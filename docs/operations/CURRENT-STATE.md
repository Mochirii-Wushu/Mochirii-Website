# Current Mochirii State

Updated: 2026-07-29 PDT

This no-secret file records the current hosted and repository state. Update it
after a completed release or ownership change; do not place credentials,
provider exports, customer data, signed URLs, or mutable access details here.

## Canonical Sources

- Repository: `Mochirii-Wushu/Mochirii-Website`.
- Active source, automation, release metadata, and navigational links use that
  canonical name. Dated evidence may retain the contemporaneous pre-rename
  slug under the documented immutable-evidence exception.
- Local checkout: `C:\Github Repo's\Mochirii Website\Website`.
- Resolve current production source with `git fetch --prune origin` and
  `git rev-parse origin/main`; do not rely on an undated copied SHA.
- `apps/web` is the Vercel/Next.js website source.
- `apps/shopify-theme` is the Shopify theme source.
- `services/social` is the DigitalOcean-hosted Mochirii Social source.
- `supabase` contains migrations and Edge Functions for the hosted backend.
- `/games/mochi-pets` is a public, indexable Website-owned concept page with an
  optional protected inner tester doorway and no game browser bridge or backend
  dependency. Builds without complete server-only tester configuration render
  the public concept alone. When included, private entry requires freshly
  server-verified active Website
  membership and the current tester passcode; its single signed cookie is
  HTTP-only and bound to that verified member. The internal disconnected game
  contract is not included in the public page payload. Retired prototype source
  is not a supported owner and must not be restored. The fresh private
  game-source owner is `Mochirii-Wushu/Mochirii-Pets`; no Web or iOS playable
  artifact is connected.

The duplicate root static website is retired. Release
`legacy-static-final-2026-07-18` contains its final restorable artifact;
`apps/web/public/assets` and `apps/web/public/data` are the only editable public
asset and data sources.

## Consolidation Ledger

- PR #459 applied Shopify shared-copy packet `2026-07-18-v2` and merged as
  `eba818418c85bc54ab0f0a4c9edf989dfdf0e902`.
- PR #460 established monorepo boundaries, ownership documentation, repository
  guards, durable operations evidence, and static-site retirement; it merged as
  `54e00b5c6ec99a38a0791717f109a9acb1f340cc`.
- PR #461 imported the sanitized Social current tree under `services/social`
  and added path-aware validation, immutable image publication, deployment,
  recovery, and online-verification workflows; it merged as
  `138f7f2c8c244315c7e7354638c389a6e2fd55df`.
- PR #472 removed unused Social browser dependencies, updated `js-cookie`, and
  refreshed generated assets; it merged as
  `ef5675575aeea6cb41def256d0a889f60f963ff8`.
- PR #476 updated reviewed GitHub Action pins and merged as
  `69479d7`.
- PR #477 updated compatible website dependencies and merged as `bb60097`.
- PR #478 completed the consolidation closeout documentation and made
  `validate-theme` an always-reporting path-aware check; it merged as
  `b0c117e855375a2b1a1a7ff2110c2d60f6733015`.
The superseded Shopify and Social repositories were exported as mirror clones,
verified `--all` bundles, and no-secret provider metadata. Their encrypted
archives and manifests are pinned and synchronized under the approved private
recovery boundary. GitHub then confirmed both superseded repositories deleted,
while the private GHCR package remained linked to the canonical repository.
Generated local evidence now lives only under ignored `.artifacts/operations`.

## Hosted Services

- `mochirii.com` remains hosted by the existing Vercel project and deploys from
  protected `main` with Root Directory `apps/web`.
- Supabase project `deyvmtncimmcinldjyqe` remains the hosted Auth, Postgres, RLS,
  and Edge Function backend.
- The last verified hosted baseline contains 34 applied migrations and exactly
  33 ACTIVE Edge Functions with 20 `verify_jwt=true` and 13 false. The larger
  local integration candidate described below has not been deployed, so its
  49-migration and 45-function source inventories are not hosted-state claims.
- `shop.mochirii.com` remains password-protected. Payments and checkout remain
  disabled. Theme `141514408011` remains unpublished.
- `social.mochirii.com` is assigned to the existing single DigitalOcean
  Droplet with Spaces-backed media. Registration is closed and ActivityPub is
  disabled. Public read-only probes at 2026-07-30T02:25Z returned Cloudflare
  `522` for `/`, `/login`, `/.well-known/security.txt`, `/installer`, and an
  installer child path after about 20 seconds each. The current origin cause
  is not verified; historical healthy checks are not current availability
  evidence, and no host, Cloudflare, DNS, image, database, or secret mutation
  was made during this source review.
- Core customer serving, authentication, media, releases, Social queues, and
  the two active Supabase spotlight schedules do not depend on the local
  workstation. Complete auxiliary continuity remains Pending until the Reaper
  Gateway worker's hosted supervisor and a current Social backup/restore drill
  are read back; see [`HOST-INDEPENDENCE.md`](./HOST-INDEPENDENCE.md).

## Meta Publishing Source Packet

- The moderator-reviewed Facebook Page and Instagram publishing packet is
  source-only and has not been deployed to the hosted Website or Supabase
  project. It makes no automatic Facebook Group mutation; a published Page post
  can only be handed off to the official private guild Group manually.
- `FACEBOOK_PAGE_PUBLISH_ENABLED=false` and
  `INSTAGRAM_PUBLISH_ENABLED=false`, and no live Meta post was created. The
  current Employee System User has Content access only to the Page and linked
  Instagram asset plus partial Develop-app access; it has no full app
  management, ad account, or ad scope. The Marketing API use case exists only
  because Meta's System User installation flow requires Ads Management API
  Standard Access.
- A 60-day token with exactly `pages_manage_posts`,
  `pages_read_engagement`, and `pages_show_list` was revoked after every Graph
  request returned OAuthException 200 `API access blocked` behind the unresolved
  `Account confirmation needed` checkpoint. No Page-task, Instagram
  identity/account-type, or Instagram Graph-ID verification is current
  evidence. The former Admin System User has no assets, installed apps, or
  tokens and is retained as `Mochirii Gallery Publisher Legacy`.
- Hosted secret values are not documented or assumed. Activation requires fresh
  name-only secret-inventory evidence and a successful read-only provider
  identity check. Instagram Graph-ID discovery, verification, and independent
  pinning remain pending.
- Public profile readback shows Instagram `mochirii_guild` beside the existing
  TikTok and Twitch links. The Facebook Page and Instagram Website fields must
  remain empty, and Meta/Instagram profile or publication copy must not include
  or link `mochirii.com`.
- Instagram and TikTok use the preferred `mochirii_guild` handle. Facebook
  does not permit underscores and the preferred non-underscore variants were
  unavailable, so the Page is `mochiriiguildpage` and the existing Group stays
  `mochiriiguild`. Twitch remains `mochiriiguild` until its rename cooldown
  ends and the preferred handle can be checked in account settings.
- Facebook, Instagram, TikTok, and Twitch use the same canonical lotus emblem.
  The Facebook Page, Facebook Group, and Twitch use the matching banner family;
  Instagram and TikTok do not expose an equivalent profile-banner surface.
- The final source-only 46-migration packet was validated on 2026-07-29 in a
  uniquely named isolated local Supabase project: all 46 migrations reset,
  all 109 focused Meta pgTAP assertions passed, and strict warning-level
  database lint returned no findings. The migration manifest SHA-256 is
  `8E9062A5452D40C7859F74FD47552322B030CCFF4724A6A9EC090961DC7C0A46`.
  This is local source evidence only; the hosted project and quarantined shared
  local stack were not contacted.
- Any hosted migration, Edge Function deployment, Meta secret change,
  activation, or first genuine post remains separately approval-gated and
  requires current provider readback.

GitHub protects `main` with strict required checks for `validate`,
`validate-next`, `validate-theme`, `validate-social`, `Vercel`, and
`Supabase Preview`. The 2026-07-29 GitHub readback finds five open Website pull
requests: #536, #538, and the stacked draft Meta PRs #539, #540, and #541.
Mochi Pets PR #4 is also open; Social Mobile has no open pull request. The
authoritative local union has not been pushed and has no pull request, so none
of the open Website pull requests may be closed as superseded until exact
replacement parity, review, and checks are proved. Website currently reports
zero open Dependabot, code-scanning, and secret-scanning alerts. Social Mobile
has one open high-severity `brace-expansion` development-tool advisory tracked
by issue #9. Alert APIs are unavailable for the other private repositories on
the current plan; unavailable is not recorded as zero. GitHub private
vulnerability reporting is currently disabled for Website, so both Website and
Social source declare `mailto:support@mochirii.com` as the operational
`security.txt` contact while retaining the GitHub security policy URL.

## Local Full-Stack Integration Candidate

- The clean source union at validated local head
  `a51c3ea572d018364dfe36a550d0467eec0d6a79` contains exactly 49 migrations
  and 45 functions declared in `supabase/config.toml`, with a source-expected
  JWT split of 28 `verify_jwt=true` / 17 false. These figures describe local
  source only; hosted production remains at the 34-migration, 33-function,
  20/13 baseline until a separately reviewed and authorized release succeeds.
- A uniquely named, non-shared local Supabase project reset all 49 migrations
  and passed 480 of 480 top-level pgTAP assertions. Warning-level database lint
  was empty; security advisors at INFO and performance advisors at WARN were
  empty. The remaining 54 performance INFO findings were `unused_index`
  observations from a freshly reset empty database and are not evidence for
  deletion. The union adds an explicit deny policy for the private raffle nonce
  table and an index for the reviewed Gallery derivative foreign key.
- The same isolated run did not use the quarantined shared local Supabase port
  range and did not contact the hosted project. Cleanup proved no isolated
  containers, volumes, networks, listeners, or registered worktree remained.
- Server-side Supabase requests now use a bounded five-second transport that
  composes caller and request cancellation, cleans up timers and listeners, and
  fails closed with generic outage responses at protected authorization
  boundaries. Local unit, repository, Web build, and browser checks exercise
  that boundary; they are not a live-provider availability claim.
- The union retains the source-only Meta publishing packet as a validated
  subset: its isolated 46-migration reset, 109 focused pgTAP assertions, and
  recorded manifest digest remain immutable evidence. Both publishing flags
  remain false and no post was created. The broader 49/480 union result
  supplements rather than rewrites that subset record.
- The union has no remote branch or pull request and has caused no Vercel,
  Supabase, DigitalOcean, Meta, Discord, Shopify, Apple, Unity, or other
  provider change. Exact provider previews, accountable review, protected-main
  release authority, source-to-provider readback, and rollback evidence remain
  future gates.
- Exact local verification at that head passed the complete repository suite,
  Node 22.23.1/npm 10.9.8/Deno 2.9.4 toolchain contract, all 266 public PNG,
  JPEG, GIF, and WebP decodes, Web lint, and the Next 16.2.11 production build.
  Asset/CSP validators now fail closed on malformed media, unexpected external
  origin/file pairs, and unreviewed multiline runtime-load sites.

## Legal and Privacy Readiness

- The source-only
  [`LEGAL-PRIVACY-READINESS-2026-07-29.md`](./LEGAL-PRIVACY-READINESS-2026-07-29.md)
  decision packet and
  [`legal-privacy-readiness.v1.json`](./legal-privacy-readiness.v1.json)
  inventory cover ten repository-owned or planned surfaces, thirteen
  processing activities, processor and transfer evidence, retention, rights,
  twelve registered public-claim conflicts, and exact future approval gates.
- The fail-closed validator reports 5 `SOURCE_OBSERVED`,
  1 `RUNTIME_READBACK_REQUIRED`, 42 `BLOCKED_APPROVAL`,
  35 `BLOCKED_EXTERNAL`, 10 `DEFERRED_BY_EXPLICIT_POLICY`, and
  0 `NOT_APPLICABLE_REVIEWED` rows. An explicit blocker is valid inventory
  state, not evidence of readiness.
- No legal operator, jurisdiction, legal basis, retention period, rights
  deadline, processor contract, transfer mechanism, counsel review, or public
  legal copy is inferred or approved. Website and Social public copy remains
  unchanged.
- Social terms, guidelines, legal-notice source authority, absolute privacy
  description, deletion promises, and age or parental-control posture remain
  blocked pending exact owner decisions, qualified review, and authorized
  runtime evidence.
- The packet used repository source only. It did not inspect credentials, use a
  shared Supabase stack, contact providers, or change hosted state.

## Website Reliability Release

- PR #534 was squash-merged through protected `main` as
  `21f195458a87ae96eea84af51d0e1420b770ca74` after its exact-head repository,
  CodeQL, Vercel Preview, non-skipped Supabase Preview, database, browser and
  release-readiness gates passed.
- Vercel production deployment `dpl_6nHjx2vKA9wBgyDEGf4cRdpUESiJ` reached
  `READY` and is exactly bound to that merge SHA.
- The release covers public `Mōchirīī` / `Mōchī` wording enforcement, authenticated
  route readiness, bounded live-spinner polling/proxy behavior, exact reviewed
  Sya draw classification, and one behavior-preserving profile-link SELECT-policy
  consolidation. The repository-local Supabase CLI remains exact-pinned to 2.109.1.
  Version 2.110.0 registry integrity/signatures were verified but its release
  was still inside the enforced Deno dependency-age window, so it was correctly
  deferred rather than bypassing the supply-chain gate. This development-tool
  decision does not change the hosted Supabase runtime.
- The connected Supabase release applied exactly
  `20260727211442_classify_reviewed_sya_spinner_draw.sql` and
  `20260727212838_consolidate_member_social_links_select_policy.sql`. The Sya
  aggregate-only readback reports `all_checks_pass=true`, and
  `member_social_links` now has exactly one reviewed SELECT policy.
- The existing Git integration redeployed exactly the same 33 ACTIVE Edge
  Functions once. Every version advanced by exactly one and JWT configuration
  remained 20 `verify_jwt=true` / 13 false. No manual Supabase deployment or
  unrelated provider configuration change occurred.
- Post-release advisors report five security warnings: four
  executable-function findings across three reviewed least-privilege
  `SECURITY DEFINER` RPC boundaries, plus disabled leaked-password protection.
  The duplicate-policy warning is cleared and 53 unused-index information
  notices remain observation items, not evidence for deletion. Leaked-password
  protection remains a separately approval-gated Auth setting.
- Detailed scope, advisor rationale, worktree disposition, and release gates are
  in [`WEBSITE-RELIABILITY-RECONCILIATION-2026-07-27.md`](./WEBSITE-RELIABILITY-RECONCILIATION-2026-07-27.md).
- The complete public-safe organization, branch, issue, and current-worktree
  classification is recorded in
  [`ORGANIZATION-RECONCILIATION-2026-07-27.md`](./ORGANIZATION-RECONCILIATION-2026-07-27.md).

## Social Release

- The canonical private GHCR package is
  `ghcr.io/mochirii-wushu/mochirii-pixelfed-ops`.
- The deployed canonical image digest is
  `sha256:1fd27c8f76595595912e6f12f1677c7f108aa50f64b38a85089006b47ad395f1`.
- The historical hosted checks below do not supersede the current Cloudflare
  `522` observation recorded in Hosted Services. Social should be treated as
  publicly unavailable until a read-only origin/provider diagnosis and a
  separately approved rollback-safe recovery packet prove otherwise.
- Social hardening replacement PR #535 was squash-merged through protected
  `main` as `075937a30a9509faa189e9b1917a2ad9b847c7b0`. It refreshes expired
  Discord role evidence on demand so an otherwise valid member is not stranded
  at Social consent when the bounded verification window expires. This merged
  historical release does not authorize deployment of the newer 45-function
  local union or any DigitalOcean runtime change.
- The approved Packet E write set only the server-side
  `MOCHIRII_SOCIAL_OAUTH_CLIENT_ID` binding as Sensitive for Vercel Preview and
  Production. The exact registered first-party identifier, callback, and S256
  PKCE request were reconciled without printing or recording the identifier.
  No public variable, client secret, OAuth registration, callback, or other
  provider setting changed, and the existing Production deployment remained
  bound to protected `main` without a deployment solely for this setting.
- PR #535 passed its reviewed exact-head GitHub, Vercel, and non-skipped
  Supabase Preview gates before merge. Protected Preview checks reached the
  application authorization boundary, preserved private/no-store rejection,
  and found no identifier in rendered HTML or client assets. DigitalOcean
  deployment remains a separate exact gate. The private-media runtime remains
  blocked until anonymous object/CDN denial and one authorized
  application-media read are proven in the separately approved cutover packet.
- Image workflow run `29664477462`, protected deployment run `29664673632`,
  and hosted verification run `29664734313` completed successfully.
- Caddy, Pixelfed, MariaDB, Redis, Horizon, scheduler, Spaces access, public
  boundaries, and federation-disabled posture passed the hosted verification.
- Post-deletion online verification run `29665954934` passed the same runtime,
  Spaces, website, Supabase, Reaper, and Discord boundaries.
- Final current-`main` online verification run `29666572246` passed after the
  consolidation closeout and ruleset update.
- Residual transitive Vue 2 advisory findings are tracked in issue #475 and are
  accepted only as a temporary compatibility risk. No open Dependabot alert is
  left without that explicit disposition.

## Workspace

The supported local workspace contains:

```text
C:\Github Repo's\Mochirii Website\
  Website\      Canonical website, theme, Social, and Supabase repository
  Mochirii-Social-Mobile\  First-party mobile client repository
  Mochirii-Pets\  Fresh Unity source repository; no playable artifact connected
  Mochi Creds\  Private synchronized credential and recovery boundary
  AGENTS.md      Umbrella workspace guidance
```

Durable no-secret runbooks belong in `docs/operations`. Provider contracts
belong in `docs/integrations`. Screenshots, logs, JSON readbacks, exports, and
generated archives belong only in ignored `.artifacts/operations`.

## Shopify Opening Readiness

- [`SHOPIFY-LAUNCH-READINESS.md`](./SHOPIFY-LAUNCH-READINESS.md) is the
  canonical no-secret decision ledger for the United States-only storefront
  opening and its 72-hour low-promotion soft launch.
- Customer-copy revision `2026-07-18-v2` is now recorded as immutable public
  content, separate from its consumed provider-write approval and verified
  2026-07-18 readback history. The shared-copy write is Applied, not Pending;
  no current provider-write, publication or commerce authority follows from
  that history.
- Existing reachable public Git history was reviewed on 2026-07-19 and
  accepted without rewriting. That disposition does not remove prior objects
  and is not authorization for a future history rewrite.
- The canonical Mochirii emblem design is universal across the guild site,
  storefront and product label/media review. The exact commerce wordmark is
  **Mochirii Cosmetics**. The 1024-pixel canonical WebP, 224-pixel storefront
  derivative and ignored 600-pixels-per-inch label PNG have recorded SHA-256
  identities; the label PNG and canonical WebP have identical decoded RGBA
  pixels. The theme applies the storefront derivative to its header, footer,
  password, gift-card, controlled structured-data and favicon surfaces. A
  2026-07-19 read-only candidate review found a
  different minimalist mark on representative Peptide Smoothing Serum
  packaging while the header used the canonical emblem, so that SKU currently
  fails parity. No physical label or other image is accepted by the source
  declaration: an emblem or wordmark mismatch blocks the affected SKU, and all
  twenty require label artwork, mockup/media, physical-label and box review.
- The local v3 product-facts and prepayment-evidence contracts remain
  fail-closed: zero products are Complete, nineteen are Pending and Peptide
  Smoothing Serum is Blocked. Complete records require controlled product type,
  filterable ingredient names with separate reviewed ingredient roles,
  structured and numerically consistent dual-unit net contents, plain-text
  safety, distinct controlled front/technical-panel/outer-box media, and exact
  rendered readback. Prepayment completion additionally requires a clean
  evidenced merge commit, merge-commit checks, full source-manifest/package
  digest parity, exact per-SKU fact/formula/product/variant identities, exact
  authenticated Shopify title/description/SEO/metafield/collection/media/alt
  projection parity, and real ignored and untracked artifact bindings for
  formulas, labels, boxes, media, catalog authentication, account plan and
  catalog snapshot. Image evidence must decode with valid dimensions; a file
  signature alone is insufficient. The bundle, every evidence envelope, theme
  package and standalone private configuration artifact must also remain
  ignored and untracked. The gate additionally requires source-bound launch
  pages and a mandatory-name register, six reviewed spelling/typo search sets,
  the configured privacy route, and an approved contiguous-US supplier/carrier
  matrix tied to the complete authenticated Shopify weight-tier configuration.
  Every tier must be contiguous, the final tier open-ended, and each positive
  threshold must pass just-below, at and just-above observations with exact
  positive USD rate parity; unsupported-address and PO-box outcomes remain
  explicit. Product/safety/MoCRA/claims records, operational runbooks and
  authenticated gift-card suppression are also required. Synthetic contract
  tests do not make any real SKU or provider gate Ready.
- The versioned provider-surface contract now pins the Mochirii emblem and
  wordmark, primary customer domain, home and collections-index presentation,
  pages, five collection identities, navigation, controlled filters, customer
  settings, policies, notification presentation and sender requirements. Its
  provider-ready mode requires an ignored exact readback tied to the candidate
  theme and package. Private rendered bodies are bound to route/content hashes
  and scanned for encoded or markup-split third-party, system, mood-only,
  unsupported-claim and inconsistent-brand language. Accountable detected-name
  attestations must map one-to-one to route-specific mandatory exceptions.
  Dedicated hero media, featured products, all five rendered collection
  bodies/media/memberships, five policies, three notifications and sender
  authentication remain Pending; no provider state was changed.
- The ledger contains exactly the twenty products in approved customer-copy
  contract `2026-07-18-v2` and the 2026-07-18 authenticated read-only Shopify
  readback. All twenty are Active with USD prices, but inventory is not tracked
  and each says Shop location is its single fulfilling location. Nonblank SKUs
  and physical weights were confirmed, while that baseline rendered a generic
  warning fallback on fifteen PDPs. The local source has since removed generic
  fact, INCI and warning fallbacks, but has not been uploaded. These facts do
  not clear product evidence, labels, formula/INCI, warnings, safety, MoCRA,
  claims, variants, fulfillment, privacy, tax, or launch operations.
- Non-payment provider blockers include the Basic development-store state,
  United States tax set to Not collecting, untracked inventory, unresolved
  physical-weight correctness and fulfillment locations, EUR-denominated US
  shipping-profile tiers in admin, and an unbranded notification sender. No
  provider setting was changed.
- All twenty release dispositions remain blocked until their evidence and
  provider fields are reviewed. Unknown private or external facts are recorded
  as Pending rather than inferred.
- The focused foundation revision was squash-merged through PR #480 on
  2026-07-24 as `d8a4b578cdf3619e886de415ee403fda220d9a60`. Its exact head passed
  the clean lockfile install, complete repository check, Shopify theme check,
  release-safety guards, JavaScript syntax, Theme Check across 45 files with
  zero offenses, 145 adversarial contract tests, 12 generic-tooling tests,
  SBOM validation, exact packaging, `git diff --check`, and required remote
  checks. Supabase Preview was correctly skipped because that PR had no
  `supabase/` diff.
- PR #480 merged source and contracts only. Its 75,251-byte review package was
  explicitly provisional and was not authorized for provider upload. The
  candidate package still must be rebuilt from the eventual approved release
  commit, rebound to that commit/tree/digest, reviewed against complete private
  product evidence and authenticated provider readback, and separately
  authorized before candidate staging. Theme publication, password removal,
  checkout, payment, product/provider writes, and downstream launch operations
  remain unreleased.
- The revised plan authorizes a single reversible upload of the exact
  human-reviewed, merged-main package to unpublished candidate theme
  `141514408011` while `checkout_enabled` stays false. The required rollback
  capture, merged source/package binding, upload and post-write readback are
  still Pending. This boundary does not authorize a repeat upload, shared
  record changes, theme publication, checkout, password removal or commerce.
- Prepayment acceptance now covers configuration and candidate-storefront
  evidence only. End-to-end checkout quotations, payments, order creation,
  inventory decrement, notifications, cancellation, refunds, fulfillment and
  payouts remain payment-dependent Gate F tests and cannot be inferred from a
  prepayment readback.
- Payment setup and payment/order-lifecycle testing are intentionally the final
  readiness phase. They do not begin until every non-payment gate is Ready and
  the owner gives exact approval for that provider action.
- Storefront password protection and disabled checkout remain in effect, and
  theme `141514408011` remains unpublished. Publication, password removal,
  purchases, real orders, and public launch remain separately approval-gated.

## Deferred

- Mochi Pets gameplay remains deferred while the fresh private
  `Mochirii-Wushu/Mochirii-Pets` Unity source has no reviewed Web or iOS playable
  artifact connected to Website or Mobile.
- Shopify product-evidence review, physical samples, remaining operational and
  provider validation, approved change packets, rollback exports, final
  payment setup, password removal, and public launch under the
  opening-readiness ledger.
- ActivityPub federation.
- Cloudflare, DNS, Spaces, Droplet-size, and unrelated provider changes.
- Unused Supabase index removal and paid leaked-password protection.
