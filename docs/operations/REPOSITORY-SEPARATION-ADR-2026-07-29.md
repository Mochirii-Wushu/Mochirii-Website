# Repository Separation Architecture Decision

Date: 2026-07-29

Status: Proposed governance direction only. This ADR does not authorize a
history rewrite, source move, deployment, secret transfer, provider change,
production cutover, or deletion.

## Decision

Keep one production authority for each active runtime.

1. Website remains the sole source, configuration, schema, schedule, secret-
   destination, and deployment owner for the shared Supabase project and every
   Edge Function declared in `supabase/config.toml`.
2. Reaper remains a consumer of versioned Website contracts. It may own its
   Discord Gateway worker, command registration, and repository-local bot
   behavior, but it does not own, copy, publish, or deploy Website Edge
   Functions or their shared helpers.
3. Social may be evaluated for a future source-history extraction into the
   private `Mochirii-Wushu/Mochirii-Social` repository because it has a
   separate application runtime and data lifecycle. Source preparation and
   production ownership transfer are different, separately approved phases.
4. Forums initialization is outside this ADR. An empty target repository is
   not production infrastructure.

Current repository instructions remain authoritative. No target repository
becomes a production owner merely because a proposal, compatibility fixture, or
source candidate exists.

## Shared Supabase boundary

Website continues to own:

- `supabase/config.toml` and the complete declared function inventory;
- every Edge Function implementation and shared helper;
- migrations, RLS, grants, database tests, schedules, tables, RPCs, generated
  types, Vault references, and provider integration settings;
- exact-head Preview and protected-main production verification;
- function inventory, version, status, and JWT-parity readbacks.

The protected-main integration is treated as one deployment writer. Reaper must
not receive a second deployment path to the same shared project, and Website
must not remove a subset of functions in anticipation of another repository
taking them over.

The six currently bot-facing functions remain Website-owned:

- `reaper-discord-interactions`;
- `reaper-discord-member-sync`;
- `reaper-spinner-dispatch`;
- `send-vote-reminder`;
- `send-member-spotlight-poll`;
- `publish-member-spotlight-winner`.

They depend on Website-owned membership, Gallery, schedule, vote, Spotlight,
spinner, RPC, and service-role boundaries. Their `verify_jwt=false` settings
are preserved only with their existing application-layer signature, scoped
capability, or constant-time secret checks. Moving files to another repository
would not create an independent security or deployment boundary.

## Reaper contract-consumer model

Reaper may consume reviewed, versioned contracts for:

- Discord command names and payload constraints;
- guild event schedule projections;
- Gallery submission requests;
- pending-member containment requests;
- spinner outbox and publication behavior;
- Spotlight and vote workflow projections.

Website remains the producer and production implementation owner. Contract
fixtures may be generated or copied into ignored CI evidence for compatibility
testing, but production function or helper source must not be duplicated as a
second canonical tree. A Reaper pull request must not contain a deployable
Supabase manifest, project identifier, deployment workflow, shared-project
credential, or claim of function ownership.

Any future proposal to move bot execution out of Website requires a new ADR and
must first prove one supported single-writer design. Examples that require
separate evaluation are a single release orchestrator consuming immutable
artifacts or a fully isolated runtime with narrow Website APIs. Neither design
is selected or authorized here.

## Future Social source extraction

A source-only Social extraction may proceed only under a separate exact
approval after the current Social work is accepted on a named Website
protected-main commit.

The preparation sequence is:

1. Freeze the exact Website cutoff and create a verified private source bundle.
2. Use a fresh disposable single-branch clone and a checksum-verified pinned
   `git-filter-repo`.
3. Analyze and dry-run before filtering only
   `services/social` with `--subdirectory-filter`.
4. Never rewrite Website history or run filtering in the canonical checkout.
5. Prove filtered-root tree parity with
   `<approved-sha>:services/social`, preserve a commit map, run
   `git fsck --full`, and inventory files, blobs, tags, LFS objects, licenses,
   and attribution.
6. Run pinned full-history secret and prohibited-path scans before any push.
   Redact findings and rotate confirmed credentials before deciding whether a
   separate remediation rewrite is required.
7. Bootstrap target-root CI, Dependabot, immutable image/SBOM/provenance,
   recovery, and hosted-verification support without provider credentials.
8. Push only after a separate approval names the private target, exact source
   cutoff, exact candidate commit/tree, and first-push boundary.

A source-only candidate remains non-deploying. It does not receive environments,
secrets, package publication, DigitalOcean access, Spaces access, DNS,
Cloudflare, or recovery authority.

A later production cutover requires its own approval and must prove target CI,
immutable image parity, protected or explicitly compensated release controls,
backup and isolated restore evidence, health checks, rollback, and exact
provider source binding. Website Social workflows remain authoritative until
that cutover succeeds. After a bounded observation window, a separate reviewed
Website pull request may remove `services/social` and Social-only workflows.
Never leave both repositories able to publish or deploy the same runtime.

Website permanently retains the public `/social` doorway, OAuth consent and
decision routes, guild membership and entitlement authority,
`social_accounts`, and shared Supabase source. Social consumes those contracts;
it does not own the Website session or shared database.

## Contract registry status

The cross-repository registry is governance scaffolding. Until each contract
has a concrete versioned artifact, producer and consumer compatibility tests,
cross-repository fixtures, and an explicit rollback window, it remains
`target_only_unversioned`.

A green registry check proves only that missing evidence remains explicit and
machine-readable. It does not authorize source removal, deployment, provider
configuration, or contract activation.

## Security and rollback invariants

- Keep secrets in their existing provider stores; never copy values between
  repositories or into evidence.
- Preserve one deployment writer per runtime and least-privilege GitHub Actions
  permissions.
- Preserve immutable Website, Social, raffle, Gallery, member, and provider
  evidence.
- Do not rewrite Website history.
- Before any future Social cutover, retain the prior immutable image and verified
  application-consistent recovery point.
- Before acceptance, abandon a disposable source candidate without changing
  production. After an approved cutover, restore only through the separately
  approved runtime rollback packet.
- Any ambiguous ownership, missing compatibility evidence, failed restore,
  provider drift, or unexpected deployment effect stops the affected phase.

## References

- [GitHub: split a subfolder into a new repository](https://docs.github.com/en/get-started/using-git/splitting-a-subfolder-out-into-a-new-repository)
- [git-filter-repo manual](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt)
- [Git bundle](https://git-scm.com/docs/git-bundle)
