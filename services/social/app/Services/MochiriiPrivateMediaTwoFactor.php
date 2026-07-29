<?php

namespace App\Services;

use App\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use PragmaRX\Google2FA\Google2FA;

class MochiriiPrivateMediaTwoFactor
{
    public const NATIVE_ASSERTION_HEADER = 'X-Mochirii-Media-Assurance';

    private const ASSERTION_VERSION = 1;

    private const SESSION_ACTIVE = '2fa.session.active';

    private const SESSION_FINGERPRINT = '2fa.session.fingerprint';

    private const SESSION_VERIFIED_AT = '2fa.session.verified_at';

    public function satisfied(Request $request, User $user): bool
    {
        if (! $this->requiresCheckpoint($user)) {
            return true;
        }

        if (! $this->hasUsableFactor($user)) {
            return false;
        }

        return $request->bearerToken()
            ? $this->nativeSatisfied($request, $user)
            : $this->browserSatisfied($request, $user);
    }

    public function requiresCheckpoint(User $user): bool
    {
        return (bool) $user->{'2fa_enabled'};
    }

    public function browserSatisfied(Request $request, User $user): bool
    {
        if (! $request->hasSession() || ! $this->hasUsableFactor($user)) {
            return false;
        }

        $active = $request->session()->get(self::SESSION_ACTIVE);
        $fingerprint = $request->session()->get(self::SESSION_FINGERPRINT);
        $verifiedAt = $request->session()->get(self::SESSION_VERIFIED_AT);
        $now = now()->getTimestamp();

        return $active === true
            && is_string($fingerprint)
            && hash_equals($this->factorFingerprint($user), $fingerprint)
            && is_int($verifiedAt)
            && $verifiedAt <= $now
            && ($now - $verifiedAt) <= $this->assuranceSeconds();
    }

    public function markBrowserSatisfied(Request $request, User $user): bool
    {
        if (! $request->hasSession() || ! $this->hasUsableFactor($user)) {
            return false;
        }

        $request->session()->put([
            self::SESSION_ACTIVE => true,
            self::SESSION_FINGERPRINT => $this->factorFingerprint($user),
            self::SESSION_VERIFIED_AT => now()->getTimestamp(),
        ]);

        return true;
    }

    public function clearBrowser(Request $request): void
    {
        if (! $request->hasSession()) {
            return;
        }

        $request->session()->forget([
            self::SESSION_ACTIVE,
            self::SESSION_FINGERPRINT,
            self::SESSION_VERIFIED_AT,
        ]);
    }

    public function issueNativeAssertion(Request $request, User $user): ?string
    {
        $bearer = $this->boundedBearer($request);
        if (! $bearer || ! $this->hasUsableFactor($user)) {
            return null;
        }

        $issuedAt = now()->getTimestamp();
        $payload = [
            'v' => self::ASSERTION_VERSION,
            'sub' => (string) $user->getAuthIdentifier(),
            'token' => hash('sha256', $bearer),
            'factor' => $this->factorFingerprint($user),
            'iat' => $issuedAt,
            'exp' => $issuedAt + $this->assuranceSeconds(),
        ];

        try {
            return Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR));
        } catch (\Throwable) {
            return null;
        }
    }

    public function verifyAndConsumeCode(User $user, string $code): bool
    {
        $code = trim($code);
        if ($code === '' || strlen($code) > 32) {
            return false;
        }

        try {
            return (bool) DB::transaction(function () use ($user, $code) {
                $current = User::query()->lockForUpdate()->find($user->getAuthIdentifier());
                if (! $current || ! $this->hasUsableFactor($current)) {
                    return false;
                }

                $totp = false;
                try {
                    $totp = (new Google2FA)->verifyKey((string) $current->{'2fa_secret'}, $code);
                } catch (\Throwable) {
                    $totp = false;
                }

                if ($totp) {
                    return $this->reserveTotp($current, $code);
                }

                $codes = json_decode((string) $current->{'2fa_backup_codes'}, true);
                if (! is_array($codes)) {
                    return false;
                }

                foreach ($codes as $index => $candidate) {
                    if (! is_string($candidate) || ! hash_equals($candidate, $code)) {
                        continue;
                    }

                    unset($codes[$index]);
                    $current->{'2fa_backup_codes'} = json_encode(array_values($codes), JSON_THROW_ON_ERROR);
                    $current->save();

                    return true;
                }

                return false;
            }, 3);
        } catch (\Throwable) {
            return false;
        }
    }

    public function assuranceSeconds(): int
    {
        return max(300, min(43_200, (int) config('mochirii-private-media.two_factor_assurance_seconds', 43_200)));
    }

    private function nativeSatisfied(Request $request, User $user): bool
    {
        $bearer = $this->boundedBearer($request);
        $assertion = trim((string) $request->header(self::NATIVE_ASSERTION_HEADER, ''));
        if (! $bearer || $assertion === '' || strlen($assertion) > 4096) {
            return false;
        }

        try {
            $payload = json_decode(Crypt::decryptString($assertion), true, 8, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return false;
        }

        if (! is_array($payload)
            || array_keys($payload) !== ['v', 'sub', 'token', 'factor', 'iat', 'exp']
            || $payload['v'] !== self::ASSERTION_VERSION
            || ! is_string($payload['sub'])
            || ! is_string($payload['token'])
            || ! is_string($payload['factor'])
            || ! is_int($payload['iat'])
            || ! is_int($payload['exp'])) {
            return false;
        }

        $now = now()->getTimestamp();
        $lifetime = $payload['exp'] - $payload['iat'];

        return $lifetime > 0
            && $lifetime <= $this->assuranceSeconds()
            && $payload['iat'] <= ($now + 30)
            && $payload['iat'] >= ($now - $this->assuranceSeconds() - 30)
            && $payload['exp'] > $now
            && hash_equals((string) $user->getAuthIdentifier(), $payload['sub'])
            && hash_equals(hash('sha256', $bearer), $payload['token'])
            && hash_equals($this->factorFingerprint($user), $payload['factor']);
    }

    private function boundedBearer(Request $request): ?string
    {
        $bearer = $request->bearerToken();

        return is_string($bearer) && strlen($bearer) >= 16 && strlen($bearer) <= 4096
            ? $bearer
            : null;
    }

    private function hasUsableFactor(User $user): bool
    {
        return $this->requiresCheckpoint($user)
            && is_string($user->{'2fa_secret'})
            && trim((string) $user->{'2fa_secret'}) !== '';
    }

    private function factorFingerprint(User $user): string
    {
        $setupAt = $user->{'2fa_setup_at'};
        $setup = $setupAt instanceof \DateTimeInterface
            ? $setupAt->format('U.u')
            : (string) $setupAt;

        return hash('sha256', implode('|', [
            (string) $user->getAuthIdentifier(),
            hash('sha256', (string) $user->{'2fa_secret'}),
            $setup,
        ]));
    }

    private function reserveTotp(User $user, string $code): bool
    {
        $key = 'mochirii:private-media:totp:'.hash('sha256', implode('|', [
            (string) $user->getAuthIdentifier(),
            $this->factorFingerprint($user),
            $code,
        ]));

        try {
            return Cache::add($key, true, now()->addSeconds(90));
        } catch (\Throwable) {
            return false;
        }
    }
}
