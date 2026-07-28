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
        $this->assertStringContainsString("->middleware(['private-media', 'mochirii.private:private-media', 'validemail'])", $routes);

        $kernel = file_get_contents(base_path('app/Http/Kernel.php'));
        $this->assertStringContainsString("'private-media' => [", $kernel);
        $this->assertStringContainsString('EncryptCookies::class', $kernel);
        $this->assertStringContainsString('StartSession::class', $kernel);
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
