# Mochirii

Canonical source repository for the Mochirii website, cosmetics storefront
theme, shared identity and authorization contracts, and hosted backend.

## Production Surfaces

| Path | Purpose | Hosted by |
| --- | --- | --- |
| `apps/web` | `mochirii.com` Next.js website | Vercel |
| `apps/shopify-theme` | `shop.mochirii.com` storefront theme | Shopify |
| `supabase` | Auth, database migrations, RLS, and Edge Functions | Supabase |

GitHub is the source, review, CI, package, and delivery control plane. Production
traffic, queues, schedules, media, authentication, and backups do not require a
local workstation to remain online.

The former Mochi Pets prototype and connected repository are retired.
`/games/mochi-pets` is a public, indexable Website page with a private tester
doorway available only when its complete access configuration is present. The
fresh private game source is now
`Mochirii-Wushu/Mochirii-Pets`; it does not restore the prototype and no playable
artifact is connected. See `docs/mochi-pets-future-project.md`.

See [system architecture](docs/architecture.md) and
[repository ownership](docs/operations/repository-ownership.md).

## Repository Layout

```text
apps/
  web/                 Live website application and canonical public assets/data
  shopify-theme/       Storefront theme source
services/
  social/              Guild-social source and container definitions
supabase/              Migrations and Edge Functions
docs/
  integrations/        No-secret hosted-provider contracts
  operations/          Runbooks and dated release evidence
.artifacts/operations/ Ignored local evidence and rollback exports
scripts/               Repository validation and operator tooling
```

The old root static website was retired after cutover verification. Its exact
last state is preserved by GitHub release `legacy-static-final-2026-07-18`.
`apps/web/public/assets` and `apps/web/public/data` are the only editable website
asset and content sources.

## Development

Use the pinned Node.js runtime:

```powershell
fnm use 22.23.1
npm ci
npm run toolchain:check
npm run check
```

Website checks:

```powershell
Set-Location apps/web
npm ci
npm run toolchain:check
npm run lint
npm run build
```

Storefront checks:

```powershell
Set-Location apps/shopify-theme
npm ci
npm run check
npm run theme:package
```

Mochirii Social application source, image publication, deployment, and recovery
belong exclusively to `Mochirii-Wushu/Mochirii-Social`. This repository retains
only the Website-side doorway, OAuth, shared identity, and authorization
contracts.

## Delivery

- Work on a focused branch and merge through protected pull requests.
- `main` deploys the website through the existing Vercel Git integration.
- Supabase integration applies only reviewed backend changes from `main`.
- Storefront source merges do not publish a theme automatically.
- Social production accepts only an approved immutable image digest through the
  canonical Social repository; Website has no Social release workflow.
- Provider settings, secrets, theme publication, database migrations, and live
  runtime changes remain scoped approval actions.

The required `validate` context is produced by
`.github/workflows/validate-static-site.yml`; its filename is retained for
branch-protection continuity even though the job now validates the repository.

## Security And Evidence

- Store credentials only under the private `Mochi Creds` boundary or protected
  provider secret stores. Never commit `.env` files, private keys, cookies,
  signed URLs, customer data, supplier costs, or production state.
- Keep durable no-secret Markdown in `docs/operations` or `docs/integrations`.
- Keep screenshots, JSON readbacks, logs, exports, and generated archives under
  ignored `.artifacts/operations`.
- Preserve required open-source licenses and upstream attribution.
- Keep ActivityPub federation disabled until its separate readiness packet is
  approved.

`npm run check:repository-boundaries` enforces current-tree brand and secret
hygiene, generated-archive rejection, reviewed file-size limits, and a locked
historical-residue baseline without rewriting public Git history.

## Content And Product Guidance

Route-specific guidance remains under `docs`. Protected website copy is guarded
by exact hashes and must not be changed incidentally. Public guild surfaces use
the NFC trademark forms `Mōchirīī` and `Mōchī`; technical identifiers, repository
slugs, infrastructure, Shopify, and `Mochirii Cosmetics` commerce surfaces retain
ASCII `Mochirii`. Supplier and provider names stay in internal code, required
attribution, CI, and no-secret technical docs.

Use [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), the root
[AGENTS.md](AGENTS.md), and the nearest subdirectory `AGENTS.md` before changes.
