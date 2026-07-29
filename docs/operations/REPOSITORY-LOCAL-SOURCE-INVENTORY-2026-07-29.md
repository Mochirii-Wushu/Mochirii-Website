# Repository Local Source Inventory

Date: 2026-07-29

Status: provider-free, read-only local evidence. This inventory describes the
exact checked-out source states named below. It does not establish current
GitHub, Vercel, Supabase, Shopify, DigitalOcean, Apple, EAS, Discord, or other
provider state and does not authorize a push, merge, deployment, migration,
cleanup, or provider change.

## Scope and evidence boundary

The evidence was collected only from these explicitly named Git worktrees:

- canonical Website checkout;
- canonical Social Mobile checkout;
- canonical Mochirii Pets checkout;
- the prepared, non-deploying Reaper ownership candidate; and
- the prepared Forums governance seed.

The private `Mochi Creds` boundary was not traversed. No credential, secret,
environment value, ignored artifact, provider export, or user-owned file
content was read. Dirty-state evidence below comes only from path-level
`git status --short --branch` output. Those changes remain preserved.

The following read-only commands supplied the evidence:

```text
git status --short --branch
git rev-parse HEAD
git branch --show-current
git remote get-url origin
git ls-tree --name-only HEAD
git ls-tree -r -l HEAD
git ls-files
git check-attr --stdin filter
git show HEAD:<tracked-path>
```

Configured `origin` URLs are local Git configuration, not proof of remote
existence, visibility, default branch, protection, contents, or connectivity.
Every mutable remote/provider field remains `UNVERIFIED_PROVIDER_READBACK`.

## Exact local snapshot

| Repository lane | Local path | Local configured origin | HEAD | Branch | Worktree classification |
| --- | --- | --- | --- | --- | --- |
| Website, canonical checkout | `C:\Github Repo's\Mochirii Website\Website` | `https://github.com/Mochirii-Wushu/Mochirii-Website.git` | `2eec9e467b4679fd77648ef61e77cf246ec9589b` | `mochi/vendor-mcp-setup` | `DIRTY_PRESERVED_USER_WORK`: untracked `.codex/` and `services/social/.codex/`; no tracked change reported |
| Social Mobile, canonical checkout | `C:\Github Repo's\Mochirii Website\Mochirii-Social-Mobile` | `https://github.com/Mochirii-Wushu/Mochirii-Social-Mobile.git` | `7e840fe337a425b659b065abf7e04e5256614cba` | `mochi/vendor-mcp-setup` | `DIRTY_PRESERVED_USER_WORK`: tracked `app.json`; untracked `.codex/` |
| Mochirii Pets, canonical checkout | `C:\Github Repo's\Mochirii Website\Mochirii-Pets` | `https://github.com/Mochirii-Wushu/Mochirii-Pets.git` | `09357c0432bf6aeb55742a27699110f0a0cb76ac` | `mochi/vendor-mcp-setup` | `DIRTY_PRESERVED_USER_WORK`: tracked `Packages/manifest.json` and `Packages/packages-lock.json`; untracked `.codex/` and `ProjectSettings/Packages/` |
| Reaper, prepared additive ownership candidate | `C:\Github Repo's\Mochirii Website\Reaper-Discord-Bot-function-ownership-20260729` | `https://github.com/Mochirii-Wushu/Reaper-Discord-Bot.git` | `288d4cab8cd1634526f835121a30e06023dd6f71` | `agent/edge-function-ownership-20260729` | `CLEAN_PREPARED_CANDIDATE`; not production authority and no deployment workflow |
| Forums, prepared governance seed | `C:\Github Repo's\Mochirii Website\Mochirii-Forums-governance-seed-20260729` | `https://github.com/Mochirii-Wushu/Mochirii-Forums.git` | `9a3291dd4f0adba903dcfe2ecc73b7bd99dd8760` | `agent/forums-governance-seed-20260729` | `CLEAN_PREPARED_SEED`; governance and validation only, with no runnable forum source |

The Reaper and Forums rows are prepared local states, not proof that either
exact commit exists in a remote default branch. The clean classifications mean
only that their named local worktrees had no status entries at capture time.

## Top-level and deployable source ownership

### Website

Tracked top-level entries are `.agents`, `.env.example`, `.gitattributes`,
`.github`, `.gitignore`, `.node-version`, `.nvmrc`, `AGENTS.md`,
`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `COPYRIGHT.md`, `NOTICE.md`,
`README.md`, `SECURITY.md`, `apps`, `deno-spotlight-poll.import_map.json`,
`deno.lock`, `docs`, `package-lock.json`, `package.json`, `reports`, `scripts`,
`services`, `supabase`, and `tests`.

| Source boundary | Local source role | Languages and frameworks | Deployment authority represented by source |
| --- | --- | --- | --- |
| `apps/web` | Website application and canonical public assets/data | TypeScript, React `19.2.8`, Next.js `16.2.11` | Vercel-targeted application source; the tracked README describes Git integration, but current provider binding is `UNVERIFIED_PROVIDER_READBACK` |
| `apps/shopify-theme` | Storefront theme | Liquid, JavaScript, CSS/SCSS; Shopify CLI `4.5.2` for validation/package work | Theme package source only; tracked guidance says a merge does not publish a theme |
| `services/social` | Current Social application and container source | PHP `^8.3|^8.4`, Laravel `^12.0`, Vue `2.6.14`, Laravel Mix `6.0.43`, Docker/Compose | Contains reviewed deploy and recovery workflows/scripts; live runtime state is `UNVERIFIED_PROVIDER_READBACK` |
| `supabase` | Shared SQL migrations, RLS/database source, Edge Functions, tests, and project source configuration | SQL, TypeScript, Deno | Current source owner; hosted migration/function state is `UNVERIFIED_PROVIDER_READBACK` |
| `scripts`, `tests`, `docs`, `reports` | Validation, test, operational, and dated evidence source | JavaScript/TypeScript, PowerShell, Markdown, JSON | Not an independent runtime owner |

The exact HEAD contains nine tracked GitHub workflow files: validation for the
repository, Web, theme, and Social; production smoke; manual Lighthouse;
Social image deployment and recovery; and Social online-host verification.
Workflow existence does not prove that a run, environment, secret, or provider
connection exists.

### Mochirii Social Mobile

Tracked top-level entries are `.env.example`, `.gitattributes`, `.github`,
`.gitignore`, `.node-version`, `.nvmrc`, `.prettierrc.json`, `AGENTS.md`,
`CONTRIBUTING.md`, `LICENSE`, `README.md`, `SECURITY.md`,
`THIRD_PARTY_LICENSES`, `THIRD_PARTY_NOTICES.md`, `app.json`, `assets`, `docs`,
`eas.json`, `eslint.config.js`, `jest.config.js`, `jest.setup.ts`,
`package-lock.json`, `package.json`, `scripts`, `src`, and `tsconfig.json`.

`src` is the application source owner. The exact HEAD is an iOS-first Expo SDK
`57.0.8` / React Native `0.86.0` / React `19.2.3` / TypeScript `6.0.x`
application using Expo Router. `app.json` and `eas.json` are tracked build
configuration surfaces. One validation workflow exists; there is no tracked
provider-deployment workflow, and current Apple, EAS, TestFlight, signing, and
store-record state is `UNVERIFIED_PROVIDER_READBACK`.

### Mochirii Pets

Tracked top-level entries are `.gitattributes`, `.github`, `.gitignore`,
`AGENTS.md`, `Assets`, `CONTRIBUTING.md`, `Packages`, `ProjectSettings`,
`README.md`, `SECURITY.md`, `docs`, `schemas`, and `scripts`.

`Assets`, `Packages`, and `ProjectSettings` form the Unity project source. The
exact HEAD pins Unity `6000.5.2f1` and Unity Test Framework `1.7.0`. Tracked
build methods and manifest-verification scripts prepare Web and iOS artifacts,
but build output is ignored and no Website/iOS deployment connection is
tracked. Two CI workflows exist: repository validation and exact-editor Unity
validation. Provider build, Apple, Website publication, and artifact-host state
is `UNVERIFIED_PROVIDER_READBACK`.

### Reaper prepared candidate

Tracked top-level entries are `.env.example`, `.github`, `.gitignore`,
`AGENTS.md`, `README.md`, `bun.lock`, `contracts`, `docs`, `package.json`,
`scripts`, `src`, `supabase`, `tests`, `tsconfig.build.json`, and
`tsconfig.json`.

`src` owns the private Discord Gateway/command helper source. `supabase`
contains a local, CI-only additive ownership candidate for exactly six
bot-specific Edge Functions; Website remains the production source owner until
a separately approved cutover. The source uses TypeScript, Bun, Node-compatible
output, Discord.js `14.27.x`, and Deno function tooling. One CI workflow exists
and no deployment workflow is tracked.

### Forums prepared seed

Tracked top-level entries are `.gitattributes`, `.github`, `.gitignore`,
`AGENTS.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `README.md`,
`SECURITY.md`, `docs`, and `scripts`.

This state contains Markdown/YAML governance plus a PowerShell repository
checker. It intentionally contains no Discourse/runtime source, container,
database, dependency lock, public experience, provider integration, or
deployment configuration. One repository-validation workflow exists.

## Toolchains, locks, and generated-state policy

| Repository lane | Runtime/tool pins found in exact HEAD | Lock/config files found in exact HEAD | Generated, local, or secret-bearing state excluded by tracked policy |
| --- | --- | --- | --- |
| Website | Node `22.23.1`; npm `10.9.8`; CI Deno `2.9.4`; Social CI PHP `8.4` and Composer `2.10.2` | root, Web, theme, and Social `package-lock.json`; `composer.lock`; root `deno.lock`; function-local Deno manifests and selected locks; Docker/Compose source | `node_modules`, `.vercel`, local Supabase branches/temp/env, local env files, and `.artifacts/operations` are ignored |
| Social Mobile | Node `22.23.1`; Expo SDK `57.0.8`; React Native `0.86.0` | `package-lock.json`, `app.json`, `eas.json` | dependencies, Expo/EAS/build/test output, generated `ios`/`android`, signing material, local env, and `.artifacts` are ignored |
| Mochirii Pets | Unity `6000.5.2f1`; README requires Git LFS `3.7.1+` when matching media exists | `Packages/manifest.json`, `Packages/packages-lock.json`, `ProjectSettings/ProjectVersion.txt` | Unity caches, IDE state, builds, logs, Xcode/output, credentials, local env, and `.artifacts` are ignored |
| Reaper candidate | CI Bun `1.3.14`; CI Deno `2.9.4`; package engine Node `>=22` | `bun.lock`; six function-local `deno.json` and `deno.lock` pairs | dependencies, compiled output, coverage, logs, and local env are ignored |
| Forums seed | CI runner `ubuntu-24.04`; repository checker uses PowerShell | No dependency or runtime lock is tracked | caches, evidence output, credentials/env, dependencies, vendor/runtime/database state, and logs are ignored |

## Git LFS and large-binary evidence

The size check used the committed tree only and classified a large blob as at
least 5 MiB (`5,242,880` bytes). It did not read working-tree binary content.

| Repository lane | LFS policy and current tracked LFS evidence | Committed blobs at least 5 MiB |
| --- | --- | --- |
| Website | Root attributes mark common media/font types binary but define no LFS filter; `git check-attr` found no tracked LFS path | `apps/web/server-assets/spinner-fonts/NotoSerifSC-Variable.ttf` (`25,125,512` bytes); `apps/web/server-assets/spinner-fonts/NotoColorEmoji-Regular.ttf` (`24,271,604`); `services/social/storage/app/cities.json` (`12,977,757`); `apps/web/public/assets/audio/mochiriiiiii.mp3` (`5,455,239`) |
| Social Mobile | Binary attributes exist for PNG, WebP, ICO, and TTF; no LFS filter and no tracked LFS path were found | None |
| Mochirii Pets | `.gitattributes` requires Git LFS for future source-art, audio, and video patterns; no matching LFS path exists at this HEAD | None |
| Reaper candidate | No tracked `.gitattributes` and no tracked LFS path were found | None |
| Forums seed | Text-only attributes; no LFS filter and no tracked LFS path were found | None |

GitHub-side LFS objects, quotas, orphaned objects, and billing are
`UNVERIFIED_PROVIDER_READBACK` even when no LFS pointer exists in the local
HEAD.

## License and upstream status

| Repository lane | Local license/notice evidence | Local upstream evidence |
| --- | --- | --- |
| Website | Root `COPYRIGHT.md` and `NOTICE.md` state that the repository is proprietary and intentionally has no open-source root license; dependency notices are retained. `services/social/LICENSE` is AGPL-3.0. | `services/social/docs/upstream-sync-policy.md` names the official Social upstream, requires isolated fetch-only review, disables upstream push, and requires reviewed selective import. |
| Social Mobile | Root `LICENSE` is proprietary/all-rights-reserved; `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_LICENSES` preserve dependency/template notices. | No application-source upstream import policy was found; the Expo template notice is retained as third-party attribution. |
| Mochirii Pets | No root license file was found at this HEAD. | Guidance forbids restoring or importing source/history from the retired prototype; no external upstream source is declared. |
| Reaper candidate | No root license file was found at this HEAD; the package is marked private. | No external source-upstream policy was found. Dependency licenses remain dependency-owned. |
| Forums seed | No root license file was found at this HEAD. | Governance requires a future reviewed packet to record origin, license, history method, update policy, and rollback before upstream/runtime source is added. |

Absence of a root license file is recorded as evidence, not interpreted as
permission to reuse source.

## CI, deployment, backup, restore, and rollback paths

| Repository lane | CI paths present at exact HEAD | Deployment paths present at exact HEAD | Backup, restore, and rollback paths present at exact HEAD |
| --- | --- | --- | --- |
| Website | Nine workflows under `.github/workflows`; root and nested validation scripts | Vercel-targeted Web source; Social image deployment workflow; theme package scripts; Supabase source integration contract. Actual provider bindings/runs are unverified. | Social recovery workflow, backup/restore scripts, systemd backup units, `services/social/docs/online-backup-recovery.md`, Website `docs/operations/deployment.md`, and dated rollback guidance |
| Social Mobile | `.github/workflows/validate.yml`; local audit and validation scripts | `eas.json` build profiles are present, but no tracked deploy/submission workflow | Provider packet and test-plan docs exist; no dedicated application backup/restore or production rollback implementation was found in HEAD |
| Mochirii Pets | `.github/workflows/validate.yml` and `validate-unity.yml`; repository, artifact-manifest, and local-independence scripts | Local Web/iOS build methods only; no tracked deploy workflow or connected artifact destination | Deterministic manifest verification supports artifact rejection; no provider backup/restore or deployed-release rollback path was found in HEAD |
| Reaper candidate | `.github/workflows/ci.yml`; Bun/Deno tests and contract checks | No deployment workflow; README explicitly keeps the six-function candidate non-deploying | No dedicated backup, restore, or runtime rollback implementation was found; activation/rollback remains a separate packet |
| Forums seed | `.github/workflows/validate-repository.yml`; PowerShell repository contract | No runnable source or deployment path | No runtime data exists to back up or restore; future rollback requirements are gated by the ownership ADR |

`PRESENT` means only that the named path exists in the committed local tree. It
does not mean the path is configured, permitted, recently exercised, or bound
to a live provider.

## Remote and provider fields requiring readback

The following are intentionally not inferred from local source:

| Mutable field class | Status |
| --- | --- |
| Repository visibility, numeric ID, default branch, size, archived state, remote HEAD, remote branches/tags, releases, packages, LFS object inventory, issues, pull requests, wiki, Discussions, and Pages | `UNVERIFIED_PROVIDER_READBACK` |
| Rulesets, branch protection, required checks, CODEOWNERS enforcement, teams, permissions, webhooks, deploy keys, apps, environments, Actions secret/variable names, and runner availability | `UNVERIFIED_PROVIDER_READBACK` |
| Vercel project/Git binding, deployments, environment names, domains, routes, metrics, and rollback aliases | `UNVERIFIED_PROVIDER_READBACK` |
| Supabase project binding, migrations, functions, JWT settings, Auth, RLS, Storage, advisors, backups, PITR, secrets, and integration behavior | `UNVERIFIED_PROVIDER_READBACK` |
| Shopify theme/store publication, DigitalOcean/Spaces runtime and recovery, Discord application/runtime state, Apple/EAS/App Store records, and future Forums hosting | `UNVERIFIED_PROVIDER_READBACK` |

Any later provider inventory must be separately authorized, name-only where
secrets are involved, stored in the approved evidence boundary, and tied to a
capture time and exact source state. This local inventory must be refreshed
after branch changes, rebases, merges, or worktree-state changes rather than
being treated as current indefinitely.
