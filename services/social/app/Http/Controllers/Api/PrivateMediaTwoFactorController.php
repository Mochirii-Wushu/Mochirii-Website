<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MochiriiPrivateMediaTwoFactor;
use Illuminate\Http\Request;

class PrivateMediaTwoFactorController extends Controller
{
    public function store(Request $request, MochiriiPrivateMediaTwoFactor $assurance)
    {
        $user = $request->user('api');
        $code = $request->input('code');

        abort_unless(
            $user
            && $request->bearerToken()
            && $assurance->requiresCheckpoint($user),
            404,
        );

        if (! is_string($code) || trim($code) === '' || strlen($code) > 32) {
            return $this->failure(422);
        }

        if (! $assurance->verifyAndConsumeCode($user, $code)) {
            return $this->failure(422);
        }

        $current = $user->fresh();
        $assertion = $current
            ? $assurance->issueNativeAssertion($request, $current)
            : null;
        if (! $assertion) {
            return $this->failure(503);
        }

        return response()->json([
            'assurance' => $assertion,
            'expires_in' => $assurance->assuranceSeconds(),
            'header' => MochiriiPrivateMediaTwoFactor::NATIVE_ASSERTION_HEADER,
        ], 200, $this->privateHeaders());
    }

    private function failure(int $status)
    {
        return response()->json([
            'message' => $status === 422
                ? 'Verification failed.'
                : 'Verification is temporarily unavailable.',
        ], $status, $this->privateHeaders());
    }

    private function privateHeaders(): array
    {
        return [
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
            'Referrer-Policy' => 'no-referrer',
            'X-Content-Type-Options' => 'nosniff',
            'Vary' => 'Authorization',
        ];
    }
}
