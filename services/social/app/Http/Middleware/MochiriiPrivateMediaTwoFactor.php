<?php

namespace App\Http\Middleware;

use App\Services\MochiriiPrivateMediaTwoFactor as PrivateMediaTwoFactor;
use Closure;
use Illuminate\Http\Request;

class MochiriiPrivateMediaTwoFactor
{
    public function __construct(private PrivateMediaTwoFactor $assurance) {}

    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();

        if (! $user || ! $this->assurance->satisfied($request, $user)) {
            abort(404);
        }

        return $next($request);
    }
}
