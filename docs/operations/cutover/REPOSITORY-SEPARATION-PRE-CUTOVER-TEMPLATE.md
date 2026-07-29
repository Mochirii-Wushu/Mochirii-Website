# Repository Separation Pre-Cutover Validation

Date: `YYYY-MM-DD`

Status: `DRAFT_NOT_APPROVED`

This is a no-secret template. Copy it to a dated evidence path only for an
authorized cutover. Do not record tokens, secret values, cookies, signed URLs,
member data, private payloads, host addresses, or raw provider exports.

## Packet identity

| Field | Value |
| --- | --- |
| Scope | `TBD` |
| Coordinating owner | `TBD` |
| Planned window and timezone | `TBD` |
| Change freeze starts | `TBD` |
| Rollback window ends | `TBD` |
| Exact approval reference | `NOT_APPROVED` |
| Public-copy approval reference | `NOT_APPLICABLE` or `NOT_APPROVED` |
| Provider mutations authorized | `NONE` or exact allowlist |
| Destructive actions authorized | `NONE` or exact allowlist |

## Repository and change freeze

| Repository | Visibility | Default/base SHA | Candidate SHA | Worktree state | PR and current checks | Freeze owner | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Website | `UNVERIFIED_PROVIDER_READBACK` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |
| Social | `UNVERIFIED_PROVIDER_READBACK` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |
| Forums | `UNVERIFIED_PROVIDER_READBACK` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |
| Social Mobile | `UNVERIFIED_PROVIDER_READBACK` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |
| Reaper | `UNVERIFIED_PROVIDER_READBACK` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |
| Pets | `UNVERIFIED_PROVIDER_READBACK` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `BLOCKED` |

Record `git status --short --branch`, remotes, refs, tags, LFS, source tree
identity, and unresolved user work. Stop on dirty/overlapping work or head drift.

## Source, history, and supply-chain gates

- [ ] Verified source bundle or mirror exists at the exact approved cutoff.
- [ ] `git fsck --full`, tree parity, commit map, refs/tags/releases/LFS, and
      large-file inventories pass as applicable.
- [ ] Full reachable-history secret and prohibited-path scans pass; findings
      are redacted and any confirmed exposure is handled separately.
- [ ] Dependencies, runtimes, CLIs, Actions, images, and lockfiles are pinned.
- [ ] SAST, dependency, secret, container, SBOM, and provenance checks pass as
      applicable at the exact candidate SHA.
- [ ] CODEOWNERS, rules, plan limitations, and compensating controls are
      accurately represented; unsupported enforcement is not claimed.

## Contract compatibility

| Contract ID/version or source hash | Producer SHA | Old consumer result | New consumer result | Rollback version retained through | Evidence |
| --- | --- | --- | --- | --- | --- |
| `TBD` | `TBD` | `BLOCKED` | `BLOCKED` | `TBD` | `TBD` |

- [ ] Producer lands backward-compatible support first.
- [ ] Old and new consumers pass together.
- [ ] Removal or incompatible change is outside this packet unless explicitly
      approved.

## Runtime and provider readback

| Boundary | Required no-secret evidence | Current result | Evidence reference |
| --- | --- | --- | --- |
| Vercel | Project/Git/root/build/runtime/env-name/domain/preview/rollback identity | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |
| Supabase | Migration list; function names/versions/JWT modes; Auth/redirects; RLS/Storage; advisors; backup/PITR | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |
| DigitalOcean/Social | Immutable image; services; firewall/monitoring/backup/volume/media/mail/registration/federation | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |
| Discord/Reaper | Command manifest; endpoint; intents; worker health; no-message smoke boundary | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |
| Mobile/Apple/Expo | Profiles; identifiers; privacy; build/release state | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |
| Pets/Unity | Editor/packages/profiles/LFS/build/artifact state | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |
| Forums | Source/runtime/DNS/TLS/mail/identity/moderation/backup/restore/monitoring state | `UNVERIFIED_PROVIDER_READBACK` | `TBD` |

Secret evidence is names and destinations only. Verify values in their approved
stores without copying them into this packet.

## Validation baseline

- [ ] Repository-specific install, lint, typecheck, tests, and builds pass.
- [ ] Database reset/migration/RLS/grant/function tests pass in an isolated
      environment whose migration inventory is exact.
- [ ] Route, redirect, auth, signed-out, accessibility, responsive, browser,
      CSP/header/cookie/CORS/cache, console, and network checks pass.
- [ ] Protected-copy hashes, complete public-text diff, public-brand scan, and
      mood-language report show no unapproved change.
- [ ] Reaper signature/replay/idempotency/authorization/rate-limit/mention/log
      tests pass without sending external messages.
- [ ] Social image/runtime/media/backup/restore evidence and Forums restore
      prerequisites pass as applicable.
- [ ] Mobile and Pets artifact manifests bind source, toolchain, dependencies,
      checksums, build reports, SBOM/provenance, and consumers.

## Independent rollback matrix

| State boundary | Exact rollback target | Restore procedure | Validation | Owner | Ready |
| --- | --- | --- | --- | --- | --- |
| Repository/source | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| Website artifact | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| Database/schema | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| Object/media storage | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| Queues/schedules/cache | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| Social/Forum runtime | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| Provider configuration | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |
| DNS/routing | `TBD` | `TBD` | `TBD` | `TBD` | `NO` |

A code rollback does not reverse database or object changes. A host snapshot is
not an application-consistent database/media restore.

## Stop conditions and decision

List every unresolved ownership, permission, credential, provider-policy,
backup/restore, secret, public-copy, test, cost, rollback, or exact-head blocker:

1. `TBD`

Final decision: `BLOCKED` / `APPROVED_FOR_EXACT_SCOPE` / `CANCELLED`

Approved exact next action: `NONE`
