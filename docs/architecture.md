# Mochirii System Architecture

`Mochirii-Wushu/Mochirii-Website` is currently the source repository for the
public website, storefront theme, hosted guild-social application, and shared
backend. This document distinguishes that verified current state from required
terminal repository boundaries. A terminal boundary is not a deployment,
provider-binding, source-removal, or cutover claim. Production systems deploy
from reviewed commits; the workstation is never a serving or job-processing
dependency.

## Current Website Repository Layout

| Path | Owner | Hosted runtime |
| --- | --- | --- |
| `apps/web` | Public website and hosted game doorways | Vercel |
| `apps/shopify-theme` | Customer storefront theme | Shopify |
| `services/social` | Guild-social application and production image | DigitalOcean Droplet and Spaces |
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

## Cross-Repository Direction

| Repository | Verified current state | Required terminal responsibility | Dependency boundary |
| --- | --- | --- | --- |
| `Mochirii-Wushu/Mochirii-Website` | Active source for Web, storefront, Social, shared Supabase, and Reaper-facing Edge handlers | Web, storefront, shared identity/database governance, and Website integration clients | Publishes versioned shared contracts; does not retain duplicate terminal Social or Reaper-specific implementations after approved cutovers and rollback windows. |
| `Mochirii-Wushu/Mochirii-Social` | Empty target; no production ownership | Pixelfed-based Social source, immutable delivery, operations, backup, restore, and Social-specific workflows | Consumes Website identity and shared-backend contracts; cannot deploy until parity and provider cutover pass. |
| `Mochirii-Wushu/Mochirii-Forums` | Empty remote target; a local, unpushed governance-seed candidate exists; no runtime | Supported Forums configuration, operations, backup, restore, and rollback | Consumes Website identity and guild-entitlement contracts after a separately approved implementation. |
| `Mochirii-Wushu/Mochirii-Social-Mobile` | Private pre-beta source foundation | First-party Social mobile application and approved native artifact host | Consumes Social API/OAuth and immutable Pets artifacts; contains no provider or privileged database secret. |
| `Mochirii-Wushu/Reaper-Discord-Bot` | Gateway and bot source; Reaper-specific Edge ownership candidate is not deployed | Reaper-specific handlers, tests, runtime delivery, command/event operations, and Gateway worker | Consumes versioned Website schema and data contracts while preserving one deployment writer. |
| `Mochirii-Wushu/Mochirii-Pets` | Fresh Unity source foundation; no connected playable artifact or API | Unity source, build definitions, immutable Web/iOS artifacts, and game-specific API contracts | Consumes Website identity through versioned APIs; Website and Mobile consume artifacts, never Unity source. |
| `Mochirii-Wushu/Mochirii-Raffle-Spinner` | Private archived historical source | Read-only dependency and hygiene evidence unless separately approved | No required live dependency may be assumed; prove reachability before any archive mutation. |

The machine-readable
[`cross-repository contract registry`](integrations/cross-repository-contract-registry.v1.json)
records producer and consumer intent. Its contracts remain unversioned target
scaffolding until concrete artifacts, compatibility tests, fixtures, and
rollback windows exist.

## Asset Classes

| Asset class | Current canonical source or store | Required terminal owner | Handling boundary |
| --- | --- | --- | --- |
| Website public data and media | `apps/web/public/data`, `apps/web/public/assets` | Website | Reviewed public content only; validate references, formats, dimensions, metadata, and byte budgets. |
| Storefront theme and public launch contracts | `apps/shopify-theme` and its active-source manifest | Website | Provider publication is separate; supplier, formula, cost, label-source, and private catalog evidence stay outside Git. |
| Shared schema, identity, and database contracts | `supabase/migrations`, shared types, RLS, RPCs, and contract fixtures | Website | One migration authority; service-role and provider secrets remain server-side. |
| Social application and image source | `services/social` until approved cutover | Social terminal repository | Runtime database, Redis, member media, logs, backups, and host configuration are never committed. |
| Reaper source and deployable artifacts | Reaper repository plus current Website-owned handler source | Reaper terminal repository for product-specific code | Transfer only with exact source/artifact identity, shared-schema compatibility, one writer, and rollback. |
| Mobile source and native artifacts | Social Mobile repository; no accepted release artifact yet | Social Mobile | Signing material, entitlements, device data, private caches, and symbols remain protected. |
| Pets Unity source and artifacts | Pets repository | Pets | Preserve Unity `.meta` files, required LFS objects, pinned toolchains, build manifests, signatures or attestations, and restricted symbols. |
| Forums configuration and recovery assets | Empty remote target; local, unpushed governance-seed candidate only | Forums | Commit only supported redacted configuration after separate review; host secrets, uploads, database, mail, and backups remain protected runtime state. |
| Release, provenance, rollback, and generated evidence | Reviewed repository records plus ignored `.artifacts/operations` | Owning repository and restricted evidence system | Public-safe durable summaries may be tracked; screenshots, provider exports, private SBOMs, logs, and rollback captures stay restricted. |
| Credentials and private business or legal records | Provider secret stores and `Mochi Creds` | No Git repository | Never print, hash, summarize, relocate, or copy secret values into source, reports, tickets, or public evidence. |

## Data, Contracts, and Flows

The
[`integration exposure catalog`](integrations/integration-exposure-catalog.v1.json)
is the current Website-source inventory for data classes, destinations,
authorization boundaries, disable controls, runbooks, and runtime-readback
requirements. It does not prove provider state or fully model terminal services
that do not yet exist.

| Macro flow | Producer to consumer | Data and trust boundary | Current status |
| --- | --- | --- | --- |
| Member identity and guild entitlement | Website/Supabase to Website, Social, Mobile, Forums, Reaper, and Pets APIs | Confidential identity and role evidence; server-derived, audience-bound, revocable, and fail-closed | Website implementation active; cross-repository contracts remain unversioned. |
| Social OAuth, account mapping, posts, and media | Website/Supabase to Social and Mobile; Social returns bounded account state | Confidential member mapping and private media; exact redirects, PKCE where applicable, signed server calls, and no client secret | Current Social source remains in Website; terminal cutover not performed. |
| Discord commands and guild events | Discord to Reaper handlers/Gateway to Website-owned shared data contracts | Signed or secret-bound events, replay protection, least privilege, redacted receipts, and idempotency | Hosted Edge handlers remain Website-owned; terminal Reaper handler transfer not performed. |
| Gallery, raffle, Spotlight, and vote workflows | Website shared backend with Reaper command/event consumers | Member, moderation, draw, fulfillment, and audit classes separated from bounded public projections | Current Website source active; consumer contracts remain target scaffolding. |
| Pets launch and artifact delivery | Website identity and launch-ticket service to Pets artifacts/API, Website Web host, and Mobile iOS host | Short-lived audience-bound tickets, immutable artifact identity, no privileged database credential in clients | No playable artifact, connected API, or production hosting exists. |
| Forums central identity | Website identity/entitlement service to future Forums runtime | Exact redirect, server-side entitlement, session revocation, deletion, and no provider login granting guild status | Target-only; no Forums runtime exists. |

Data purpose, storage location, retention, deletion propagation, recipient
category, and cross-border status remain requirement-level ledger fields. They
must be explicit before a target flow is activated; absence is not inferred as
no collection or no transfer. The source-only
[`legal and privacy readiness inventory`](operations/legal-privacy-readiness.v1.json)
tracks those decisions, rights workflows, public-claim conflicts, and external
evidence gaps. It is not legal approval, provider proof, or deployment
authority.

## Current Hosted Boundaries

- GitHub is the source, review, CI, container registry, and delivery control
  plane. GitHub-hosted runners are used; no workstation or production-host
  runner is permitted.
- Vercel serves `mochirii.com` from `apps/web`.
- Supabase owns Auth, Postgres, RLS, and Edge Functions under `supabase`.
- Shopify hosts `shop.mochirii.com`; `apps/shopify-theme` is its reviewed theme
  source. Store records remain provider-managed and require a rollback export
  before mutation.
- The DigitalOcean runtime pulls an immutable image built from
  `services/social`; database, cache, queues, schedules, media, and backups run
  online without workstation processes.
- Cloudflare remains an edge and DNS boundary. Provider configuration changes
  require exact, scoped approval.
- Discord/Reaper interactions currently run through Website-owned hosted Edge
  Functions. A separate Gateway worker exists in Reaper source, but its hosted
  supervisor and health remain pending readback. No local bot process may be a
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
