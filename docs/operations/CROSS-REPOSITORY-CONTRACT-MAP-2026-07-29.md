# Cross-Repository Contract Map

Date: 2026-07-29

Status: target contract map. It does not activate a provider or move source.

| Contract | Producer/authority | Consumers | Required compatibility evidence |
| --- | --- | --- | --- |
| Website session and guild entitlement | Website and shared Supabase | Website, Social, Mobile, future Forums, Pets doorway | Verified server-side claims, exact audience/origin, revocation and expired-membership denial, signed-out failure, and no provider login granting guild status. |
| Social OAuth handoff and account mapping | Website and shared Supabase | Social and Mobile | Authorization Code with PKCE where applicable, exact redirect, state/nonce/replay checks, opaque failures, and `social_accounts` RLS isolation. |
| Social API/media behavior | Social | Website and Mobile | Versioned endpoint contract, private-media authorization, bounded upload/download, no direct provider/storage credential, and backward-compatible rollback window. |
| Gallery ingest and moderation | Website and shared Supabase | Website, Reaper submission handler | Immutable source/publication revisions, member/moderator RLS, idempotent submission, approved-media-only public delivery, quota, and redacted failures. |
| Discord command manifest | Reaper | Reaper HTTP handler, registration workflow, operator docs | Every supported handler command appears exactly once; guild-scoped registration, permissions, options, and test fixtures match. |
| Member synchronization | Reaper execution; Website data authority | Shared Supabase membership records and Website access | Signed Discord event, guild/role checks, idempotency, stale-event handling, least privilege, and no external message during smoke. |
| Guild event schedule | Website | Website Events UI and Reaper event synchronization | One canonical event ID/time-zone/recurrence record, duplicate prevention, preview before apply, and localized display tests. |
| Spinner draw and publication | Website and shared Supabase | Website viewer/raffle surface and Reaper dispatcher | Immutable official/test classification, deterministic result ID, timestamp, privacy projection, outbox idempotency, and no test result changing live publication. |
| Spotlight and vote workflows | Website data authority; Reaper execution | Website result surfaces and Discord delivery | Shared schema/RPC tests, explicit schedule/confirmation, idempotent dispatch, privacy projection, and read-side compatibility. |
| Mochi Pets launch ticket | Website | Pets Web artifact and Mobile iOS host | Short-lived audience-scoped ticket, current member entitlement, no shared password/provider token, exact artifact identity, and fail-closed absence. |
| Unity artifact manifest | Pets | Website and Mobile | Commit, Unity version, dependency manifest, platform, checksum, build report, provenance, and no workstation/local endpoint dependency. |
| Forum central identity | Website | Future Forums | Signed nonce-bound payload, stable opaque external ID, verified email, current guild entitlement, replay and return-URL validation, revocation, and no automatic moderator/admin grant. |

## Contract release rule

The producer lands backward-compatible support first. Every consumer validates
against the exact contract version or hash in CI and Preview. Production moves
only after old and new consumers pass together. The old contract remains
available through the defined rollback window; incompatible removal is a
separate reviewed release.
