<?php

namespace App\Services;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class MochiriiPrivateSocialRateLimiter
{
    public function keys(Request $request, ?Authenticatable $user = null): array
    {
        if (! $user) {
            $user = $request->bearerToken()
                ? $request->user('api')
                : $request->user('web');
        }

        $identity = $user
            ? (string) $user->getAuthIdentifier()
            : 'anonymous';
        $ip = (string) ($request->ip() ?: 'unknown');
        $key = (string) config('app.key');

        $opaqueKey = static fn (string $context, string $value) => $key !== ''
            ? hash_hmac('sha256', $context.'|'.$value, $key)
            : hash('sha256', $context.'|'.$value);

        return [
            $opaqueKey('identity', $identity),
            $opaqueKey('ip', $ip),
        ];
    }

    public function response(): \Closure
    {
        return fn (Request $request, array $headers) => $this->opaqueResponse($headers);
    }

    public function ensureMemberSyncAllowed(Request $request, Authenticatable $user): void
    {
        [$identity, $ip] = $this->keys($request, $user);
        $identityKey = 'member-sync:identity:'.$identity;
        $ipKey = 'member-sync:ip:'.$ip;
        $identityLimit = max(1, (int) config(
            'mochirii-private-media.rate_limits.member_syncs_per_minute_per_identity',
            6,
        ));
        $ipLimit = max(1, (int) config(
            'mochirii-private-media.rate_limits.member_syncs_per_minute_per_ip',
            30,
        ));

        // Redis-backed increments are atomic. Count before performing the
        // remote membership request so a concurrent burst cannot overshoot a
        // ceiling and make the expensive call first.
        $identityAttempts = RateLimiter::hit($identityKey, 60);
        $ipAttempts = RateLimiter::hit($ipKey, 60);

        if ($identityAttempts > $identityLimit || $ipAttempts > $ipLimit) {
            $retryAfter = max(
                1,
                RateLimiter::availableIn($identityKey),
                RateLimiter::availableIn($ipKey),
            );

            throw new HttpResponseException($this->opaqueResponse([
                'Retry-After' => (string) $retryAfter,
            ]));
        }
    }

    private function opaqueResponse(array $headers = [])
    {
        return response('', 429, array_merge($headers, [
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
            'Referrer-Policy' => 'no-referrer',
            'X-Content-Type-Options' => 'nosniff',
            'Vary' => 'Authorization, Cookie',
        ]));
    }
}
