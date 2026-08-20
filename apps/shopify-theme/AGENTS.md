# Shopify Theme Guidance

- Keep every Mochirii storefront artifact in `Mochirii-Wushu/Mochirii-Website`. Never copy it into another brand repository or reuse another brand's assets, identifiers, deployment configuration, or operational data.
- This public directory owns only the Mochirii Cosmetics storefront theme.
- Keep runtime theme code under `assets`, `blocks`, `config`, `layout`,
  `locales`, `sections`, `snippets`, and `templates`.
- Never add supplier records, costs, source or mockup identifiers, samples,
  counsel material, admin exports, credentials, private evidence, or internal
  launch ledgers.
- Public operator tooling must remain pure and generic: no real product facts,
  source identifiers, private paths, provider reads/writes, or mutation calls.
- Versioned customer-copy contracts may live under `content`, but they must
  remain excluded from the packaged theme and may not imply shared-record
  mutation, theme publication, or commerce approval.
- `MIGRATION-MANIFEST.json` is byte-sealed migration-history evidence. Never
  regenerate or edit it. Current runtime, generic-tooling, and public-contract
  hashes belong only in `ACTIVE-SOURCE-MANIFEST.v1.json`; refresh that file with
  `npm run generate:active-source-manifest` after an approved source change.
- Keep the twenty customer-approved products visible and keep
  `checkout_cta_enabled` false. This setting controls only the theme cart CTA;
  it does not disable Shopify checkout or replace provider readback. Never add
  a public internal-metadata control or restore the obsolete
  `product_publication_approved` gate. Password removal, checkout or payment
  activation, orders, shared product/page/policy mutations, domains, and paid
  resources require separate explicit approval and must not be automated by CI.
- Run `npm ci`, `npm run check`, `npm run theme:package`, and
  `git diff --check` before handoff.
