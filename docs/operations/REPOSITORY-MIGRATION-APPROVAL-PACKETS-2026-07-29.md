# Repository Migration Approval Packets

Date: 2026-07-29

These packets separate reversible source preparation from live/provider
changes. No packet is approved merely because it is documented.

## Packet A: canonical-name check repair

Purpose: finish the already-open Website and Mochirii Pets naming pull requests
without mixing repository naming with an unrelated CI-policy change or
rewriting sealed launch evidence.

- Capture both exact heads and trees again immediately before approval. A
  locally reviewed head is evidence, not standing authorization.
- Website scope: preserve the sealed approved-copy packet and its historical
  provenance byte-for-byte, teach active validators to recognize that sealed
  evidence boundary, and record the already merged Social Mobile result.
- Pets scope: retain only the canonical-name and portable repository-contract
  corrections. The separate proposal to make the credential-gated Unity build
  manual is excluded and requires its own policy review.

The earlier SHA-specific approval does not cover a changed Website descendant
or any mixed Pets descendant. A fresh exact-head approval must authorize all
of the following together:

- push only those two descendants to Website PR #538 and Pets PR #4;
- run their exact-head checks and merge only if the base, head, review state,
  required checks, and previews remain exact and successful;
- for Website only, allow the normal Vercel production deployment, one
  automatic redeployment of the unchanged 33 declared Supabase functions with
  20/13 JWT parity, and the reviewed immutable Social GHCR image with SBOM and
  provenance;
- capture the current production deployment immediately before merge and
  restore that exact deployment if Website application acceptance fails;
- for Pets, allow repository CI only and no Unity, Apple, or provider
  deployment;
- after verified merges, delete only the two exact merged remote feature
  branches.

The approval must continue to prohibit manual Supabase/GHCR deployment,
DigitalOcean deployment, Shopify publication, secrets, and all unrelated
provider changes.

## Packet B: Social history candidate

Decisions required before execution:

1. Keep `Mochirii-Social` private.
2. Approve a pinned `git-filter-repo` 2.47.0 history candidate from the exact
   post-hardening Website `main` cutoff.
3. Approve the one reviewed first push to the empty target `main` only after
   bundle, scan, tree, commit-map, and manifest review.

This packet creates source history only. It does not create environments,
secrets, packages, deployments, DNS, host changes, or recurring cost. Because
private-repository rulesets are unavailable on the current plan, production
ownership remains blocked until enforcement is available or a separately
accepted compensating-control decision is recorded.

## Packet C: Forums governance seed

Decisions required before execution:

1. Keep `Mochirii-Forums` private.
2. Approve one reviewed governance-only seed of empty `main`.
3. Approve available read-only Actions and dependency-security settings.
4. Choose whether to create an organization maintainers team for CODEOWNERS;
   no suitable team currently exists.

The seed is source-only and deliberately contains no runnable forum, hostname,
public copy, provider connection, secret, host configuration, or paid resource.

## Packet D: Reaper additive source partition

Approve only a Reaper source pull request containing the exact six-function
allowlist, bot-only helpers, tests, runbooks, command manifest, locks, and CI.
Do not deploy, change Supabase, send Discord messages, change secrets, or remove
Website source. A later paired Website and production packet must prove the
27/6 partition and non-pruning behavior before cutover.

## Packet E: destructive cleanup

After every canonical target and rollback path is accepted, separately approve
exact deletion targets:

- merged remote feature branches;
- two orphaned Dependabot branches in the archived spinner repository;
- superseded clean Website worktrees and local branches whose patch parity is
  proven;
- empty stray workspace directories with no tracked or unique content.

Never include dirty user worktrees, credential directories, immutable evidence,
the archived repository, runtime data, or an unverified computed path.
