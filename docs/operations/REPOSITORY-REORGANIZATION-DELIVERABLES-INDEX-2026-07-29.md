# Repository Reorganization Deliverables Index

Date: 2026-07-29

Status: provider-free evidence index. This document records only evidence
tracked in this Website worktree. It does not assert current GitHub or provider
state, approve a migration, or satisfy a live release gate.

## Status vocabulary

- `PRESENT_PROPOSED`: a dedicated artifact exists, but acceptance and any live
  verification remain outstanding.
- `PARTIAL`: relevant evidence exists but does not cover the full required
  scope.
- `MISSING`: no dedicated artifact was found in this tracked worktree.
- `TEMPLATE_ONLY`: a no-secret recording surface exists, but no execution
  evidence has been collected.
- `PROVIDER_GATED`: completion requires a fresh authorized readback or a
  separately approved provider action.

Mutable facts use `UNVERIFIED_PROVIDER_READBACK` until they are read again from
the authoritative system. A linked historical report is evidence of its dated
snapshot only.

## Phase 0 evidence map

### Repository inventory

| Required evidence | Status | Tracked evidence | Gap or dependency |
| --- | --- | --- | --- |
| Repository ID, canonical URL, visibility, default branch, and size for every repository | `PRESENT_PROPOSED` | [authenticated GitHub readback](GITHUB-ORGANIZATION-READBACK-2026-07-29.md), [local source inventory](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md), [discovery](REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md), [organization ledger](ORGANIZATION-RECONCILIATION-2026-07-27.md) | The seven canonical repository rows and five local source lanes are captured. Mutable remote metadata must be refreshed before write actions. |
| Git LFS usage, object count, branches, tags, releases, and packages | `PARTIAL` | [local source inventory LFS and large-binary evidence](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md#git-lfs-and-large-binary-evidence), [discovery Social findings](REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md#social) | Committed LFS attributes, matching tracked paths, and blobs at least 5 MiB are normalized for the five local source lanes. Remote LFS objects, refs, releases, and packages require readback. |
| Issues, pull requests, wiki, discussions, and Pages | `PARTIAL` | [current GitHub work-item readback](GITHUB-ORGANIZATION-READBACK-2026-07-29.md#open-pull-requests), [organization ledger](ORGANIZATION-RECONCILIATION-2026-07-27.md#pull-requests-issues-and-remote-branches) | Current open PRs/issues are classified. Wiki, Discussions, and Pages remain unread, and all mutable counts require a fresh pre-write readback. |
| Webhooks, deploy keys, environments, Actions secret and variable names, branch protections, rulesets, required checks, CODEOWNERS, team permissions, apps, and deployment integrations | `PARTIAL` | [governance and CI matrix](REPOSITORY-GOVERNANCE-AND-CI-MATRIX-2026-07-29.md), [organization provider readback](ORGANIZATION-RECONCILIATION-2026-07-27.md#provider-connection-readback) | Required checks and some integration/plan limits are documented. The complete per-repository inventory is absent. Secret values must never be collected; names only require authorized readback. |
| Full top-level and deployable-subtree file inventory | `PARTIAL` | [local top-level and deployable ownership inventory](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md#top-level-and-deployable-source-ownership), [source ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md), [Social discovery](REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md#social) | Reproducible commands, exact top-level entries, and deployable-owner groups now cover the five available source lanes. A refreshed exact per-file cutoff is still required before any source move. |
| Languages, frameworks, lockfiles, runtime pins, generated/ignored files, large files, binaries, licenses, and upstream attribution | `PARTIAL` | [normalized local source/toolchain inventory](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md#toolchains-locks-and-generated-state-policy), [repository README](../../README.md), [Social upstream policy](../../services/social/docs/upstream-sync-policy.md), [Pets contract](../integrations/mochi-pets-website-contract.md) | The five available source lanes are normalized. Any future Social split, Forums runtime introduction, or source change requires a refreshed exact-state inventory. |
| CI, deployment, backup, restore, and rollback paths | `PARTIAL` | [normalized local path inventory](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md#ci-deployment-backup-restore-and-rollback-paths), [governance and CI matrix](REPOSITORY-GOVERNANCE-AND-CI-MATRIX-2026-07-29.md), [deployment runbook](deployment.md), [Social recovery](../../services/social/docs/online-backup-recovery.md) | Tracked path presence and explicit absence are normalized for the five local lanes. Provider binding, configuration, execution, restore, and rollback readiness require authorized readback and testing. |
| Internal repository names, clone/package/badge/raw/workflow/doc links, provider integrations, and deployment triggers | `PARTIAL` | [source separation proposal](SOURCE-SEPARATION-AND-DUPLICATE-REMOVAL-PROPOSAL-2026-07-29.md), [repository boundary checker](../../scripts/check-repository-boundaries.mjs) | No dated, complete reference-scan result is linked for every repository. |

Repository visibility approval, history movement, first pushes, and deployment
reconnections remain separate gates. A private target stays private unless an
exact approval says otherwise.

### Production baseline

| Required evidence | Status | Tracked evidence | Gap or dependency |
| --- | --- | --- | --- |
| Production commit or artifact digest for each service | `PARTIAL` | [discovery mutable state](REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md#mutable-release-state), [current state](CURRENT-STATE.md) | Dated Website/Social evidence exists; there is no normalized exact-artifact row for every service. Fresh readback is required. |
| Health, routes, auth, signed-out behavior, accessibility, performance, and browser behavior | `PARTIAL` | [current state](CURRENT-STATE.md), [production reports](../../reports) | Older surface-specific reports exist, but no reorganization baseline covers every affected runtime at one exact source state. |
| Vercel project and Git connection | `PARTIAL` | [organization provider readback](ORGANIZATION-RECONCILIATION-2026-07-27.md#provider-connection-readback), [deployment runbook](deployment.md) | Dated readback only; release use requires `UNVERIFIED_PROVIDER_READBACK` to be replaced with fresh evidence. |
| Supabase migrations, functions, Auth, redirects, RLS/Storage, advisors, backup, and PITR | `PARTIAL` | [discovery](REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md), [Supabase README](../../supabase/README.md), [Supabase reports](../../reports/supabase-production-security-review.md) | Function counts and older component evidence exist. No one exact-state packet covers every required control. |
| DigitalOcean Droplet, firewall, monitoring, backup, volume, and Spaces | `PARTIAL` | [Social runtime](../../services/social/docs/online-hosted-runtime.md), [Social media readiness](../../services/social/docs/media-spaces-readiness.md), [Social recovery](../../services/social/docs/online-backup-recovery.md) | No fresh normalized provider inventory is tracked here. Provider identifiers and private topology must remain outside public Git. |
| Pixelfed version/digest, workers, scheduler, database, Redis, media, mail, registration, and federation | `PARTIAL` | [Social runtime](../../services/social/docs/online-hosted-runtime.md), [Social README](../../services/social/README.md) | Source/runbook evidence exists; a single exact production-baseline record is absent. |
| Reaper topology, Discord commands/endpoint/intents, and worker health | `PARTIAL` | [separation ADR](REPOSITORY-SEPARATION-ADR-2026-07-29.md#reaper-partition), [Reaper health checklist](../reaper-runtime-health-checklist.md) | Source ownership is proposed; current provider/runtime truth is not established by this worktree. |
| Mobile profiles, bundle IDs, Apple records, privacy manifests, and release state | `MISSING` | No dedicated artifact in this worktree. | Owner: `Mochirii-Social-Mobile`. Requires its tracked source plus authorized Apple/Expo readback where applicable. |
| Unity version, packages, build profiles, LFS, artifact manifests, and release state | `PARTIAL` | [Pets Website contract](../integrations/mochi-pets-website-contract.md), [future project guidance](../mochi-pets-future-project.md) | The disconnected Website contract exists. Exact Pets repository/build evidence belongs in `Mochirii-Pets`. |

No secret value, cookie, signed URL, member payload, host credential, or raw
production export belongs in this index or its linked public evidence.

### Migration decision record

| Required evidence | Status | Tracked evidence | Gap or dependency |
| --- | --- | --- | --- |
| Compare Social subtree split, filtered history, and clean Forums initialization | `PRESENT_PROPOSED` | [repository separation ADR](REPOSITORY-SEPARATION-ADR-2026-07-29.md) | The selected methods and key rationale are recorded. Acceptance remains pending. |
| Preservation, downtime, redirect, rollback, permissions, security, deployment, release, and audit consequences | `PARTIAL` | [ADR](REPOSITORY-SEPARATION-ADR-2026-07-29.md), [threat model](REPOSITORY-REORGANIZATION-THREAT-MODEL-2026-07-29.md), [approval packets](REPOSITORY-MIGRATION-APPROVAL-PACKETS-2026-07-29.md) | Consequences are distributed across prose rather than one explicit alternatives matrix. |

## Phase 1 evidence map

### Target architecture and ownership

| Required matrix field | Status | Tracked evidence | Gap or dependency |
| --- | --- | --- | --- |
| Source directory and destination; old-source retirement | `PRESENT_PROPOSED` | [source ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md) | Requires acceptance and exact cutover inventories. |
| Hosted runtime owner and deployment workflow owner | `PRESENT_PROPOSED` | [operational ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md#operational-ownership-by-repository), [ADR](REPOSITORY-SEPARATION-ADR-2026-07-29.md) | Explicit current/target authority is proposed; acceptance and fresh provider readback remain outstanding. |
| Database/migration and secret-store owner | `PRESENT_PROPOSED` | [operational ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md#operational-ownership-by-repository) | Repository-level authority and destination classes are proposed. Deliverable 12 still requires exact variable names and destinations. |
| API/event contract owner | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md), [machine-readable registry](../integrations/cross-repository-contract-registry.v1.json) | All 12 IDs and repository owners are machine-readable; every contract remains explicitly unversioned and mostly lacks a concrete artifact. |
| Release/rollback and retention/backup owner | `PRESENT_PROPOSED` | [operational ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md#operational-ownership-by-repository), [ADR rollback](REPOSITORY-SEPARATION-ADR-2026-07-29.md#rollback) | Repository-level ownership is proposed; exact release and restore evidence remains outstanding. |
| Current and future consumers | `PRESENT_PROPOSED` | [operational ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md#operational-ownership-by-repository), [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md), [machine-readable registry](../integrations/cross-repository-contract-registry.v1.json) | Consumers are bound to required contract IDs and known repositories; concrete versions and paired consumer tests remain outstanding. |

### Required versioned contracts

The [strict v1 registry](../integrations/cross-repository-contract-registry.v1.json)
now records all 12 target contracts, local Website artifact/test references,
and explicit missing-evidence gaps. Its status is
`target_only_unversioned`; it does not satisfy any versioned-contract row below
or assert provider/deployment state.

| Boundary | Status | Tracked evidence | Missing contract evidence |
| --- | --- | --- | --- |
| Website and Supabase Auth | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md) | Contract ID/version, schema or typed interface, fixtures, producer/consumer tests, rollback duration. |
| Website and Social | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md), [Social delivery](../integrations/mochirii-social-delivery.md) | Machine-readable identity/API version and compatibility tests. |
| Website and Forums identity | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md), [ADR](REPOSITORY-SEPARATION-ADR-2026-07-29.md#identity-and-contracts) | Versioned signed-payload schema, replay fixtures, producer/consumer tests. |
| Mobile and Website Auth/shared backend | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md) | Concrete versioned artifact and tests in both owner repositories. |
| Mobile and Social | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md) | Versioned OAuth/API/media artifact and tests. |
| Reaper and Website-owned shared Supabase | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md), [source ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md#reaper-shared-helper-split) | Function registry, versioned producer schemas/fixtures, and paired compatibility tests. |
| Pets Web artifact and Website | `PARTIAL` | [Pets contract](../integrations/mochi-pets-website-contract.md), [v1 schema](../integrations/mochi-pets-website-contract.v1.schema.json) | This is the only concrete v1 schema found; playable artifact remains intentionally absent and release evidence is incomplete. |
| Pets iOS artifact and Mobile | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md) | Versioned Unity-as-a-Library manifest/schema and Mobile consumer tests. |
| Forums and approved Website identity | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md) | Same missing signed identity contract as the Website/Forums producer boundary. |
| Backward compatibility through rollback window and producer/consumer tests | `PARTIAL` | [contract release rule](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md#contract-release-rule) | The rule exists; contract-specific window lengths, retained versions, and test paths are not recorded. |

## Required deliverables

| # | Deliverable | Status | Tracked evidence | Canonical owner | Gate or dependency | Next artifact or action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Current-state inventory | `PARTIAL` | [local source inventory](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md), [discovery](REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md), [organization ledger](ORGANIZATION-RECONCILIATION-2026-07-27.md), [current state](CURRENT-STATE.md) | Website coordinates; each repository supplies its lane | Local source/toolchain evidence is dated and complete for the five available lanes; fresh remote/provider facts are `UNVERIFIED_PROVIDER_READBACK` | Refresh after source-state changes and complete separately authorized provider readbacks. |
| 2 | Source-to-target ownership matrix | `PRESENT_PROPOSED` | [source and operational ownership matrix](REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md) | Website architecture | Acceptance; exact cutoff inventories and fresh provider readback | Review and accept the proposed path/capability and repository-level responsibility mappings. |
| 3 | Migration-method decision record | `PRESENT_PROPOSED` | [separation ADR](REPOSITORY-SEPARATION-ADR-2026-07-29.md) | Website architecture | Architecture approval and exact source cutoff | Add an explicit alternatives/consequences table; then record acceptance. |
| 4 | Threat model | `PRESENT_PROPOSED` | [threat model](REPOSITORY-REORGANIZATION-THREAT-MODEL-2026-07-29.md) | Cross-repository security | Security review and repository-specific validation | Review and accept the expanded migration, identity, media, browser, event, retention, supply-chain, and abuse controls. |
| 5 | Public-brand policy and scoped exceptions | `PRESENT_PROPOSED` | [brand/copy/mood policy](PUBLIC-BRAND-COPY-AND-MOOD-POLICY-2026-07-29.md), [exception register](../../scripts/public-brand-exceptions.json) | Website content authority | Exact copy-owner approval for visible changes | Review and accept the policy; do not modify existing public copy in this migration. |
| 6 | Public-copy baseline and change-report mechanism | `PARTIAL` | [protected hash baseline](../../scripts/protected-content-baseline.json), [protected-copy checker](../../scripts/check-protected-content.mjs), [no-change audit](evidence/2026-07-12/copy/no-change-copy-audit.md) | Website content authority | Complete rendered-surface inventory; exact copy approval | Add a complete public-copy manifest and deterministic review-packet generator without changing copy. |
| 7 | Cross-repository contract map | `PARTIAL` | [contract map](CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md), [v1 registry](../integrations/cross-repository-contract-registry.v1.json), [strict schema](../integrations/cross-repository-contract-registry.v1.schema.json), [checker](../../scripts/check-cross-repository-contract-registry.mjs) | Website architecture with producer owners | Concrete versions, producer/consumer tests, fixtures, and rollback windows | Resolve the registry's explicit gaps contract by contract; never infer a deployed version from prose or a related local test. |
| 8 | One focused migration plan and PR per repository | `PARTIAL` | [migration approval packets](REPOSITORY-MIGRATION-APPROVAL-PACKETS-2026-07-29.md) | Each canonical repository | Exact-head review; first-push/live gates where applicable | Add six repository-scoped plans and later record exact branches/PRs without combining causal changes. |
| 9 | Updated root and nested `AGENTS.md` files | `PARTIAL` | [root guidance](../../AGENTS.md), [Web guidance](../../apps/web/AGENTS.md), [Social guidance](../../services/social/AGENTS.md), [Supabase guidance](../../supabase/AGENTS.md) | Each canonical repository | Update only when current/target state is unambiguous | Add transition-aware ownership, allowlisted deploy, contract, copy, and rollback invariants in each owner repository. |
| 10 | CODEOWNERS and ruleset proposal | `PARTIAL` | [governance and CI matrix](REPOSITORY-GOVERNANCE-AND-CI-MATRIX-2026-07-29.md#codeowners-proposal) | GitHub organization/repository owners | Team/settings approval; plan limitations | Record the approved team and exact path patterns; apply settings only under a separate provider approval. |
| 11 | CI and security-control matrix | `PARTIAL` | [governance and CI matrix](REPOSITORY-GOVERNANCE-AND-CI-MATRIX-2026-07-29.md) | Each repository | Repository-plan capabilities and exact workflows | Add per-control pass/fail/unsupported evidence and workflow links for every repository. |
| 12 | Secret inventory by variable name and destination only | `PARTIAL` | [source-declared name/destination inventory](SECRET-NAME-AND-DESTINATION-INVENTORY-2026-07-29.md), plus tracked Web/Social/Supabase examples | Each runtime owner; Website coordinates shared backend | Names only; never read or record values; provider presence remains unverified | Reconcile with authorized name-only provider readbacks and add Mobile-owned Apple/EAS destinations without values. |
| 13 | Authentication provider rollout plan | `PRESENT_PROPOSED` | [dated rollout decision](auth/AUTHENTICATION-PROVIDER-ROLLOUT-2026-07-29.md), [existing implementation guide](../multi-provider-login-and-verification.md) | Website/shared Supabase | Owner decision is deferred; any future lane needs current provider, copy, identity, Preview, and rollback approval | Keep all lanes disabled unless their exact packet advances; reconcile older implementation guidance before source work. |
| 14 | Facebook readiness packet | `PRESENT_PROPOSED` | [Facebook packet](auth/FACEBOOK-LOGIN-READINESS-PACKET-2026-07-29.md) | Website/shared Supabase | Current Meta/Supabase readback; exact privacy/public-copy/provider/release approval | Retain `PLANNED_NOT_AUTHORIZED` until every named gate passes. |
| 15 | Spotify pilot and production-eligibility packet | `PRESENT_PROPOSED` | [Spotify packet](auth/SPOTIFY-LOGIN-ELIGIBILITY-PACKET-2026-07-29.md) | Website/shared Supabase | Current Spotify audience/quota eligibility and separate provider/release approval | Retain `DEFERRED_PROVIDER_ELIGIBILITY` unless the intended guild audience is supported. |
| 16 | Instagram login decision record | `PRESENT_PROPOSED` | [Instagram decision](auth/INSTAGRAM-LOGIN-DECISION-2026-07-29.md) | Website/shared Supabase | Reconsider only from a current consumer-safe official flow under a separate packet | Keep publishing/profile-link lanes separate and retain `SKIPPED_FOR_GUILD_IDENTITY`. |
| 17 | Twilio phone-login cost and eligibility decision | `PRESENT_PROPOSED` | [Twilio decision](auth/TWILIO-PHONE-LOGIN-COST-DECISION-2026-07-29.md) | Website/shared Supabase | Current official pricing plus proof of a hard zero-cost, non-trial production ceiling | Retain `DEFERRED_COST_GATE`; do not configure, fund, expose, or send OTPs. A separate local unmerged candidate, `agent/phone-auth-fail-closed-20260729` at `c6f0702762b9135d7dacdcb055bcabfae98a9313`, changes the dormant login default only; it is not part of this ADR worktree and is not approved, merged, configured, or deployed. |
| 18 | Vercel migration and rollback packet | `PARTIAL` | [deployment runbook](deployment.md), [historical DNS rollback](history/dns-cutover-readiness-and-rollback.md) | Website | Fresh project/Git/deployment/env-name readback; release approval | Add a reorganization-specific packet binding exact tested artifact, route/auth checks, and independent data rollback. |
| 19 | Supabase migration/Auth/RLS/backup/rollback packet | `PARTIAL` | [Supabase README](../../supabase/README.md), [security review](../../reports/supabase-production-security-review.md), [advisor plan](../supabase-advisor-remediation-plan.md) | Website/shared Supabase | Fresh authorized readback; no live mutation without approval | Consolidate exact migrations/functions/Auth/RLS/Storage/advisors/backup/rollback evidence. |
| 20 | DigitalOcean, Docker, Spaces, Pixelfed, and Discourse runbooks | `PARTIAL` | [Social runtime](../../services/social/docs/online-hosted-runtime.md), [Social recovery](../../services/social/docs/online-backup-recovery.md), [Spaces readiness](../../services/social/docs/media-spaces-readiness.md) | Social; Forums for Discourse | Target source acceptance; future host/provider approvals | Move/adapt Social-owned runbooks after acceptance; create supported no-secret Forums runbooks. |
| 21 | Mobile App Store readiness report | `MISSING` | No dedicated artifact in this worktree. | Social Mobile | Mobile source plus Apple/Expo/TestFlight evidence | Create the report in `Mochirii-Social-Mobile` and link the accepted artifact here. |
| 22 | Reaper release packet | `PARTIAL` | [Reaper health checklist](../reaper-runtime-health-checklist.md), [migration packet](REPOSITORY-MIGRATION-APPROVAL-PACKETS-2026-07-29.md#packet-d-reaper-additive-source-partition) | Reaper | Additive source acceptance, six-function parity, protected/compensating deploy gate | Create the release packet in Reaper and link exact source/contracts/tests/rollback here. |
| 23 | Mochirii Pets artifact and release packet | `PARTIAL` | [Pets Website contract](../integrations/mochi-pets-website-contract.md), [v1 schema](../integrations/mochi-pets-website-contract.v1.schema.json) | Pets | Unity build/test/artifact evidence; Web/iOS consumer acceptance | Create the packet in Pets; no playable artifact is currently connected. |
| 24 | Pre-cutover and post-cutover validation reports | `TEMPLATE_ONLY` | [pre-cutover template](cutover/REPOSITORY-SEPARATION-PRE-CUTOVER-TEMPLATE.md), [post-cutover template](cutover/REPOSITORY-SEPARATION-POST-CUTOVER-TEMPLATE.md) | Coordinating release owner | Exact approved cutover and fresh evidence | Copy templates into dated evidence only when execution is authorized. |
| 25 | Source-separation and duplicate-removal proposal | `PRESENT_PROPOSED` | [source separation proposal](SOURCE-SEPARATION-AND-DUPLICATE-REMOVAL-PROPOSAL-2026-07-29.md) | Website coordinates; each owner accepts | Target acceptance, rollback window, exact deletion approval | Re-read targets immediately before any cleanup and record every removal. |
| 26 | Final completion report | `TEMPLATE_ONLY` | [final report template](cutover/REPOSITORY-REORGANIZATION-FINAL-COMPLETION-TEMPLATE.md) | Coordinating release owner | All deliverables, approvals, deployments, validation, restore, and rollback evidence | Populate only from verified commits, PRs, artifact digests, and provider readbacks. |

## Immediate provider-free work queue

Completed in this worktree: the machine-readable cross-repository contract
registry, strict schema, and dependency-free checker. All entries remain
explicitly unversioned until their recorded gaps are resolved.

1. Keep the completed [dated local source inventory](REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md)
   current after branch/worktree changes; remote-only facts remain unverified.
2. Reconcile the source-declared secret-name/destination inventory with
   authorized provider name-only readbacks.
3. Build the complete public-copy inventory and change-packet mechanism without
   modifying current public copy.
4. Reconcile older authentication implementation guidance with the dated
   provider decisions before any source change.
