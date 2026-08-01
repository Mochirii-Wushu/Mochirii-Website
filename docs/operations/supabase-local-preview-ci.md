# Supabase Local Preview CI

## Purpose

`supabase-local-preview` is the always-reporting, provider-isolated pull-request
database check. It replaces the schema and Edge source confidence previously
obtained by creating a hosted Supabase Preview branch, without creating a
Supabase project, consuming hosted project egress, or requiring a provider
token.

The workflow follows Supabase's documented local and CI model: the repository
pins the CLI as an npm development dependency, launches Postgres in Docker,
applies migrations from a clean reset, runs pgTAP, and tests Edge source with
the pinned Deno runtime. Standard GitHub-hosted runners are free for public
repositories; this workflow deliberately uploads no artifacts and creates no
Actions cache.

Primary references, reviewed 2026-07-31:

- [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase database testing](https://supabase.com/docs/guides/local-development/testing/overview)
- [Supabase CLI database lint](https://supabase.com/docs/reference/cli/supabase-projects-create#supabase-db-lint)
- [Supabase GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## Always-Reporting Contract

The workflow has one stable job name: `supabase-local-preview`. It runs for
every pull request and every push to `main`; event-level path filters are not
used.
Superseded runs for the same pull request are cancelled so only its newest
exact head consumes the database-validation runner.

For a diff with no Supabase-owned path, the job validates its own source and
function inventory, reports a deterministic success, and creates no local or
hosted database. Supabase-owned paths include:

- `supabase/**`;
- root Deno locks/import maps and npm manifests that pin the test toolchain;
- Supabase validation scripts and their shared helpers; and
- the local Preview workflow itself.

For an owned-path diff, the job uses exact repository pins:

- Node `22.23.1`;
- npm `10.9.8`;
- Supabase CLI `2.109.1`; and
- Deno `2.9.4`, including the reviewed Linux AMD64 checksum.

The heavy path performs all of the following in an isolated local-only
workdir:

1. Start local Postgres with a non-production project ID.
2. Reset from the complete migration history with seeding disabled.
3. Prove that every migration file appears exactly once in local applied
   history.
4. Run every `supabase/tests/*_test.sql` pgTAP file.
5. Run warning-strict local `plpgsql_check` database lint.
6. Run repository RLS, explicit-grant, index, service-only, and public-config
   guardrails.
7. Prove the exact configured Function/source inventory and current
   `20 verify_jwt=true / 13 false` contract.
8. Type-check and audit every Function with its function-local import map.
9. Run every discovered `supabase/functions/**/*_test.ts` file; discovery and
   the reviewed execution map must match exactly.

Telemetry is disabled. The workflow has only `contents: read`, disables
persisted checkout credentials, references third-party actions by full commit
SHA, uses no secrets, does not link a project, and cannot run `db push`, deploy
Functions, or call a hosted branch. Docker image and package downloads happen
from the GitHub runner; they are not traffic from project
`deyvmtncimmcinldjyqe`.

## Local Reproduction

Do not use ports `54321` through `54327`, which are a shared workstation
boundary. Prepare a unique temporary directory and port family, then use the
same pinned commands as CI:

```powershell
$previewRoot = Join-Path $env:TEMP 'mochirii-supabase-local-preview-manual'
node scripts/prepare-supabase-local-preview-workdir.mjs `
  --destination $previewRoot `
  --project-id mochirii-local-preview-manual `
  --port-base 59000
npm exec -- supabase db start --workdir $previewRoot
npm exec -- supabase db reset --local --no-seed --workdir $previewRoot
node scripts/verify-supabase-local-history.mjs --workdir $previewRoot
$env:SUPABASE_LOCAL_WORKDIR = $previewRoot
npm run test:supabase-db
npm exec -- supabase db lint --local --level warning --fail-on warning --workdir $previewRoot
npm run check:supabase-config
npm run check:supabase-security-performance
npm run check:supabase-edge-types
npm run test:supabase-edge-local-preview
npm exec -- supabase stop --no-backup --workdir $previewRoot
```

Use a new temporary path/project ID for each concurrent run. Remove only the
directory created for that run after `supabase stop` succeeds.

## Approval-Gated Provider Transition

The source workflow does not change GitHub or Supabase settings. After this
workflow has merged and produced a successful exact-main check, use this
rollback-safe sequence under a separate exact provider approval:

1. Capture the Website ruleset, its required checks, the Supabase GitHub
   integration settings, and all existing Preview branches without secrets.
2. In the Supabase GitHub integration, disable **Automatic branching** only.
   Preserve **Deploy to production**, production branch `main`, working
   directory `.`, and every other setting. This prevents new hosted PR
   branches while retaining the protected-main migration/Function release
   path documented by Supabase.
3. Confirm a fresh PR reports `supabase-local-preview` at its exact head.
4. In the GitHub ruleset, add required check `supabase-local-preview`, then
   remove required check `Supabase Preview`. Preserve reviews, current-head
   enforcement, all other required checks, and bypass rules.
5. Rebase PR #538 onto the new `main`, require every exact-head check, and use
   the deterministic no-op result when its final diff has no Supabase-owned
   path.
6. Inventory inactive Supabase branches and their linked PRs. Delete only
   proven-stale branches under a separate target-specific approval; never
   infer that an inactive branch is disposable.

Do not disable the production deployment option, disconnect GitHub, change the
project working directory, or manually deploy Supabase as part of this
transition.

### Rollback

If the local context fails to report reliably, do not bypass it. Restore in
this order under exact provider approval:

1. Re-enable Supabase Automatic branching with its captured settings.
2. Open or refresh a harmless review branch and prove an exact-head
   `Supabase Preview` succeeds.
3. Re-add `Supabase Preview` to the GitHub required-check set.
4. Only after provider Preview is required and green, remove the local context
   from the required set if desired.

Source rollback is a focused revert PR. Never revert or delete an already
applied production migration; database recovery is a forward-fix or separately
approved restore decision.

## Limits

This job does not prove hosted extension versions, Auth/Data API/Storage
dashboard configuration, hosted secrets, production data, real external
provider behavior, or the platform's deployment bundle. Production releases
still require protected-main source binding, the approved automatic production
integration, exact Function/JWT readback, migration readback, hosted
security/performance advisor review, and application acceptance.

Moving PR validation local prevents ephemeral Supabase Preview branch usage; it
does not reduce ordinary production database, Auth, Storage, or Edge Function
egress. Production egress overage therefore remains a separate read-only usage
diagnosis and optimization lane.
