# Repository Reorganization Threat Model

Date: 2026-07-29

Status: Proposed controls for source migration. This document contains no
secret values, private topology, member data, or provider export.

## Protected assets

- source history, authorship, review evidence, releases, and rollback refs;
- member identity, guild authorization, profiles, media ownership, raffle and
  moderation evidence;
- provider credentials, signing material, environments, and deployment trust;
- public URLs, approved copy, Mochirii branding, and accessibility behavior;
- database, object storage, queues, schedules, backups, and immutable images;
- the ability to restore each runtime without this workstation.

## Trust boundaries

1. GitHub organization, repositories, Actions, packages, and reviewers.
2. Vercel Website build and runtime.
3. Supabase Auth, Postgres, Storage, and Edge Functions.
4. Social build/recovery workflows and the hosted runtime.
5. Reaper's Discord execution and shared Website data contracts.
6. Future Forums source and separately approved runtime.
7. Developer workstation and private recovery storage.

The workstation is an administrative client, never a production dependency or
the only copy of source, data, credentials, or recovery evidence.

## Threats and controls

| Threat | Impact | Required control |
| --- | --- | --- |
| Filtering the wrong ref or local dirty state | Missing or contaminated history | Fresh single-branch clone, exact cutoff SHA, clean status, source bundle, dry run, commit map, tree parity, and `git fsck`. |
| Secret or private-data history copied to a target | Credential compromise or privacy breach | Pinned full-history scan before push, prohibited-path allowlist, redacted results, rotation before any remediation, and private ignored evidence. |
| Two active canonical copies | Drift and unreviewed deployment | Additive target first, explicit ownership registry, paired removal PR, bounded rollback window, then delete only the accepted duplicate. |
| Cross-repository contract drift | Auth, Gallery, spinner, or bot failure | Versioned contracts, producer/consumer tests, compatibility window, source hashes, and fail-closed consumers. |
| Supply-chain substitution | Malicious Action, image, tool, plugin, or package | Full-SHA Action pins, locked dependencies, verified tool checksums, immutable image digests, SBOMs, provenance where plan-supported, dependency review, and secret scanning. |
| CI credential escalation | Unauthorized provider mutation | Read-only default token, least-privilege job permissions, protected environments, exact repository/ref conditions, no pull-request secrets, and human approval. |
| Private-repository rules assumed but unavailable | Unreviewed merge or deletion | Record plan limitation, use exact-head procedural gates, disable force pushes/deletions where available, and do not claim unsupported enforcement. |
| Second shared-Supabase source or deployment owner | Function overwrite, deletion, release skew, or excessive deployment trust | Keep Website as the sole source and deployment owner for the complete declared function inventory. Reaper consumes versioned contracts only; reject deployable copied function/helper source and any second shared-project deployment credential. |
| Shared schema moved with a consumer | Split migration authority | Keep all migrations, RLS, schedules, shared RPCs, and generated types in Website; consumers use versioned contracts. |
| OAuth or membership bypass | Unauthorized guild access | Server-side session and entitlement verification, exact audience/redirect checks, PKCE where applicable, replay protection, and no provider login granting guild status. |
| Automatic same-email identity linking, account collision, or pre-account takeover | An attacker links to or captures another member's account | Keep new providers and manual linking disabled by default. Before any provider is enabled, explicitly choose and document a Supabase-supported linking strategy; require verified provider evidence, collision and pre-account-takeover tests, member notification, recovery, revocation, and session invalidation. If manual link or unlink is later enabled, require a recent authenticated session and explicit confirmation. |
| BOLA/IDOR across member, media, raffle, or moderation records | One member reads or changes another member's data | Deny-by-default RLS, owner/moderator predicates at the data layer, server-side resource authorization on every object lookup, opaque denials, and cross-user negative tests. |
| SSRF through remote media, profile links, callbacks, or webhooks | Internal service probing or credential exposure | No server-side profile scraping, strict scheme/origin allowlists, DNS/IP and redirect revalidation for approved fetchers, bounded time/bytes, and blocked private/link-local/metadata ranges. |
| Malicious or oversized uploads, decompression bombs, or retained image metadata | Resource exhaustion, stored malware, or privacy leakage | Exact MIME and decoded-format validation, pixel/byte/dimension limits, bounded streaming, metadata stripping, generated filenames, quarantine/moderation, and independent thumbnail generation. |
| Stored/reflected XSS, CSRF, permissive CORS, or shared-cache confusion | Session abuse or cross-member data disclosure | Context-safe output, CSP, origin-bound server sessions, anti-CSRF checks for cookie-authenticated writes, exact CORS allowlists, private/no-store responses, and cache variation by authorization state. |
| Forged, replayed, or reordered provider events | Unauthorized Discord, Social, Gallery, or reward action | Verify signatures over exact raw bytes before parsing, enforce timestamp/replay windows and idempotency keys, bind events to expected guild/channel/audience, and log only redacted receipts. |
| Deletion or retention policy loses evidence or leaves private data in backups | Regulatory, support, or incident-response failure | Classify mutable account data separately from immutable draw/audit evidence, define retention and deletion propagation, version backups, test restore and post-restore access controls, and never rewrite immutable raffle evidence. |
| Spam, harassment, impersonation, or moderation bypass | Member harm and platform abuse | Verified-member boundary, rate and quota controls, report/block/mute paths, least-privilege moderator roles, auditable actions, appeal/escalation runbooks, and opening gates for any new community surface. |
| Public-copy or branding drift | Misleading or inconsistent member experience | Exact visible-copy approval, route/metadata/alt-text scans, preserved legal attribution, and no provider names in Mochirii-authored customer copy. |
| Runtime cutover fails after source move | Outage or lost rollback | Separate source and runtime approvals, immutable old image, application-consistent backups, health/readback matrix, and preauthorized bounded rollback. |
| Logs or evidence leak sensitive data | Account or member exposure | Structured redaction, no raw payloads/tokens/signed URLs, private evidence boundary, retention limits, and access review. |
| New forum creates unapproved cost or exposure | Billing, spam, privacy, or moderation incident | Source-only initialization; separate cost, host, firewall, DNS, mail, identity, moderation, backup, restore, and opening approvals. |
| Local test stack belongs to another worktree | Invalid validation evidence or data loss | Unique local project IDs and ports, explicit migration inventory, owner coordination, and no reset of a shared stack. |

## Zero Trust and IAM rules

- Authenticate and authorize every request at the server boundary; network
  location, repository membership, or login-provider identity is insufficient.
- Grant the minimum role, scope, repository, environment, function, guild,
  channel, and object access required for one operation.
- Require MFA for provider and source-control administrators.
- Prefer short-lived workload identity where supported. Long-lived secrets stay
  in protected provider stores, never source, artifacts, browser bundles, or
  shell output.
- Review access before migration and after cutover; remove old access only after
  rollback expires.

## Security validation

Each migration pull request requires SAST, dependency and secret scanning,
locked clean installs, syntax/type/test/build checks, path and provider-effect
allowlists, and exact-head review. Runtime cutovers additionally require DAST or
boundary probes for authentication, authorization, headers, errors, replay,
rate limiting, logs, and rollback without sending real external messages unless
that canary is separately approved.

Any secret finding, unexpected source owner, failed backup/restore check,
provider drift, unapproved public copy, ambiguous rollback, or missing exact
approval stops only the affected cutover while independent source work
continues.
