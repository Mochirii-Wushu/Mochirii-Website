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
- `private-spinner.md`: role-separated live-spinner operation, privacy,
  delivery, release, and recovery boundaries.
- `repository-ownership.md`: source and hosted ownership matrix.
- `REPOSITORY-SEPARATION-ADR-2026-07-29.md`: proposed, non-activating repository
  boundary decision for review.
- `REPOSITORY-REORGANIZATION-THREAT-MODEL-2026-07-29.md`: threat model for
  staged repository separation without adding a second shared-backend owner.
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
