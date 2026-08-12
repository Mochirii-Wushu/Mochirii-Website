# Pixelfed Guild Social ADR

Date: 2026-07-02

Status: staging integration in progress; provider mutations and production runtime are approval-gated.

## Decision

Mochirii will treat Pixelfed as a separate guild social runtime at `social.mochirii.com`. The Vercel/Next.js site in `apps/web` remains the member doorway, Supabase remains the identity and guild membership authority, Discord remains the guild verification source, and GitHub protected PR checks remain the release gate.

Pixelfed code, infrastructure secrets, media storage credentials, DB passwords, queue/runtime configs, and host-specific state must not be committed to this website repo. The staging host now contains a Mochirii branding commit that must be moved into a Mochirii-owned private fork or ops repo before additional runtime edits.

## Source Anchors

- Pixelfed installation expects a PHP/Laravel application with supporting services, and the current beta install docs use the `dev` branch for deployable code: <https://pixelfed.github.io/docs-next/running-pixelfed/installation.html>
- Vercel remains the Next.js host; Pixelfed media, queues, scheduler, and long-running service work must stay off the Vercel website runtime: <https://vercel.com/docs/limits>
- Supabase OAuth 2.1 Server supports OIDC, authorization code flow with PKCE, custom consent UI, and exact redirect clients: <https://supabase.com/docs/guides/auth/oauth-server>
- Supabase OAuth setup requires enabling the server, configuring the Authorization Path, building the consent UI, and registering clients: <https://supabase.com/docs/guides/auth/oauth-server/getting-started>
- ActivityPub is federated server-to-server social networking; remote copies can exist outside Mochirii control: <https://www.w3.org/TR/activitypub/>
- Discord OAuth scopes and `state` handling remain relevant for existing Discord identity and guild membership verification: <https://discord.com/developers/docs/topics/oauth2>
- Upload safety follows allowlisted types, server validation, generated names, size limits, authorized uploads, private/object storage, and malware scanning where available: <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>

## Architecture Boundaries

- Website repo: `/social`, `/oauth/consent`, `/api/oauth/decision`, account social status, Social handoff links, Supabase migration/function files, and no-secret docs. The website `/members` profile surface is retired.
- Supabase project `deyvmtncimmcinldjyqe`: Auth, OAuth consent handoff, member access, `social_accounts`, RLS, and the `sync-pixelfed-social-account` Edge Function. The service-role key stays inside Supabase; Pixelfed receives only a narrow sync secret.
- Discord: guild membership and role verification only; it is not the Pixelfed identity authority.
- Pixelfed runtime: separate DigitalOcean staging host with HTTPS, PHP, queue worker, scheduler, database, Redis, media storage, backups, monitoring, and pinned Pixelfed release or commit.
- DigitalOcean Spaces: required primary media object storage before broad member upload testing. Use a dedicated media Space, exact-origin CORS for `https://social.mochirii.com`, separate backup storage, host-only credentials, and restore notes.
- Durable runtime source: a Mochirii-owned private fork or ops repo; never the public website repo.

## SSO Gate

Website source defines the additive v1 Social entitlement in
[`integrations/social-service-entitlement.v1.md`](integrations/social-service-entitlement.v1.md).
It grants only exact active members with current trusted Discord verification;
manual Gallery approval remains Gallery-only. The consent UI and Website
decision route are defense-in-depth gates, not complete token-issuance
enforcement. Production remains blocked until a separately reviewed
server-side policy covers initial and refresh token issuance for the exact
Social client.

Do not provision production Pixelfed until staging proves Supabase OAuth 2.1 and Pixelfed OIDC compatibility:

1. Supabase OAuth Server is enabled for an approved non-production or production-staging path.
2. Authorization Path is `/oauth/consent`.
3. A Pixelfed OAuth client is registered with exact redirect URI `https://social.mochirii.com/auth/oidc/callback`.
4. Pixelfed receives OIDC-compatible `sub`, `email`, and deterministic username data from Supabase.
5. PKCE succeeds end to end.
6. Invalid `state`, missing sessions, non-members, suspended members, duplicate username/email, and callback retry paths fail safely.

If PKCE or required claims fail, pause and prepare a decision packet for a minimal Pixelfed patch/fork, an identity broker, or native Pixelfed accounts mapped back to Supabase. Do not force a brittle production workaround.

## Account Sync Gate

First admin login is not complete until Pixelfed writes back to Supabase through
the trusted sync bridge:

1. Pixelfed completes OIDC callback and creates or links the local user.
2. Pixelfed calls `sync-pixelfed-social-account` with `sub`, Pixelfed user id,
   username, `https://social.mochirii.com/...` profile URL, event, timestamp,
   and the shared sync secret.
3. Supabase verifies the secret, timestamp freshness, user id, username shape,
   profile URL boundary, and the strict v1 Social entitlement, then upserts
   `public.social_accounts` as
   `provider = 'pixelfed'`, `status = 'active'`, and
   `federation_enabled = false`.

The current sync source uses bounded stored Discord evidence. Launch remains
blocked until an accepted design provides live refresh plus durable service
revocation, or the release owner explicitly accepts the documented staleness
window. Manual verification must never satisfy this bridge.

Do not store the Supabase service-role key on the Pixelfed host. Deploying the
Edge Function, setting `PIXELFED_SOCIAL_SYNC_SECRET`, and setting Pixelfed host
sync env vars are provider/runtime mutations and require exact approval.

## Federation And Moderation Gate

Default launch posture is guild-only, closed registration, SSO-only, moderator-visible, and federation disabled until approval. Before enabling federation:

- Publish server rules, report/takedown process, moderator roles, escalation contacts, and defederation/blocklist policy.
- Add member-facing copy explaining that federated posts may be copied or cached by remote servers and deletion cannot guarantee remote removal.
- Verify local-only posting, image upload, reports, blocks, account suspension, backup restore, and queue health.
- Then run ActivityPub smoke tests for WebFinger/NodeInfo, local-to-remote follows, remote-to-local follows, outgoing posts, incoming replies, deletion behavior, and defederation.

## Approval Prompts

Use exact prompts before provider mutations:

- `Approve enabling Supabase OAuth 2.1 Server for project deyvmtncimmcinldjyqe and setting Authorization Path /oauth/consent.`
- `Approve registering the Pixelfed OAuth client for social.mochirii.com with redirect URI https://social.mochirii.com/auth/oidc/callback.`
- `Approve provisioning the Pixelfed staging host at [host/provider] with the reviewed cost, backup, and monitoring plan.`
- `Approve creating DNS for social.mochirii.com pointing to the approved Pixelfed host.`
- `Approve creating a private GitHub repository under Mochirii-Wushu named mochirii-pixelfed-ops for the Mochirii-controlled Pixelfed staging source and no-secret ops docs, then pushing the existing Droplet-local branding branch to it. No secrets, .env files, DB files, Redis data, media, backups, cache files, or host-private notes will be committed.`
- `Approve deploying Supabase Edge Function sync-pixelfed-social-account for project deyvmtncimmcinldjyqe and setting PIXELFED_SOCIAL_SYNC_SECRET from the local credential vault.`
- `Approve setting Pixelfed host env vars MOCHIRII_SOCIAL_SYNC_URL and MOCHIRII_SOCIAL_SYNC_SECRET on social.mochirii.com, clearing Laravel config cache, and restarting app services only if required.`
- `Approve configuring DigitalOcean Spaces as the primary Pixelfed media store for social.mochirii.com with exact-origin CORS and host-only credentials before broad member uploads.`
- `Approve enabling ActivityPub federation for social.mochirii.com after the moderation gate passes.`

## Rollback

Rollback the website by reverting the website PR. Rollback the database by leaving `social_accounts` inert unless a future migration explicitly removes it. Rollback Pixelfed by disabling DNS or SSO client access and suspending account sync; do not delete media or accounts until backup and retention decisions are approved.

## Verification

Local website changes must pass:

- `npm run toolchain:check`
- `npm run check`
- `npm run check:pixelfed-first-login-readiness`
- `git diff --check`
- `cd apps/web && npm run toolchain:check && npm run lint && npm run build`

Supabase-changing PRs must also pass:

- `npm run check:supabase-security-performance`
- `npm run check:supabase-edge-types`
- `npm run test:pixelfed-social-sync`
- Supabase Preview evidence after PR creation

Provider reads may be performed with credentials from
`C:\Github Repo's\Mochirii Website\Mochi Creds`; provider writes require the
approval prompts above.

See [`pixelfed-staging-ops.md`](pixelfed-staging-ops.md) for the no-secret
staging deploy, cache, health, rollback, backup, and source-control runbook.
