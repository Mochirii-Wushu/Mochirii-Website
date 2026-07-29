# Multi-Provider Login And Verification

This feature separates four layers that must stay distinct:

- Authentication: Supabase Auth proves control of an approved sign-in identity.
- Identity linking: signed-in users can link more OAuth identities to one Supabase account.
- Member verification: Discord can be checked automatically against the live guild and required roles; non-Discord identities require moderator review.
- Gallery authorization: Supabase RLS and Storage policies allow upload only for active members with recent Discord verification or approved, unexpired member verification.

## Current Provider State

| State | Providers | Operational rule |
| --- | --- | --- |
| Active | Discord, Google, Twitch, Apple | Keep enabled in Supabase Auth production and keep the public website allowlist at `NEXT_PUBLIC_AUTH_PROVIDER_IDS=discord,google,twitch,apple`. Apple is active identity evidence and still requires moderator review for member-only privileges. |
| Deferred | Facebook, Kakao, Spotify, Phone | Keep disabled and hidden from public activation until a scoped provider lane is reopened. |

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
  - `NEXT_PUBLIC_AUTH_PROVIDER_IDS=discord,google,twitch,apple`
  - `NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS=`
  - `NEXT_PUBLIC_PHONE_AUTH_READY=false`
  - `NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=false`
  - `NEXT_PUBLIC_AUTH_CAPTCHA_PROVIDER=`
  - `NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY=`
- OAuth client secrets stay only in Supabase Auth provider settings.
- Phone stays disabled unless SMS provider, CAPTCHA, Auth rate limits, country/cost expectations, and abuse handling are configured in a separate lane.

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
- Facebook: deferred; request `email` only if the Facebook lane is reopened.
- Kakao: deferred; keep disabled until the app is approved as a Kakao Biz App for `account_email` or leadership accepts a profile-only manual-review path.
- Spotify: deferred; identity evidence only and no membership proof.
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

1. Confirm Supabase Auth production has Discord, Google, Twitch, and Apple enabled among the current active set.
2. Confirm Supabase Auth Manual Linking is enabled for the production project.
3. Confirm Facebook, Kakao, Spotify, and Phone remain disabled in Supabase Auth production.
4. Set the public provider allowlist to `discord,google,twitch,apple`.
5. Leave the public placeholder list empty.
6. Deploy `verify-member-access` and `review-member-verification`.
7. Smoke Discord, Google, Twitch, and Apple provider flows without recording tokens, cookies, raw headers, or OAuth payloads.
8. Confirm Apple is clickable, redirects through Supabase Auth, and links to the existing admin account before signed-out Apple login is tested.
9. Confirm a non-Discord account remains blocked until moderator approval.
10. In Supabase Preview, confirm an approved active member can upload and an expired/revoked/suspended/archived member cannot.

## Out Of Scope

New website login methods do not grant access to any future game, purchases, wallets, Discord role mutation, or Discord message-content access.
