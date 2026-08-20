# Deployment And Rollback

This no-secret runbook records the hosted delivery boundaries for the canonical
repository. The workstation is optional and is not required to serve traffic,
run jobs, store production state, or keep integrations online.

## Website

- Production: `https://mochirii.com`
- Canonical source: `apps/web`
- Delivery: protected GitHub `main` through the existing Vercel Git integration
- Preview: Vercel Preview on pull requests
- Canonical public content: `apps/web/public/data`
- Canonical public media: `apps/web/public/assets`

The Vercel project Root Directory remains `apps/web`. Do not relink, change
domains, or edit environment values as part of ordinary source work.

### Vercel Release Policy

The Mochirii website GitHub repository is currently public. Preserve that
visibility unless a separate owner-approved change is made. Every production
merge must pass protected review and fresh required checks; stale provider
statuses are not release evidence.

The Git integration is the normal release path. For an explicitly approved
manual recovery deployment, run the CLI from the repository root so the linked
`apps/web` Root Directory is resolved only once. Load the private token from the
credential boundary without printing it:

```powershell
$workspaceRoot = $env:MOCHIRII_WORKSPACE_ROOT
$activeCreds = $env:MOCHIRII_CREDS_DIR
if ([string]::IsNullOrWhiteSpace($workspaceRoot) -or !(Test-Path -LiteralPath $workspaceRoot -PathType Container)) {
  throw 'MOCHIRII_WORKSPACE_ROOT must name the existing Mochirii umbrella workspace.'
}
if ([string]::IsNullOrWhiteSpace($activeCreds) -or !(Test-Path -LiteralPath $activeCreds -PathType Container)) {
  throw 'MOCHIRII_CREDS_DIR must name Mochirii-Website\Creds\Active inside the private credential boundary.'
}
$repoRoot = Join-Path $workspaceRoot 'Website'
$tokenPath = Join-Path $activeCreds 'Vercel\Vercel Token.txt'
$vercel = Join-Path $repoRoot 'apps\web\node_modules\.bin\vercel.cmd'
if (!(Test-Path -LiteralPath $repoRoot -PathType Container)) { throw 'Canonical Website checkout not found.' }
if (!(Test-Path -LiteralPath $tokenPath -PathType Leaf)) { throw 'Vercel credential file not found.' }
if (!(Test-Path -LiteralPath $vercel -PathType Leaf)) { throw 'Pinned repo-local Vercel CLI not found.' }
Set-Location -LiteralPath $repoRoot
$tokenFromActiveBoundary = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($tokenFromActiveBoundary)) { throw 'Vercel credential file is empty.' }
$project = Get-Content -LiteralPath 'apps\web\.vercel\project.json' -Raw | ConvertFrom-Json
$env:VERCEL_ORG_ID = $project.orgId
$env:VERCEL_PROJECT_ID = $project.projectId
[Environment]::SetEnvironmentVariable('VERCEL_TOKEN', $tokenFromActiveBoundary, 'Process')
try {
  & $vercel deploy --prod --yes
} finally {
  Remove-Item Env:\VERCEL_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:\VERCEL_ORG_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\VERCEL_PROJECT_ID -ErrorAction SilentlyContinue
  Remove-Variable tokenFromActiveBoundary -ErrorAction SilentlyContinue
}
```

### Website Verification

```powershell
fnm use 22.23.1
npm ci
npm run check
Set-Location apps/web
npm ci
npm run toolchain:check
npm run lint
npm run build
```

Before merge, require the protected GitHub checks and a ready Vercel Preview.
After merge, require the production deployment for the merged commit to become
ready, then verify canonical redirects, routes, metadata, headers, and signed-out
authentication boundaries.

### Post-deploy observability smoke

Verify the production deployment serves Vercel Web Analytics and Speed Insights
after hydration, then confirm visits appear in the Vercel dashboard. The script
URLs may be project-specific, so identify them by their SDK data attributes
rather than by a fixed pathname. Cloudflare remains DNS-only for the website.

### Website Rollback

Promote the prior known-good Vercel deployment or revert the focused pull
request. The retired root static site is not a live fallback; its exact final
state is preserved only as release `legacy-static-final-2026-07-18` for disaster
recovery and historical inspection.

## Supabase

`supabase` owns migrations and Edge Functions. Use protected Git integration and
retain migration ordering, RLS, explicit grants, JWT/signature/shared-secret
boundaries, and unsigned fail-closed behavior.

- Never deploy from an unreviewed checkout.
- Never print or commit service-role keys, database passwords, OAuth secrets,
  bot tokens, or bundled secret JSON.
- A failed migration requires a forward fix or a tested restore decision; code
  rollback alone does not reverse database state.

## Shopify

`apps/shopify-theme` is the storefront-theme source. Source merge does not
publish a theme. Push only to an identified unpublished QA theme until an exact
publication action is approved. Shared product, page, collection, locale, and
policy records require a pre-write rollback export and one authenticated writer.

## Mochirii Social

`services/social` builds the private immutable production image. A release must
record the reviewed commit, exact GHCR digest, SBOM, successful clean migrations,
and workflow run. The protected manual deployment workflow accepts an exact
digest and typed confirmation; it must not build on the Droplet.

Rollback deploys the previous known-good digest when no migration was applied.
Migration releases require the verified database backup and migration-specific
recovery path. ActivityPub remains disabled.

## Security Hardening

- `apps/web/next.config.ts` owns the enforced `Content-Security-Policy` and
  security headers for the website.
- Cloudflare remains DNS-only for the Vercel website records; edge changes are
  separate evidence-backed provider actions.
- Public security contact metadata is served from the Website-owned
  `apps/web/public/.well-known/security.txt` and the Social-host-specific
  `services/social/public/.well-known/security.txt`; both remain source checked
  and require separate hosted readback after an approved release.
- GitHub Actions use full-SHA-pinned actions, minimum permissions, disabled
  persisted checkout credentials, and no `pull_request_target` workflows.
  Mutable pull-request, event, ref, and actor values must enter shell steps only
  through quoted environment variables; never interpolate those contexts
  directly into `run` scripts.
- Credentials live only in protected hosted secret stores or the private
  `Mochi Creds` boundary.
- `scripts/public-disclosure-policy.json` records each retained public metadata
  class, accountable repository owner, purpose, exposure, retention, exact
  source files, and executable verification. The repository check rejects
  untracked or repository-escaping sources and nonexistent package scripts.

## Evidence

Durable no-secret release notes belong in `docs/operations`. Generated
screenshots, logs, JSON readbacks, provider exports, and rollback captures belong
in ignored `.artifacts/operations`. Never attach credentials, signed URLs,
private customer data, or production database/media state to a pull request.
