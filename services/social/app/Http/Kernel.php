<?php

namespace App\Http;

use App\Http\Middleware\AccountInterstitial;
use App\Http\Middleware\Admin;
use App\Http\Middleware\AdminOrNotFound;
use App\Http\Middleware\DangerZone;
use App\Http\Middleware\EmailVerificationCheck;
use App\Http\Middleware\EncryptCookies;
use App\Http\Middleware\FrameGuard;
use App\Http\Middleware\Localization;
use App\Http\Middleware\MochiriiPrivateMediaTwoFactor;
use App\Http\Middleware\MochiriiPrivateSocial;
use App\Http\Middleware\MochiriiRequestId;
use App\Http\Middleware\RedirectIfAuthenticated;
use App\Http\Middleware\RejectRetiredPublicRoutes;
use App\Http\Middleware\TrimStrings;
use App\Http\Middleware\TrustProxies;
use App\Http\Middleware\TwoFactorAuth;
use App\Http\Middleware\VerifyCsrfToken;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Auth\Middleware\AuthenticateWithBasicAuth;
use Illuminate\Auth\Middleware\Authorize;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Session\Middleware\AuthenticatesSessions;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Foundation\Http\Kernel as HttpKernel;
use Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\HandlePrecognitiveRequests;
use Illuminate\Foundation\Http\Middleware\ValidatePostSize;
use Illuminate\Http\Middleware\HandleCors;
use Illuminate\Http\Middleware\SetCacheHeaders;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Middleware\ThrottleRequestsWithRedis;
use Illuminate\Routing\Middleware\ValidateSignature;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;
use Laravel\Passport\Http\Middleware\CheckForAnyScope;
use Laravel\Passport\Http\Middleware\CheckScopes;
use Laravel\Passport\Http\Middleware\CreateFreshApiToken;

class Kernel extends HttpKernel
{
    /**
     * Keep the private Social boundary ahead of controller authentication so
     * signed-out member routes return an opaque response instead of redirecting.
     *
     * @var string[]
     */
    protected $middlewarePriority = [
        HandlePrecognitiveRequests::class,
        \Illuminate\Cookie\Middleware\EncryptCookies::class,
        AddQueuedCookiesToResponse::class,
        StartSession::class,
        MochiriiPrivateSocial::class,
        ShareErrorsFromSession::class,
        AuthenticatesRequests::class,
        ThrottleRequests::class,
        ThrottleRequestsWithRedis::class,
        MochiriiPrivateMediaTwoFactor::class,
        AuthenticatesSessions::class,
        SubstituteBindings::class,
        Authorize::class,
    ];

    /**
     * The application's global HTTP middleware stack.
     *
     * These middleware are run during every request to your application.
     *
     * @var array
     */
    protected $middleware = [
        MochiriiRequestId::class,
        HandleCors::class,
        RejectRetiredPublicRoutes::class,
        CheckForMaintenanceMode::class,
        ValidatePostSize::class,
        TrustProxies::class,
        TrimStrings::class,
        ConvertEmptyStringsToNull::class,
    ];

    /**
     * The application's route middleware groups.
     *
     * @var array
     */
    protected $middlewareGroups = [
        'web' => [
            EncryptCookies::class,
            FrameGuard::class,
            AddQueuedCookiesToResponse::class,
            StartSession::class,
            AuthenticateSession::class,
            MochiriiPrivateSocial::class,
            ShareErrorsFromSession::class,
            VerifyCsrfToken::class,
            SubstituteBindings::class,
            CreateFreshApiToken::class,
            // 'restricted',
        ],

        'oauth-web' => [
            EncryptCookies::class,
            FrameGuard::class,
            AddQueuedCookiesToResponse::class,
            StartSession::class,
            ShareErrorsFromSession::class,
            VerifyCsrfToken::class,
            SubstituteBindings::class,
            CreateFreshApiToken::class,
        ],

        'api' => [
            'bindings',
        ],

        // Private media must accept the existing browser session as well as a
        // native Passport bearer token. This deliberately omits the complete
        // web group so native requests are not rejected by the web guard.
        'private-media' => [
            EncryptCookies::class,
            AddQueuedCookiesToResponse::class,
            StartSession::class,
            SubstituteBindings::class,
        ],
    ];

    /**
     * The application's route middleware.
     *
     * These middleware may be assigned to groups or used individually.
     *
     * @var array
     */
    protected $routeMiddleware = [
        'api.admin' => Middleware\Api\Admin::class,
        'admin' => Admin::class,
        'admin.notfound' => AdminOrNotFound::class,
        'auth' => Authenticate::class,
        'auth.basic' => AuthenticateWithBasicAuth::class,
        'bindings' => SubstituteBindings::class,
        'cache.headers' => SetCacheHeaders::class,
        'can' => Authorize::class,
        'dangerzone' => DangerZone::class,
        'localization' => Localization::class,
        'mochirii.federation-disabled' => Middleware\MochiriiFederationDisabled::class,
        'mochirii.private' => MochiriiPrivateSocial::class,
        'mochirii.private-media-2fa' => MochiriiPrivateMediaTwoFactor::class,
        'guest' => RedirectIfAuthenticated::class,
        'signed' => ValidateSignature::class,
        'throttle' => ThrottleRequests::class,
        'twofactor' => TwoFactorAuth::class,
        'validemail' => EmailVerificationCheck::class,
        'interstitial' => AccountInterstitial::class,
        'scopes' => CheckScopes::class,
        'scope' => CheckForAnyScope::class,
        // 'restricted'    => \App\Http\Middleware\RestrictedAccess::class,
    ];
}
