# Mochirii Cosmetics Shopify theme

This directory contains the public, deployable Online Store 2.0 theme source
for Mochirii Cosmetics. It intentionally contains storefront runtime files, a
nondeployable versioned customer-copy contract, and pure generic validation
tooling only. All Mochirii website and storefront work belongs in
`Mochirii-Wushu/Mochirii-Website`; none belongs in another brand repository.

Private supplier records, costs, source identifiers, samples, legal reviews,
operator checklists, credentials, admin exports, and launch ledgers are not
part of this repository. They must never be reconstructed from public data or
added to this directory.

The locked package can generate and validate an SPDX 2.3 software bill of
materials with `npm run check:sbom`; its document namespace and creation time
are intentionally generated at execution time.

`content/approved-customer-copy.json` preserves the English theme strings, home
SEO, page copy, collection copy, and exact-20 product description/SEO set. It is
excluded by `.shopifyignore`, contains no prices, inventory, supplier records,
provider identifiers, or private evidence. The v2 packet permits unpublished
theme QA but explicitly grants no shared-record mutation, theme publication, or
commerce authority. The pure seven-column
copy helper additionally requires the exact current `Option1 name` and
`Option1 value` from a fresh pre-import product export. When those values are
copied unchanged, the helper preserves option identity and reduces the risk of
accidentally recreating or deleting variants. It cannot verify provider
freshness, never invents option values, and neither reads nor writes provider
state. Generating a validated CSV does not authorize importing it.

The runtime was reconciled from the 2026-07-18 live-theme baseline so its
twenty products, navigation, cart, and provider-managed theme behavior remained
visible at that time. The obsolete `product_publication_approved` switch and
optional internal-product metadata control are intentionally absent.
`checkout_cta_enabled` remains false, so the theme does not render its cart-page
checkout button and instead states that checkout opens when the store launches.
This is a presentation-only control: it does not disable Shopify checkout,
payment links, cart permalinks, or other provider-controlled routes. Prepayment
containment therefore also requires the exact candidate to remain unpublished,
storefront password protection to remain enabled, and fresh authenticated
provider readback. Store password state, checkout availability, theme
publication, shared product/page/policy changes, domains, payments, orders, and
paid applications remain separate provider-side actions and are never
performed by repository CI.

`MIGRATION-MANIFEST.json` is byte-sealed historical evidence of the 2026-07-18
reconciliation into the canonical repository and the subsequent customer-copy
v2 packet. It is never regenerated and does not describe current mutable source.
It remains unsigned because no approved signing identity was available, and
existing public history was not rewritten by the import.

`ACTIVE-SOURCE-MANIFEST.v1.json` is the versioned current hash authority for the
complete theme runtime, sanitized generic tooling, and public launch contracts.
Package and prepayment validators consume this active manifest. After an
approved source change, refresh it with `npm run generate:active-source-manifest`
and review the resulting hash diff. That command never reads from or writes to
Shopify and never modifies the sealed migration manifest.

## Validate locally

```powershell
npm ci
npm run check:active-source-manifest
npm run check
npm run theme:package
git diff --check
```

The evidence gates expose their complete local-only syntax through real help:

```powershell
npm run gate:prepayment-complete -- --help
npm run gate:provider-surfaces -- --help

npm run gate:prepayment-complete -- --bundle <ignored-prepayment-bundle.json>
npm run gate:provider-surfaces -- --private-readback <ignored-provider-readback.json> --candidate-theme-id <theme-id> --package-sha256 <sha256>
```

Keep those evidence files under the ignored `.artifacts/operations` boundary.
The commands read local files only; they neither access nor mutate Shopify and
do not grant provider, publication, payment, or commerce authority.

`theme:package` creates a local ignored archive. It does not upload or publish
the theme. `check:release-safety` fails if the theme checkout CTA, direct
checkout primitives, internal-product-data, warning-copy, navigation, or
title/SEO safeguards regress. It does not claim server-side checkout is
disabled.
`check:customer-facing-copy` rejects internal operator phrasing, supplier names,
filler, obsolete availability labels, and repeated metadata regressions.
`check:approved-copy` validates the customer-copy schema, exact counts, varied
two-sentence product descriptions, SEO constraints, runtime parity, packaging
exclusion, and false shared-record/publication/commerce authorization flags.
The generic CSV helpers are pure validation/serialization
code. Their synthetic exact-20 contracts emit only reviewed copy or structured
list-metafield columns; they do not read private files, write output, or call
Shopify.
