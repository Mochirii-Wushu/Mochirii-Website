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

The runtime is reconciled from the current live theme so its twenty products,
navigation, cart, and provider-managed theme behavior remain visible. The
obsolete `product_publication_approved` switch and optional internal-product
metadata control are intentionally absent. `checkout_enabled` remains false,
and the disabled cart control states that checkout opens when the store
launches. These repository controls do not replace provider-side product status
or storefront-password review. Store password state, checkout activation,
theme publication, shared product/page/policy changes, domains, payments,
orders, and paid applications remain separate provider-side actions and are
never performed by repository CI.

The migration manifest records the 2026-07-18 reconciliation from the current
live Shopify theme into the canonical repository, followed by the customer-copy
v2 packet. It covers the selected runtime, public copy contract, and pure
generic CSV/tooling contract, but deliberately excludes private evidence and
provider workflows. It is unsigned because no approved signing identity was
available. Existing public history was not rewritten by this import.

## Validate locally

```powershell
npm ci
npm run check
npm run theme:package
git diff --check
```

`theme:package` creates a local ignored archive. It does not upload or publish
the theme. `check:release-safety` fails if checkout, internal-product-data,
warning-copy, navigation, or title/SEO safeguards regress.
`check:customer-facing-copy` rejects internal operator phrasing, supplier names,
filler, obsolete availability labels, and repeated metadata regressions.
`check:approved-copy` validates the customer-copy schema, exact counts, varied
two-sentence product descriptions, SEO constraints, runtime parity, packaging
exclusion, and false shared-record/publication/commerce authorization flags.
The generic CSV helpers are pure validation/serialization
code. Their synthetic exact-20 contracts emit only reviewed copy or structured
list-metafield columns; they do not read private files, write output, or call
Shopify.
