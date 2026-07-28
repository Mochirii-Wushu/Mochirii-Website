<?php

namespace Tests\Feature;

use App\Services\MochiriiRaffleLeaderboardService;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class MochiriiRaffleLeaderboardServiceTest extends TestCase
{
    private const ENDPOINT = 'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/get-current-raffle';

    private const SUBJECT = '8ccaa7af-909f-44e7-84cb-67cdccb56be6';

    private const SECRET = 'test-only-raffle-secret-32-bytes-minimum';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'remote-auth.raffle_leaderboard.endpoint' => self::ENDPOINT,
            'remote-auth.raffle_leaderboard.secret' => self::SECRET,
            'remote-auth.raffle_leaderboard.timeout' => 2,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    #[Test]
    public function it_signs_a_bounded_request_and_returns_only_the_strict_dto(): void
    {
        Carbon::setTestNow('2026-07-28T01:02:03Z');
        Http::fake([
            '*' => Http::response($this->validPayload(), 200, ['Content-Type' => 'application/json; charset=UTF-8']),
        ]);

        $result = app(MochiriiRaffleLeaderboardService::class)->read(strtoupper(self::SUBJECT));

        $this->assertSame($this->validPayload(), $result);
        Http::assertSent(function (Request $request): bool {
            $timestamp = $request->header('x-mochirii-raffle-timestamp')[0] ?? '';
            $nonce = $request->header('x-mochirii-raffle-nonce')[0] ?? '';
            $signature = $request->header('x-mochirii-raffle-signature')[0] ?? '';
            $canonical = implode("\n", ['v1', self::SUBJECT, $timestamp, $nonce]);

            return $request->url() === self::ENDPOINT
                && $request->method() === 'POST'
                && $request->data() === ['sub' => self::SUBJECT]
                && $timestamp === (string) now()->getTimestamp()
                && preg_match('/\A[0-9a-f]{32}\z/D', $nonce) === 1
                && hash_equals('v1='.hash_hmac('sha256', $canonical, self::SECRET), $signature)
                && ! str_contains(json_encode([$request->headers(), $request->data()]), self::SECRET);
        });
    }

    #[Test]
    public function missing_or_invalid_configuration_never_sends_a_request(): void
    {
        Http::preventStrayRequests();
        config([
            'remote-auth.raffle_leaderboard.endpoint' => 'http://example.test/leaderboard',
            'remote-auth.raffle_leaderboard.secret' => 'short',
        ]);

        $this->assertNull(app(MochiriiRaffleLeaderboardService::class)->read(self::SUBJECT));
        Http::assertNothingSent();
    }

    #[Test]
    public function endpoint_origin_and_path_confusion_never_sends_a_request(): void
    {
        Http::preventStrayRequests();
        $invalidEndpoints = [
            'http://deyvmtncimmcinldjyqe.supabase.co/functions/v1/get-current-raffle',
            'https://attacker.example/functions/v1/get-current-raffle',
            'https://deyvmtncimmcinldjyqe.supabase.co.attacker.example/functions/v1/get-current-raffle',
            'https://member@deyvmtncimmcinldjyqe.supabase.co/functions/v1/get-current-raffle',
            'https://deyvmtncimmcinldjyqe.supabase.co:443/functions/v1/get-current-raffle',
            'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/get-current-raffle/',
            'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/other',
            'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/get-current-raffle?next=other',
            'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/get-current-raffle#other',
        ];

        foreach ($invalidEndpoints as $endpoint) {
            config(['remote-auth.raffle_leaderboard.endpoint' => $endpoint]);
            $this->assertNull(app(MochiriiRaffleLeaderboardService::class)->read(self::SUBJECT));
        }

        Http::assertNothingSent();
    }

    #[Test]
    public function extra_fields_and_invalid_entry_totals_fail_closed(): void
    {
        $extraField = $this->validPayload();
        $extraField['internalId'] = 'must-not-pass';
        $invalidTotal = $this->validPayload();
        $invalidTotal['entries'][0]['entryCount'] = 11;

        Http::fakeSequence()
            ->push($extraField, 200, ['Content-Type' => 'application/json'])
            ->push($invalidTotal, 200, ['Content-Type' => 'application/json']);

        $service = app(MochiriiRaffleLeaderboardService::class);
        $this->assertNull($service->read(self::SUBJECT));
        $this->assertNull($service->read(self::SUBJECT));
    }

    #[Test]
    public function malformed_ranking_and_non_json_responses_fail_closed(): void
    {
        $invalidRank = $this->validPayload();
        $invalidRank['entries'][1]['rank'] = 2;

        Http::fakeSequence()
            ->push($invalidRank, 200, ['Content-Type' => 'application/json'])
            ->push('<html>not json</html>', 200, ['Content-Type' => 'text/html']);

        $service = app(MochiriiRaffleLeaderboardService::class);
        $this->assertNull($service->read(self::SUBJECT));
        $this->assertNull($service->read(self::SUBJECT));
    }

    #[Test]
    public function unicode_bidirectional_controls_in_display_names_fail_closed(): void
    {
        foreach ([
            "\u{061C}",
            "\u{200E}",
            "\u{200F}",
            "\u{202A}",
            "\u{202B}",
            "\u{202C}",
            "\u{202D}",
            "\u{202E}",
            "\u{2066}",
            "\u{2067}",
            "\u{2068}",
            "\u{2069}",
        ] as $control) {
            $payload = $this->validPayload();
            $payload['entries'][0]['displayName'] = "Trusted{$control}Member";
            Http::fake([
                '*' => Http::response($payload, 200, ['Content-Type' => 'application/json']),
            ]);

            $this->assertNull(app(MochiriiRaffleLeaderboardService::class)->read(self::SUBJECT));
        }
    }

    #[Test]
    public function transport_failures_do_not_log_secrets_or_payloads(): void
    {
        Log::spy();
        Http::fake(function () {
            throw new \RuntimeException('secret='.self::SECRET.' member=Private Name');
        });

        $this->assertNull(app(MochiriiRaffleLeaderboardService::class)->read(self::SUBJECT));

        Log::shouldHaveReceived('warning')
            ->once()
            ->with(
                'Mōchirīī raffle leaderboard request failed.',
                \Mockery::on(fn ($context) => is_array($context)
                    && ($context['exception'] ?? null) === \RuntimeException::class
                    && ! str_contains(json_encode($context), self::SECRET)
                    && ! str_contains(json_encode($context), 'Private Name')),
            );
    }

    /**
     * @return array{cycleLabel: string, asOf: string, entries: list<array{rank: int, displayName: string, entryCount: int}>}
     */
    private function validPayload(): array
    {
        return [
            'cycleLabel' => 'July 2026',
            'asOf' => '2026-07-28T01:02:03Z',
            'entries' => [
                ['rank' => 1, 'displayName' => 'Mōchī Member', 'entryCount' => 10],
                ['rank' => 1, 'displayName' => 'Second Member', 'entryCount' => 10],
                ['rank' => 2, 'displayName' => 'Third Member', 'entryCount' => 4],
            ],
        ];
    }
}
