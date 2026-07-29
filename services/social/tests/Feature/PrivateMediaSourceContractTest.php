<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class PrivateMediaSourceContractTest extends TestCase
{
    #[Test]
    public function member_upload_paths_never_request_public_visibility(): void
    {
        $files = [
            'app/Http/Controllers/Api/ApiV1Controller.php',
            'app/Http/Controllers/Api/ApiV1Dot1Controller.php',
            'app/Http/Controllers/Api/ApiV2Controller.php',
            'app/Http/Controllers/Api/BaseApiController.php',
            'app/Http/Controllers/AvatarController.php',
            'app/Http/Controllers/ComposeController.php',
            'app/Http/Controllers/DirectMessageController.php',
            'app/Http/Controllers/GroupController.php',
            'app/Http/Controllers/Groups/GroupsCommentController.php',
            'app/Http/Controllers/Groups/GroupsPostController.php',
            'app/Http/Controllers/Import/Instagram.php',
            'app/Http/Controllers/Stories/StoryApiV1Controller.php',
            'app/Http/Controllers/StoryComposeController.php',
            'app/Jobs/GroupPipeline/GroupMediaPipeline.php',
            'app/Jobs/GroupsPipeline/ImageS3UploadPipeline.php',
            'app/Jobs/StoryPipeline/StoryFetch.php',
            'app/Services/MediaStorageService.php',
            'app/Services/ResilientMediaStorageService.php',
        ];

        foreach ($files as $file) {
            $source = file_get_contents(base_path($file));
            $this->assertIsString($source, $file);
            $this->assertStringNotContainsString('storePublicly', $source, $file);
            $this->assertDoesNotMatchRegularExpression(
                '/(?:putFileAs|putFile)\([^;]+[\'\"]public[\'\"]\s*\)/s',
                $source,
                $file,
            );
        }
    }

    #[Test]
    public function rendered_media_contracts_do_not_return_raw_storage_columns(): void
    {
        $files = [
            'app/Media.php',
            'app/Profile.php',
            'app/Story.php',
            'app/StoryItem.php',
            'app/Models/GroupMedia.php',
            'app/Services/GroupService.php',
            'app/Services/Groups/GroupMediaService.php',
            'app/Transformer/Api/MediaTransformer.php',
            'app/Transformer/Api/MediaDraftTransformer.php',
            'app/Transformer/Api/Mastodon/v1/MediaTransformer.php',
        ];

        foreach ($files as $file) {
            $source = file_get_contents(base_path($file));
            $this->assertIsString($source, $file);
            $this->assertStringNotContainsString("'url' => \$media->cdn_url", $source, $file);
            $this->assertStringNotContainsString("'preview_url' => \$media->thumbnail_url", $source, $file);
            $this->assertStringNotContainsString("'optimized_url' => \$media->optimized_url", $source, $file);
            $this->assertStringNotContainsString("'remote_url' => \$media->remote_url", $source, $file);
        }

        $retiredStoryItem = file_get_contents(base_path('app/StoryItem.php'));
        $this->assertStringNotContainsString('Storage::url', $retiredStoryItem);
        $this->assertStringContainsString('MochiriiPrivateMedia::class', $retiredStoryItem);
    }

    #[Test]
    public function direct_local_member_storage_is_denied_at_the_edge(): void
    {
        $source = file_get_contents(base_path('caddy/Caddyfile'));

        $this->assertStringContainsString('respond @privateMemberStorage "" 404', $source);
        $this->assertStringContainsString('Cache-Control "private, no-store"', $source);
        $this->assertStringContainsString('X-Content-Type-Options "nosniff"', $source);
        $this->assertStringContainsString('Referrer-Policy "no-referrer"', $source);
        foreach ([
            '/storage/m',
            '/storage/m/*',
            '/storage/_esm.t3',
            '/storage/_esm.t3/*',
            '/storage/g',
            '/storage/g/*',
            '/storage/g1',
            '/storage/g1/*',
            '/storage/avatars',
            '/storage/avatars/*',
            '/storage/cache/avatars',
            '/storage/cache/avatars/*',
        ] as $path) {
            $this->assertStringContainsString($path, $source);
        }
        $this->assertStringContainsString('/storage/avatars/default.jpg', $source);
    }

    #[Test]
    public function the_gateway_requires_the_current_member_api_boundary(): void
    {
        $routes = file_get_contents(base_path('routes/api.php'));

        $this->assertStringContainsString("Route::get('media/private/{kind}/{id}/{variant?}'", $routes);
        $this->assertStringContainsString("'kind' => 'media|avatar|story|group|group-media'", $routes);
        $this->assertStringNotContainsString('story-item', $routes);
        foreach ([
            "'private-media'",
            "'mochirii.private:private-media'",
            "'mochirii.private-media-2fa'",
            "'throttle:private-media'",
            "'validemail'",
        ] as $middleware) {
            $this->assertStringContainsString($middleware, $routes);
        }
        $this->assertLessThan(
            strpos($routes, "'mochirii.private-media-2fa'"),
            strpos($routes, "'throttle:private-media'")
        );
        $this->assertStringContainsString("Route::post('security/private-media-assurance'", $routes);
        $this->assertStringContainsString("'throttle:private-media-checkpoint'", $routes);

        $kernel = file_get_contents(base_path('app/Http/Kernel.php'));
        $this->assertStringContainsString("'private-media' => [", $kernel);
        $this->assertStringContainsString('EncryptCookies::class', $kernel);
        $this->assertStringContainsString('StartSession::class', $kernel);
        $this->assertStringContainsString("'mochirii.private-media-2fa' => MochiriiPrivateMediaTwoFactor::class", $kernel);

        $provider = file_get_contents(base_path('app/Providers/AppServiceProvider.php'));
        $this->assertStringContainsString("RateLimiter::for('private-media'", $provider);
        $this->assertStringContainsString("RateLimiter::for('private-media-checkpoint'", $provider);
        $this->assertStringContainsString('requests_per_minute_per_identity', $provider);
        $this->assertStringContainsString('requests_per_minute_per_ip', $provider);

        $handler = file_get_contents(base_path('app/Exceptions/Handler.php'));
        $this->assertMatchesRegularExpression('/protected \$dontFlash = \[[^]]*\'code\'/s', $handler);
    }

    #[Test]
    public function current_member_refreshes_are_bounded_before_remote_sync(): void
    {
        $sync = file_get_contents(base_path('app/Services/MochiriiSocialSyncService.php'));
        $limiter = file_get_contents(base_path('app/Services/MochiriiPrivateSocialRateLimiter.php'));

        $this->assertStringContainsString("Cache::lock(\$cacheKey.':refresh'", $sync);
        $this->assertStringContainsString('->block($timeout + 1', $sync);
        $this->assertGreaterThanOrEqual(2, substr_count($sync, 'Cache::get($cacheKey) === true'));
        $this->assertStringContainsString('Cache::get($failureCacheKey) === true', $sync);
        $this->assertStringContainsString('$this->rateLimiter->ensureMemberSyncAllowed(request(), $user)', $sync);
        $this->assertLessThan(
            strpos($sync, '$this->performSync($user, $oidcId, \'access_check\')'),
            strpos($sync, '$this->rateLimiter->ensureMemberSyncAllowed(request(), $user)'),
        );
        $publicSync = substr($sync, strpos($sync, 'public function sync('));
        $this->assertLessThan(
            strpos($publicSync, 'return $this->performSync($user, $oidcId, $event)'),
            strpos($publicSync, '$this->rateLimiter->ensureMemberSyncAllowed(request(), $user)'),
        );
        $this->assertStringContainsString('catch (LockTimeoutException)', $sync);
        $this->assertStringContainsString('catch (HttpResponseException $error)', $sync);

        $this->assertStringContainsString('RateLimiter::hit($identityKey, 60)', $limiter);
        $this->assertStringContainsString('RateLimiter::hit($ipKey, 60)', $limiter);
        $this->assertStringContainsString('member_syncs_per_minute_per_identity', $limiter);
        $this->assertStringContainsString('member_syncs_per_minute_per_ip', $limiter);
        $this->assertStringNotContainsString("'u:'", $limiter);
        $this->assertStringNotContainsString("'ip:'", $limiter);
    }

    #[Test]
    public function the_edge_and_application_share_one_sanitized_client_address_contract(): void
    {
        $caddy = file_get_contents(base_path('caddy/Caddyfile'));
        $runtime = file_get_contents(base_path('scripts/production-runtime-lib.sh'));

        foreach ([
            'trusted_proxies static 103.21.244.0/22',
            '198.41.128.0/17',
            '2c0f:f248::/32',
            'client_ip_headers CF-Connecting-IP X-Forwarded-For',
            'trusted_proxies_strict',
            'header_up X-Forwarded-For {client_ip}',
        ] as $contract) {
            $this->assertStringContainsString($contract, $caddy);
        }
        $this->assertLessThan(
            strpos($caddy, 'reverse_proxy 127.0.0.1:8080'),
            strpos($caddy, 'respond @retiredCreationAndTokenManagement 404'),
        );

        foreach ([
            'verify_private_media_proxy_runtime_contract',
            'caddy validate --config "$caddy_config" --adapter caddyfile',
            'caddy adapt --config "$caddy_config" --adapter caddyfile',
            'http://127.0.0.1:2019/config/',
            'if active != expected:',
            '"127.0.0.1:8080"',
            '$defaultCache !== "redis" || $limiterCache !== "redis"',
            'config("trustedproxy.proxies") !== "*"',
            '$firstIp !== "198.51.100.10"',
            '$secondIp !== "203.0.113.20"',
            'hash_equals($firstIp, $secondIp)',
        ] as $contract) {
            $this->assertStringContainsString($contract, $runtime);
        }
        $permanent = substr($runtime, strpos($runtime, 'verify_permanent_private_media_runtime_local()'));
        $this->assertLessThan(
            strpos($permanent, 'docker exec pixelfed-app php artisan tinker'),
            strpos($permanent, 'verify_private_media_proxy_runtime_contract || return 1'),
        );
    }

    #[Test]
    public function cloud_member_storage_defaults_to_private_visibility(): void
    {
        $source = file_get_contents(base_path('config/filesystems.php'));

        $this->assertIsString($source);
        $this->assertStringContainsString("'visibility' => env('AWS_VISIBILITY', 'private')", $source);

        foreach (['alt-primary', 'alt-secondary', 'spaces'] as $disk) {
            $offset = strpos($source, "'{$disk}' => [");
            $this->assertNotFalse($offset, $disk);
            $nextDisk = strpos($source, "\n        '", $offset + 1);
            $block = substr($source, $offset, $nextDisk === false ? null : $nextDisk - $offset);
            $this->assertStringContainsString("'visibility' => 'private'", $block, $disk);
        }
    }

    #[Test]
    public function group_media_is_published_only_after_its_upload_pipeline(): void
    {
        foreach ([
            'app/Http/Controllers/Groups/GroupsPostController.php',
            'app/Http/Controllers/Groups/GroupsCommentController.php',
        ] as $file) {
            $source = file_get_contents(base_path($file));
            $pipeline = strrpos($source, 'ImageS3UploadPipeline::dispatchSync');
            $publication = strpos($source, "->visibility = 'public'", $pipeline ?: 0);

            $this->assertNotFalse($pipeline, $file);
            $this->assertNotFalse($publication, $file);
            $this->assertGreaterThan($pipeline, $publication, $file);
        }

        $commentSource = file_get_contents(base_path('app/Http/Controllers/Groups/GroupsCommentController.php'));
        $commentTyping = strpos($commentSource, '$media->is_comment = true');
        $commentPipeline = strpos($commentSource, 'ImageS3UploadPipeline::dispatchSync', $commentTyping ?: 0);
        $this->assertNotFalse($commentTyping);
        $this->assertNotFalse($commentPipeline);
        $this->assertLessThan($commentPipeline, $commentTyping);
    }
}
