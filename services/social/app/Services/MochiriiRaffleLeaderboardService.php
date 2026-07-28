<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MochiriiRaffleLeaderboardService
{
    private const ENDPOINT_HOST = 'deyvmtncimmcinldjyqe.supabase.co';

    private const ENDPOINT_PATH = '/functions/v1/get-current-raffle';

    private const MAX_RESPONSE_BYTES = 65536;

    private const MAX_ENTRIES = 250;

    private const SUBJECT_PATTERN = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/Di';

    private const NONCE_PATTERN = '/\A[0-9a-f]{32}\z/D';

    private const TIMESTAMP_PATTERN = '/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\z/D';

    private const BIDI_CONTROL_PATTERN = '/[\x{061C}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u';

    /**
     * @return array{cycleLabel: string, asOf: string, entries: list<array{rank: int, displayName: string, entryCount: int}>}|null
     */
    public function read(string $oidcSubject): ?array
    {
        $endpoint = trim((string) config('remote-auth.raffle_leaderboard.endpoint'));
        $secret = (string) config('remote-auth.raffle_leaderboard.secret');
        $timeout = (int) config('remote-auth.raffle_leaderboard.timeout', 5);

        if (! $this->validEndpoint($endpoint) || strlen($secret) < 32 || ! preg_match(self::SUBJECT_PATTERN, $oidcSubject)) {
            return null;
        }

        try {
            $subject = strtolower($oidcSubject);
            $timestamp = (string) now()->getTimestamp();
            $nonce = bin2hex(random_bytes(16));
            if (! preg_match(self::NONCE_PATTERN, $nonce)) {
                return null;
            }

            $canonical = implode("\n", ['v1', $subject, $timestamp, $nonce]);
            $signature = 'v1='.hash_hmac('sha256', $canonical, $secret);

            $response = Http::acceptJson()
                ->asJson()
                ->withOptions(['allow_redirects' => false])
                ->connectTimeout(min(3, $timeout))
                ->timeout($timeout)
                ->withHeaders([
                    'x-mochirii-raffle-timestamp' => $timestamp,
                    'x-mochirii-raffle-nonce' => $nonce,
                    'x-mochirii-raffle-signature' => $signature,
                ])
                ->post($endpoint, ['sub' => $subject]);
        } catch (\Throwable $exception) {
            Log::warning('Mōchirīī raffle leaderboard request failed.', [
                'exception' => $exception::class,
            ]);

            return null;
        }

        $contentType = strtolower((string) $response->header('Content-Type'));
        $body = $response->body();
        if ($response->status() !== 200 || ! str_starts_with($contentType, 'application/json') || strlen($body) > self::MAX_RESPONSE_BYTES) {
            Log::warning('Mōchirīī raffle leaderboard request was rejected.', [
                'status' => $response->status(),
            ]);

            return null;
        }

        try {
            $payload = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return $this->validatedPayload($payload);
    }

    private function validEndpoint(string $endpoint): bool
    {
        if ($endpoint === '' || strlen($endpoint) > 2048 || filter_var($endpoint, FILTER_VALIDATE_URL) === false) {
            return false;
        }

        $parts = parse_url($endpoint);

        return is_array($parts)
            && ($parts['scheme'] ?? null) === 'https'
            && strtolower((string) ($parts['host'] ?? '')) === self::ENDPOINT_HOST
            && ($parts['path'] ?? null) === self::ENDPOINT_PATH
            && ! isset($parts['user'])
            && ! isset($parts['pass'])
            && ! isset($parts['port'])
            && ! isset($parts['fragment'])
            && ! isset($parts['query']);
    }

    /**
     * @return array{cycleLabel: string, asOf: string, entries: list<array{rank: int, displayName: string, entryCount: int}>}|null
     */
    private function validatedPayload(mixed $payload): ?array
    {
        if (! is_array($payload) || ! $this->hasExactKeys($payload, ['cycleLabel', 'asOf', 'entries'])) {
            return null;
        }

        if (! $this->validText($payload['cycleLabel'] ?? null, 80)
            || ! $this->validTimestamp($payload['asOf'] ?? null)
            || ! is_array($payload['entries'] ?? null)
            || ! array_is_list($payload['entries'])
            || count($payload['entries']) > self::MAX_ENTRIES) {
            return null;
        }

        $entries = [];
        $previousRank = 0;
        $previousCount = null;
        foreach ($payload['entries'] as $entry) {
            if (! is_array($entry) || ! $this->hasExactKeys($entry, ['rank', 'displayName', 'entryCount'])) {
                return null;
            }

            $rank = $entry['rank'] ?? null;
            $displayName = $entry['displayName'] ?? null;
            $entryCount = $entry['entryCount'] ?? null;
            if (! is_int($rank) || $rank < 1 || $rank > self::MAX_ENTRIES
                || ! $this->validText($displayName, 80)
                || ! is_int($entryCount) || $entryCount < 1 || $entryCount > 10) {
                return null;
            }

            if ($previousCount === null && $rank !== 1) {
                return null;
            }
            if ($previousCount !== null) {
                $expectedRank = $entryCount === $previousCount ? $previousRank : $previousRank + 1;
                if ($entryCount > $previousCount || $rank !== $expectedRank) {
                    return null;
                }
            }

            $entries[] = [
                'rank' => $rank,
                'displayName' => $displayName,
                'entryCount' => $entryCount,
            ];
            $previousRank = $rank;
            $previousCount = $entryCount;
        }

        return [
            'cycleLabel' => $payload['cycleLabel'],
            'asOf' => $payload['asOf'],
            'entries' => $entries,
        ];
    }

    private function validText(mixed $value, int $maxLength): bool
    {
        return is_string($value)
            && $value !== ''
            && trim($value) === $value
            && mb_strlen($value) <= $maxLength
            && preg_match('//u', $value) === 1
            && preg_match('/[\x00-\x1F\x7F]/u', $value) !== 1
            && preg_match(self::BIDI_CONTROL_PATTERN, $value) !== 1;
    }

    private function validTimestamp(mixed $value): bool
    {
        if (! is_string($value) || ! preg_match(self::TIMESTAMP_PATTERN, $value)) {
            return false;
        }

        try {
            new \DateTimeImmutable($value);

            return true;
        } catch (\Exception) {
            return false;
        }
    }

    /** @param string[] $expected */
    private function hasExactKeys(array $value, array $expected): bool
    {
        $keys = array_keys($value);
        sort($keys);
        sort($expected);

        return $keys === $expected;
    }
}
