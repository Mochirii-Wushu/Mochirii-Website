# Multi-Provider Login And Verification

This feature separates four layers that must stay distinct:

- Authentication: Supabase Auth proves control of an approved sign-in identity.
- Identity linking: signed-in users can link more OAuth identities to one Supabase account.
- Member verification: Discord can be checked automatically against the live guild and required roles; non-Discord identities require moderator review.
- Gallery authorization: Supabase RLS and Storage policies allow upload only for active members with recent Discord verification or approved, unexpired member verification.

## Current Provider State

Supabase Auth remains the sole OAuth broker. The source contract deliberately
separates buttons that may appear on the sign-in page from providers that may
be linked from an already authenticated Account. Neither public environment
variable enables a provider in Supabase or substitutes for callback testing.

| State | Providers | Operational rule |
| --- | --- | --- |
| Approved source registry | Apple, Facebook, Google, Discord, Twitch, Spotify | All six have reviewed button definitions and local official marks. Registration does not render or enable a provider. |
| Production-enabled initiation | Discord, Google, Twitch, Apple | Current read-only evidence proves Supabase initiation reaches each official provider. It does not prove consent, callback, cookie-session, or return-path completion; verify that full flow before describing one as working. Apple is identity evidence and still requires moderator review for member-only privileges. |
| Production-disabled broker lanes | Facebook, Spotify | Keep disabled and absent from the runtime sign-in allowlist until provider configuration, end-to-end callback evidence, app review where required, and provider-specific brand approval are complete. Their source-staged buttons and marks do not authorize activation. |
| Account identity linking | Discord, Google, Twitch, Apple | The separate Account allowlist is `NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS=discord,google,twitch,apple`. Facebook and Spotify do not become one-click linking methods merely because they are present in the sign-in source list. |
| Deferred outside the approved six | Kakao, Phone | Keep disabled and hidden until a separately approved provider lane satisfies its readiness gates. |

This is an operational activation list, not a destructive schema list. Existing code and database constraints may retain historical/future provider values so linked identity history and future Apple work do not need a migration churn pass.

Deferred Phone readiness was captured in PR #300, <https://github.com/Mochirii-Wushu/Mochirii-Website/pull/300>, at commit `850a13df22853778d8a48ad6b5a319ae029739bc`. Keep it closed/deferred unless the Phone lane is explicitly resumed with SMS provider, CAPTCHA, rate-limit, cost, and abuse controls.

## Provider Setup

- Supabase Site URL: `https://mochirii.com`.
- OAuth callback URL for every social provider: `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/callback`.
- Redirect allowlist should include production, approved Vercel preview patterns, and localhost development.
- Supabase Auth Manual Linking must be enabled for signed-in account linking.
  This is the project-level gate behind `linkIdentity`; if it is disabled, the
  Account page will show `Manual linking is disabled` before any provider flow
  starts. The equivalent Management API field is
  `security_manual_linking_enabled`; do not print bearer tokens or raw auth
  config responses while checking it.
- Browser/Vercel public env may contain only provider IDs and public readiness flags:
  - `NEXT_PUBLIC_AUTH_PROVIDER_IDS=apple,google,discord,twitch`
  - `NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS=discord,google,twitch,apple`
  - `NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS=`
  - `NEXT_PUBLIC_PHONE_AUTH_READY=false`
  - `NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=false`
  - `NEXT_PUBLIC_AUTH_CAPTCHA_PROVIDER=`
  - `NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY=`
- OAuth client secrets stay only in Supabase Auth provider settings.
- Phone stays disabled unless SMS provider, CAPTCHA, Auth rate limits, country/cost expectations, and abuse handling are configured in a separate lane.

The website enforces both reviewed lists before calling the browser Supabase
client. They are presentation and client-policy controls, not a server-side
per-provider authorization boundary. Supabase's project-level Manual Linking
setting remains global, so an activation packet must review that setting and
the provider dashboard state together rather than relying on the Account UI.

## Provider Buttons And Official Marks

The six reviewed source labels are exact:

- `Continue with Apple`
- `Continue with Facebook`
- `Continue with Google`
- `Sign in with Discord`
- `Log in with Twitch`
- `Log in with Spotify`

On 2026-08-01, the release owner expressly approved a narrow public-name and
mark exception for these six exact actions on Mōchirīī authentication-provider
choosers. The exception covers only the exact action text above and each
matching reviewed, unmodified local mark; it does not authorize provider names
as general Mōchirīī branding, provider SDKs, remote artwork, additional OAuth
paths, runtime enablement, a new identity-linking provider, or provider
configuration. The existing Account identity-link controls remain governed by
their independent allowlist and release gate; this exception does not change
that surface or make a sign-in provider linkable automatically.

Official local marks live under
`apps/web/public/assets/auth-providers`. Their retrieval source, review date,
and SHA-256 are recorded in that directory's `README.md`. The files are used
only to identify the matching authentication option, are excluded from the
Mochirii project license, and must not be recolored, distorted, or reused as
Mochirii branding. Loading the sign-in page must not fetch logo artwork from a
provider at runtime.

Each enabled sign-in control exposes only the provider's exact reviewed action
label as its accessible name and visible button text. Membership-verification
status is a separate description below the control, so Mōchirīī guidance does
not alter or compete with the provider-branded action. The controls retain
equal visual weight, a minimum 44 CSS-pixel target, keyboard focus visibility,
and one-column reflow on compact screens.

Facebook uses the unmodified login mark linked by Meta's Login Button
documentation while Supabase continues to own the OAuth flow; do not add
Meta's JavaScript SDK as a second broker. Spotify remains production-disabled
because its current design guidance needs provider-specific confirmation for
this multi-provider chooser. Facebook likewise remains disabled until its
platform and brand-review gates are satisfied.

## Facebook Source-Only Readiness

The Website is ready to present Facebook without connecting it yet:

- the exact visible label is `Continue with Facebook` and the checksum-locked
  official mark is served locally;
- the provider registry uses Supabase's `facebook` provider and requests only
  `email`; Facebook's standard `public_profile` data is handled only as part of
  the provider's basic identity response;
- `NEXT_PUBLIC_AUTH_PROVIDER_IDS` excludes Facebook by default, the public
  placeholder list is empty, and the browser client rejects a direct Facebook
  call while it is outside that allowlist;
- `NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS` independently excludes
  Facebook, so later sign-in activation cannot silently expose one-click
  identity linking;
- no Meta JavaScript SDK, Graph API token, provider token persistence, or
  second website session exists for sign-in;
- `/privacy` and `/meta-data-deletion` distinguish future Facebook member
  sign-in from the separate Page and Instagram publishing workflow.

`npm run smoke:auth-provider-chooser` starts a local, disposable Next.js
instance with a six-provider test allowlist. It checks the exact Facebook
accessible label, official local mark, common mobile/desktop geometry, and a
synthetic Supabase authorization URL in Chromium, Firefox, and WebKit. The
test blocks every real Meta/Facebook request and never uses a client ID,
secret, token, hosted callback, or provider account.

Only after those gates pass, extend the runtime value to
`apple,facebook,google,discord,twitch,spotify` in the same approved activation
packet that enables both providers. Never publish a button before its broker
lane can complete the corresponding flow.

## Server-Side Reliability Boundary

All Supabase requests made by the Next.js server client, request middleware,
and Social OAuth decision route use the shared server fetch wrapper. Each
request has a five-second deadline. The wrapper composes that deadline with
caller cancellation from an explicit `RequestInit.signal` or, when no explicit
signal is supplied, the input `Request.signal`; this preserves standard fetch
precedence while ensuring a hung upstream cannot hold a server render or OAuth
decision open indefinitely.

The wrapper aborts the upstream request at the deadline and uses a raced stop
promise so the boundary still rejects if an underlying fetch implementation
ignores abort. It clears its timer and removes the caller abort listener after
every settled request. An already-aborted caller is rejected without starting
network work, while ordinary upstream errors retain their original failure.

Protected routes fail closed when Supabase is unavailable. They do not turn an
upstream outage into a signed-out redirect, reveal protected page content, or
render provider diagnostics. OAuth decision failures return a generic,
no-store error and never expose an upstream URL, token, cookie, or raw response.

The 2026-07-29 local candidate verification covered the bounded transport with
unit cases for success, timeout, ignored abort, caller cancellation, input
`Request` cancellation, signal precedence, cleanup, upstream rejection,
already-aborted callers, and invalid deadlines. A separate 36-case Web runtime
suite and the production-mode server-auth boundary smoke passed with a
deliberately unreachable test origin. This proves deterministic local timeout
and fail-closed behavior; it does not claim that any live OAuth provider flow
or hosted Supabase request succeeded.

## Phone OTP Activation Gate

Phone remains absent from the public provider allowlist and disabled in
Supabase Auth. The source is activation-ready but intentionally fails closed:

- a phone send is rejected unless Supabase public configuration, the explicit
  phone readiness flag, CAPTCHA enforcement flag, `turnstile` provider name,
  and a non-empty public site key are all present;
- every send requires a fresh CAPTCHA token, passes it directly to Supabase
  Auth, resets the challenge after the request, and never writes the token to
  browser storage or a generated hidden form field;
- OTP requests cannot create a new account (`shouldCreateUser` is always
  false), so member account creation remains on the reviewed identity lanes;
- the browser enforces a 60-second session-scoped resend cooldown without
  storing the phone number, while Supabase Auth remains the authoritative
  project-wide and per-recipient rate-limit boundary;
- the CAPTCHA secret belongs only in Supabase Auth Bot and Abuse Protection;
  Vercel receives only the public site key and public readiness fields;
- the route-scoped `/auth` CSP narrowly permits the CAPTCHA script and frame
  origin; unrelated routes retain the stricter shared policy, and the script is
  never requested unless every phone readiness input is complete and Phone is
  explicitly present in the provider allowlist;
- after a validated request reaches Supabase Auth, every upstream send outcome
  returns the same public accepted state so account-lookup results cannot reveal
  whether a phone number is linked to an account. Code-verification failures use
  one generic public error and never expose provider diagnostics.

Before a later activation packet may add `phone` to the public allowlist, it
must verify the SMS provider and sender, exact supported-country and cost
policy, Supabase CAPTCHA enforcement, the OTP and SMS rate limits, budget/abuse
alerts, moderator review operations, accessibility, and rollback. Enabling any
dashboard/provider setting or Vercel environment value remains a separate
owner-approved provider mutation.

## Provider Notes

- Discord: automatic verification through guild membership, onboarding state, and required roles.
- Apple: active identity evidence; member review is required for member-only privileges and the OAuth client secret must stay on a six-month rotation cadence.
- Google: use minimal `openid email profile` scopes.
- Twitch: identity evidence only, not membership proof.
- Facebook: source-staged but production-disabled; request `email` only after provider configuration, callback, app-review, and brand-approval gates pass.
- Kakao: deferred; keep disabled until the app is approved as a Kakao Biz App for `account_email` or leadership accepts a profile-only manual-review path.
- Spotify: source-staged but production-disabled; identity evidence only, no membership proof, and activation requires provider-specific brand approval.
- Phone: deferred; SMS control only and still requires moderator review for gallery access.

## Apple Activation Gate

Apple login uses Supabase Auth's hosted OAuth callback, not a Vercel route or a
custom website callback:

```text
https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/callback
```

Stable Apple Developer identifiers for this website lane:

```text
App ID: com.mochirii.web
App ID description: Mochirii Web
Services ID: com.mochirii.web.login
Services ID description: Mochirii Website Login
Domain: deyvmtncimmcinldjyqe.supabase.co
```

Credential artifacts, Apple key metadata, generated client-secret expiry notes,
and rotation notes belong only under
`C:\Github Repo's\Mochirii Website\Mochi Creds\Apple`. Do not
commit or print Apple private key material, generated client secrets, token
payloads, cookies, raw OAuth responses, or digests of those values.

Apple is identity evidence only. It does not automatically prove Discord guild
membership, role ownership, gallery upload eligibility, moderator access,
or Mochirii Social account creation. First activation testing
must link Apple to the existing admin account from Account before testing
signed-out Apple login, so the flow does not accidentally create a duplicate
admin identity.

Apple's generated OAuth client secret must be rotated on a six-month cadence.
Record the next rotation date in the local credential notes after enabling the
provider.

## Tables And Policies

- `member_auth_identities` stores redacted identity evidence only: provider, provider subject, verified email/phone flags, display label, and timestamps.
- `member_verifications` stores current gallery access status, method, reviewer, timestamps, expiry, and redacted reason.
- Neither table grants direct `anon` or `authenticated` access.
- `private.member_has_gallery_upload_access(uuid)` is the RLS helper used by gallery submission and Storage policies.

## Edge Functions

- `verify-member-access`: syncs linked identities, refreshes Discord verification when requested, and returns redacted gallery eligibility.
- `review-member-verification`: moderator-only approve/reject/revoke endpoint for non-Discord member verification. Approval activates a pending profile; suspended or archived profiles must be restored separately.
- `verify-discord-member`: retained as the Discord-specific compatibility endpoint during rollout.

## Moderator Review

- Leader Dashboard includes a moderator-only Member Verification panel for approving, rejecting, or revoking non-Discord gallery access by Member user ID.
- Moderators must use redacted notes only. Do not paste private messages, provider payloads, tokens, cookies, raw headers, or OAuth response bodies.
- Activation evidence belongs in the private ignored `.local/multi-provider-login-activation-ledger.md` ledger, with status/counts only.
- End-to-end approve/revoke proof belongs in Supabase Preview only. Use `npm run smoke:member-verification-preview` with `ALLOW_PREVIEW_MEMBER_VERIFICATION_SMOKE=true`; the script refuses the production project `deyvmtncimmcinldjyqe`.

## Activation Checklist

1. Confirm the source sign-in policy is exactly `apple,facebook,google,discord,twitch,spotify` and the Account linking policy is independently `discord,google,twitch,apple`.
2. Confirm the six buttons use the exact reviewed labels and the checksum-verified local official marks.
3. Confirm Supabase Auth production has Discord, Google, Twitch, and Apple enabled among the current active set.
4. Confirm Supabase Auth Manual Linking is enabled for the production project and Account offers only Discord, Google, Twitch, and Apple.
5. Confirm Facebook, Spotify, Kakao, and Phone remain disabled in Supabase Auth production; Facebook and Spotify require separate provider and brand approval before activation.
6. Leave the public placeholder list empty.
7. Deploy `verify-member-access` and `review-member-verification` only in an independently approved release.
8. Smoke Discord, Google, Twitch, and Apple through consent, Supabase callback, cookie session, and reviewed return path without recording tokens, cookies, raw headers, or OAuth payloads.
9. Confirm Apple links to the existing admin account before signed-out Apple login is tested.
10. Confirm Facebook and Spotify fail closed while their Supabase provider lanes are disabled, without attempting a provider consent flow.
11. Confirm a non-Discord account remains blocked until moderator approval.
12. In Supabase Preview, confirm an approved active member can upload and an expired/revoked/suspended/archived member cannot.

## Out Of Scope

New website login methods do not grant access to any future game, purchases, wallets, Discord role mutation, or Discord message-content access.
