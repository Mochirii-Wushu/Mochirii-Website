<?php

namespace Tests\Feature;

use App\Media;
use App\Models\UserOidcMapping;
use App\Profile;
use App\Services\MochiriiSocialSyncService;
use App\Transformer\Api\MediaTransformer;
use App\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Passport\Passport;
use League\OAuth2\Server\ResourceServer;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\Test;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

class PrivateMediaGatewayTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
            'filesystems.default' => 'local',
            'cache.default' => 'array',
            'cache.limiter' => 'array',
            'mochirii-private-media.enabled' => true,
        ]);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('profile_id')->nullable();
            $table->string('name')->nullable();
            $table->string('username')->unique();
            $table->string('email')->unique();
            $table->string('password');
            $table->string('status')->nullable();
            $table->string('register_source')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->boolean('2fa_enabled')->default(false);
            $table->string('2fa_secret')->nullable();
            $table->json('2fa_backup_codes')->nullable();
            $table->timestamp('2fa_setup_at')->nullable();
            $table->rememberToken();
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('profiles', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('user_id');
            $table->string('username')->unique();
            $table->string('name')->nullable();
            $table->string('status')->nullable();
            $table->boolean('is_private')->default(false);
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('user_oidc_mappings', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id')->index();
            $table->string('oidc_id')->unique();
            $table->timestamps();
        });
        Schema::create('statuses', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('profile_id');
            $table->unsignedBigInteger('in_reply_to_profile_id')->nullable();
            $table->string('scope')->nullable();
            $table->string('visibility')->nullable();
            $table->string('type')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('followers', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('profile_id');
            $table->unsignedBigInteger('following_id');
            $table->timestamps();
        });
        Schema::create('direct_messages', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('status_id');
            $table->unsignedBigInteger('from_id');
            $table->unsignedBigInteger('to_id');
            $table->timestamps();
        });
        Schema::create('user_filters', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('filterable_id');
            $table->string('filterable_type');
            $table->string('filter_type');
            $table->timestamps();
        });
        Schema::create('media', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('profile_id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('status_id')->nullable();
            $table->string('media_path');
            $table->string('thumbnail_path')->nullable();
            $table->text('cdn_url')->nullable();
            $table->text('thumbnail_url')->nullable();
            $table->text('optimized_url')->nullable();
            $table->text('remote_url')->nullable();
            $table->string('mime')->nullable();
            $table->boolean('remote_media')->default(false);
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('stories', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('profile_id');
            $table->string('path');
            $table->string('mime')->nullable();
            $table->boolean('local')->default(true);
            $table->boolean('active')->default(false);
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
        Schema::create('groups', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('profile_id');
            $table->string('status')->nullable();
            $table->boolean('local')->default(true);
            $table->boolean('is_private')->default(false);
            $table->json('metadata')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('group_members', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('group_id');
            $table->unsignedBigInteger('profile_id');
            $table->boolean('join_request')->default(false);
            $table->timestamp('rejected_at')->nullable();
            $table->timestamps();
        });
        Schema::create('group_blocks', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('group_id');
            $table->unsignedBigInteger('profile_id')->nullable();
            $table->boolean('is_user')->default(false);
            $table->timestamps();
        });
        Schema::create('group_posts', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('group_id');
            $table->unsignedBigInteger('profile_id');
            $table->string('type')->nullable();
            $table->string('visibility')->nullable();
            $table->string('status')->nullable();
            $table->timestamps();
        });
        Schema::create('group_comments', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('group_id');
            $table->unsignedBigInteger('profile_id');
            $table->unsignedBigInteger('status_id')->nullable();
            $table->string('visibility')->nullable();
            $table->string('status')->nullable();
            $table->timestamps();
        });
        Schema::create('group_media', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('group_id');
            $table->unsignedBigInteger('profile_id');
            $table->unsignedBigInteger('status_id')->nullable();
            $table->string('media_path');
            $table->text('cdn_url')->nullable();
            $table->string('mime')->nullable();
            $table->boolean('is_comment')->default(false);
            $table->timestamps();
        });

        User::unsetEventDispatcher();
        Profile::unsetEventDispatcher();
        Media::unsetEventDispatcher();
        Storage::fake('local');
    }

    #[Test]
    public function signed_out_requests_never_receive_member_media_or_an_object_path(): void
    {
        $response = $this->get('/media/private/media/701/original');

        $response->assertNotFound();
        $this->assertStringNotContainsString('public/m/', $response->getContent());
    }

    #[Test]
    public function a_current_browser_session_can_stream_own_pending_media_with_range_support(): void
    {
        [$user, $profile] = $this->activeMember(51, 151);
        $this->allowCurrentAccess($user, 'member-51');
        $this->actingAs($user, 'web');

        Storage::disk('local')->put('public/m/_v2/member/file.mp4', 'private-video-body', ['visibility' => 'private']);
        Media::create([
            'id' => 701,
            'profile_id' => $profile->id,
            'user_id' => $user->id,
            'status_id' => null,
            'media_path' => 'public/m/_v2/member/file.mp4',
            'mime' => 'video/mp4',
            'remote_media' => false,
        ]);

        $response = $this->withHeader('Range', 'bytes=0-6')
            ->get('/media/private/media/701/original');

        $response->assertStatus(206);
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame('private', $response->streamedContent());
    }

    #[Test]
    public function enabled_two_factor_browser_media_requires_a_fresh_bound_checkpoint(): void
    {
        [$user, $profile] = $this->activeMember(68, 168);
        $secret = $this->enableTwoFactor($user);
        $this->allowCurrentAccess($user, 'member-68', 5);
        $this->actingAs($user->fresh(), 'web');
        config(['mochirii-private-media.two_factor_assurance_seconds' => 300]);

        Storage::disk('local')->put('public/m/_v2/member/2fa-browser.jpg', 'browser-media', ['visibility' => 'private']);
        Media::create([
            'id' => 2001,
            'profile_id' => $profile->id,
            'user_id' => $user->id,
            'status_id' => null,
            'media_path' => 'public/m/_v2/member/2fa-browser.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);

        $this->get('/media/private/media/2001/original')->assertNotFound();

        $this->post('/i/auth/checkpoint', [
            'code' => (new Google2FA)->getCurrentOtp($secret),
        ])->assertRedirect('/');

        $this->get('/media/private/media/2001/original')
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $this->travel(301)->seconds();
        $this->get('/media/private/media/2001/original')->assertNotFound();
        $this->travelBack();

        DB::table('users')->where('id', $user->id)->update([
            '2fa_secret' => (new Google2FA)->generateSecretKey(32),
        ]);
        $this->actingAs($user->fresh(), 'web');
        $this->get('/media/private/media/2001/original')->assertNotFound();
    }

    #[Test]
    public function enabled_two_factor_native_media_requires_an_assertion_bound_to_the_exact_bearer(): void
    {
        [$user, $profile] = $this->activeMember(69, 169);
        $secret = $this->enableTwoFactor($user);
        $this->allowCurrentAccess($user, 'member-69', 7);
        $this->actingAsNative($user->fresh());
        config(['mochirii-private-media.two_factor_assurance_seconds' => 300]);

        Storage::disk('local')->put('public/m/_v2/member/2fa-native.jpg', 'native-media', ['visibility' => 'private']);
        Media::create([
            'id' => 2002,
            'profile_id' => $profile->id,
            'user_id' => $user->id,
            'status_id' => null,
            'media_path' => 'public/m/_v2/member/2fa-native.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);

        $bearer = 'native-token-0000000000000001';
        $this->withHeader('Authorization', 'Bearer '.$bearer)
            ->get('/media/private/media/2002/original')
            ->assertNotFound();

        $checkpoint = $this->withHeader('Authorization', 'Bearer '.$bearer)
            ->postJson('/api/v1.1/security/private-media-assurance', [
                'code' => (new Google2FA)->getCurrentOtp($secret),
            ]);

        $checkpoint->assertOk()
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private')
            ->assertJsonStructure(['assurance', 'expires_in', 'header']);
        $assertion = $checkpoint->json('assurance');
        $this->assertIsString($assertion);

        $this->withHeader('Authorization', 'Bearer '.$bearer)
            ->postJson('/api/v1.1/security/private-media-assurance', [
                'code' => (new Google2FA)->getCurrentOtp($secret),
            ])->assertStatus(422);

        $this->withHeaders([
            'Authorization' => 'Bearer '.$bearer,
            'X-Mochirii-Media-Assurance' => $assertion,
        ])->get('/media/private/media/2002/original')->assertOk();

        $this->withHeaders([
            'Authorization' => 'Bearer native-token-0000000000000002',
            'X-Mochirii-Media-Assurance' => $assertion,
        ])->get('/media/private/media/2002/original')->assertNotFound();

        $this->withHeaders([
            'Authorization' => 'Bearer '.$bearer,
            'X-Mochirii-Media-Assurance' => $assertion.'tampered',
        ])->get('/media/private/media/2002/original')->assertNotFound();

        $this->travel(301)->seconds();
        $this->withHeaders([
            'Authorization' => 'Bearer '.$bearer,
            'X-Mochirii-Media-Assurance' => $assertion,
        ])->get('/media/private/media/2002/original')->assertNotFound();
        $this->travelBack();
    }

    #[Test]
    public function private_media_has_independent_identity_and_ip_request_ceilings(): void
    {
        [$user, $profile] = $this->activeMember(70, 170);
        $this->allowCurrentAccess($user, 'member-70', 6);
        $this->actingAs($user, 'web');

        Storage::disk('local')->put('public/m/_v2/member/throttled.jpg', 'bounded-media', ['visibility' => 'private']);
        Media::create([
            'id' => 2003,
            'profile_id' => $profile->id,
            'user_id' => $user->id,
            'status_id' => null,
            'media_path' => 'public/m/_v2/member/throttled.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);

        config([
            'mochirii-private-media.rate_limits.requests_per_minute_per_identity' => 2,
            'mochirii-private-media.rate_limits.requests_per_minute_per_ip' => 100,
        ]);
        $this->get('/media/private/media/2003/original')->assertOk();
        $this->get('/media/private/media/2003/original')->assertOk();
        $identityLimited = $this->get('/media/private/media/2003/original');
        $identityLimited->assertStatus(429);
        $this->assertStringContainsString('no-store', (string) $identityLimited->headers->get('Cache-Control'));

        Cache::flush();
        config([
            'mochirii-private-media.rate_limits.requests_per_minute_per_identity' => 100,
            'mochirii-private-media.rate_limits.requests_per_minute_per_ip' => 2,
        ]);
        $this->get('/media/private/media/2003/original')->assertOk();
        $this->get('/media/private/media/2003/original')->assertOk();
        $ipLimited = $this->get('/media/private/media/2003/original');
        $ipLimited->assertStatus(429);
        $this->assertStringContainsString('no-store', (string) $ipLimited->headers->get('Cache-Control'));
    }

    #[Test]
    public function private_media_throttles_invalid_native_assurance_before_decryption(): void
    {
        [$user] = $this->activeMember(73, 173);
        $this->enableTwoFactor($user);
        $this->allowCurrentAccess($user, 'member-73', 3);
        $this->actingAsNative($user->fresh());
        config([
            'mochirii-private-media.rate_limits.requests_per_minute_per_identity' => 2,
            'mochirii-private-media.rate_limits.requests_per_minute_per_ip' => 100,
        ]);

        $headers = [
            'Authorization' => 'Bearer native-token-0000000000000005',
            'X-Mochirii-Media-Assurance' => str_repeat('invalid', 32),
        ];

        $this->withHeaders($headers)->get('/media/private/media/999999/original')->assertNotFound();
        $this->withHeaders($headers)->get('/media/private/media/999999/original')->assertNotFound();
        $limited = $this->withHeaders($headers)->get('/media/private/media/999999/original');
        $limited->assertStatus(429);
        $this->assertStringContainsString('no-store', (string) $limited->headers->get('Cache-Control'));
    }

    #[Test]
    public function native_two_factor_checkpoint_attempts_are_identity_limited(): void
    {
        [$user] = $this->activeMember(71, 171);
        $this->enableTwoFactor($user);
        $this->allowCurrentAccess($user, 'member-71', 3);
        $this->actingAsNative($user->fresh());
        config([
            'mochirii-private-media.rate_limits.checkpoints_per_minute_per_identity' => 2,
            'mochirii-private-media.rate_limits.checkpoints_per_hour_per_identity' => 100,
            'mochirii-private-media.rate_limits.checkpoints_per_minute_per_ip' => 100,
            'mochirii-private-media.rate_limits.checkpoints_per_hour_per_ip' => 100,
        ]);

        $headers = ['Authorization' => 'Bearer native-token-0000000000000003'];
        $this->withHeaders($headers)->postJson('/api/v1.1/security/private-media-assurance', ['code' => 'wrong'])->assertStatus(422);
        $this->withHeaders($headers)->postJson('/api/v1.1/security/private-media-assurance', ['code' => 'wrong'])->assertStatus(422);
        $limited = $this->withHeaders($headers)->postJson('/api/v1.1/security/private-media-assurance', ['code' => 'wrong']);
        $limited->assertStatus(429);
        $this->assertStringContainsString('no-store', (string) $limited->headers->get('Cache-Control'));
    }

    #[Test]
    public function native_recovery_code_is_consumed_once(): void
    {
        [$user] = $this->activeMember(72, 172);
        $this->enableTwoFactor($user);
        $this->allowCurrentAccess($user, 'member-72', 2);
        $this->actingAsNative($user->fresh());
        $headers = ['Authorization' => 'Bearer native-token-0000000000000004'];
        $recovery = 'recovery-code-'.str_pad((string) $user->id, 12, '0');

        $this->withHeaders($headers)
            ->postJson('/api/v1.1/security/private-media-assurance', ['code' => $recovery])
            ->assertOk();
        $this->withHeaders($headers)
            ->postJson('/api/v1.1/security/private-media-assurance', ['code' => $recovery])
            ->assertStatus(422);

        $this->assertSame([], json_decode((string) DB::table('users')->where('id', $user->id)->value('2fa_backup_codes'), true));
    }

    #[Test]
    public function a_current_native_passport_bearer_can_stream_member_media(): void
    {
        [$user, $profile] = $this->activeMember(55, 155);
        $this->allowCurrentAccess($user, 'member-55');
        $this->actingAsNative($user);

        Storage::disk('local')->put('public/m/_v2/member/native.jpg', 'native-image', ['visibility' => 'private']);
        Media::create([
            'id' => 707,
            'profile_id' => $profile->id,
            'user_id' => $user->id,
            'status_id' => null,
            'media_path' => 'public/m/_v2/member/native.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);

        $response = $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/707/original');

        $response->assertOk();
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertSame('native-image', $response->streamedContent());
    }

    #[Test]
    public function pending_media_is_owner_only_and_confused_or_remote_paths_fail_closed(): void
    {
        [$requester] = $this->activeMember(52, 152);
        [$owner, $ownerProfile] = $this->activeMember(53, 153);
        $this->allowCurrentAccess($requester, 'member-52', 3);
        $this->actingAsNative($requester);

        foreach ([
            [702, 'public/m/_v2/other/private.jpg', false],
            [703, 'public/m/../private.jpg', false],
            [704, 'https://objects.example.test/private.jpg', true],
        ] as [$id, $path, $remote]) {
            Media::create([
                'id' => $id,
                'profile_id' => $ownerProfile->id,
                'user_id' => $owner->id,
                'status_id' => null,
                'media_path' => $path,
                'remote_url' => $remote ? $path : null,
                'mime' => 'image/jpeg',
                'remote_media' => $remote,
            ]);
            $this->withHeader('Authorization', 'Bearer test-native-token')
                ->get('/media/private/media/'.$id.'/original')
                ->assertNotFound();
        }
    }

    #[Test]
    public function attached_media_with_a_missing_parent_is_denied_even_to_its_owner(): void
    {
        [$owner, $profile] = $this->activeMember(63, 163);
        $this->allowCurrentAccess($owner, 'member-63');
        $this->actingAsNative($owner);

        Storage::disk('local')->put('public/m/_v2/member/orphan.jpg', 'orphan-body', ['visibility' => 'private']);
        Media::create([
            'id' => 708,
            'profile_id' => $profile->id,
            'user_id' => $owner->id,
            'status_id' => 999999,
            'media_path' => 'public/m/_v2/member/orphan.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);

        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/708/original')
            ->assertNotFound();
    }

    #[Test]
    public function suspended_members_are_denied_before_storage_resolution(): void
    {
        [$user, $profile] = $this->activeMember(54, 154);
        $user->status = 'suspended';
        $user->save();
        $this->allowCurrentAccess($user, 'member-54', 0);
        $this->actingAsNative($user);

        Media::create([
            'id' => 705,
            'profile_id' => $profile->id,
            'user_id' => $user->id,
            'status_id' => null,
            'media_path' => 'public/m/_v2/member/suspended.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);

        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/705/original')
            ->assertNotFound();
        $this->assertFalse(Storage::disk('local')->exists('public/m/_v2/member/suspended.jpg'));
    }

    #[Test]
    public function status_media_enforces_visibility_direct_participants_following_and_blocks(): void
    {
        [$requester] = $this->activeMember(56, 156);
        [$owner, $ownerProfile] = $this->activeMember(57, 157);
        $this->allowCurrentAccess($requester, 'member-56', 10);
        $this->actingAsNative($requester);

        foreach ([
            711 => ['public', 'public.jpg'],
            712 => ['private', 'private.jpg'],
            713 => ['direct', 'direct.jpg'],
            714 => ['draft', 'draft.jpg'],
            715 => ['archived', 'archived.jpg'],
        ] as $mediaId => [$scope, $file]) {
            $statusId = 800 + $mediaId;
            DB::table('statuses')->insert([
                'id' => $statusId,
                'profile_id' => $ownerProfile->id,
                'in_reply_to_profile_id' => $scope === 'direct' ? $requester->profile_id : null,
                'scope' => $scope,
                'visibility' => $scope,
                'type' => 'photo',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            Media::create([
                'id' => $mediaId,
                'profile_id' => $ownerProfile->id,
                'user_id' => $owner->id,
                'status_id' => $statusId,
                'media_path' => 'public/m/_v2/member/'.$file,
                'mime' => 'image/jpeg',
                'remote_media' => false,
            ]);
            Storage::disk('local')->put('public/m/_v2/member/'.$file, 'fixture-'.$scope, ['visibility' => 'private']);
        }

        DB::table('user_filters')->insert([
            'user_id' => $ownerProfile->id,
            'filterable_id' => $requester->profile_id,
            'filterable_type' => Profile::class,
            'filter_type' => 'block',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ([711, 712, 713, 714, 715] as $mediaId) {
            $this->withHeader('Authorization', 'Bearer test-native-token')
                ->get('/media/private/media/'.$mediaId.'/original')
                ->assertNotFound();
        }

        DB::table('user_filters')->delete();
        DB::table('profiles')->where('id', $ownerProfile->id)->update(['is_private' => true]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/711/original')
            ->assertNotFound();

        DB::table('followers')->insert([
            'profile_id' => $requester->profile_id,
            'following_id' => $ownerProfile->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $public = $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/711/original');
        $public->assertOk();
        $this->assertSame('fixture-public', $public->streamedContent());

        $private = $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/712/original');
        $private->assertOk();
        $this->assertSame('fixture-private', $private->streamedContent());

        DB::table('direct_messages')->insert([
            'status_id' => 1513,
            'from_id' => $requester->profile_id,
            'to_id' => $ownerProfile->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/713/original')
            ->assertNotFound();

        DB::table('direct_messages')->insert([
            'status_id' => 1513,
            'from_id' => $ownerProfile->id,
            'to_id' => $requester->profile_id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $direct = $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/713/original');
        $direct->assertOk();
        $this->assertSame('fixture-direct', $direct->streamedContent());
    }

    #[Test]
    public function stories_require_a_current_follower_and_unexpired_audience(): void
    {
        [$requester] = $this->activeMember(58, 158);
        [, $ownerProfile] = $this->activeMember(59, 159);
        $this->allowCurrentAccess($requester, 'member-58', 3);
        $this->actingAsNative($requester);

        DB::table('stories')->insert([
            'id' => 1801,
            'profile_id' => $ownerProfile->id,
            'path' => 'public/m/_v2/member/story.jpg',
            'mime' => 'image/jpeg',
            'local' => true,
            'active' => true,
            'expires_at' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Storage::disk('local')->put('public/m/_v2/member/story.jpg', 'story-body', ['visibility' => 'private']);

        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/story/1801/original')
            ->assertNotFound();

        DB::table('followers')->insert([
            'profile_id' => $requester->profile_id,
            'following_id' => $ownerProfile->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/story/1801/original')
            ->assertOk();

        DB::table('stories')->where('id', 1801)->update(['expires_at' => now()->subMinute()]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/story/1801/original')
            ->assertNotFound();
    }

    #[Test]
    public function an_expired_story_is_denied_to_its_owner(): void
    {
        [$owner, $profile] = $this->activeMember(64, 164);
        $this->allowCurrentAccess($owner, 'member-64');
        $this->actingAsNative($owner);

        DB::table('stories')->insert([
            'id' => 1803,
            'profile_id' => $profile->id,
            'path' => 'public/m/_v2/member/expired-owner-story.jpg',
            'mime' => 'image/jpeg',
            'local' => true,
            'active' => true,
            'expires_at' => now()->subMinute(),
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ]);
        Storage::disk('local')->put('public/m/_v2/member/expired-owner-story.jpg', 'expired', ['visibility' => 'private']);

        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/story/1803/original')
            ->assertNotFound();
    }

    #[Test]
    public function private_group_media_requires_membership_and_published_content(): void
    {
        [$requester] = $this->activeMember(60, 160);
        [, $adminProfile] = $this->activeMember(61, 161);
        [, $ownerProfile] = $this->activeMember(62, 162);
        $this->allowCurrentAccess($requester, 'member-60', 10);
        $this->actingAsNative($requester);

        DB::table('groups')->insert([
            'id' => 1901,
            'profile_id' => $adminProfile->id,
            'status' => null,
            'local' => true,
            'is_private' => true,
            'metadata' => json_encode(['header' => ['path' => 'public/g/group/header.jpg']], JSON_THROW_ON_ERROR),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Storage::disk('local')->put('public/g/group/header.jpg', 'group-header', ['visibility' => 'private']);

        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group/1901/header')
            ->assertNotFound();

        DB::table('group_members')->insert([
            'group_id' => 1901,
            'profile_id' => $requester->profile_id,
            'join_request' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group/1901/header')
            ->assertOk();

        DB::table('group_posts')->insert([
            'id' => 1902,
            'group_id' => 1901,
            'profile_id' => $ownerProfile->id,
            'type' => 'photo',
            'visibility' => 'draft',
            'status' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_media')->insert([
            'id' => 1903,
            'group_id' => 1901,
            'profile_id' => $ownerProfile->id,
            'status_id' => 1902,
            'media_path' => 'public/g1/group/post.jpg',
            'mime' => 'image/jpeg',
            'is_comment' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Storage::disk('local')->put('public/g1/group/post.jpg', 'group-post', ['visibility' => 'private']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1903/original')
            ->assertNotFound();

        DB::table('group_posts')->where('id', 1902)->update(['visibility' => 'public']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1903/original')
            ->assertOk();

        DB::table('user_filters')->insert([
            'user_id' => $ownerProfile->id,
            'filterable_id' => $requester->profile_id,
            'filterable_type' => Profile::class,
            'filter_type' => 'block',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1903/original')
            ->assertNotFound();
        DB::table('user_filters')->delete();

        DB::table('group_comments')->insert([
            'id' => 1905,
            'group_id' => 1901,
            'profile_id' => $ownerProfile->id,
            'status_id' => 1902,
            'visibility' => 'public',
            'status' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_media')->insert([
            'id' => 1906,
            'group_id' => 1901,
            'profile_id' => $ownerProfile->id,
            'status_id' => 1905,
            'media_path' => 'public/g1/group/comment.jpg',
            'mime' => 'image/jpeg',
            'is_comment' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Storage::disk('local')->put('public/g1/group/comment.jpg', 'group-comment', ['visibility' => 'private']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1906/original')
            ->assertOk();

        DB::table('group_posts')->where('id', 1902)->update(['status' => 'removed']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1906/original')
            ->assertNotFound();
        DB::table('group_posts')->where('id', 1902)->update(['status' => null]);

        DB::table('group_comments')->where('id', 1905)->update(['status' => 'removed']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1906/original')
            ->assertNotFound();

        DB::table('group_blocks')->insert([
            'group_id' => 1901,
            'profile_id' => $requester->profile_id,
            'is_user' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1903/original')
            ->assertNotFound();

        DB::table('group_blocks')->delete();
        DB::table('group_media')->insert([
            'id' => 1904,
            'group_id' => 1901,
            'profile_id' => $requester->profile_id,
            'status_id' => 999999,
            'media_path' => 'public/g1/group/orphan.jpg',
            'mime' => 'image/jpeg',
            'is_comment' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Storage::disk('local')->put('public/g1/group/orphan.jpg', 'orphan', ['visibility' => 'private']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/group-media/1904/original')
            ->assertNotFound();
    }

    #[Test]
    public function group_video_fallback_requires_an_unmoderated_video_parent_and_video_mime(): void
    {
        [$requester] = $this->activeMember(65, 165);
        [, $adminProfile] = $this->activeMember(66, 166);
        [$owner, $ownerProfile] = $this->activeMember(67, 167);
        $this->allowCurrentAccess($requester, 'member-65', 4);
        $this->actingAsNative($requester);

        DB::table('groups')->insert([
            'id' => 1910,
            'profile_id' => $adminProfile->id,
            'status' => null,
            'local' => true,
            'is_private' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_posts')->insert([
            'id' => 1911,
            'group_id' => 1910,
            'profile_id' => $ownerProfile->id,
            'type' => 'photo',
            'visibility' => 'public',
            'status' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Media::create([
            'id' => 1912,
            'profile_id' => $ownerProfile->id,
            'user_id' => $owner->id,
            'status_id' => 1911,
            'media_path' => 'public/g/group/video.mp4',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);
        Storage::disk('local')->put('public/g/group/video.mp4', 'group-video', ['visibility' => 'private']);

        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/1912/original')
            ->assertNotFound();
        DB::table('group_posts')->where('id', 1911)->update(['type' => 'video']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/1912/original')
            ->assertNotFound();
        DB::table('media')->where('id', 1912)->update(['mime' => 'video/mp4']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/1912/original')
            ->assertOk();
        DB::table('group_posts')->where('id', 1911)->update(['status' => 'removed']);
        $this->withHeader('Authorization', 'Bearer test-native-token')
            ->get('/media/private/media/1912/original')
            ->assertNotFound();
    }

    #[Test]
    public function media_transformers_return_only_same_origin_gateway_urls(): void
    {
        $media = new Media([
            'media_path' => 'public/m/_v2/member/original.jpg',
            'thumbnail_path' => 'public/m/_v2/member/thumbnail.jpg',
            'cdn_url' => 'https://private-space.example.test/public/m/_v2/member/original.jpg',
            'thumbnail_url' => 'https://private-space.example.test/public/m/_v2/member/thumbnail.jpg',
            'optimized_url' => 'https://private-space.example.test/public/m/_v2/member/optimized.jpg',
            'mime' => 'image/jpeg',
            'remote_media' => false,
        ]);
        $media->id = 706;

        $result = (new MediaTransformer)->transform($media);
        $serialized = json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        $this->assertStringContainsString('/media/private/media/706/original', $result['url']);
        $this->assertStringContainsString('/media/private/media/706/preview', $result['preview_url']);
        $this->assertStringContainsString('/media/private/media/706/optimized', $result['optimized_url']);
        $this->assertStringNotContainsString('private-space.example.test', $serialized);
        $this->assertStringNotContainsString('public/m/', $serialized);
    }

    private function activeMember(int $userId, int $profileId): array
    {
        $user = User::create([
            'id' => $userId,
            'name' => 'Verified Member',
            'username' => 'member'.$userId,
            'email' => 'member'.$userId.'@example.test',
            'password' => 'not-used',
            'register_source' => 'oidc',
            'email_verified_at' => now(),
        ]);
        $profile = Profile::create([
            'id' => $profileId,
            'user_id' => $user->id,
            'username' => $user->username,
            'name' => $user->name,
        ]);
        $user->profile_id = $profile->id;
        $user->save();

        return [$user->fresh(), $profile->fresh()];
    }

    private function allowCurrentAccess(User $user, string $oidcId, int $times = 1): void
    {
        UserOidcMapping::create([
            'user_id' => $user->id,
            'oidc_id' => $oidcId,
        ]);
        $this->partialMock(MochiriiSocialSyncService::class, function (MockInterface $mock) use ($times) {
            if ($times > 0) {
                $mock->shouldReceive('hasCurrentAccess')->times($times)->andReturn(true);
            } else {
                $mock->shouldNotReceive('hasCurrentAccess');
            }
        });
    }

    private function enableTwoFactor(User $user): string
    {
        $secret = (new Google2FA)->generateSecretKey(32);
        DB::table('users')->where('id', $user->id)->update([
            '2fa_enabled' => true,
            '2fa_secret' => $secret,
            '2fa_backup_codes' => json_encode(['recovery-code-'.str_pad((string) $user->id, 12, '0')], JSON_THROW_ON_ERROR),
            '2fa_setup_at' => now(),
        ]);

        return $secret;
    }

    private function actingAsNative(User $user): void
    {
        // Passport's test helper only needs a resource-server binding while it
        // seeds the API guard. The Authorization header below still selects the
        // native bearer branch of the application middleware.
        $this->app->instance(ResourceServer::class, \Mockery::mock(ResourceServer::class));
        Passport::actingAs($user);
    }
}
