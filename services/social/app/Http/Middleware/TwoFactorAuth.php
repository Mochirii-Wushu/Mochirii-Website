<?php

namespace App\Http\Middleware;

use App\Services\MochiriiPrivateMediaTwoFactor;
use Auth;
use Closure;
use Illuminate\Http\Request;

class TwoFactorAuth
{
    public function __construct(private MochiriiPrivateMediaTwoFactor $assurance) {}

    /**
     * Handle an incoming request.
     *
     * @param  Request  $request
     * @return mixed
     */
    public function handle($request, Closure $next)
    {
        if ($request->user()) {
            $user = $request->user();
            $enabled = (bool) $user->{'2fa_enabled'};
            if ($enabled != false) {
                $checkpoint = 'i/auth/checkpoint';
                if (! $this->assurance->browserSatisfied($request, $user) && ! $request->is($checkpoint) && ! $request->is('logout')) {
                    return redirect('/i/auth/checkpoint');
                } elseif ($request->session()->has('2fa.attempts') && (int) $request->session()->get('2fa.attempts') > 3) {
                    $request->session()->pull('2fa.attempts');
                    $this->assurance->clearBrowser($request);
                    Auth::logout();
                }
            }
        }

        return $next($request);
    }
}
