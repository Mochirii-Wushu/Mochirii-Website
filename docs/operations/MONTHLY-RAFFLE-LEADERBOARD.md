# Monthly raffle leaderboard

## Status and scope

This source is a disabled, reviewable foundation. It does not activate raffle
submissions, schedules, claims, rewards, provider orders, or paid
infrastructure. It also does not deploy the Website or Mōchirīī Social.

The canonical raffle ledger lives in Supabase. The Website and Mōchirīī Social
render separate native views of the same sanitized aggregate; Social does not
copy raffle standings into its database, and member browsers do not call a
cross-origin raffle API.

## Member-visible contract

Only a currently verified, active guild member may read the current drawing's
standings. A leaderboard row contains only:

- dense rank;
- guild display name;
- current point total; and
- a Website-only boolean identifying the viewer's own row.

Each point is one raffle entry. The total is derived from the one eligible
monthly opt-in entry plus distinct, active bonus awards, capped at ten. Frozen
or drawn cycles use the immutable frozen entry count. There is no independently
mutable points column.

Account identifiers, evidence, verification details, country, age, claim data,
reward data, and provider data never enter the member DTO. Display names are
bounded; any legacy name containing control or bidirectional-override
characters is replaced with the deterministic safe label `Mōchī Member` at the
database aggregate boundary so one row cannot suppress the standings. The
database filters members through a Discord-current verified-member predicate
before ranking, so suspended, stale, role-revoked, future-dated, or deverified
accounts neither appear nor affect rank or participant totals. Manual gallery
approval is deliberately not an alternate leaderboard authorization.

Signed-out and unverified Website visitors receive the ordinary public raffle
page with no leaderboard section or standings request. Signed-out, unmapped, or
unverified Social requests receive an opaque not-found response. A verified
member receives a private empty state when no eligible drawing exists.

## Website boundary

`/raffle` remains a public, indexable, server-rendered route. Its client member
island initially renders nothing and attempts a standings request only after a
valid local member session is available. The same-origin
`/api/raffle/leaderboard` route requires an origin-matched POST and a bounded
bearer token, then calls the canonical Edge reader with `cache: no-store`.

The Edge reader verifies the token with Supabase Auth, resolves the current
member record, and invokes a service-only aggregate that independently checks
current verified guild access. Any missing configuration, invalid token,
failed verification, malformed response, timeout, or upstream error clears the
client view and fails closed. Private responses use `Cache-Control: private,
no-store, max-age=0`, vary on authorization, disable sniffing and framing, and
are excluded from indexing.

The visible client refresh is bounded to once per minute while the page is
visible, with an eight-second browser timeout and a five-second server timeout.

## Mōchirīī Social boundary

`/guild/raffle` is a native server-rendered Social route behind the existing
private-member middleware. It requires the authenticated Social account's
current OIDC mapping and never trusts a browser-supplied identity.

Social sends the mapped lowercase UUID to the canonical reader over HTTPS with
a dedicated HMAC-SHA256 request signature. The signed UTF-8 bytes are exactly:

```text
v1
{subject}
{unix-timestamp}
{32-character-lowercase-hex-nonce}
```

There is no trailing line feed. The reader permits at most 60 seconds of clock
skew, compares the lowercase signature in constant time, and consumes the
nonce once in a private database table. The member predicate is re-evaluated
after signature verification and before reading standings.

Host-only configuration names are:

```dotenv
MOCHIRII_RAFFLE_LEADERBOARD_URL=
MOCHIRII_RAFFLE_LEADERBOARD_SECRET=
MOCHIRII_RAFFLE_LEADERBOARD_TIMEOUT=5
```

The matching Edge secret name is
`MOCHIRII_RAFFLE_LEADERBOARD_HMAC_SECRET`. Values stay blank in source and must
never appear in commands, logs, artifacts, pull requests, browser code, or
Mochi Creds inspection. Missing or weak configuration returns an opaque error.
The Social reader accepts only the exact current hosted function origin and
`/functions/v1/get-current-raffle` path; redirects, alternate hosts, ports,
userinfo, queries, fragments, and path variants fail closed before signing.
The route is rate-limited to 30 requests per minute and emits private/no-store,
noindex, and frame-denial headers.

## Database and release boundary

The migration creates the disabled monthly raffle ledger, one-use nonce table,
service-only functions, immutable draw evidence, and default-deny RLS. Browser
roles have no direct table or aggregate access. Every operational switch and
approval gate starts closed, and no schedule or external network call is
created by the migration.

This change declares `get-current-raffle` with `verify_jwt=false` because it
serves a public GET contract and performs explicit token or HMAC verification
for private POST actions. The exact source inventory becomes 34 functions with
20 `verify_jwt=true` and 14 false. This parity must be recalculated from the
final reviewed source before any release approval.

Activation requires a separate exact authorization covering all of the
following:

1. The exact migration and non-skipped Supabase Preview.
2. The normal protected-main Vercel publication.
3. The unavoidable automatic redeployment of all 34 functions declared in
   `supabase/config.toml`, preserving 20/14 JWT parity.
4. The immutable Social image publication and its SBOM/provenance.
5. Setting the same newly generated HMAC secret only in the Edge environment
   and existing Social host, followed by a rollback-safe Social deployment.

Never deploy Supabase manually, create a new host, add paid infrastructure, or
activate submissions, scheduling, claims, reward orders, the relay, or provider
access as part of the leaderboard release. The official spinner must eventually
animate a result selected from the same frozen weighted ledger. Test spins must
never publish or alter the official ledger, and existing immutable draw evidence
must never be rewritten.

## Verification

Before review, run from a clean dependency state:

```text
npm run toolchain:check
npm run test:raffle-leaderboard
npm run test:raffle-leaderboard-edge
npm run test:raffle-leaderboard-db
npm run check
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm run smoke:raffle-public:fixtures
git diff --check
```

Also require a clean local database reset, pgTAP, database lint and advisors,
the focused Social tests, and responsive Chromium, Firefox, and WebKit checks.
The browser matrix must prove that signed-out fixtures contain no leaderboard,
verified-member ties use dense rank, long safe names reflow at 320 CSS pixels
and 200% text, and malformed or stale data disappears rather than remaining on
screen.

Primary implementation guidance: [Supabase Row Level
Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Supabase Edge Function authorization](https://supabase.com/docs/guides/functions/auth),
[Next.js authentication and data-access
boundaries](https://nextjs.org/docs/app/guides/authentication), and the [Laravel
HTTP client](https://laravel.com/docs/12.x/http-client).
