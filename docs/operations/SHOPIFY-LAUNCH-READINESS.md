# Shopify Opening Readiness

Updated: 2026-07-29 PDT

Status: **BLOCKED — the launch foundation and independently reviewed local
source hardening are reconciled and locally revalidated; accountable human
review, remote required checks, scoped product/storefront evidence, and
provider gates remain**

This no-secret decision ledger is the single launch-control record for
shop.mochirii.com. It turns the approved opening-readiness plan into explicit,
fail-closed gates without placing supplier, formula, counsel, customer,
credential, or provider-export material in Git.

Current release boundary:

- initial market: United States only;
- launch pattern: 72-hour low-promotion public soft launch;
- assortment: exactly the twenty products in
  apps/shopify-theme/content/approved-customer-copy.json;
- customer-copy revision `2026-07-18-v2` is a content-only public artifact;
  its consumed provider-write approval and verified 2026-07-18 readback are
  recorded separately in
  apps/shopify-theme/content/customer-facing-copy-approval-packet.md;
- candidate theme: unpublished theme 141514408011;
- `checkout_cta_enabled` remains false, which controls only whether this theme
  renders its cart-page checkout CTA and does not disable Shopify checkout;
- the 2026-07-18 readback recorded storefront password protection as enabled,
  but a fresh authenticated readback is still required;
- prepayment containment requires all three controls to be freshly proved: the
  exact candidate is unpublished, storefront password protection is enabled,
  and provider readback matches the source-bound package with its theme checkout
  CTA absent;
- the revised launch plan authorizes one reversible,
  theme-checkout-CTA-disabled upload
  of the exact reviewed package built from merged source to unpublished
  candidate theme 141514408011 after the rollback capture and stop conditions
  below are satisfied; this is prepayment staging, not publication or commerce
  approval;
- payment setup and payment testing are intentionally the final readiness
  phase and are not authorized by this document; and
- theme publication, password removal, real orders, purchases, and provider
  mutations outside the candidate-staging boundary still require the exact
  approval described below.

## Status And Evidence Rules

Use only these dispositions:

- **Pending**: acceptable current evidence is not recorded. This does not mean
  that evidence does not exist.
- **Ready**: the accountable reviewer accepted current evidence and recorded a
  sanitized pointer, review date, and result.
- **Blocked**: one or more required upstream decisions remain Pending or failed.
- **N/A (reviewed)**: a qualified reviewer documented why the field does not
  apply. Never use N/A as a convenience fallback.

Evidence is admissible only when it is formula- and SKU-specific, current for
the physical item that will ship, and reviewed by the accountable role. Broad
supplier marketing, a catalog-family document, a theme screenshot, or a green
code check cannot substitute for product-specific evidence.

Keep private evidence in the private credential and recovery boundary. The
public ledger may record only an opaque evidence ID, review date, reviewer
role, and pass/fail result. The private mapping for an evidence ID must retain
the product handle, evidence kind, source, capture date, review date, owner,
reviewer, currentness or expiry, and decision. Do not record a private
filename, supplier identifier, formula, cost, legal advice, signature, contact
detail, or credential here.

Generated Shopify readbacks, screenshots, logs, exports, and rollback captures
belong in the ignored .artifacts/operations/shopify boundary. A public status
may point to a sanitized capture ID, but not to secret-bearing output.

## Reconciliation Decisions

- Existing reachable public Git history was reviewed on 2026-07-19 and
  accepted without rewriting. The decision does not claim deletion from
  commits, pull-request references, caches, backups, or clones, and it is not
  authorization for a future rewrite.
- Public-copy revision `2026-07-18-v2` is immutable content. Provider-write
  approval and readback history are a separate audit record. The 2026-07-18
  shared-record write is Applied and read back, not Pending; its exact approval
  was consumed and cannot be reused.
- No current authorization follows from that historical write. Product facts,
  labels, formula/INCI, warnings, media, prices, inventory, fulfillment, tax,
  privacy, publication, checkout, payments, orders, password removal, and
  launch retain their own gates below.

## Universal Brand Identity Gate

The canonical Mochirii emblem design is the universal visual mark for the guild
site, storefront, and product logo/label review. The source reference is
`apps/web/public/assets/img/brand/emblem.webp` (1024 by 1024 pixels; SHA-256
`ED9FE4C522BC2B0D1C2072C1C098F241EE52F0CEEC0307CB531CE440E730BB60`).
The storefront derivative at
`apps/shopify-theme/assets/mochirii-emblem.webp` (224 by 224 pixels; SHA-256
`AD96D3428572404D9F5C1D7387669B5680920079CDF8CC637FDEBFA217D00DF4`)
may differ in dimensions and encoding but must preserve the same design. The
ignored 1024 by 1024 label-production PNG records 600 pixels per inch and SHA-256
`7392F30FC1F91221F4FE707CC48CE6C1F1C95D460DDCF798447A0F7857E25313`;
its decoded RGBA pixels exactly match the canonical WebP (decoded-pixel
SHA-256 `F5A54927590B1640D535612FE253F22C43C6946EAFD0B267888F0D50A6E01076`).
The theme uses the storefront derivative for its header, footer, password,
gift-card and controlled structured-data brand surfaces and uses the matching
favicon assets. Product labels, outer boxes and customer-facing media must
still be reviewed visually against the canonical emblem.

The commerce wordmark is exactly **Mochirii Cosmetics**. Do not substitute the
guild-style diacritic spelling or another company name on labels, storefront
merchandising, metadata, support or commerce correspondence. A missing,
redrawn, substituted or materially altered emblem, or any product wordmark
other than **Mochirii Cosmetics**, blocks that SKU until the approved sellable
unit and its media match. No label or product image is marked Ready by this
repository statement. A 2026-07-19 read-only candidate review found that the
Peptide Smoothing Serum package shown in representative storefront media uses
a different minimalist mark while the storefront header uses the canonical
emblem. That is a current parity failure for the SKU, not proof about the other
products. Peptide Smoothing Serum is blocked on correction and all twenty
remain Pending until label artwork, storefront mockups/media, physical labels
and outer boxes receive SKU-specific visual review.

## Ownership And Approval

| Role | Accountable work | Public assignment rule |
| --- | --- | --- |
| Store owner | Final business decision, market, assortment, launch and emergency rollback approvals | Keep the named human in the private launch packet |
| Product evidence custodian | Physical samples, labels, formula/INCI and supplier evidence | Keep names and source records private |
| Qualified cosmetics counsel or compliance reviewer | Product classification, warnings, claims, responsible-person and MoCRA decisions | Record only the reviewer role and disposition here |
| Shopify operator | Provider readbacks, rollback exports, theme staging and approved provider actions | One authenticated writer per change packet |
| Theme engineer | Source validation, accessibility, responsive, performance and browser QA | Work through a focused branch and protected pull request |
| Fulfillment and support owner | Inventory, shipping, returns, complaints and adverse-event operations | Keep personal contact details out of Git |
| Privacy owner or counsel | App/pixel inventory, notices, consent, opt-out and request procedure | Record only the reviewed outcome here |

No role may approve its own evidence where qualified independent review is
required. The store owner must confirm the named accountable humans privately
before any SKU or launch gate becomes Ready.

## Historical Provider And Storefront Baseline

An authenticated Shopify admin readback and storefront smoke were completed on
2026-07-18 PDT. No provider setting, product, location, menu, policy, app,
pixel, theme, domain, payment record, order, or credential was changed. The
only storefront mutation was an ephemeral cart add/update/remove sequence, and
that browser-session cart was cleared. No payment page was opened.

This is a dated historical baseline, not current provider proof. It does not
satisfy a gate that requires a fresh readback or evidence captured within the
gate's freshness window.

Facts recorded by that baseline:

- Shopify reports a Basic development store. The store currency is USD, the
  United States market is Active, and the Canada market is Draft.
- The catalog contains exactly twenty Active Mochirii Cosmetics products plus
  twenty archived legacy products. Every Active product is on one sales
  channel, has no catalog assignment, and reports **Inventory not tracked**.
- All twenty Active product records have a nonblank provider SKU and physical
  weight in grams, their admin/storefront prices match, and each record says
  **Shop location** is its single fulfilling location. This still requires the
  fulfillment owner to reconcile the intended supplier workflow and oversell
  behavior.
- The authenticated candidate storefront rendered all twenty Active products
  with USD prices. All twenty PDPs exposed size, suitability, directions, INCI,
  origin/certifications, nonblank image alt text, a canonical URL, and valid
  JSON-LD. This verifies rendered fields, not the source or legal sufficiency
  of those fields.
- Fifteen PDPs rendered the generic warning fallback. Five rendered specific
  warning text: Sensitive Skin Oil-to-Milk Cleanser, BiPhasic Make-up Remover,
  AHA Exfoliating Concentrate, All-in-One Facial Oil, and Hydrating Toner. None
  of those warning dispositions is cleared without label/formula review.
- Current live theme `141422395467` is **Mochirii Cosmetics Launch QA** version
  0.4.0. Candidate theme `141514408011` is **Mochirii Customer Copy QA
  2026-07-18 v2** version 0.5.0 and remains Draft. Storefront password
  protection remains enabled.
- The supplier delivery profile contains all twenty products, one fulfillment
  location, and thirty zones. Its United States weight tiers were displayed in
  euros in admin and have not been proven through checkout. The location list
  also contains an active placeholder Toronto location and a Shopify Test Data
  warehouse. These must be dispositioned before launch.
- Shopify Tax is enabled as a service, but the United States region reports
  **Not collecting**. Tax nexus, registrations, and collection behavior remain
  blocked on owner and qualified tax review.
- Installed apps comprise one supplier-fulfillment app, Search & Discovery,
  Knowledge Base, Shopify CLI Connector App, Theme Access, and one legacy store
  automation app. Customer events reports no app or custom pixels. Shopify
  Network Intelligence is enabled. Exact supplier and legacy-app names belong
  in the private release packet, not this public ledger.
- The automated privacy policy is enabled; the data-sharing opt-out page is
  active in fifteen US states; the provider Footer menu explicitly contains
  **Your Privacy Choices**; and the public opt-out route rendered successfully.
  The admin editor and public route showed different policy update dates.
  Checkout email marketing is preselected for US customers, and abandoned
  checkout email is enabled at ten hours for anyone. Legal and privacy-owner
  review of those settings and customer-visible behavior remains pending.
- The primary domain `shop.mochirii.com` is connected. Customer notifications
  use a public-domain sender, so Shopify reports that customers see a
  Shopify-generated sender address rather than a Mochirii-domain sender.
  `account.mochirii.com` and an older superseded storefront domain also remain
  connected and require an owner disposition before opening. Keep the retired
  brand/domain value out of public repository records.
- One organization owner is Active, but provider enforcement says a secure
  sign-in method is not required. Individual two-step-authentication status was
  not verified and remains a private owner check before payment activation.
- The then-current draft passed read-only smokes for five collections, a routine
  filter, ingredient and zero-result search, add/update/remove cart behavior,
  an absent theme checkout CTA, contact required-field focus, public policy and
  privacy routes, branded 404, and 360x800, 390x844, 768x1024, and 1440x900
  layouts with no horizontal overflow or broken main-content images. The new
  branch has not been uploaded to Shopify, so these are baseline provider
  smokes rather than acceptance of the source changes in this branch. The
  absent theme CTA did not prove that Shopify checkout or direct provider
  routes were disabled.
- A prior authenticated preview audit intermittently reached Shopify loading
  error pages that recovered after refresh. The behavior remains unclassified
  until controlled candidate-theme and post-password customer-route smokes pass.

## Twenty-SKU Release Ledger

The title and handle below are the only public SKU identity available in the
approved copy contract. Nonblank provider SKUs were read back, but the exact
product/variant-to-evidence mapping and release disposition remain pending.
Provider identifiers must not be invented or copied from private evidence into
this file.

Each provider-readback cell below records only sanitized rendered/admin facts.
It does not clear SKU/variant identity, inventory policy, physical-unit parity,
formula/label provenance, claims, warnings, fulfillment, or regulatory
readiness.

| # | Product identity | Physical sample | Label/formula | INCI | Directions | Warnings decision | Origin/certs | Responsible person | Safety substantiation | MoCRA registration/listing/exemption | Claims/counsel | Provider readback | Release disposition |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Peptide Smoothing Serum (peptide-smoothing-serum) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $48.99 USD; inventory untracked; generic warning fallback; representative package mark differs from canonical emblem | Blocked |
| 2 | Natural Retinol Alternative Oil Serum (natural-retinol-alternative-oil-serum) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $50.99 USD; inventory untracked; generic warning fallback | Blocked |
| 3 | Vitamin C Serum (vitamin-c-serum) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $47.99 USD; inventory untracked; generic warning fallback | Blocked |
| 4 | Hyaluronic Day Cream (hyaluronic-day-cream) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $50.99 USD; inventory untracked; generic warning fallback | Blocked |
| 5 | Moisturising Day Cream (moisturising-day-cream) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $49.99 USD; inventory untracked; generic warning fallback | Blocked |
| 6 | Double Hydration Boost Gel (double-hydration-boost-gel) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $39.99 USD; inventory untracked; generic warning fallback | Blocked |
| 7 | Sensitive Skin Oil-to-Milk Cleanser (sensitive-skin-oil-to-milk-cleanser) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $51.99 USD; inventory untracked; warning displayed | Blocked |
| 8 | BiPhasic Make-up Remover, Fragrance Free (biphasic-makeup-remover-fragrance-free) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $47.99 USD; inventory untracked; warning displayed | Blocked |
| 9 | Collagen Night Cream (collagen-night-cream) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $53.99 USD; inventory untracked; generic warning fallback | Blocked |
| 10 | Ceramide Barrier Night Cream (ceramide-barrier-night-cream) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $53.99 USD; inventory untracked; generic warning fallback | Blocked |
| 11 | Niacinamide Gel Moisturiser (niacinamide-gel-moisturiser) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $41.99 USD; inventory untracked; generic warning fallback | Blocked |
| 12 | Gentle Cleansing Milk (gentle-cleansing-milk) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $36.99 USD; inventory untracked; generic warning fallback | Blocked |
| 13 | AHA Exfoliating Concentrate (aha-exfoliating-concentrate) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $43.99 USD; inventory untracked; warning displayed | Blocked |
| 14 | All-in-One Facial Oil (all-in-one-facial-oil) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $47.99 USD; inventory untracked; warning displayed | Blocked |
| 15 | Retinol Alternative Moisturiser (retinol-alternative-moisturiser) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $39.99 USD; inventory untracked; generic warning fallback | Blocked |
| 16 | Hydrating Toner (hydrating-toner) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $33.99 USD; inventory untracked; warning displayed | Blocked |
| 17 | Sensitive Face & Body Cleanser (sensitive-face-body-cleanser) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $27.99 USD; inventory untracked; generic warning fallback | Blocked |
| 18 | Cleansing Foam (cleansing-foam) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $36.99 USD; inventory untracked; generic warning fallback | Blocked |
| 19 | Caffeine Gel Booster (caffeine-gel-booster) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $39.99 USD; inventory untracked; generic warning fallback | Blocked |
| 20 | Smoothing Eye Cream (smoothing-eye-cream) | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Active; $42.99 USD; inventory untracked; generic warning fallback | Blocked |

A SKU becomes **Ready** only when every evidence cell is Ready or N/A
(reviewed), the provider readback matches the approved physical unit, and no
open claim, label, safety, channel, inventory, or fulfillment conflict remains.
The release is fail-closed: all twenty SKU rows must be Ready.

## Prepayment And Payment-Dependent Acceptance

Prepayment acceptance proves configuration and customer presentation without
enabling the theme checkout CTA, configuring a payment provider, creating an
order, or incurring a charge. It does not claim server-side checkout is
disabled. It includes:

- exact twenty-SKU facts, media, variant mapping, channel, weight, inventory
  source, location, and fulfillment-route readbacks;
- USD contiguous-US shipping-zone, eligibility, weight-tier, processing, and
  transit configuration compared with the approved private matrix, including
  a provider rate-preview tool when it does not create a checkout or order;
- reviewed tax/nexus decisions and the resulting configuration readback,
  without treating a platform estimate as legal advice;
- privacy, consent, apps, domains, account security, notification-template,
  sender-domain, support, policy, and operational review; and
- the source-bound unpublished candidate-theme route, absent cart checkout CTA,
  accessibility, performance, metadata, search, filter, error, and rollback
  acceptance defined below.

Payment-dependent acceptance begins only in Gate F. It includes end-to-end
checkout address quotation, final tax and shipping calculations, successful
and declined payment behavior, inventory decrement, order creation,
notifications, cancellation, refund, fulfillment handoff, payout, and any
low-value real transaction. A prepayment configuration readback must not be
reported as proof of these payment-dependent behaviors.

If a purported prepayment test would enable checkout or payments, create a
checkout/order, place a manual fulfillment order, send a customer message, or
incur a charge, stop and move it to the separately approved Gate F matrix.

The aggregate prepayment gate is intentionally stricter than a checklist. It
requires a clean `main` checkout at the evidenced merge commit and tree,
required checks on that merge commit (with `Supabase Preview` permitted to be
`Skipped` only when the repository runbook permits it), and a candidate ZIP
whose complete runtime file set and digests match the versioned active-source
manifest. The sealed migration manifest is historical evidence and is not the
current package hash authority. Product review evidence is tied to the exact v3
contract and per-SKU facts, formula,
variant, emblem, wordmark and role-keyed media identities. A deterministic
Shopify Admin GraphQL 2026-07 projection additionally requires exact title,
serialized description, SEO, all controlled metafields, collections, ordered
media, alt text, original-media hash and applicable emblem/wordmark parity.
The associated formula, label, box, media, authentication, account-plan and
catalog hashes must resolve to real untracked files in the ignored operations
boundary through the private artifact index, and image evidence must actually
decode with valid dimensions. The bundle, every evidence envelope, candidate
ZIP and each standalone private configuration artifact must also be ignored
and untracked. Launch pages,
mandatory-name exceptions and six search-result expectations are tied to their
versioned source contracts. Fresh rendered observations use the configured
privacy opt-out route. Shipping binds the supplier/carrier matrix to a hashed
authenticated Shopify Admin rate-table export, requires a contiguous
`[minimum, maximum)` schedule beginning at zero with an open-ended final tier,
and verifies just-below, at and just-above observations for every positive
threshold. The representative carts, unsupported-region cases and recorded
PO-box behavior must show exact positive USD supplier-to-store rate parity and
no free-shipping threshold. The approved exact
retail-price rule additionally requires a fresh
authenticated private US/USD catalog snapshot and exact formula/source-record
linkage; costs and raw evidence remain outside public Git.

The versioned provider-surface contract pins the universal emblem and exact
wordmark, primary customer domain, home and collections-index presentation,
pages, five collection identities, navigation, controlled filters, customer
settings, policies, notification presentation and sender requirements. Its
provider-ready mode requires an ignored readback bound to the exact candidate
theme and package. Every private rendered body is tied to its route/content
hash and scanned through the same entity-decoding and inline-markup-aware
Mochirii language policy. Accountable detected-name attestations must map
one-to-one to exact route-specific mandatory exceptions, including previously
unknown manufacturer, certifier, carrier or privacy names. The real dedicated
hero, featured products, five rendered collection bodies/media/memberships,
five policies, three notifications and sender authentication remain Pending.

## Non-Payment Readiness Checklist

All items in this section must be Ready before payment setup begins.

### Product And Compliance

| ID | Required decision | Accountable role | Status |
| --- | --- | --- | --- |
| PC-01 | Reconcile each shipped sample, primary label and outer packaging to the corresponding ledger row, canonical Mochirii emblem and exact Mochirii Cosmetics commerce wordmark | Product evidence custodian | Pending |
| PC-02 | Confirm actual formula, full INCI, directions, warning text or documented none-required decision, size and origin/certification display for every SKU | Product evidence custodian plus compliance reviewer | Pending |
| PC-03 | Confirm responsible-person contact and safety-substantiation record for every SKU | Compliance reviewer | Pending |
| PC-04 | Record applicable facility-registration evidence and each product/formula listing, exemption, renewal and change-reporting disposition under MoCRA | Compliance reviewer | Pending |
| PC-05 | Review cosmetic-versus-drug classification and every express or implied storefront, packaging, review, social and promotional claim | Qualified cosmetics counsel or compliance reviewer | Pending |
| PC-06 | Confirm the provider page, variant and media exactly match the approved physical unit, canonical emblem and exact Mochirii Cosmetics wordmark for all twenty SKUs | Shopify operator plus product evidence custodian | Pending |

### Commerce And Fulfillment

| ID | Required decision | Accountable role | Status |
| --- | --- | --- | --- |
| CF-01 | Read back exactly twenty intended active products and their provider SKU/variant identifiers, prices, USD currency, inventory and channel status | Shopify operator | Blocked — 20 Active products, USD prices, nonblank SKUs and weights were confirmed; inventory remains untracked and final variant release disposition is Pending |
| CF-02 | Verify inventory source of truth, location assignment, oversell policy, package weights and fulfillment workflow | Fulfillment owner | Blocked — all 20 have weights but report inventory untracked and Shop location fulfillment; supplier routing, oversell behavior and placeholder/test locations require review |
| CF-03 | Verify the prepayment USD shipping configuration, contiguous-US eligibility, weight tiers, processing and transit promises against representative supported and unsupported addresses without creating a checkout or order; reserve end-to-end checkout quotation for Gate F | Shopify operator plus fulfillment owner | Blocked — US profile tiers were visible in EUR; prepayment configuration parity and the later Gate F checkout test are both unproven |
| CF-04 | Document reviewed US tax registrations, nexus and collection configuration; do not treat Shopify estimates as legal advice | Store owner plus tax professional | Blocked — Shopify reports United States Not collecting |
| CF-05 | Reconcile shipping, return, cancellation, damaged, incorrect, incomplete and carrier-lost promises to the real operating process | Fulfillment owner plus counsel | Pending |
| CF-06 | Verify customer-facing support routes, coverage, response ownership and order-number handling without exposing personal contacts | Support owner | Blocked — contact route works, but branded sender, coverage ownership and escalation evidence remain Pending |
| CF-07 | Disposition every connected commerce/account domain and verify secure owner access before payment activation | Store owner plus Shopify operator | Blocked — an older superseded storefront domain remains connected; provider enforcement says a secure sign-in method is not required, and individual two-step authentication was not verified |

### Privacy And Customer Safety

| ID | Required decision | Accountable role | Status |
| --- | --- | --- | --- |
| PS-01 | Inventory all installed apps, pixels, analytics, data recipients and Shopify privacy features | Privacy owner plus Shopify operator | Blocked — six apps, no pixels and Network Intelligence enabled were read back; data-recipient and owner review remain Pending |
| PS-02 | Review the automated privacy policy against actual settings and the US-only launch; the 2026-07-18 readback proves enablement, not legal sufficiency | Privacy owner or counsel | Blocked — automated policy is enabled and rendered, but admin/public update dates differed and legal review remains Pending |
| PS-03 | Verify applicable consent banner, opt-out page, Global Privacy Control behavior, marketing consent and privacy-request procedure | Privacy owner | Blocked — provider opt-out route and automated regions were verified; GPC and request operations remain Pending, while US checkout email marketing is preselected and abandoned-checkout email is enabled at ten hours for anyone pending review |
| PS-04 | Establish complaint, product-quality and serious adverse-event intake, retention, escalation and reporting workflow | Compliance reviewer plus support owner | Pending |
| PS-05 | Prepare approved customer-notification and escalation language for safety, fulfillment, privacy and payment incidents | Store owner plus accountable owner | Pending |

### Theme, Accessibility And Release Evidence

| ID | Required decision | Accountable role | Status |
| --- | --- | --- | --- |
| QA-01 | Pass npm ci, npm run check, npm run theme:package and git diff --check on the reviewed commit | Theme engineer | Blocked — PR #480 was squash-merged through protected `main` on 2026-07-24 as `d8a4b578cdf3619e886de415ee403fda220d9a60` after its source checks passed. GitHub records no formal PR review. A fresh candidate package still must be rebuilt from the eventual approved release commit, rerun through the complete current checks, and receive accountable review before upload. |
| QA-02 | Verify all twenty PDPs expose the reviewed facts without generic warning or other evidence fallbacks | Theme engineer plus product evidence custodian | Blocked — the local source removes generic fact, INCI and warning fallbacks, but the 2026-07-18 candidate baseline still rendered a generic warning on 15 PDPs; all twenty fact records and the revised candidate rendering remain Pending |
| QA-03 | Verify five collections, filters, ingredient search, misspellings, sold-out state, cart, contact form, policies, privacy choices and branded 404 | Theme engineer | Blocked — the source now pins reviewed expected sets for `moisturizer`, `moisturiser`, `niacinimide`, `hyaluronic`, `retinol` and `cleanser`, plus a zero-result fixture; candidate readbacks, configured Privacy Choices parity, sold-out and server-error observations remain Pending because the branch is not on the candidate theme |
| QA-04 | Pass keyboard, screen-reader announcements, 200 percent zoom, focus order, error handling, contrast and touch navigation at 360x800, 390x844, 768x1024 and 1440x900 | Theme engineer | Blocked — viewport, overflow, broken-image and code-level contrast checks passed; assistive-technology and 200 percent zoom acceptance remain Pending |
| QA-05 | Run authenticated-preview Lighthouse checks for home, collection, PDP and cart; resolve confirmed LCP-priority and unnecessary-script problems | Theme engineer | Blocked — branch removes unnecessary eager/high product-card images; authenticated Lighthouse evidence remains Pending |
| QA-06 | Verify canonical URLs, metadata, Product and Breadcrumb structured data, social cards, sitemap and password-safe robots behavior | Theme engineer plus Shopify operator | Blocked — all 20 PDP canonicals and JSON-LD parsed, and representative home, collection and PDP metadata and social cards passed; sitemap, password-safe robots and branch-candidate acceptance remain Pending |
| QA-07 | Capture fresh provider readbacks and a restorable export of the current live theme plus the existing candidate theme before the theme-checkout-CTA-disabled candidate upload; capture scoped shared records/settings separately when their own mutation packet is approved | Shopify operator | Blocked — live/candidate theme IDs and sanitized settings were read back, but no approved rollback export packet was created |
| QA-08 | Record exact candidate theme 141514408011, human-reviewed merged commit, source tree, package artifact and rollback theme in the private release packet | Shopify operator plus theme engineer | Blocked — PR #480 is merged as `d8a4b578cdf3619e886de415ee403fda220d9a60`; candidate 141514408011, rollback theme 141422395467 and provisional local package Mochirii Cosmetics-0.6.0.zip (SHA-256 DBB772F5AA07ADED833E27F9CE435DE8DB0CA60A087D6ABFC54E6EE939C9806F; 75,251 bytes) are recorded. GitHub records no formal PR review, and the provisional package remains explicitly non-final, unuploaded and not bound to the eventual approved release commit. |
| QA-09 | Upload only the exact merged-source package to unpublished candidate theme 141514408011 with `checkout_cta_enabled` false, preserve Draft status, and verify the source binding, route matrix, absent theme checkout CTA and no out-of-scope shared-record changes without claiming Shopify checkout is server-disabled | Shopify operator plus theme engineer | Blocked — the staging boundary is authorized, but the reviewed merged package, rollback capture, upload and post-write readback remain Pending |

## Approval Gates

| Gate | Entry condition | Exit evidence | Current disposition |
| --- | --- | --- | --- |
| A — Product evidence | Exactly twenty canonical rows | Every SKU cell Ready or N/A (reviewed), with every release row Ready | Blocked |
| B — Non-payment commerce | Gate A Ready | CF-01 through CF-07 Ready | Blocked |
| C — Privacy and safety operations | Gate A Ready | PS-01 through PS-05 Ready | Blocked |
| D — Theme and storefront QA | Gates A through C Ready | QA-01 through QA-06 Ready on the candidate commit and theme | Blocked |
| E — Release and rollback preparation | Gate D Ready | QA-07 through QA-09 Ready; every out-of-scope provider change separately approved | Blocked |
| F — Final payment setup and order lifecycle | Every non-payment gate Ready | Payment verification and required test-order matrix pass; test mode disabled | Intentionally deferred final phase |
| G — Public soft launch | Gate F Ready | Exact publication/password-removal approval and successful release smoke | Blocked |

Updating a checklist or ledger status is a documentation change, not provider
authorization. Every provider mutation packet must name the exact store,
record or setting, intended value, writer, rollback capture, verification, and
stop condition.

## Theme-Checkout-CTA-Disabled Candidate Staging Boundary

The revised launch plan authorizes exactly one prepayment staging class: upload
the reviewed package built from merged `main` to existing unpublished candidate
theme `141514408011` for `shop.mochirii.com`. The upload may occur before the
product and operational gates become Ready so candidate QA can proceed, but it
cannot make any launch gate Ready by itself. QA-09 may therefore be performed
early only under the entry conditions below; Gate E still cannot become Ready
until Gate D is Ready and QA-07 through QA-09 all pass.

- **Entry:** PR #480 satisfied the protected source-merge portion on 2026-07-24,
  but did not make the provisional package releasable. Before any candidate
  upload, the exact release commit or scoped successor has accountable review,
  current required checks are green, and a new package is built from that
  merged source with its commit, tree and SHA-256 recorded privately.
- **Before state:** theme `141514408011` is Draft; the current candidate and
  live-theme exports are restorable; storefront password protection is on;
  `checkout_cta_enabled` is false; the current live theme is identified without
  changing it; and fresh authenticated provider evidence supports each fact.
- **Allowed write:** one authenticated Shopify operator replaces only the code
  and bundled settings of theme `141514408011` with the exact package. No
  product, variant, price, inventory, location, market, shipping, tax, policy,
  menu, app, notification, domain, payment, password, order, or live-theme
  record is in scope.
- **Required after state:** theme `141514408011` remains Draft,
  `checkout_cta_enabled` remains false, password protection and the live theme
  are unchanged, and a fresh candidate readback proves Draft/unpublished state
  and matches the source-bound package. The theme setting alone is not checkout
  containment.
- **Verification:** record sanitized theme identity/status and source binding;
  verify the theme checkout CTA is absent without reporting Shopify checkout as
  server-disabled, and run the candidate route, search/filter, cart,
  accessibility, performance, metadata, structured-data, error and responsive
  matrices. Evidence remains private or under ignored `.artifacts/operations`.
- **Rollback:** restore the captured pre-write candidate export to theme
  `141514408011`; never publish, delete a theme, alter the live theme, or delete
  provider records as rollback.
- **Stop conditions:** stop before writing if review, merge, required checks,
  source/package binding, exports, target identity, Draft status, or
  theme-checkout-CTA-disabled proof is missing; stop on an unexpected
  permission or broader-write prompt; roll back if the target becomes
  publishable/live, the theme checkout CTA is exposed, source parity fails, or
  an out-of-scope record changes.

This staging authorization does not cover a repeat upload after a failed or
superseded package. A new exact packet is required for another write. It also
does not authorize human review, merge approval, shared-record mutation,
publication, checkout, payment setup, orders, password removal, or launch.

## Final Payment Phase Boundary

Do not begin payment setup until Gates A through E are Ready and the store
owner gives an exact approval naming the store and payment action. That final
phase uses this separate payment-dependent checklist:

| ID | Payment-dependent acceptance | Current disposition |
| --- | --- | --- |
| PF-01 | Confirm account security and two-step authentication, then complete plan, payment-provider business and bank verification privately without recording secrets or identity documents in Git | Intentionally deferred |
| PF-02 | With the password still enabled and the candidate unpublished, verify representative supported and unsupported checkout addresses, shipping quotations and final tax calculations against the approved matrices | Intentionally deferred |
| PF-03 | Verify USD, statement descriptor, payout status, fraud controls and any reserve or hold; run successful, declined and gateway-failure payment cases | Intentionally deferred |
| PF-04 | Carry the test matrix through inventory decrement, order creation, customer notifications, cancellation, refund and integrated fulfillment handoff | Intentionally deferred |
| PF-05 | Disable test mode and record a sanitized provider readback proving the final non-test configuration | Intentionally deferred |
| PF-06 | Perform a low-value real capture, payout or refund only after a separate approval that names the purchase and maximum cost | Intentionally deferred — separate cost approval required |

The theme checkout CTA remains disabled until the final payment phase is
verified and an approved source change sets `checkout_cta_enabled` to true.
Shopify checkout availability remains provider-controlled and requires its own
fresh readback and payment-dependent evidence.

## Release, Rollback And 72-Hour Soft Launch

### Pre-release

1. Freeze the twenty-SKU decision ledger and retain the approved evidence
   manifest privately.
2. Confirm a clean reviewed commit, green required checks and a package built
   from that commit.
3. Capture fresh no-secret provider readbacks and a restorable export before
   any shared-record write.
4. Record the current live theme and candidate theme IDs, settings and
   rollback operator privately.
5. Complete Gate F under its separate approval.

### Controlled release

1. Merge the focused checkout-CTA-enabled source change only after Gate F passes.
2. Push that exact package only to candidate theme 141514408011.
3. Repeat the route, accessibility, SEO, cart and order-lifecycle smokes.
4. Under exact approval, publish candidate theme 141514408011.
5. Verify theme and checkout behavior while password protection remains
   enabled.
6. Remove the storefront password last under a separate exact approval.
7. Capture the public baseline without customer or payment data.

### Soft-launch monitoring

Keep promotion low for 72 hours. Review at opening, one hour, four hours, and
24, 48 and 72 hours:

- orders, declines, payouts, fraud review and duplicate-charge reports;
- inventory, oversells, fulfillment, shipping rates and tax anomalies;
- storefront route, cart, checkout and notification failures;
- privacy requests, support contacts, complaints and adverse events;
- accessibility, error signals, and p75 Core Web Vitals targets of LCP at or
  below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below
  0.1; and
- any mismatch between the shipped unit and the approved SKU ledger.

The store owner's release approval must also pre-authorize the named operator
to reapply password protection and restore the previous theme when a stop
condition occurs. Stop promotion and roll back for a label/formula/safety
conflict, systemic checkout or payment failure, incorrect tax or shipping
charges, inventory oversell, privacy-control failure, or a material storefront
regression. Preserve valid order records; never delete orders or evidence as a
rollback method.

After rollback, record the trigger, time, operator, restored state, customer
impact, evidence pointer and required corrective gate. Reopening requires a
fresh exact approval.

## Authoritative Source Anchors

Use current primary sources and qualified professional advice when completing
the gates:

- [Shopify launch preparation](https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-prepare-for-launch)
- [Shopify Payments testing](https://help.shopify.com/en/manual/payments/shopify-payments/testing-shopify-payments)
- [Shopify customer privacy settings](https://help.shopify.com/en/manual/privacy-and-security/privacy/customer-privacy-settings/privacy-settings)
- [FDA Modernization of Cosmetics Regulation Act](https://www.fda.gov/cosmetics/cosmetics-laws-regulations/modernization-cosmetics-regulation-act-2022-mocra)
- [FDA cosmetics labeling requirements](https://www.fda.gov/cosmetics/cosmetics-labeling-regulations/summary-cosmetics-labeling-requirements)
- [FDA cosmetics under US law](https://www.fda.gov/cosmetics/cosmetics-laws-regulations/cosmetics-us-law)
- [FTC Health Products Compliance Guidance](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance)
- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [Shopify theme accessibility guidance](https://shopify.dev/docs/storefronts/themes/best-practices/accessibility)

This ledger is an operational control, not legal, tax, medical, or regulatory
advice. Qualified reviewers remain responsible for their decisions.
