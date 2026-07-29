# Cross-Repository Contract Map

Date: 2026-07-29

Status: `PARTIAL_MACHINE_READABLE`. This is a target contract map. It does not
activate a provider, move source, or assert that any contract version is
deployed.

The [machine-readable v1 registry](../integrations/cross-repository-contract-registry.v1.json)
and its [strict schema](../integrations/cross-repository-contract-registry.v1.schema.json)
enumerate all 12 boundaries below. Every entry is deliberately `unversioned`
with `version: null`; missing artifacts, producer/consumer tests, fixtures, and
rollback windows are explicit gaps rather than inferred readiness. Run
`npm run check:cross-repository-contracts` to validate that inventory.

| Registry ID | Contract | Producer/authority | Consumers | Required compatibility evidence | Registry state |
| --- | --- | --- | --- | --- | --- |
| `website-session-guild-entitlement` | Website session and guild entitlement | Website and shared Supabase | Website, Social, Mobile, future Forums, Pets doorway | Verified server-side claims, exact audience/origin, revocation and expired-membership denial, signed-out failure, and no provider login granting guild status. | `unversioned` |
| `social-oauth-handoff-account-mapping` | Social OAuth handoff and account mapping | Website and shared Supabase | Social and Mobile | Authorization Code with PKCE where applicable, exact redirect, state/nonce/replay checks, opaque failures, and `social_accounts` RLS isolation. | `unversioned` |
| `social-api-media-behavior` | Social API/media behavior | Social | Website and Mobile | Versioned endpoint contract, private-media authorization, bounded upload/download, no direct provider/storage credential, and backward-compatible rollback window. | `unversioned` |
| `gallery-ingest-moderation` | Gallery ingest and moderation | Website and shared Supabase | Website, Reaper submission handler | Immutable source/publication revisions, member/moderator RLS, idempotent submission, approved-media-only public delivery, quota, and redacted failures. | `unversioned` |
| `discord-command-manifest` | Discord command manifest | Reaper | Reaper HTTP handler, registration workflow, operator docs | Every supported handler command appears exactly once; guild-scoped registration, permissions, options, and test fixtures match. | `unversioned` |
| `member-synchronization` | Member synchronization | Reaper execution; Website data authority | Shared Supabase membership records and Website access | Signed Discord event, guild/role checks, idempotency, stale-event handling, least privilege, and no external message during smoke. | `unversioned` |
| `guild-event-schedule` | Guild event schedule | Website | Website Events UI and Reaper event synchronization | One canonical event ID/time-zone/recurrence record, duplicate prevention, preview before apply, and localized display tests. | `unversioned` |
| `spinner-draw-publication` | Spinner draw and publication | Website and shared Supabase | Website viewer/raffle surface and Reaper dispatcher | Immutable official/test classification, deterministic result ID, timestamp, privacy projection, outbox idempotency, and no test result changing live publication. | `unversioned` |
| `spotlight-vote-workflows` | Spotlight and vote workflows | Website data authority; Reaper execution | Website result surfaces and Discord delivery | Shared schema/RPC tests, explicit schedule/confirmation, idempotent dispatch, privacy projection, and read-side compatibility. | `unversioned` |
| `mochi-pets-launch-ticket` | Mochi Pets launch ticket | Website | Pets Web artifact and Mobile iOS host | Short-lived audience-scoped ticket, current member entitlement, no shared password/provider token, exact artifact identity, and fail-closed absence. | `unversioned` |
| `unity-artifact-manifest` | Unity artifact manifest | Pets | Website and Mobile | Commit, Unity version, dependency manifest, platform, checksum, build report, provenance, and no workstation/local endpoint dependency. | `unversioned` |
| `forum-central-identity` | Forum central identity | Website | Future Forums | Signed nonce-bound payload, stable opaque external ID, verified email, current guild entitlement, replay and return-URL validation, revocation, and no automatic moderator/admin grant. | `unversioned` |

## Contract release rule

The producer lands backward-compatible support first. Every consumer validates
against the exact contract version or hash in CI and Preview. Production moves
only after old and new consumers pass together. The old contract remains
available through the defined rollback window; incompatible removal is a
separate reviewed release.

The registry cannot mark an entry `versioned` until it names a concrete schema,
interface, or manifest; producer and consumer compatibility tests; a shared
fixture; and a positive rollback window. Documentation and same-repository tests
are recorded as partial evidence only.
