# Local Development Toolchain

This repo uses project-local tooling where possible so Codex, local terminals,
and CI run the same checks before website changes reach Vercel.

## Required Local Tools

- Node.js `22.23.1` via `fnm`; `.node-version` and `.nvmrc` pin the repo.
- npm `10.x`, bundled with the pinned Node.js runtime.
- Git and GitHub CLI for branch, PR, and repository hygiene.
- Deno `2.9.4` for Supabase Edge Function tests, matching GitHub Actions.
- Supabase CLI as a root dev dependency; run through `npm` or
  `node_modules/.bin/supabase` to avoid the root `supabase.js` name collision.
- Playwright Chromium for local browser smoke tests.
- Lighthouse as a root dev dependency for repeatable performance audits.
- Vercel CLI as an `apps/web` dev dependency for local Vercel build parity.
- ImageMagick and `jq` for image and JSON utility work.

## Setup

```powershell
fnm use 22.23.1
deno upgrade 2.9.4
npm ci
npm run setup:playwright
cd apps\web
npm ci
```

Keep this Windows checkout and its dependencies on the Windows filesystem. The
local preflight does not invoke Docker or WSL. Container-backed Supabase tests
run on the repository's isolated GitHub-hosted Linux jobs. The non-Windows
toolchain contract retains both the Docker CLI and daemon checks. This preserves
those tests without overlapping the workstation's Windows development
environment.

## Verification

From the repository root:

```powershell
npm run toolchain:check
npm run check
git diff --check
```

For the Next/Vercel app:

```powershell
cd apps\web
npm run toolchain:check
npm run lint
npm run build
npm run vercel:build:local
```

For a production-like Next.js browser smoke:

```powershell
npm run smoke:gallery:serve
# In another terminal:
npm run smoke:gallery
```

This starts the canonical Next.js app; the retired root static server is no
longer part of local development.

## Source Basis

- Node.js version parity follows the repo and CI contract in `AGENTS.md`.
- Vercel CLI local build usage follows the Vercel CLI docs and
  `apps/web/README.md`.
- Supabase CLI usage follows Supabase local-development guidance; the CLI is
  installed locally, not globally. Supabase's container-backed database tests
  run in isolated GitHub-hosted CI under the Windows workstation policy.
- Windows filesystem placement follows Microsoft's guidance for tools that run
  from the Windows command line; repository work does not cross into a WSL
  filesystem.
- Playwright browser installation follows the official Playwright browser
  install workflow.
- Lighthouse audits use the local package instead of `npx --yes` so the audit
  version is locked.
- Social image validation installs the official Docker Buildx `v0.35.0` Linux
  AMD64 release only after its exact SHA-256 and Sigstore bundle identity pass,
  then starts digest-pinned BuildKit `v0.31.2`. The official Syft `v1.49.0`
  binary is accepted only after the release checksum file's Anchore Sigstore
  identity and both pinned SHA-256 values pass. Cosign itself is installed by a
  full-SHA-pinned Sigstore action at exact version `v3.0.6`.
- The full-SHA-pinned Deno setup action installs `2.9.4`; validation then checks
  the installed Linux AMD64 binary against the immutable official release
  SHA-256 before any repository tests run.
- Hosted jobs use `ubuntu-24.04` to keep the runner OS family explicit while
  receiving GitHub's maintained image updates. The exact image and installed
  software versions remain recorded in each job's `Set up job` log.
  Review updates against the official [Deno releases](https://github.com/denoland/deno/releases),
  [Buildx releases](https://github.com/docker/buildx/releases),
  [BuildKit releases](https://github.com/moby/buildkit/releases), and
  [Syft releases](https://github.com/anchore/syft/releases) before changing the
  pins; use [GitHub's runner guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
  when reviewing the hosted runner family.
- Review the workstation boundary against Microsoft's
  [cross-filesystem guidance](https://learn.microsoft.com/windows/wsl/filesystems)
  and Supabase's [local development](https://supabase.com/docs/guides/local-development)
  and [database testing](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)
  guidance before changing the split between Windows-local and container-backed
  CI validation.
