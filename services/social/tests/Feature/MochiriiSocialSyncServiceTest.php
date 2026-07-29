<?php

namespace Tests\Feature;

use App\Services\MochiriiSocialSyncService;
use App\User;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Mockery;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class MochiriiSocialSyncServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'remote-auth.social_sync.endpoint' => 'https://example.test/functions/v1/social-sync',
            'remote-auth.social_sync.secret' => 'test-only-secret',
            'remote-auth.social_sync.timeout' => 2,
        ]);
        Cache::flush();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    #[Test]
    public function current_access_uses_a_bounded_five_minute_success_cache(): void
    {
        Carbon::setTestNow('2026-07-27T12:00:00Z');
        Http::fake(['*' => Http::response(['ok' => true, 'status' => 'synced'], 200)]);
        $service = app(MochiriiSocialSyncService::class);
        $user = $this->user(42);

        $this->assertTrue($service->hasCurrentAccess($user, '8ccaa7af-909f-44e7-84cb-67cdccb56be6'));
        $this->assertTrue($service->hasCurrentAccess($user, '8ccaa7af-909f-44e7-84cb-67cdccb56be6'));
        Http::assertSentCount(1);

        Carbon::setTestNow(now()->addSeconds(301));
        $this->assertTrue($service->hasCurrentAccess($user, '8ccaa7af-909f-44e7-84cb-67cdccb56be6'));
        Http::assertSentCount(2);
    }

    #[Test]
    public function failed_syncs_fail_closed_and_concurrent_waiters_reuse_a_brief_negative_result(): void
    {
        Carbon::setTestNow('2026-07-27T12:00:00Z');
        Http::fakeSequence()
            ->push(['ok' => false, 'error' => 'current_member_access_required'], 403)
            ->push(['status' => 'synced'], 200);
        $service = app(MochiriiSocialSyncService::class);
        $user = $this->user(43);

        $this->assertFalse($service->hasCurrentAccess($user, '8ccaa7af-909f-44e7-84cb-67cdccb56be6'));
        $this->assertFalse($service->hasCurrentAccess($user, '8ccaa7af-909f-44e7-84cb-67cdccb56be6'));
        Http::assertSentCount(1);

        Carbon::setTestNow(now()->addSeconds(6));
        $this->assertFalse($service->hasCurrentAccess($user, '8ccaa7af-909f-44e7-84cb-67cdccb56be6'));
        Http::assertSentCount(2);
    }

    #[Test]
    public function a_slow_successful_sync_is_single_flight_and_then_served_from_cache(): void
    {
        Http::fake(function () {
            usleep(50_000);

            return Http::response(['ok' => true, 'status' => 'synced'], 200);
        });
        $service = app(MochiriiSocialSyncService::class);
        $user = $this->user(45);

        $this->assertTrue($service->hasCurrentAccess($user, '1d4b5ca4-11de-4fbd-8e48-b6c518444db0'));
        $this->assertTrue($service->hasCurrentAccess($user, '1d4b5ca4-11de-4fbd-8e48-b6c518444db0'));
        Http::assertSentCount(1);
    }

    #[Test]
    public function a_concurrent_waiter_rechecks_the_cache_after_the_lock_owner_finishes(): void
    {
        Http::fake();
        $user = $this->user(46);
        $oidcId = '4382d619-2746-4e5f-8315-885c42ef3ddc';
        $cacheKey = 'mochirii:social:member-access:'.hash('sha256', $user->id.'|'.$oidcId);
        $lock = Mockery::mock(Lock::class);

        Cache::shouldReceive('get')->with($cacheKey)->twice()->andReturn(false, true);
        Cache::shouldReceive('get')->with($cacheKey.':failed')->once()->andReturn(false);
        Cache::shouldReceive('lock')->with($cacheKey.':refresh', 4)->once()->andReturn($lock);
        $lock->shouldReceive('block')
            ->with(3, Mockery::on(fn ($callback) => is_callable($callback)))
            ->once()
            ->andReturnUsing(fn ($seconds, $callback) => $callback());

        $this->assertTrue(app(MochiriiSocialSyncService::class)->hasCurrentAccess($user, $oidcId));
        Http::assertNothingSent();
    }

    #[Test]
    public function a_waiter_that_cannot_acquire_a_slow_sync_lock_fails_closed(): void
    {
        Http::fake();
        $user = $this->user(47);
        $oidcId = '3589dfc7-3a37-4611-b261-36b6f47278d0';
        $cacheKey = 'mochirii:social:member-access:'.hash('sha256', $user->id.'|'.$oidcId);
        $lock = Mockery::mock(Lock::class);

        Cache::shouldReceive('get')->with($cacheKey)->once()->andReturn(false);
        Cache::shouldReceive('get')->with($cacheKey.':failed')->once()->andReturn(false);
        Cache::shouldReceive('lock')->with($cacheKey.':refresh', 4)->once()->andReturn($lock);
        $lock->shouldReceive('block')->with(3, Mockery::type('callable'))->once()
            ->andThrow(new LockTimeoutException);

        $this->assertFalse(app(MochiriiSocialSyncService::class)->hasCurrentAccess($user, $oidcId));
        Http::assertNothingSent();
    }

    #[Test]
    public function the_identity_and_ip_limiter_rejects_before_a_second_remote_sync(): void
    {
        Carbon::setTestNow('2026-07-27T12:00:00Z');
        config([
            'remote-auth.social_sync.failure_cache_seconds' => 1,
            'mochirii-private-media.rate_limits.member_syncs_per_minute_per_identity' => 1,
            'mochirii-private-media.rate_limits.member_syncs_per_minute_per_ip' => 1,
        ]);
        $this->app->instance('request', Request::create(
            '/member-content',
            'GET',
            [],
            [],
            [],
            ['REMOTE_ADDR' => '198.51.100.40'],
        ));
        Http::fake(['*' => Http::response(['ok' => false], 503)]);
        $service = app(MochiriiSocialSyncService::class);
        $user = $this->user(48);
        $oidcId = 'c8c99a29-31dc-443c-8fd1-451e2f2df12f';

        $this->assertFalse($service->hasCurrentAccess($user, $oidcId));
        Carbon::setTestNow(now()->addSeconds(2));

        try {
            $service->hasCurrentAccess($user, $oidcId);
            $this->fail('The second remote member sync must be rate limited.');
        } catch (HttpResponseException $error) {
            $response = $error->getResponse();
            $this->assertSame(429, $response->getStatusCode());
            $this->assertSame('', $response->getContent());
            $cacheControl = (string) $response->headers->get('Cache-Control');
            $this->assertStringContainsString('private', $cacheControl);
            $this->assertStringContainsString('no-store', $cacheControl);
            $this->assertStringContainsString('max-age=0', $cacheControl);
            $this->assertNotNull($response->headers->get('Retry-After'));
        }

        Http::assertSentCount(1);
    }

    #[Test]
    public function transport_failures_do_not_log_raw_exception_messages(): void
    {
        Log::spy();
        Http::fake(function () {
            throw new \RuntimeException('client_secret=must-not-appear access_token=must-not-appear');
        });

        $service = app(MochiriiSocialSyncService::class);
        $this->assertFalse($service->sync(
            $this->user(44),
            '8ccaa7af-909f-44e7-84cb-67cdccb56be6',
            'access_check',
        ));

        Log::shouldHaveReceived('warning')
            ->once()
            ->with(
                'Mochirii Social account sync request failed.',
                Mockery::on(fn ($context) => is_array($context) &&
                    ($context['exception'] ?? null) === \RuntimeException::class &&
                    ! array_key_exists('message', $context) &&
                    ! str_contains(json_encode($context), 'must-not-appear')),
            );
    }

    private function user(int $id): User
    {
        $user = new User([
            'name' => 'Verified Member',
            'username' => 'verifiedmember',
            'email' => 'verified.member@example.test',
        ]);
        $user->id = $id;

        return $user;
    }
}
