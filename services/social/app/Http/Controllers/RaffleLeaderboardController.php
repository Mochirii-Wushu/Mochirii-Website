<?php

namespace App\Http\Controllers;

use App\Models\UserOidcMapping;
use App\Services\MochiriiRaffleLeaderboardService;
use Illuminate\Http\Request;

class RaffleLeaderboardController extends Controller
{
    public function __invoke(Request $request, MochiriiRaffleLeaderboardService $leaderboardService)
    {
        $user = $request->user('web');
        abort_unless($user, 404);

        $mapping = UserOidcMapping::where('user_id', $user->getAuthIdentifier())->first();
        abort_unless($mapping && is_string($mapping->oidc_id), 404);

        $leaderboard = $leaderboardService->read($mapping->oidc_id);
        abort_unless($leaderboard, 404);

        return response()
            ->view('guild.raffle', ['leaderboard' => $leaderboard])
            ->withHeaders([
                'Cache-Control' => 'private, no-store, max-age=0',
                'Pragma' => 'no-cache',
                'Expires' => '0',
                'Referrer-Policy' => 'no-referrer',
                'X-Content-Type-Options' => 'nosniff',
                'X-Frame-Options' => 'DENY',
                'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            ]);
    }
}
