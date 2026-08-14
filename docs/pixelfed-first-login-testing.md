# Pixelfed First Login Testing Runbook

> **Historical and superseded - do not execute.** This document is retained
> only as integration history. Current Social operations are owned exclusively
> by `Mochirii-Wushu/Mochirii-Social`.

Status: admin-first staging readiness packet. Provider mutations remain approval-gated.

This runbook prepares the first Pixelfed login test without committing Pixelfed
runtime code, host secrets, OAuth client secrets, database URLs, cookies, access
tokens, or media credentials to this website repo.

Phase 2 OIDC compatibility work is tracked in
[`docs/pixelfed-oidc-spike.md`](pixelfed-oidc-spike.md). Run
`npm run check:pixelfed-oidc-spike` before enabling or retesting provider
OAuth settings.

## Current Repo Gate

The strict source boundary is versioned in
[`integrations/social-service-entitlement.v1.md`](integrations/social-service-entitlement.v1.md).
It requires exact `active && discordVerified` and never treats manual Gallery
approval as Social access. This foundation does not secure prior-consent or
refresh-token issuance by itself, so provider activation remains blocked until
an independently accepted server-side token policy and revocation design are
implemented and verified.

First login testing may start only after these website and database-facing
pieces are live through the protected branch flow:

- PR containing `/social`, `/oauth/consent`, `/api/oauth/decision`, and
  `social_accounts` has merged to `main`.
- `npm run check:pixelfed-first-login-readiness` passes on the merged commit.
- `npm run toolchain:check`, `npm run check`, `git diff --check`, and
  `cd apps/web && npm run toolchain:check && npm run lint && npm run build`
  pass on the merged commit.
- Supabase Preview is green for the migration before production database
  mutation.
- The staged Pixelfed branding/source commit has been pushed to a
  Mochirii-owned private fork or ops repo, or the missing source-control step is
  explicitly recorded as the blocker before first login.

## Provider Approval Gates

Use these exact approval prompts before mutating provider state:

- `Approve Supabase db push for project deyvmtncimmcinldjyqe migration 20260702080720.`
- `Approve enabling Supabase OAuth 2.1 Server for project deyvmtncimmcinldjyqe and setting Authorization Path /oauth/consent.`
- `Approve registering the Pixelfed OAuth client for the approved staging Pixelfed URL with its exact OIDC callback URI.`
- `Approve updating or re-registering the Pixelfed OAuth client for social.mochirii.com with redirect URI https://social.mochirii.com/auth/oidc/callback and token endpoint auth method client_secret_post.`
- `Approve provisioning the Pixelfed staging host at [host/provider] with the reviewed cost, backup, and monitoring plan.`
- `Approve creating DNS for social.mochirii.com pointing to the approved Pixelfed host.`
- `Approve creating a private GitHub repository under Mochirii-Wushu named mochirii-pixelfed-ops for the Mochirii-controlled Pixelfed staging source and no-secret ops docs, then pushing the existing Droplet-local branding branch to it. No secrets, .env files, DB files, Redis data, media, backups, cache files, or host-private notes will be committed.`

Do not combine these approvals. If the callback URL changes, stop and request a
new approval naming the exact redirect URI.

## Supabase Database Gate

After PR merge and explicit approval, apply the committed migration to project
`deyvmtncimmcinldjyqe`.

Minimum verification:

- `social_accounts` exists in `public`.
- RLS is enabled.
- `authenticated` has `select` plus column-scoped
  `update(profile_link_visible)` only.
- Users can read only their own `social_accounts` row.
- Users cannot insert, delete, or update Pixelfed identity fields.
- Service-role server workflows can write Pixelfed identity fields.
- `npm run check:supabase-security-performance` still passes locally.

### Social Account Sync Bridge

The first login smoke must create or update one active `social_accounts` row.
The trusted write path is the Supabase Edge Function
`sync-pixelfed-social-account`; Pixelfed must not receive a Supabase
service-role key.

Approved sync flow:

1. Pixelfed OIDC callback completes.
2. Pixelfed sends a server-to-server POST to the Edge Function with `sub`,
   Pixelfed local user id, username, `https://social.mochirii.com/...` profile
   URL, event, timestamp, and the shared sync secret header.
3. The Edge Function verifies the secret, timestamp freshness, Member user ID,
   username shape, profile URL boundary, and the strict v1 Social entitlement.
4. The Edge Function upserts `public.social_accounts` with
   `provider = 'pixelfed'`, `status = 'active'`, and
   `federation_enabled = false`.

Required deployment approval before using this live:

```text
Approve deploying Supabase Edge Function sync-pixelfed-social-account for project deyvmtncimmcinldjyqe and setting PIXELFED_SOCIAL_SYNC_SECRET from the local credential vault.
```

Required Pixelfed host approval before using this live:

```text
Approve setting Pixelfed host env vars MOCHIRII_SOCIAL_SYNC_URL and MOCHIRII_SOCIAL_SYNC_SECRET on social.mochirii.com, clearing Laravel config cache, and restarting app services only if required.
```

## Supabase OAuth Gate

Supabase OAuth Server must be configured according to the current Supabase OAuth
2.1 documentation:

- OAuth Server is enabled.
- Authorization Path is `/oauth/consent`.
- Site URL resolves to the website surface that serves `/oauth/consent`.
- OIDC discovery and UserInfo endpoints are reachable.
- The approved Pixelfed staging client uses an exact redirect URI.
- The approved Pixelfed staging client uses the token endpoint auth method
  expected by the staged Pixelfed runtime. Current unpatched Pixelfed OIDC uses
  The PHP League `GenericProvider`, so use `client_secret_post` unless a
  private Pixelfed patch or custom provider is explicitly approved and tested.
- Requested scopes include `openid profile email`.
- Approval calls are allowed only for active guild members through
  `/api/oauth/decision`.
- `/api/oauth/decision` keeps the active-member gate server-side, then submits
  the consent decision to Supabase Auth with the signed-in user's bearer token.
  Do not replace this with a sessionless server `supabase.auth.oauth.*` helper:
  those helpers require an auth-js session and will return `Auth session
  missing!` in a stateless route handler.
- The custom consent surface is defense in depth. It does not cover every
  prior-consent or refresh-token issuance path; do not activate Social login
  until the separately reviewed server-side all-token-issuance policy is live.

If ID token generation fails because JWT signing keys are still symmetric,
pause and prepare a JWT signing-key decision packet before continuing.

### Live Provider Assertion

After the OAuth Server approval is applied, assert the live Supabase provider
state without printing token values:

```powershell
$tokenFromCreds = (Get-Content -LiteralPath "C:\Github Repo's\Mochirii Website\Mochi Creds\Supabase\Supabase Key.txt" -Raw).Trim()
[Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', $tokenFromCreds, 'Process')
$env:PIXELFED_FIRST_LOGIN_PROVIDER_READY = '1'
npm run check:pixelfed-first-login-readiness
Remove-Item Env:\SUPABASE_ACCESS_TOKEN
Remove-Item Env:\PIXELFED_FIRST_LOGIN_PROVIDER_READY
```

This verifies the Management API auth config, OAuth discovery, OIDC discovery,
Site URL, Authorization Path, and PKCE `S256` support. It does not prove that
the Pixelfed client or staging runtime exists.

## Pixelfed Staging Gate

The first login test targets a staging Pixelfed runtime, not production
federation. Pixelfed must be hosted outside Vercel with PHP/Laravel runtime
support, DB, Redis, queue worker, scheduler, HTTPS, private media configuration,
backups, and monitoring.

Current staging target: `https://social.mochirii.com`. Treat it as admin-first
testing only; do not invite regular members or enable federation until the
first-login smoke, media policy, backup/restore, and moderation gates pass.

Public website navigation should treat `https://social.mochirii.com` as the
main Social destination from the regular Guild dropdown and footer. The website
`/social` route is intentionally noindex: signed-in members are redirected to
the social host, while signed-out visitors see login/help copy. Account-link
state belongs in the website Account page, while public Social links should
open `https://social.mochirii.com`; do not make `/social` the primary public
Social link again.

Minimum staging posture:

- Closed registration.
- SSO/OIDC login enabled.
- Federation disabled.
- Public discovery minimized until moderation is ready.
- Media upload type and size limits configured.
- Moderator/report flow configured.
- Runtime commit or release pinned and documented privately.
- Staged source changes stored in a Mochirii-owned private fork or ops repo.

Pixelfed OIDC configuration must map Supabase claims without using Discord
display names as authority. Prefer deterministic website member identity data
for usernames. If Supabase cannot emit the required claim directly, stop and
prepare a claim bridge or Pixelfed patch decision packet.

### Staging Assertion

After the separate approvals for OAuth client registration and staging runtime
provisioning are complete, assert the staging boundary with explicit no-secret
operator markers:

```powershell
$env:PIXELFED_FIRST_LOGIN_STAGING_READY = '1'
$env:PIXELFED_STAGING_BASE_URL = 'https://social.mochirii.com'
$env:PIXELFED_OIDC_CALLBACK_URI = 'https://social.mochirii.com/auth/oidc/callback'
$env:PIXELFED_OAUTH_CLIENT_REGISTERED = '1'
$env:PIXELFED_OAUTH_CLIENT_CREDENTIAL_READY = '1'
$env:PIXELFED_OAUTH_TOKEN_AUTH_METHOD = 'client_secret_post'
$env:PIXELFED_STAGING_RUNTIME_READY = '1'
$env:PIXELFED_STAGING_SECURITY_READY = '1'
npm run check:pixelfed-first-login-readiness
```

Set the marker variables only after the private host checklist confirms the
matching OAuth client, token endpoint auth method, closed registration, disabled
federation, upload limits, queue worker, scheduler, backups, monitoring, and
moderation/report flow. Inject `PIXELFED_OAUTH_CLIENT_ID` and
`PIXELFED_OAUTH_CLIENT_SECRET` only into the child-process environment from
local credential files; do not paste them into docs, reports, PRs, or shell
history. When both provider and staging assertions pass, first admin account
creation is the next manual prompt before browser login smoke testing.

Clear the variables from the shell after the check if the session will remain
open.

## First Login Smoke

Run the first login smoke with no secret values in screenshots, docs, PRs, or
terminal summaries:

1. Open the staging Pixelfed login page.
2. Start OIDC login.
3. Confirm Supabase redirects to `/oauth/consent?authorization_id=...`.
4. Sign in through the website using a verified active guild member account.
5. Confirm the consent page shows client, redirect URI, requested scopes, and
   active member state.
6. Approve the request.
7. Confirm Pixelfed callback completes.
8. Confirm the Pixelfed account is created or linked to the deterministic
   username.
9. Confirm `social_accounts` has one active Pixelfed row written by the sync
   bridge.
10. Confirm the website Account page shows linked Mochirii Social status without
    exposing retired member-page profile visibility controls.

## Negative Smokes

Before declaring first-login ready, verify:

- Missing `authorization_id` fails safely.
- Invalid or stale `authorization_id` fails safely.
- Signed-out user is sent to `/auth` with the consent redirect preserved.
- Non-member approval is denied.
- A manually approved Gallery member without current trusted Discord evidence
  is denied by the consent display, decision route, and sync bridge.
- Suspended member approval is denied.
- Deny action redirects safely without creating a Pixelfed account.
- Duplicate username or duplicate email produces a documented decision packet.
- Logout and re-login do not expose another member's `social_accounts` row.
- Missing or invalid Pixelfed sync secret is rejected by the Edge Function.
- Stale Pixelfed sync timestamps are rejected by the Edge Function.
- Off-domain `profile_url` values are rejected by the Edge Function.

## Result Packet

Keep the completed result packet private and untracked. The public summary may
state only:

- approved staging URL label, not secrets;
- PR and commit identifiers;
- pass/fail status for each smoke;
- provider settings changed by explicit approval;
- whether first login is ready, blocked, or deferred.

Never paste OAuth client secrets, access tokens, refresh tokens, cookies,
database URLs, service-role keys, private user identifiers, raw headers, or
provider screenshots containing private data into this repo.
