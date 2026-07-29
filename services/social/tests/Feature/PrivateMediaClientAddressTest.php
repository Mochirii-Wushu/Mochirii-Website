<?php

namespace Tests\Feature;

use App\Http\Middleware\TrustProxies;
use App\Services\MochiriiPrivateSocialRateLimiter;
use App\User;
use Illuminate\Http\Request;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class PrivateMediaClientAddressTest extends TestCase
{
    #[Test]
    public function caddy_sanitized_addresses_remain_distinct_inside_laravel(): void
    {
        config(['trustedproxy.proxies' => '*']);

        $first = $this->throughTrustedProxy('198.51.100.10');
        $second = $this->throughTrustedProxy('203.0.113.20');

        $this->assertSame('198.51.100.10', $first->ip());
        $this->assertSame('203.0.113.20', $second->ip());
        $this->assertNotSame($first->ip(), $second->ip());
    }

    #[Test]
    public function opaque_limiter_keys_share_identity_but_separate_client_addresses(): void
    {
        config(['trustedproxy.proxies' => '*']);
        $user = new User;
        $user->id = 7301;
        $limiter = app(MochiriiPrivateSocialRateLimiter::class);

        [$firstIdentity, $firstIp] = $limiter->keys(
            $this->throughTrustedProxy('198.51.100.10'),
            $user,
        );
        [$secondIdentity, $secondIp] = $limiter->keys(
            $this->throughTrustedProxy('203.0.113.20'),
            $user,
        );

        $this->assertSame($firstIdentity, $secondIdentity);
        $this->assertNotSame($firstIp, $secondIp);
        foreach ([$firstIdentity, $firstIp, $secondIp] as $key) {
            $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $key);
            $this->assertStringNotContainsString('7301', $key);
            $this->assertStringNotContainsString('198.51.100.10', $key);
            $this->assertStringNotContainsString('203.0.113.20', $key);
        }
    }

    private function throughTrustedProxy(string $forwarded): Request
    {
        $request = Request::create(
            'https://social.mochirii.com/media/private/media/1/original',
            'GET',
            [],
            [],
            [],
            [
                'REMOTE_ADDR' => '192.0.2.254',
                'HTTP_X_FORWARDED_FOR' => $forwarded,
                'HTTP_X_FORWARDED_PROTO' => 'https',
            ],
        );

        return app(TrustProxies::class)->handle($request, static fn ($trustedRequest) => $trustedRequest);
    }
}
