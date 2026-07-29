# Repository Separation Architecture Decision

Date: 2026-07-29

Status: Proposed. No history, source, deployment, secret, provider connection,
or production responsibility has moved.

## Decision

Use three different migration methods because the source histories and runtime
boundaries are different:

1. Extract Social with pinned `git-filter-repo` from a fresh, exact protected-
   main clone using `--subdirectory-filter services/social`.
2. Move six bot-specific Edge Functions and their execution-only support code
   to Reaper through paired additive/removal pull requests and an allowlisted
   cutover. Keep all shared database ownership in Website.
3. Initialize Forums cleanly with governance and no-secret operational
   templates. Do not import Website history or vendor Discourse core.

Website history is never rewritten. Public routes, shared Auth and membership,
database history, and the Website Vercel/shared-Supabase connections remain
Website-owned. Social image build, recovery, and runtime deployment trust move
to Social only during the approved paired cutover; the Website equivalents are
then retired so two active deployment owners cannot persist.

## Social extraction

GitHub's supported subfolder-split guidance uses `git-filter-repo`. The audited
Social history has only twelve protected-main path-touch commits, so subtree
split offers no fidelity advantage and lacks the same analyze, dry-run, and
commit-map evidence.

The approved execution must:

1. Finish current Social work and freeze an exact protected Website `main`.
2. Create a verified source bundle in ignored private evidence.
3. Use a fresh, disposable, single-branch clone and a checksum-verified pin of
   `git-filter-repo` 2.47.0.
4. Run `--analyze` and a dry run before the real filter.
5. Filter only the approved branch with
   `--subdirectory-filter services/social`.
6. Never use `--force`, `--all`, `--sensitive-data-removal`, or subtree
   `--rejoin`; never run against the canonical checkout.
7. Prove the filtered root tree equals `<approved-sha>:services/social`, map
   every rewritten commit, run `git fsck --full`, and verify file/blob/LFS/tag
   inventories.
8. Run a pinned full-history secret and prohibited-path scan before any push.
   Findings are redacted; a confirmed credential is revoked and rotated before
   a separate rewrite decision.
9. Push the reviewed candidate to the still-empty private Social repository
   only after an exact visibility and first-push approval.

The target bootstrap then adapts Social-owned validation, image publication,
recovery, hosted verification, Dependabot, and delivery-contract files to the
new repository root. Website retains `/social`, OAuth consent and decision
routes, membership and `social_accounts` contracts, and the shared Supabase
source.

Production ownership moves only after target CI, immutable image/SBOM evidence,
secret-store and environment setup, and an approved rollback-safe runtime
cutover pass. Website deletes the old Social subtree only after that acceptance
and the rollback window.

## Reaper partition

Reaper owns Discord execution; Website owns shared data and producer contracts.
The migration allowlist is the six functions recorded in the discovery report.

The Reaper additive pull request must provide:

- the six functions, their bot-only helpers, tests, runbooks, and one canonical
  command manifest;
- current pinned Deno and Supabase dependencies with generated locks;
- parity for all nine handler commands, rather than the current partial
  registration model;
- raw-body Ed25519 verification, replay and idempotency controls, bounded
  retries, explicit `allowed_mentions`, least-privilege guild/role checks, and
  redacted logs;
- CI-only validation with no provider credentials or deployment.

A paired Website pull request splits mixed helpers, adds versioned producer and
consumer contracts, and removes only bot-owned files. Migrations, pgTAP tests,
RLS, schedules, shared types, Gallery ingest, guild authorization, Spotlight
read APIs, and spinner producer/session code remain.

The production cutover requires a merge freeze and either a plan-supported
Reaper protected environment or a separately approved procedural/external
compensating gate. The private repository cannot use required-reviewer
environment protection on the current plan, so production is blocked until one
of those controls is approved and proven. Deploy only the six exact function
names individually, never an unscoped function deployment and never `--prune`.
Prove those six versions advance once, then prove the Website integration
redeploys only its declared 27 while preserving all six Reaper functions. If
the integration cannot guarantee non-deletion, stop and obtain a supported
multi-repository deployment design before changing production.

## Forums initialization

The empty private Forums repository receives one reviewed governance seed,
then all further changes use pull requests. The seed contains only repository
guidance, security and contribution policy, an exact-SHA read-only validation
workflow, a repository contract, and this architecture relationship.

The operational foundation may later add no-secret templates, upstream lock
records, an identity contract, threat model, and install/upgrade/backup/restore/
monitoring/incident/rollback runbooks. It must not include:

- vendored Discourse or `discourse_docker` core;
- a runnable or secret-bearing production `app.yml`;
- runtime databases, uploads, backups, logs, volumes, keys, certificates,
  hostnames, IP addresses, or account identifiers;
- a loadable public theme or member-facing copy before exact copy approval;
- plugins without a separate maintenance, license, compatibility, and security
  review.

Future self-hosting follows Discourse's supported Docker path on a separately
approved host. Source initialization creates no new paid runtime or recurring
infrastructure; CI may consume existing GitHub Actions quota. DNS, mail,
identity, moderation, backups, restore testing, and general access remain
separate production gates.

## Identity and contracts

- Website and shared Supabase remain the inner session and current guild-
  entitlement authority.
- Social consumes the versioned Website identity and entitlement contract.
- Mobile consumes the versioned first-party Social OAuth/API contract. Social
  enforces the inner Website/Supabase membership boundary; Mobile never calls
  Supabase directly or receives provider secrets.
- Forums must use a proposed server-side central identity adapter that verifies
  the current Website session and guild entitlement before emitting a signed
  forum payload. Ordinary identity never grants moderation.
- Reaper consumes versioned Website data, schedule, Gallery, and spinner
  contracts; it does not own their schemas.
- Every producer and consumer test pins the contract version or source hash.

## Rollback

- Social: abandon the disposable candidate before cutover; after cutover,
  restore the previous immutable image and revert ownership pull requests.
- Reaper: keep the former Website bundles and source through the observation
  window; restore only the six allowlisted functions if acceptance fails.
- Forums: before production, revert source commits only. A future runtime must
  have an application-consistent backup and clean restore proof before access.
- Never rewrite Website history or delete immutable raffle, member, Gallery,
  provider, or release evidence as rollback.

## References

- [GitHub: split a subfolder into a new repository](https://docs.github.com/en/get-started/using-git/splitting-a-subfolder-out-into-a-new-repository)
- [git-filter-repo manual](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt)
- [Git bundle](https://git-scm.com/docs/git-bundle)
- [Discourse supported installation](https://github.com/discourse/discourse/blob/main/docs/INSTALL.md)
- [Discourse Docker](https://github.com/discourse/discourse_docker)
