<?php

namespace App\Http\Middleware;

use App\Models\UserOidcMapping;
use App\Services\MochiriiSocialSyncService;
use App\Services\MochiriiLocalAccountPolicy;
use Closure;
use Illuminate\Support\Facades\Auth;
use Laravel\Passport\RefreshToken;

class MochiriiPrivateSocial
{
    public function __construct(
        private MochiriiSocialSyncService $socialSync,
        private MochiriiLocalAccountPolicy $localAccountPolicy
    ) {}

    /**
     * Routes that expose no member content and must remain reachable before sign-in.
     * Everything else in the web stack fails closed with an opaque response.
     */
    private const PUBLIC_PATHS = [
        '/',
        'login',
        'auth/oidc/start',
        'auth/oidc/callback',
        'oauth/token',
        'logout',
        'site/privacy',
        'site/terms',
        'site/open-source',
        'site/legal-notice',
        'e/privacy',
        'e/terms',
    ];

    /**
     * @param  \Illuminate\Http\Request  $request
     * @return mixed
     */
    public function handle($request, Closure $next, $guard = 'web')
    {
        if ($guard === 'private-media') {
            // Browser image elements cannot attach Passport's CSRF header, so
            // they authenticate with the normal server session. Native clients
            // use the API guard and an Authorization bearer token.
            $guard = $request->bearerToken() ? 'api' : 'web';
        }

        $authGuard = Auth::guard($guard);
        $user = $authGuard->user();

        if ($this->isPublicRequest($request, $user !== null)) {
            return $next($request);
        }

        if (! $user || ! $this->hasCurrentMochiriiAccess($request, $user, $guard)) {
            $this->revokeDeniedAccess($request, $user, $authGuard, $guard);
            abort(404);
        }

        Auth::shouldUse($guard);

        return $next($request);
    }

    private function isPublicRequest($request, bool $signedIn): bool
    {
        $path = '/'.ltrim($request->path(), '/');

        if ($path === '/' && $signedIn) {
            return false;
        }

        if ($path === '/login' && ! $request->isMethodSafe()) {
            return ! (bool) config('remote-auth.oidc.enabled');
        }

        if (str_starts_with($path, '/password/')) {
            return ! (bool) config('remote-auth.oidc.enabled');
        }

        if ($path === '/oauth/authorize') {
            return ! $signedIn && $request->isMethodSafe();
        }

        return in_array(ltrim($path, '/'), array_map(fn ($item) => ltrim($item, '/'), self::PUBLIC_PATHS), true);
    }

    private function hasCurrentMochiriiAccess($request, $user, string $guard): bool
    {
        if (! $this->localAccountPolicy->mayAccess($user)) {
            return false;
        }

        $mapping = UserOidcMapping::where('user_id', $user->getAuthIdentifier())->first();
        $verified = $mapping
            ? $this->socialSync->hasCurrentAccess($user, (string) $mapping->oidc_id)
            : false;

        if ($verified && $guard === 'web' && $request->hasSession()) {
            $request->session()->forget('mochirii_oidc_verified');
            $request->session()->put('mochirii_oidc_verified_at', now()->getTimestamp());
        } elseif ($guard === 'web' && $request->hasSession()) {
            $request->session()->forget(['mochirii_oidc_verified', 'mochirii_oidc_verified_at']);
        }

        return $verified;
    }

    private function revokeDeniedAccess($request, $user, $authGuard, string $guard): void
    {
        if ($guard === 'api' && $user && method_exists($user, 'token')) {
            $token = $user->token();
            if ($token) {
                try {
                    $tokenId = $token->getKey();
                    if ($tokenId) {
                        $token->revoke();
                        RefreshToken::where('access_token_id', $tokenId)->update(['revoked' => true]);
                    }
                } catch (\Throwable) {
                    // A malformed or incomplete token must still fail closed;
                    // revocation cleanup must never turn denial into a 500.
                }
            }
        }

        if ($guard !== 'web') {
            return;
        }

        if ($request->hasSession()) {
            $request->session()->forget(['mochirii_oidc_verified', 'mochirii_oidc_verified_at']);
        }
        if ($user) {
            $authGuard->logout();
        }
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
    }
}
