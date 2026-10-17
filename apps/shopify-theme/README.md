# Mochirii Cosmetics theme

The storefront theme for Mochirii Cosmetics, with product pages, collections,
navigation, cart presentation, and reviewed customer copy.

The theme keeps the selected twenty-product catalog visible for preview.
Product, packaging, and store launch reviews are separate. Checkout remains
disabled until the store’s launch approval.

## Contents

- `assets`, `blocks`, `config`, `layout`, `locales`, `sections`,
  `snippets`, and `templates`: Online Store 2.0 theme files.
- [Approved customer copy](content/approved-customer-copy.json): product,
  collection, page, and search-description copy; excluded from the theme package.
- [Package scripts](package.json): theme checks, packaging, and license inventory.
- [Migration manifest](MIGRATION-MANIFEST.json): source provenance.

Private supplier records, costs, samples, credentials, and store exports do
not belong in this directory.

## Check and package

Use the repository’s pinned Node.js version. Run from this directory:

~~~sh
npm ci
npm run check
npm run theme:package
git diff --check
~~~

Packaging creates an ignored archive; it does not upload or publish the theme.
`npm run check:sbom` generates and validates its software bill of materials.

The copy helpers only validate and serialize reviewed data. Product imports
must preserve the current option names and values from a fresh export; a
generated CSV does not authorize an import.

## Release rules

Theme publication, storefront-password changes, checkout, payments, orders,
domains, and changes to shared product or policy records require separate
approval. CI never performs these actions.

See the [migration guide](../../docs/shopify-theme-migration-2026-07-16.md),
[directory guidance](AGENTS.md), and [repository overview](../../README.md).
