<?php

namespace Tests\Feature;

use App\Http\Middleware\RestrictedAccess;
use App\Services\MochiriiSourceRelease;
use App\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class OpenSourceNoticeTest extends TestCase
{
    private const REVISION = '0123456789abcdef0123456789abcdef01234567';
    private const REPOSITORY = 'https://github.com/Mochirii-Wushu/Mochirii-Website';

    #[Test]
    public function anonymous_notice_binds_every_source_link_to_one_exact_release(): void
    {
        $this->useExactSourceRelease();

        $this->get('/site/open-source')
            ->assertOk()
            ->assertSeeText('Open-source notices')
            ->assertSeeText('modified Pixelfed software')
            ->assertSeeText('GNU Affero General Public License, version 3')
            ->assertSeeText(self::REVISION)
            ->assertSee(self::REPOSITORY.'/tree/'.self::REVISION.'/services/social', false)
            ->assertSee(self::REPOSITORY.'/archive/'.self::REVISION.'.zip', false)
            ->assertSee(self::REPOSITORY.'/commit/'.self::REVISION, false)
            ->assertSee(self::REPOSITORY.'/blob/'.self::REVISION.'/services/social/LICENSE', false)
            ->assertDontSee('Exact source release information is temporarily unavailable.');
    }

    #[Test]
    public function missing_or_untrusted_metadata_never_claims_an_exact_release(): void
    {
        foreach ([
            ['revision' => '@MOCHIRII_SOURCE_REVISION@'],
            ['revision' => strtoupper(self::REVISION)],
            ['revision' => self::REVISION.'/../main'],
            ['repository_url' => 'https://example.invalid/source'],
            ['subdirectory' => 'apps/web'],
        ] as $override) {
            $this->useExactSourceRelease($override);
            $this->assertNull(MochiriiSourceRelease::current());
        }

        $this->useExactSourceRelease(['revision' => '@MOCHIRII_SOURCE_REVISION@']);

        $this->get('/site/open-source')
            ->assertOk()
            ->assertSeeText('Exact source release information is temporarily unavailable.')
            ->assertDontSee('/tree/', false)
            ->assertDontSee('/archive/', false)
            ->assertDontSee('/commit/', false);
    }

    #[Test]
    public function notice_link_remains_on_login_restricted_authenticated_and_error_shells(): void
    {
        $this->useExactSourceRelease();
        config(['instance.restricted.enabled' => true]);

        $this->get('/login')
            ->assertOk()
            ->assertSee('href="'.route('site.opensource').'"', false)
            ->assertSeeText('Open-source notices');

        $restricted = app(RestrictedAccess::class)->handle(
            Request::create('/site/open-source', 'GET'),
            fn () => response('notice'),
        );
        $this->assertSame('notice', $restricted->getContent());

        $user = (new User())->forceFill([
            'id' => 42,
            'name' => 'Verified Member',
            'username' => 'verifiedmember',
            'email' => 'verified.member@example.com',
            'email_verified_at' => now(),
            '2fa_enabled' => false,
            'is_admin' => false,
        ]);
        Auth::guard('web')->setUser($user);

        $this->get('/site/open-source')
            ->assertOk()
            ->assertSeeText('Open-source notices');

        Auth::guard('web')->logout();
        $this->get('/definitely-not-a-real-social-route')
            ->assertNotFound()
            ->assertSeeText('Open-source notices')
            ->assertDontSee('Pixelfed')
            ->assertDontSee('Mastodon');
    }

    private function useExactSourceRelease(array $override = []): void
    {
        config([
            'mochirii-source.repository_url' => $override['repository_url'] ?? self::REPOSITORY,
            'mochirii-source.revision' => $override['revision'] ?? self::REVISION,
            'mochirii-source.subdirectory' => $override['subdirectory'] ?? 'services/social',
        ]);
    }
}
