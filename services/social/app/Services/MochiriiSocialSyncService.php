<?php

namespace App\Services;

use App\User;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MochiriiSocialSyncService
{
    private const ACCESS_CACHE_SECONDS = 300;

    public function __construct(
        private MochiriiPrivateSocialRateLimiter $rateLimiter
    ) {}

    public function hasCurrentAccess(User $user, string $oidcId): bool
    {
        $cacheKey = $this->accessCacheKey($user, $oidcId);
        $failureCacheKey = $cacheKey.':failed';

        try {
            if (Cache::get($cacheKey) === true) {
                return true;
            }
            if (Cache::get($failureCacheKey) === true) {
                return false;
            }

            $timeout = max(1, min(10, (int) config('remote-auth.social_sync.timeout', 5)));

            return (bool) Cache::lock($cacheKey.':refresh', $timeout + 2)
                ->block($timeout + 1, function () use ($cacheKey, $failureCacheKey, $user, $oidcId) {
                    // A waiter must always recheck after the lock owner
                    // finishes. This keeps one remote request in flight per
                    // member and lets every waiter reuse its bounded result.
                    if (Cache::get($cacheKey) === true) {
                        return true;
                    }
                    if (Cache::get($failureCacheKey) === true) {
                        return false;
                    }

                    $this->rateLimiter->ensureMemberSyncAllowed(request(), $user);
                    $verified = $this->performSync($user, $oidcId, 'access_check');
                    if (! $verified) {
                        Cache::put(
                            $failureCacheKey,
                            true,
                            max(1, min(30, (int) config(
                                'remote-auth.social_sync.failure_cache_seconds',
                                5,
                            ))),
                        );
                    }

                    return $verified;
                });
        } catch (HttpResponseException $error) {
            throw $error;
        } catch (LockTimeoutException) {
            // A slow in-flight check is not an authorization grant. The next
            // request may retry after the bounded lock wait.
            return false;
        } catch (\Throwable $error) {
            Log::warning('Mochirii Social current-access coordination failed.', [
                'exception' => get_class($error),
            ]);

            return false;
        }
    }

    public function sync(User $user, string $oidcId, string $event = 'login'): bool
    {
        $this->rateLimiter->ensureMemberSyncAllowed(request(), $user);

        return $this->performSync($user, $oidcId, $event);
    }

    private function performSync(User $user, string $oidcId, string $event): bool
    {
        $cacheKey = $this->accessCacheKey($user, $oidcId);
        $failureCacheKey = $cacheKey.':failed';
        $endpoint = trim((string) config('remote-auth.social_sync.endpoint'));
        $secret = trim((string) config('remote-auth.social_sync.secret'));

        if (! $endpoint || ! $secret) {
            Log::warning('Mochirii Social account sync is not configured.', [
                'has_endpoint' => (bool) $endpoint,
                'has_secret' => (bool) $secret,
            ]);

            Cache::forget($cacheKey);

            return false;
        }

        $payload = [
            'sub' => $oidcId,
            'provider_user_id' => (string) $user->id,
            'username' => $user->username,
            'profile_url' => url($user->username),
            'event' => $event,
            'timestamp' => now()->toJSON(),
        ];

        try {
            $response = Http::timeout((int) config('remote-auth.social_sync.timeout', 5))
                ->acceptJson()
                ->withHeaders([
                    'x-mochirii-social-sync-secret' => $secret,
                ])
                ->post($endpoint, $payload);
        } catch (\Throwable $error) {
            Log::warning('Mochirii Social account sync request failed.', [
                'exception' => get_class($error),
                'code' => is_int($error->getCode()) || is_string($error->getCode())
                    ? substr((string) $error->getCode(), 0, 40)
                    : null,
            ]);

            Cache::forget($cacheKey);

            return false;
        }

        if (! $response->successful()) {
            Log::warning('Mochirii Social account sync was rejected.', [
                'status' => $response->status(),
            ]);

            Cache::forget($cacheKey);

            return false;
        }

        $body = $response->json();
        if (! is_array($body) || ($body['ok'] ?? false) !== true || ($body['status'] ?? null) !== 'synced') {
            Log::warning('Mochirii Social account sync returned an invalid response.', [
                'status' => $response->status(),
            ]);
            Cache::forget($cacheKey);

            return false;
        }

        Cache::forget($failureCacheKey);
        Cache::put($cacheKey, true, self::ACCESS_CACHE_SECONDS);

        return true;
    }

    private function accessCacheKey(User $user, string $oidcId): string
    {
        return 'mochirii:social:member-access:'.hash('sha256', (string) $user->getAuthIdentifier().'|'.$oidcId);
    }
}
