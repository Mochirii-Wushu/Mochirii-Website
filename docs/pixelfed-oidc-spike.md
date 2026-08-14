# Pixelfed OIDC Spike Packet

> **Historical and superseded - do not execute.** This document is retained
> only as integration history. Current Social operations are owned exclusively
> by `Mochirii-Wushu/Mochirii-Social`.

Status: staging OIDC packet. Provider mutations remain approval-gated.

This packet defines the smallest credible staging proof before Mochirii commits
to production Pixelfed infrastructure. It does not contain Pixelfed code, OAuth
secrets, database URLs, host credentials, cookies, access tokens, or private
member identifiers.

## Goal

Prove whether a current Pixelfed staging runtime can complete OIDC login against
Supabase OAuth 2.1 while preserving the website as the member consent doorway and
Supabase as the identity and guild membership authority.

The spike must answer one question before production work starts: can Pixelfed
complete authorization code login with Supabase OAuth 2.1, including PKCE,
`state`, `sub`, `email`, and deterministic username claims?

## Current Source Findings

- Supabase Auth can act as an OAuth 2.1 and OIDC identity provider. The flow is
  authorization code with mandatory PKCE, and `openid` enables ID tokens,
  UserInfo, and OIDC discovery.
- Supabase OAuth setup requires enabling OAuth Server, setting the Authorization
  Path, building the consent UI, and registering client applications.
- Supabase redirects OAuth requests to the configured consent UI with an
  `authorization_id`; the website must call Supabase OAuth approve or deny
  methods only after the signed-in user is confirmed as an active guild member.
- Supabase recommends asymmetric JWT signing keys for OAuth clients. ID token
  generation fails with HS256 when clients request `openid`.
- Supabase confidential OAuth clients default to `client_secret_basic`, but also
  support `client_secret_post`. Current unpatched Pixelfed OIDC uses The PHP
  League `GenericProvider`, so the staging client must use
  `client_secret_post` unless a Pixelfed patch or custom provider is approved.
- Pixelfed installation currently expects a separate PHP/Laravel runtime and
  supporting services. It is not a Vercel serverless workload.
- Pixelfed `dev` OIDC config exposes `PF_OIDC_ENABLED`,
  `PF_OIDC_CLIENT_ID`, `PF_OIDC_CLIENT_SECRET`, `PF_OIDC_SCOPES`,
  `PF_OIDC_AUTHORIZE_URL`, `PF_OIDC_TOKEN_URL`, `PF_OIDC_PROFILE_URL`,
  `PF_OIDC_USERNAME_FIELD`, and `PF_OIDC_FIELD_ID`.
- Pixelfed `dev` builds OIDC through `League\OAuth2\Client\Provider\GenericProvider`
  with redirect URI `auth/oidc/callback`, validates `state`, exchanges an
  authorization code, reads UserInfo, and creates or links the local Pixelfed
  user.
- The currently inspected Pixelfed OIDC path does not show explicit PKCE
  configuration in the application code. Treat PKCE compatibility as unproven
  until a staging browser/network test proves that Pixelfed sends an acceptable
  `code_challenge` and can exchange the authorization code.

## Non-Secret Endpoint Map

Supabase project ref: `deyvmtncimmcinldjyqe`

Supabase OAuth and OIDC endpoints:

- Authorization endpoint:
  `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/oauth/authorize`
- Token endpoint:
  `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/oauth/token`
- UserInfo endpoint:
  `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/oauth/userinfo`
- JWKS endpoint:
  `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/.well-known/jwks.json`
- OIDC discovery:
  `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/.well-known/openid-configuration`

The authorization UI path must be `/oauth/consent` on the website Site URL.

## Current Provider State

As of the latest read-only Management API check on 2026-07-02:

- Supabase OAuth Server is enabled for project `deyvmtncimmcinldjyqe`.
- Authorization Path is `/oauth/consent`.
- Site URL is `https://mochirii.com`.
- Dynamic OAuth client registration is disabled.
- OIDC discovery advertises Authorization, Token, UserInfo, JWKS, `openid`,
  `profile`, `email`, and PKCE `S256` support.

The remaining provider/runtime gates before first login testing are an approved
Pixelfed OAuth client with the exact staging callback URI and compatible token
endpoint auth method, a reachable staging Pixelfed runtime, and private
confirmation of closed registration, disabled federation, media limits,
queue/scheduler health, backups, monitoring, moderation flow, and durable
Mochirii-owned runtime source control.

## Approval Gates

Use these exact approvals separately. Do not combine them.

- `Approve enabling Supabase OAuth 2.1 Server for project deyvmtncimmcinldjyqe and setting Authorization Path /oauth/consent.`
- `Approve registering the Pixelfed OAuth client for the approved staging Pixelfed URL with its exact OIDC callback URI.`
- `Approve updating or re-registering the Pixelfed OAuth client for social.mochirii.com with redirect URI https://social.mochirii.com/auth/oidc/callback and token endpoint auth method client_secret_post.`
- `Approve provisioning the Pixelfed staging host at [host/provider] with the reviewed cost, backup, and monitoring plan.`
- `Approve creating DNS for social.mochirii.com pointing to the approved Pixelfed host.`
- `Approve creating a private GitHub repository under Mochirii-Wushu named mochirii-pixelfed-ops for the Mochirii-controlled Pixelfed staging source and no-secret ops docs, then pushing the existing Droplet-local branding branch to it. No secrets, .env files, DB files, Redis data, media, backups, cache files, or host-private notes will be committed.`

If the callback URI changes, stop and request a new approval naming the exact
redirect URI.

## Local Credential Boundary

Credentials remain local only under
`C:\Github Repo's\Mochirii Website\Mochi Creds`.

Recommended local filenames once the provider steps are approved:

- `pixelfed-staging-oauth-client-id.txt`
- `pixelfed-staging-oauth-client-secret.txt`
- `pixelfed-staging-admin-url.txt`
- `pixelfed-staging-host-notes.txt`

Never paste these values into commits, PR comments, docs, screenshots, terminal
summaries, or reports.

## Staging Pixelfed OIDC Environment Shape

These are configuration names only. Values must stay in the approved host secret
store, not this repo.

- `PF_OIDC_ENABLED=true`
- `PF_OIDC_CLIENT_ID=[from approved Supabase OAuth client]`
- `PF_OIDC_CLIENT_SECRET=[from approved Supabase OAuth client]`
- `PF_OIDC_SCOPES=openid profile email`
- `PF_OIDC_AUTHORIZE_URL=https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/oauth/authorize`
- `PF_OIDC_TOKEN_URL`: Supabase Token endpoint
  `https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/oauth/token`
- `PF_OIDC_PROFILE_URL=https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/oauth/userinfo`
- `PF_OIDC_USERNAME_FIELD=preferred_username`
- `PF_OIDC_FIELD_ID=sub`

The staging Pixelfed callback URI must match the registered Supabase OAuth
client redirect URI exactly and must end in `/auth/oidc/callback`. The Supabase
client token endpoint auth method must match the staged Pixelfed token exchange;
use `client_secret_post` for unpatched Pixelfed.

## Spike Procedure

1. Confirm `main` includes the merged `/social`, `/oauth/consent`,
   `/api/oauth/decision`, and `social_accounts` changes.
2. Confirm `npm run check:pixelfed-oidc-spike` and
   `npm run check:pixelfed-first-login-readiness` pass locally.
3. After explicit approval, enable Supabase OAuth Server and set Authorization
   Path to `/oauth/consent`.
4. Confirm OIDC discovery, Authorization, Token, UserInfo, and JWKS endpoints are
   reachable without printing secrets.
5. After explicit approval, register the staging Pixelfed OAuth client with the
   exact callback URI and a compatible token endpoint auth method.
6. Configure staging Pixelfed OIDC environment variables in the host secret store.
7. Confirm the staged Pixelfed branding/source patch is durable in the approved
   private fork or ops repo.
8. Run the login flow in a browser and inspect only no-secret network facts:
   `state`, requested scopes, redirect URI, and whether a PKCE `code_challenge`
   using `S256` is present.
9. Sign in as an active guild member and approve from `/oauth/consent`.
10. Confirm Pixelfed receives UserInfo fields for `sub`, `email`, and
   `preferred_username`.
11. Confirm Pixelfed creates or links the user and does not accept non-member or
    suspended-member approvals.

## Pass Criteria

- Supabase OAuth discovery is reachable and advertises the expected OIDC
  endpoints.
- Supabase redirects to `/oauth/consent?authorization_id=...`.
- Consent UI shows the client, redirect URI, requested scopes, and active member
  status before approval.
- The token endpoint accepts the configured client authentication method and
  rejects dummy authorization codes with `invalid_grant`, not credential errors.
- Pixelfed sends and validates `state`.
- Pixelfed satisfies Supabase PKCE requirements, preferably with S256.
- UserInfo contains stable `sub`, verified `email`, and deterministic
  `preferred_username`.
- Duplicate email, duplicate username, denied consent, non-member, suspended
  member, and stale callback paths fail safely.
- No token, client secret, cookie, database URL, or private user identifier is
  written to repo files, PR text, screenshots, or reports.

## Decision Outcomes

- Pass: proceed to the approved staging host hardening and first-login smoke.
- PKCE fail: prepare a decision packet for a minimal Pixelfed patch/fork,
  identity broker, or native Pixelfed accounts mapped back to Supabase.
- Claim fail: prepare a Supabase claim bridge or Pixelfed username-field
  decision packet. Do not weaken authorization or derive usernames from Discord
  display names.
- Runtime fail: stop production work and produce a host/runtime compatibility
  decision packet.
