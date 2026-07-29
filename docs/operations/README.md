# Mochirii Operations

This directory contains durable, no-secret operational guidance for the
canonical Mochirii repository and hosted production surfaces.

## Canonical Workspace

```text
C:\Github Repo's\Mochirii Website\
  Website\      GitHub: Mochirii-Wushu/Mochirii-Website
  Mochirii-Social-Mobile\  GitHub: Mochirii-Wushu/Mochirii-Social-Mobile
  Mochirii-Pets\  GitHub: Mochirii-Wushu/Mochirii-Pets; fresh Unity source
  Mochi Creds\  Private credential and recovery boundary, never Git tracked
  AGENTS.md      Umbrella workspace guidance
```

Within `Website`, the public website, storefront theme, Social application, and
Supabase backend live under `apps/web`, `apps/shopify-theme`, `services/social`,
and `supabase`. The former Mochi Pets prototype and repository are deleted.
`Mochirii-Wushu/Mochirii-Pets` is the fresh Unity source owner, while Website
owns the server-only tester doorway and disconnected waiting room. No playable
Web or iOS artifact is connected.

## Directory Contract

- `CURRENT-STATE.md`: current hosted state and exact resume point.
- `deployment.md`: release, verification, and rollback boundaries.
- `integration-operations-runbook.md`: provider-adjacent operating rules.
- `ORGANIZATION-RECONCILIATION-2026-07-27.md`: public-safe repository,
  branch, issue, worktree, provider-effect, and cleanup disposition ledger.
- `REPOSITORY-REORGANIZATION-DISCOVERY-2026-07-29.md`: dated public-safe
  repository and source-ownership baseline.
- `REPOSITORY-LOCAL-SOURCE-INVENTORY-2026-07-29.md`: exact provider-free local
  Git states, source owners, toolchains, locks, LFS/large-file evidence,
  licenses/upstreams, and CI/deployment/recovery path presence for the five
  available source lanes; remote/provider facts remain unverified.
- `GITHUB-ORGANIZATION-READBACK-2026-07-29.md`: authenticated read-only
  repository metadata, exact default-branch heads, and classified open
  pull-request/issue evidence for the seven canonical repositories.
- `REPOSITORY-REORGANIZATION-DELIVERABLES-INDEX-2026-07-29.md`: Phase 0,
  Phase 1, and 26-deliverable tracked-evidence map with explicit gaps and gates.
- `REPOSITORY-SEPARATION-ADR-2026-07-29.md`: proposed Social, Reaper, and
  Forums migration decisions, contracts, sequencing, and rollback.
- `REPOSITORY-REORGANIZATION-THREAT-MODEL-2026-07-29.md`: source-migration,
  IAM, supply-chain, privacy, and cutover threats and controls.
- `REPOSITORY-SOURCE-OWNERSHIP-MATRIX-2026-07-29.md`: path and capability
  mapping from current owners to the target canonical repositories.
- `CROSS-REPOSITORY-CONTRACT-MAP-2026-07-29.md`: producer, consumer,
  compatibility, security, and rollback requirements. Its machine-readable
  companion and strict schema live under `docs/integrations` and are checked by
  `npm run check:cross-repository-contracts`.
- `REPOSITORY-GOVERNANCE-AND-CI-MATRIX-2026-07-29.md`: present enforcement,
  CODEOWNERS, workflow, security, and plan-limitation controls.
- `SOURCE-SEPARATION-AND-DUPLICATE-REMOVAL-PROPOSAL-2026-07-29.md`: gated
  retirement order for source, branches, worktrees, and empty local paths.
- `REPOSITORY-MIGRATION-APPROVAL-PACKETS-2026-07-29.md`: exact boundaries
  between source preparation, provider effects, and destructive cleanup.
- `PUBLIC-BRAND-COPY-AND-MOOD-POLICY-2026-07-29.md`: no-copy-change brand,
  provider/legal-exception, mood-language, and exact review-packet policy.
- `SECRET-NAME-AND-DESTINATION-INVENTORY-2026-07-29.md`: source-declared
  variable names, classifications, and intended provider destinations only;
  it never records values or claims current provider presence.
- `auth/`: provider-free Facebook, Spotify, Instagram, and Twilio decisions plus
  the authentication rollout sequence; none authorizes provider or UI changes.
- `cutover/`: no-secret pre-cutover, post-cutover, and final completion report
  templates; a template is not execution evidence.
- `private-spinner.md`: role-separated live-spinner operation, privacy,
  delivery, release, and recovery boundaries.
- `repository-ownership.md`: source and hosted ownership matrix.
- `history/REPOSITORY-RENAME-2026-07-28.md`: canonical Website repository
  rename record and legacy-evidence handling rule.
- `history/`: superseded plans and dated handoffs retained as evidence.
- `evidence/`: durable no-secret approval and readiness packets.

Generated screenshots, logs, JSON readbacks, provider exports, and rollback
captures do not belong here. Store them under ignored `.artifacts/operations`.

## Rules

- Start each repository phase with `git status --short --branch`.
- Keep credentials, cookies, tokens, private keys, signed URLs, customer data,
  supplier evidence, and recovery material in `Mochi Creds` or protected hosted
  secret stores only.
- Preserve protected-PR delivery and exact approval gates for provider
  mutations, deployments, theme publication, migrations, and secret changes.
- Keep ActivityPub federation disabled.
- Never require the workstation to serve traffic, process production jobs, hold
  the only production data copy, or keep hosted integrations online.
