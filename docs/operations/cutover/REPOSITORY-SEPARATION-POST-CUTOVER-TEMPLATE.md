# Repository Separation Post-Cutover Validation

Date: `YYYY-MM-DD`

Status: `NOT_EXECUTED`

This is a no-secret template. It does not prove a deployment occurred. Record
only evidence from an exact approved cutover; keep private raw evidence under
the ignored evidence boundary.

## Cutover identity

| Field | Value |
| --- | --- |
| Approved packet | `TBD` |
| Execution start/end and timezone | `TBD` |
| Coordinator | `TBD` |
| Exact approved scope | `TBD` |
| Unplanned action | `NONE` or exact description |
| Rollback deadline | `TBD` |

## Source and deployed identity

| Surface | Repository SHA | Artifact/image digest | Deployment/version ID | Provider source binding | Result |
| --- | --- | --- | --- | --- | --- |
| Website | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |
| Social | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |
| Shared Supabase | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |
| Reaper | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |
| Forums | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |
| Mobile | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |
| Pets | `TBD` | `TBD` | `TBD` | `UNVERIFIED_PROVIDER_READBACK` | `BLOCKED` |

## Provider mutations actually performed

| Provider/boundary | Approved action | Actual action | Actor/audit reference | Before/after no-secret evidence | Result |
| --- | --- | --- | --- | --- | --- |
| `TBD` | `NONE` | `NONE` | `TBD` | `TBD` | `PASS` |

Do not record secret values, cookies, signed URLs, member data, private payloads,
host addresses, or raw provider exports.

## Acceptance matrix

| Lane | Checks | Evidence | Result |
| --- | --- | --- | --- |
| Source ownership | Canonical paths, no unclassified active duplicate, correct links/workflows | `TBD` | `BLOCKED` |
| Website | Routes, redirects, headers, cookies, CSP/CORS/cache, assets, metadata, accessibility, responsive behavior | `TBD` | `BLOCKED` |
| Public copy | Protected hashes, rendered-text equivalence, brand exceptions, mood report, approval references | `TBD` | `BLOCKED` |
| Auth/authorization | Existing identities, callbacks, closed registration, Discord guild entitlement, signed-out/failure behavior | `TBD` | `BLOCKED` |
| Supabase | Migrations,  functions/JWT modes, RLS/grants/Storage, advisors, logs, backup/rollback | `TBD` | `BLOCKED` |
| Social | Image digest, app/workers/scheduler/database/Redis/mail/media, registration closed, federation disabled | `TBD` | `BLOCKED` |
| Reaper | Six-name ownership, command manifest, signatures, replay/idempotency, authorization, rate limits, mentions, logs | `TBD` | `BLOCKED` |
| Mobile | OAuth/deep link, Keychain deletion, privacy/support/moderation/account deletion, build state | `TBD` | `BLOCKED` |
| Pets | Artifact manifest/checksum/provenance, Web MIME/encoding, iOS consumer, independence/no tokens | `TBD` | `BLOCKED` |
| Forums | TLS/DNS, identity, permissions, mail, moderation, uploads, backup/restore, upgrade, monitoring, rollback | `TBD` | `BLOCKED` |
| Observability | Health, queues, alerts, logs, redaction, browser console/network review | `TBD` | `BLOCKED` |

## Contract compatibility and data continuity

| Contract/version | Producer | Old consumer | New consumer | Rollback version retained | Result |
| --- | --- | --- | --- | --- | --- |
| `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |

- [ ] Supabase user IDs, linked identities, profiles, Discord entitlements,
      Gallery ownership, forum ownership, and audit relationships are intact.
- [ ] Object counts/checksums/metadata/application reads match the approved
      media plan where storage moved.
- [ ] Queues, schedules, caches, and duplicate deliveries are reconciled.
- [ ] Old code/state and application-consistent backups remain available
      through the rollback window.

## Exceptions, incidents, and rollback

| Time | Finding | Impact | Decision | Approval | Rollback action/result |
| --- | --- | --- | --- | --- | --- |
| `TBD` | `NONE` | `NONE` | `CONTINUE` | `TBD` | `NOT_REQUIRED` |

If rollback occurred, record each state boundary independently. Do not claim a
complete rollback from only a Vercel rollback, repository revert, or host
snapshot.

## Observation window

| Check time | Exact deployed identity unchanged | Health/data/auth/observability result | New risk | Owner |
| --- | --- | --- | --- | --- |
| `TBD` | `UNVERIFIED` | `BLOCKED` | `TBD` | `TBD` |

## Outcome

- Implemented: `NO`
- Merged: `NO`
- Configured: `NO`
- Deployed: `NO`
- Smoke-tested: `NO`
- Fully verified: `NO`
- Rollback state: `UNPROVEN`
- Remaining blockers/risks: `TBD`
- Next approved action: `NONE`

