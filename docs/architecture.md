# Mochirii System Architecture

`Mochirii-Wushu/Mochirii-Website` is the source repository for the public
website, storefront theme, Website-side identity and authorization contracts,
and shared backend. The hosted guild-social application is sourced exclusively
from `Mochirii-Wushu/Mochirii-Social`. Production systems deploy from reviewed
commits; the workstation is never a serving or job-processing dependency.

## Repository Layout

| Path | Owner | Hosted runtime |
| --- | --- | --- |
| `apps/web` | Public website and hosted game doorways | Vercel |
| `apps/shopify-theme` | Customer storefront theme | Shopify |
| `supabase` | Database migrations and Edge Functions | Supabase |
| `docs/integrations` | No-secret provider contracts and architecture notes | GitHub |
| `docs/operations` | No-secret runbooks and dated release evidence | GitHub |
| `.artifacts/operations` | Generated local evidence and rollback exports | Ignored; never committed |

The canonical website data and public assets live in `apps/web/public`. The
retired root static site is preserved by the `legacy-static-final-2026-07-18`
release and is not an editable production source.

The current tree, paths, and commit messages contain no former-brand or supplier
branding. A small set of pre-consolidation commits contains removed wording in
historical patches. Rewriting those commits would invalidate review and release
history, so `scripts/repository-boundary-history-baseline.json` locks the exact
known set and CI rejects every new occurrence.

## Hosted Boundaries

- GitHub is the source, review, CI, container registry, and delivery control
  plane. GitHub-hosted runners are used; no workstation or production-host
  runner is permitted.
- Vercel serves `mochirii.com` from `apps/web`.
- Supabase owns Auth, Postgres, RLS, and Edge Functions under `supabase`.
- Shopify hosts `shop.mochirii.com`; `apps/shopify-theme` is its reviewed theme
  source. Store records remain provider-managed and require a rollback export
  before mutation.
- The Social runtime pulls an immutable image built exclusively from
  `Mochirii-Wushu/Mochirii-Social`; database, cache, queues, schedules, media,
  and backups run online without workstation processes. Website owns only the
  doorway, OAuth, shared identity, and authorization contracts it exposes.
- Cloudflare remains an edge and DNS boundary. Provider configuration changes
  require exact, scoped approval.
- Discord/Reaper runs through hosted Edge Functions. No local bot process is a
  production dependency.

## Mochi Pets Boundary

No playable game runtime is part of this architecture.
`/games/mochi-pets` is a public, indexable Website concept page with an optional
protected inner tester doorway. Builds without the complete server-only tester
configuration render only the public concept. When included, the browser hands
its current Website access token to a
same-origin route only in the Authorization header; the server verifies active
membership before accepting the separate tester passcode. The single signed
tester cookie is HTTP-only, member-bound, and rechecked only after fresh member
verification. The versioned game connection contract is never serialized into
the page and contains no game origin or credential. The fresh private
`Mochirii-Wushu/Mochirii-Pets` Unity repository owns game source for both Web and
iOS; Website and Mobile consume only reviewed immutable artifacts. Mochirii
Social remains the single member identity and future chat platform.

See [repository ownership](operations/repository-ownership.md) for the detailed
change and deployment matrix.
