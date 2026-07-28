<?php

namespace Tests\Feature;

use App\Models\UserOidcMapping;
use App\Services\MochiriiRaffleLeaderboardService;
use App\Services\MochiriiSocialSyncService;
use App\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class RaffleLeaderboardPageTest extends TestCase
{
    private const SUBJECT = '8ccaa7af-909f-44e7-84cb-67cdccb56be6';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
            'pixelfed.enforce_email_verification' => false,
        ]);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('name')->nullable();
            $table->string('username')->nullable()->unique();
            $table->string('email')->unique();
            $table->string('password');
            $table->rememberToken();
            $table->boolean('is_admin')->default(false);
            $table->boolean('2fa_enabled')->default(false);
            $table->string('status')->nullable();
            $table->unsignedBigInteger('profile_id')->nullable();
            $table->string('app_register_ip')->nullable();
            $table->string('register_source')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('user_oidc_mappings', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id')->index();
            $table->string('oidc_id')->unique();
            $table->timestamps();
        });
        User::unsetEventDispatcher();
    }

    #[Test]
    public function signed_out_visitors_receive_an_opaque_not_found_response(): void
    {
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('read');
        });

        $this->get('/guild/raffle')->assertNotFound();
    }

    #[Test]
    public function verified_members_receive_the_private_no_store_leaderboard(): void
    {
        $user = $this->verifiedUser();
        $this->allowPrivateBoundary($user);
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) {
            $mock->shouldReceive('read')
                ->once()
                ->with(self::SUBJECT)
                ->andReturn($this->leaderboard());
        });
        Auth::guard('web')->setUser($user);

        $response = $this->get('/guild/raffle');

        $response->assertOk()
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private')
            ->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
            ->assertSee('Monthly Raffle Leaderboard')
            ->assertSee('Each point is one raffle entry.')
            ->assertSee('Points')
            ->assertSee('Mōchī Member')
            ->assertSee('/guild/raffle', false)
            ->assertDontSee('Pixelfed')
            ->assertDontSee('Supabase');
        $this->assertGreaterThanOrEqual(2, substr_count(
            $response->getContent(),
            'href="'.route('guild.raffle').'"',
        ), 'Desktop and mobile member navigation must both link to the private raffle page.');
    }

    #[Test]
    public function verified_members_receive_a_private_empty_state_when_no_drawing_is_active(): void
    {
        $user = $this->verifiedUser();
        $this->allowPrivateBoundary($user);
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) {
            $mock->shouldReceive('read')->once()->andReturn([
                'cycleLabel' => 'No active drawing',
                'asOf' => '2026-07-28T01:02:03Z',
                'entries' => [],
            ]);
        });
        Auth::guard('web')->setUser($user);

        $this->get('/guild/raffle')
            ->assertOk()
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private')
            ->assertSee('No active drawing')
            ->assertSee('No active raffle standings')
            ->assertDontSee('Guild member</th>', false);
    }

    #[Test]
    public function display_names_are_escaped_before_rendering(): void
    {
        $user = $this->verifiedUser();
        $this->allowPrivateBoundary($user);
        $payload = $this->leaderboard();
        $payload['entries'][0]['displayName'] = '<img src=x onerror=alert(1)>';
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) use ($payload) {
            $mock->shouldReceive('read')->once()->andReturn($payload);
        });
        Auth::guard('web')->setUser($user);

        $this->get('/guild/raffle')
            ->assertOk()
            ->assertSee('&lt;img src=x onerror=alert(1)&gt;', false)
            ->assertDontSee('<img src=x onerror=alert(1)>', false);
    }

    #[Test]
    public function missing_mapping_or_upstream_failure_fails_closed(): void
    {
        $unmappedUser = $this->verifiedUser(false);
        $this->partialMock(MochiriiSocialSyncService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('hasCurrentAccess');
        });
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('read');
        });
        Auth::guard('web')->setUser($unmappedUser);
        $this->get('/guild/raffle')->assertNotFound();

        $user = $this->verifiedUser();
        $this->allowPrivateBoundary($user);
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) {
            $mock->shouldReceive('read')->once()->with(self::SUBJECT)->andReturn(null);
        });
        Auth::guard('web')->setUser($user);
        $this->get('/guild/raffle')->assertNotFound();
    }

    #[Test]
    public function verified_member_requests_are_bounded_by_the_existing_rate_limiter(): void
    {
        $user = $this->verifiedUser();
        $this->partialMock(MochiriiSocialSyncService::class, function (MockInterface $mock) use ($user) {
            $mock->shouldReceive('hasCurrentAccess')
                ->times(31)
                ->with($user, self::SUBJECT)
                ->andReturn(true);
        });
        $this->mock(MochiriiRaffleLeaderboardService::class, function (MockInterface $mock) {
            $mock->shouldReceive('read')
                ->times(30)
                ->with(self::SUBJECT)
                ->andReturn($this->leaderboard());
        });
        Auth::guard('web')->setUser($user);

        for ($requestNumber = 1; $requestNumber <= 30; $requestNumber++) {
            $this->get('/guild/raffle')->assertOk();
        }
        $this->get('/guild/raffle')->assertStatus(429);
    }

    private function verifiedUser(bool $mapped = true): User
    {
        $user = User::create([
            'name' => 'Verified Member',
            'username' => 'verifiedmember'.User::count(),
            'email' => 'verified.member'.User::count().'@example.test',
            'password' => 'not-used',
            'register_source' => 'oidc',
            'email_verified_at' => now(),
        ]);

        if ($mapped) {
            UserOidcMapping::create([
                'user_id' => $user->id,
                'oidc_id' => self::SUBJECT,
            ]);
        }

        return $user;
    }

    private function allowPrivateBoundary(User $user): void
    {
        $this->partialMock(MochiriiSocialSyncService::class, function (MockInterface $mock) use ($user) {
            $mock->shouldReceive('hasCurrentAccess')
                ->once()
                ->with($user, self::SUBJECT)
                ->andReturn(true);
        });
    }

    /**
     * @return array{cycleLabel: string, asOf: string, entries: list<array{rank: int, displayName: string, entryCount: int}>}
     */
    private function leaderboard(): array
    {
        return [
            'cycleLabel' => 'July 2026',
            'asOf' => '2026-07-28T01:02:03Z',
            'entries' => [
                ['rank' => 1, 'displayName' => 'Mōchī Member', 'entryCount' => 10],
            ],
        ];
    }
}
