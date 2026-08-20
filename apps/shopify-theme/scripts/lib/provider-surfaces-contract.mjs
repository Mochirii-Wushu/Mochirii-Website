import { createHash } from "node:crypto";
import {
  customerLanguageCompanyMatches,
  customerLanguageIssueCategories,
  exactCustomerLanguageCompanyName,
  normalizeCustomerLanguageForPolicy,
} from "./launch-content-contracts.mjs";
import { SHOPIFY_PUBLICATION_MAPPING } from "./product-facts-contract.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u;
const PRIVATE_READBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const PROVIDER_SURFACE_PUBLIC_ROOT_KEYS = Object.freeze([
  "$schema",
  "schema_version",
  "revision",
  "locale",
  "brand",
  "market",
  "currency",
  "brand_identity",
  "homepage",
  "collections_index",
  "pages",
  "collections",
  "navigation",
  "search_and_filters",
  "policies",
  "settings",
  "notifications",
]);

const link = (order, label, destination) => ({ order, label, destination, children: [] });

export const EXPECTED_HEADER_NAVIGATION = Object.freeze([
  link(1, "Shop", "/collections/mochirii-cosmetics"),
  link(2, "Product type", "/collections/mochirii-cosmetics#shop-filters"),
  link(3, "Skin needs", "/collections/mochirii-cosmetics#shop-filters"),
  link(4, "Routine", "/collections#routine-collections"),
  link(5, "About", "/pages/about"),
  link(6, "Help", "/pages/faq"),
  link(7, "Search", "/search"),
  link(8, "Cart", "/cart"),
]);

export const EXPECTED_FOOTER_NAVIGATION = Object.freeze([
  {
    order: 1,
    identity: "guild-link",
    heading: null,
    links: [link(1, "Visit Mochirii Guild", "https://mochirii.com")],
  },
  {
    order: 2,
    identity: "support",
    heading: "Support",
    links: [
      link(1, "Contact", "/pages/contact"),
      link(2, "FAQ", "/pages/faq"),
      link(3, "About", "/pages/about"),
      link(4, "Ingredients & Standards", "/pages/ingredients-standards"),
      link(5, "Accessibility", "/pages/accessibility"),
    ],
  },
  {
    order: 3,
    identity: "policies",
    heading: "Policies",
    links: [
      link(1, "Shipping", "/policies/shipping-policy"),
      link(2, "Returns", "/policies/refund-policy"),
      link(3, "Privacy", "/policies/privacy-policy"),
      link(4, "Terms", "/policies/terms-of-service"),
      link(5, "Privacy Choices", "/pages/data-sharing-opt-out"),
    ],
  },
]);

export const EXPECTED_SEARCH_FILTERS = Object.freeze([
  { order: 1, label: "Product type", param_name: "filter.p.m.custom.product_type", type: "list" },
  { order: 2, label: "Skin needs", param_name: "filter.p.m.custom.appearance_concerns", type: "list" },
  { order: 3, label: "Skin type", param_name: "filter.p.m.custom.skin_type", type: "list" },
  { order: 4, label: "Routine step", param_name: "filter.p.m.custom.routine_step", type: "list" },
  { order: 5, label: "Key ingredients", param_name: "filter.p.m.custom.key_ingredients", type: "list" },
  { order: 6, label: "Availability", param_name: "filter.v.availability", type: "boolean" },
  { order: 7, label: "Price", param_name: "filter.v.price", type: "price_range" },
]);

export const EXPECTED_POLICIES = Object.freeze([
  { order: 1, identity: "shipping-policy", customer_label: "Shipping", route: "/policies/shipping-policy", expected_title: "Shipping policy" },
  { order: 2, identity: "refund-policy", customer_label: "Returns", route: "/policies/refund-policy", expected_title: "Refund policy" },
  { order: 3, identity: "privacy-policy", customer_label: "Privacy", route: "/policies/privacy-policy", expected_title: "Privacy policy" },
  { order: 4, identity: "terms-of-service", customer_label: "Terms", route: "/policies/terms-of-service", expected_title: "Terms of service" },
  { order: 5, identity: "privacy-choices", customer_label: "Privacy Choices", route: "/pages/data-sharing-opt-out", expected_title: "Privacy Choices" },
]);

export const EXPECTED_SETTINGS = Object.freeze({
  checkout_cta_enabled: false,
  gift_cards_enabled: false,
  gift_cards_listed: false,
  gift_card_route: "/products/gift-card",
  gift_card_route_http_status: 404,
  customer_accounts: "optional",
  privacy_choices_enabled: true,
  privacy_choices_menu_visible: true,
  privacy_choices_route: "/pages/data-sharing-opt-out",
  password_protection_enabled: true,
  candidate_theme_admin_status: "Draft",
  candidate_theme_published: false,
  background_color: "#f7f8f5",
  text_color: "#13231d",
  accent_color: "#1f6b58",
  default_meta_description: "Shop Mochirii Cosmetics skincare by routine, with ingredients, directions, skin suitability, and product details for every formula.",
  storefront_mode_text: "Skincare by routine",
  empty_catalog_heading: "No products found.",
  empty_catalog_body: "Clear a filter or browse all skincare.",
  footer_summary: "Cleansers, hydrating products, brightening products, and moisturizers for daily skincare routines.",
  footer_section_summary: "Cleansers, hydrating products, brightening products, and moisturizers for daily skincare routines.",
  header_main_menu_handle: "main-menu",
  footer_menu_handle: "footer",
  password_eyebrow: "Mochirii Cosmetics",
  password_heading: "The skincare shop is opening soon.",
  password_intro: "Enter the password to preview the store.",
  social_share_image_setting: "blank-theme-fallback",
  social_share_image_fallback_sha256: "05289a0d2887d3ce1c7b7e2e7343379392ce89da5afac8082faf896a0ae39d82",
  primary_customer_domain: "shop.mochirii.com",
  primary_customer_url: "https://shop.mochirii.com",
  shop_name: "Mochirii Cosmetics",
  currency: "USD",
});

export const EXPECTED_NOTIFICATION_IDENTITIES = Object.freeze([
  { order: 1, identity: "order-confirmation", customer_label: "Order confirmation" },
  { order: 2, identity: "shipping-confirmation", customer_label: "Shipping confirmation" },
  { order: 3, identity: "delivery-confirmation", customer_label: "Delivery confirmation" },
]);

export const EXPECTED_NOTIFICATION_SENDER = Object.freeze({
  display_name: "Mochirii Cosmetics",
  approval_status: "pending",
  approved_sender_address_sha256: null,
  approved_sender_domain_sha256: null,
});

export const EXPECTED_THEME_BINDINGS = Object.freeze([
  { order: 1, surface: "storefront-header-logo", source_path: "sections/header.liquid", relation: "logo", media_type: "image/webp", sizes: "56x56" },
  { order: 2, surface: "storefront-footer-logo", source_path: "sections/footer.liquid", relation: "logo", media_type: "image/webp", sizes: "56x56" },
  { order: 3, surface: "password-page-logo", source_path: "sections/main-password.liquid", relation: "logo", media_type: "image/webp", sizes: "56x56" },
  { order: 4, surface: "gift-card-logo", source_path: "templates/gift_card.liquid", relation: "logo", media_type: "image/webp", sizes: "56x56" },
  { order: 5, surface: "structured-data-logo", source_path: "snippets/structured-data.liquid", relation: "logo", media_type: "image/webp", sizes: null },
  { order: 6, surface: "storefront-favicon", source_path: "layout/theme.liquid", relation: "icon", media_type: "image/webp", sizes: "224x224" },
  { order: 7, surface: "password-favicon", source_path: "layout/password.liquid", relation: "icon", media_type: "image/webp", sizes: "224x224" },
]);

export const EXPECTED_PROVIDER_LOGO_SURFACES = Object.freeze([
  "brand-logo",
  "checkout-logo",
  "customer-account-logo",
]);

export const EXPECTED_STORE_PRODUCT_HANDLES = Object.freeze([
  "peptide-smoothing-serum",
  "natural-retinol-alternative-oil-serum",
  "vitamin-c-serum",
  "hyaluronic-day-cream",
  "moisturising-day-cream",
  "double-hydration-boost-gel",
  "sensitive-skin-oil-to-milk-cleanser",
  "biphasic-makeup-remover-fragrance-free",
  "collagen-night-cream",
  "ceramide-barrier-night-cream",
  "niacinamide-gel-moisturiser",
  "gentle-cleansing-milk",
  "aha-exfoliating-concentrate",
  "all-in-one-facial-oil",
  "retinol-alternative-moisturiser",
  "hydrating-toner",
  "sensitive-face-body-cleanser",
  "cleansing-foam",
  "caffeine-gel-booster",
  "smoothing-eye-cream",
]);

export const EXPECTED_HOMEPAGE = Object.freeze({
  featured_collection_handle: "mochirii-cosmetics",
  seo_title: "Mochirii Cosmetics | Skincare by Routine",
  seo_description: "Shop Mochirii Cosmetics skincare by routine, with ingredients, directions, skin suitability, and product details for every formula.",
  temporary_hero_fallback_asset_path: "assets/mochirii-page-password.webp",
  temporary_hero_fallback_sha256: "05289a0d2887d3ce1c7b7e2e7343379392ce89da5afac8082faf896a0ae39d82",
  temporary_hero_fallback_alt: "Abstract green Mochirii Cosmetics artwork.",
  hero_media_approval_status: "pending",
  approved_hero_image_sha256: null,
  approved_hero_image_alt: null,
  featured_products_approval_status: "pending",
  approved_featured_product_handles: null,
  hero_eyebrow: "Skincare by routine",
  hero_heading: "Mochirii Cosmetics",
  hero_text: "Find cleansers, serums, moisturizers, and facial oils for each step of your routine.",
  primary_cta_label: "Shop skincare",
  primary_cta_destination: "/collections/mochirii-cosmetics",
  featured_heading: "Start your routine here",
  collections_heading: "Choose your next step",
  standards_heading: "See what fits your routine",
  standards_intro: "Compare texture, skin suitability, key ingredients, directions, and full ingredient lists before you choose.",
  standard_one_heading: "Matching product images",
  standard_one_text: "Each gallery shows the Mochirii Cosmetics packaging for that product.",
  standard_two_heading: "Ingredients and directions",
  standard_two_text: "Find key ingredients, full INCI, size, skin suitability, and directions on every product page.",
  standard_three_heading: "Shopping details in one place",
  standard_three_text: "Check warnings, origin, shipping, and returns before adding a product to your routine.",
  policy_note: "Shipping and return details are available before checkout.",
});

export const EXPECTED_COLLECTIONS_INDEX = Object.freeze({
  eyebrow: "Skincare routines",
  heading: "Choose your next step",
  intro: "Browse skincare for cleansing, hydration, brightening, smoothing, and moisture support.",
});

export const EXPECTED_PAGE_IDENTITIES = Object.freeze([
  { order: 1, handle: "about", route: "/pages/about", title: "About", seo_title: "About Mochirii Cosmetics | Skincare by Routine", seo_description: "Learn how Mochirii Cosmetics organizes skincare formulas by routine step, skin type, ingredients, texture, and use.", content_source: "content/approved-customer-copy.json#pages/about/bodyHtml" },
  { order: 2, handle: "contact", route: "/pages/contact", title: "Contact", seo_title: "Contact Mochirii Cosmetics | Product & Order Help", seo_description: "Contact Mochirii Cosmetics for help with a product, an order, or a store policy.", content_source: "content/approved-customer-copy.json#pages/contact/bodyHtml" },
  { order: 3, handle: "faq", route: "/pages/faq", title: "Frequently Asked Questions", seo_title: "Frequently Asked Questions | Mochirii Cosmetics", seo_description: "Find where to review product details, ingredients, directions, shipping, returns, and ways to contact Mochirii Cosmetics.", content_source: "content/launch-pages.v1.json#pages/faq/body_html" },
  { order: 4, handle: "ingredients-standards", route: "/pages/ingredients-standards", title: "Ingredients & Standards", seo_title: "Ingredients & Standards | Mochirii Cosmetics", seo_description: "Learn how Mochirii Cosmetics presents product-specific ingredients, directions, warnings, origin, and verified certification wording.", content_source: "content/launch-pages.v1.json#pages/ingredients-standards/body_html" },
  { order: 5, handle: "accessibility", route: "/pages/accessibility", title: "Accessibility", seo_title: "Accessibility | Mochirii Cosmetics", seo_description: "Read the Mochirii Cosmetics accessibility approach and learn how to report a storefront access or usability barrier.", content_source: "content/launch-pages.v1.json#pages/accessibility/body_html" },
]);

export const EXPECTED_COLLECTION_IDENTITIES = Object.freeze([
  { order: 1, handle: "mochirii-cosmetics", route: "/collections/mochirii-cosmetics", title: "Mochirii Cosmetics", seo_title: "Shop Skincare | Mochirii Cosmetics", seo_description: "Shop all 20 Mochirii Cosmetics skincare formulas for cleansing, hydration, brightening, and moisture support.", description_source: "content/approved-customer-copy.json#collections/mochirii-cosmetics/description" },
  { order: 2, handle: "cleanse-tone", route: "/collections/cleanse-tone", title: "Cleanse & Tone", seo_title: "Cleanse & Tone | Mochirii Cosmetics", seo_description: "Shop Mochirii cleansers, makeup removers, and toner for the first steps of your skincare routine.", description_source: "content/approved-customer-copy.json#collections/cleanse-tone/description" },
  { order: 3, handle: "hydrate-barrier", route: "/collections/hydrate-barrier", title: "Hydrate & Barrier", seo_title: "Hydrate & Barrier | Mochirii Cosmetics", seo_description: "Shop Mochirii gels and daily moisturizers for hydration and soft, comfortable-feeling skin.", description_source: "content/approved-customer-copy.json#collections/hydrate-barrier/description" },
  { order: 4, handle: "brighten-smooth", route: "/collections/brighten-smooth", title: "Brighten & Smooth", seo_title: "Brighten & Smooth | Mochirii Cosmetics", seo_description: "Shop Mochirii serums, exfoliation, and eye care for a brighter, smoother-looking finish.", description_source: "content/approved-customer-copy.json#collections/brighten-smooth/description" },
  { order: 5, handle: "age-support-nourish", route: "/collections/age-support-nourish", title: "Age-Support & Nourish", seo_title: "Age-Support & Nourish | Mochirii Cosmetics", seo_description: "Shop Mochirii oils, creams, and serums for moisture, suppleness, and a smooth-looking finish.", description_source: "content/approved-customer-copy.json#collections/age-support-nourish/description" },
]);

function normalizeForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForCanonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeForCanonicalJson(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function textSha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function providerSurfaceContractSha256(contract) {
  return canonicalSha256(contract);
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    new Set(left).size === left.length && left.every((value) => right.includes(value));
}

function withoutKeys(value, keys) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));
}

function add(issues, surface, category) {
  issues.push({ surface, category });
}

function exactKeys(value, expected, issues, surface, category) {
  const actual = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  if (!same(actual, [...expected].sort())) {
    add(issues, surface, category);
    return false;
  }
  return true;
}

function validSha(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value) && !/^([a-f0-9])\1{63}$/u.test(value);
}

function validTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateVisibleText(value, issues, surface, category) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    add(issues, surface, `${category}.text`);
    return;
  }
  for (const issueCategory of customerLanguageIssueCategories(value)) {
    add(issues, surface, `${category}.${issueCategory}`);
  }
}

function validateRichCustomerBody(value, issues, surface, category) {
  const body = String(value ?? "");
  validateVisibleText(body.replaceAll(/<[^>]+>/gu, " ").replaceAll(/\s+/gu, " ").trim(), issues, surface, category);
  const joinedMarkup = body.replaceAll(/<[^>]+>/gu, "");
  for (const issueCategory of customerLanguageIssueCategories(joinedMarkup)) {
    add(issues, surface, `${category}.${issueCategory}`);
  }
}

function reviewDateMilliseconds(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : Number.NaN;
}

function reviewedBodyExceptionCount(contract, routeCategory, route, body, company, latestTimestamp) {
  const review = contract?.rendered_review;
  const reviewTimestamp = reviewDateMilliseconds(review?.review_date);
  if (contract?.status !== "reviewed" || review?.status !== "reviewed" ||
      !Array.isArray(review.reviewed_route_categories) || !review.reviewed_route_categories.includes(routeCategory) ||
      !Number.isFinite(reviewTimestamp) || reviewTimestamp > latestTimestamp || !Array.isArray(contract.entries)) return 0;
  const normalizedBody = normalizeCustomerLanguageForPolicy(body, { joinInternalSeparators: true });
  const normalizedCompany = normalizeCustomerLanguageForPolicy(company, { joinInternalSeparators: true });
  return contract.entries.filter((entry) => {
    const entryTimestamp = reviewDateMilliseconds(entry?.review_date);
    const wording = normalizeCustomerLanguageForPolicy(entry?.exact_approved_wording, { joinInternalSeparators: true });
    const name = normalizeCustomerLanguageForPolicy(entry?.exact_name, { joinInternalSeparators: true });
    const canonicalCompany = exactCustomerLanguageCompanyName(company);
    const exactNameValid = entry?.exact_name === company && (
      canonicalCompany === null
        ? exactCustomerLanguageCompanyName(entry.exact_name) === null
        : exactCustomerLanguageCompanyName(entry.exact_name) === canonicalCompany
    );
    return entry?.surface === `rendered-body:${routeCategory}` && entry?.route === route && exactNameValid &&
      typeof entry.reviewer === "string" && entry.reviewer.trim().length > 0 &&
      Number.isFinite(entryTimestamp) && entryTimestamp <= reviewTimestamp && entryTimestamp <= latestTimestamp &&
      typeof entry.legal_or_contractual_reason === "string" &&
      /\b(?:legal|law|required|regulation|contract|contractual|agreement|carrier|certification|privacy|label)\b/iu
        .test(entry.legal_or_contractual_reason) && wording.length > 0 && normalizedBody.includes(wording) &&
      name.length > 0 && normalizedCompany.length > 0 &&
      ` ${wording} `.includes(` ${name} `) && ` ${normalizedBody} `.includes(` ${normalizedCompany} `);
  }).length;
}

function potentialThirdPartyNames(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.match(/\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*)+\b/gu) ?? [])]
    .filter((name) => name !== "Mochirii Cosmetics" &&
      /\b(?:LLC|Inc[.]?|Labs?|Laboratories|Corp[.]?|Corporation|Foundation|Association)$/u.test(name));
}

function validatePrivateBody(value, detectedNames, routeCategory, route, evidence, options, issues, surface) {
  const categories = customerLanguageIssueCategories(value);
  for (const category of categories.filter((item) => item !== "third-party-name")) {
    add(issues, surface, `readback.body-language.${category}`);
  }
  const latestTimestamp = Math.min(Date.parse(evidence.captured_at), options.now instanceof Date ? options.now.getTime() : Date.now());
  if (!Array.isArray(detectedNames) || new Set(detectedNames).size !== detectedNames.length ||
      detectedNames.some((name) => typeof name !== "string" || name.trim() !== name || name.length === 0 ||
        !/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}&.' -]*$/u.test(name))) {
    add(issues, surface, "readback.body-language.third-party-attestation");
  }
  const requiredNames = [...new Set([...customerLanguageCompanyMatches(value), ...potentialThirdPartyNames(value)])];
  for (const name of requiredNames) {
    if (!detectedNames?.includes(name)) {
      add(issues, surface, "readback.body-language.third-party-omission");
      add(issues, surface, "readback.body-language.third-party-name");
    }
  }
  const registeredNames = (options.mandatoryNameExceptions?.entries ?? [])
    .filter((entry) => entry?.surface === `rendered-body:${routeCategory}` && entry?.route === route)
    .map((entry) => entry.exact_name);
  if (!sameSet(detectedNames ?? [], registeredNames) && ((detectedNames?.length ?? 0) > 0 || registeredNames.length > 0)) {
    add(issues, surface, "readback.body-language.exception-name-set");
  }
  for (const company of detectedNames ?? []) {
    if (reviewedBodyExceptionCount(
      options.mandatoryNameExceptions,
      routeCategory,
      route,
      value,
      company,
      latestTimestamp,
    ) !== 1) add(issues, surface, "readback.body-language.third-party-name");
  }
}

function validateSequentialOrder(records, issues, surface) {
  if (!Array.isArray(records)) {
    add(issues, surface, "order.records");
    return;
  }
  if (!records.every((record, index) => record?.order === index + 1)) {
    add(issues, surface, "order.sequence");
  }
}

function validateNavigationLinks(records, issues, surface) {
  validateSequentialOrder(records, issues, surface);
  for (const item of Array.isArray(records) ? records : []) {
    if (!exactKeys(item, ["order", "label", "destination", "children"], issues, surface, "link.keys")) continue;
    validateVisibleText(item.label, issues, surface, "link.label");
    if (typeof item.destination !== "string" || !/^(?:\/|https:\/\/mochirii[.]com$)/u.test(item.destination)) {
      add(issues, surface, "link.destination");
    }
    if (!Array.isArray(item.children)) {
      add(issues, surface, "link.children");
    } else {
      validateNavigationLinks(item.children, issues, surface);
    }
  }
}

function validatePublicBoundary(value, issues, path = "provider-surfaces") {
  if (!value || typeof value !== "object") return;
  const forbiddenKeys = new Set([
    "readback",
    "captured_at",
    "observed",
    "observed_sha256",
    "candidate_theme_id",
    "theme_id",
    "package_sha256",
    "provider_write_authority",
  ]);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) add(issues, path, "public-boundary.mutable-or-provider-field");
    validatePublicBoundary(child, issues, `${path}.${key}`);
  }
}

export function validateProviderSurfacesContract(contract) {
  const issues = [];
  if (!exactKeys(contract, PROVIDER_SURFACE_PUBLIC_ROOT_KEYS, issues, "provider-surfaces", "root.keys")) {
    return { issues };
  }
  validatePublicBoundary(contract, issues);
  if (contract.$schema !== "./provider-surfaces.v1.schema.json") add(issues, "provider-surfaces", "root.schema");
  if (contract.schema_version !== 1) add(issues, "provider-surfaces", "root.schema-version");
  validateVisibleText(contract.revision, issues, "provider-surfaces", "root.revision");
  if (contract.locale !== "en-US") add(issues, "provider-surfaces", "root.locale");
  if (contract.brand !== "Mochirii Cosmetics") add(issues, "provider-surfaces", "root.brand");
  if (contract.market !== "US" || contract.currency !== "USD") add(issues, "provider-surfaces", "root.market-currency");

  const brand = contract.brand_identity;
  if (exactKeys(brand, ["canonical_reference", "storefront_derivative", "theme_bindings", "provider_logo_expectations"], issues, "brand-identity", "root.keys")) {
    const canonicalReference = brand.canonical_reference;
    const emblem = brand.storefront_derivative;
    if (exactKeys(canonicalReference, ["asset_path", "sha256"], issues, "brand-identity", "canonical-reference.keys")) {
      if (canonicalReference.asset_path !== "apps/web/public/assets/img/brand/emblem.webp" || !validSha(canonicalReference.sha256)) {
        add(issues, "brand-identity", "canonical-reference.identity");
      }
    }
    if (exactKeys(emblem, ["asset_path", "sha256", "format", "width", "height", "relationship"], issues, "brand-identity", "emblem.keys")) {
      if (emblem.asset_path !== "apps/shopify-theme/assets/mochirii-emblem.webp" || emblem.format !== "webp" || emblem.width !== 224 || emblem.height !== 224 || emblem.relationship !== "reviewed-storefront-rendering-of-canonical-emblem") {
        add(issues, "brand-identity", "emblem.identity");
      }
      if (!validSha(emblem.sha256)) add(issues, "brand-identity", "emblem.sha256");
    }
    if (!same(brand.theme_bindings, EXPECTED_THEME_BINDINGS)) add(issues, "brand-identity", "theme-bindings.exact");
    validateSequentialOrder(brand.theme_bindings, issues, "brand-identity");
    const logoExpectations = Array.isArray(brand.provider_logo_expectations) ? brand.provider_logo_expectations : [];
    validateSequentialOrder(logoExpectations, issues, "brand-identity");
    if (logoExpectations.length !== EXPECTED_PROVIDER_LOGO_SURFACES.length) add(issues, "brand-identity", "provider-logo.exact-count");
    for (const [index, expectedSurface] of EXPECTED_PROVIDER_LOGO_SURFACES.entries()) {
      const item = logoExpectations[index];
      if (!exactKeys(item, ["order", "surface", "requirement", "expected_asset_sha256"], issues, "brand-identity", "provider-logo.keys")) continue;
      if (item.surface !== expectedSurface || item.requirement !== "match-when-configurable") add(issues, "brand-identity", "provider-logo.identity");
      if (item.expected_asset_sha256 !== emblem?.sha256) add(issues, "brand-identity", "provider-logo.emblem-parity");
    }
  }

  const homepage = contract.homepage;
  if (exactKeys(homepage, ["expected", "expected_sha256"], issues, "homepage", "root.keys")) {
    const approvalFields = [
      "hero_media_approval_status", "approved_hero_image_sha256", "approved_hero_image_alt",
      "featured_products_approval_status", "approved_featured_product_handles",
    ];
    if (!same(withoutKeys(homepage.expected, approvalFields), withoutKeys(EXPECTED_HOMEPAGE, approvalFields))) {
      add(issues, "homepage", "expectations.exact");
    }
    if (homepage.expected_sha256 !== canonicalSha256(homepage.expected) || !validSha(homepage.expected_sha256)) {
      add(issues, "homepage", "expectations.sha256");
    }
    for (const [field, value] of Object.entries(homepage.expected ?? {})) {
      if (!["featured_collection_handle", "temporary_hero_fallback_asset_path", "temporary_hero_fallback_sha256", "hero_media_approval_status", "approved_hero_image_sha256", "featured_products_approval_status", "approved_featured_product_handles", "primary_cta_destination"].includes(field) && value !== null) {
        validateVisibleText(value, issues, "homepage", `expected.${field}`);
      }
    }
    if (homepage.expected?.hero_media_approval_status === "pending") {
      if (homepage.expected.approved_hero_image_sha256 !== null || homepage.expected.approved_hero_image_alt !== null) add(issues, "homepage", "hero.pending-state");
    } else if (homepage.expected?.hero_media_approval_status === "approved") {
      if (!validSha(homepage.expected.approved_hero_image_sha256) || homepage.expected.approved_hero_image_sha256 === homepage.expected.temporary_hero_fallback_sha256) {
        add(issues, "homepage", "hero.dedicated-image");
      }
      validateVisibleText(homepage.expected.approved_hero_image_alt, issues, "homepage", "hero.alt");
    } else {
      add(issues, "homepage", "hero.approval-status");
    }
    if (homepage.expected?.featured_products_approval_status === "pending") {
      if (homepage.expected.approved_featured_product_handles !== null) add(issues, "homepage", "featured-products.pending-state");
    } else if (homepage.expected?.featured_products_approval_status !== "approved" ||
        !Array.isArray(homepage.expected.approved_featured_product_handles) ||
        homepage.expected.approved_featured_product_handles.length !== 6 ||
        new Set(homepage.expected.approved_featured_product_handles).size !== 6 ||
        homepage.expected.approved_featured_product_handles.some(
          (handle) => !EXPECTED_STORE_PRODUCT_HANDLES.includes(handle),
        )) {
      add(issues, "homepage", "featured-products.approval");
    }
  }

  const collectionsIndex = contract.collections_index;
  if (exactKeys(collectionsIndex, ["expected", "expected_sha256"], issues, "collections-index", "root.keys")) {
    if (!same(collectionsIndex.expected, EXPECTED_COLLECTIONS_INDEX)) add(issues, "collections-index", "expectations.exact");
    if (collectionsIndex.expected_sha256 !== canonicalSha256(collectionsIndex.expected) || !validSha(collectionsIndex.expected_sha256)) {
      add(issues, "collections-index", "expectations.sha256");
    }
    for (const [field, value] of Object.entries(collectionsIndex.expected ?? {})) {
      validateVisibleText(value, issues, "collections-index", `expected.${field}`);
    }
  }

  const pages = contract.pages;
  if (exactKeys(pages, ["section_settings", "items"], issues, "pages", "root.keys")) {
    if (!same(pages.section_settings, { eyebrow: "Mochirii Cosmetics", intro: null })) add(issues, "pages", "section-settings.exact");
    validateSequentialOrder(pages.items, issues, "pages");
    if (!Array.isArray(pages.items) || pages.items.length !== EXPECTED_PAGE_IDENTITIES.length) add(issues, "pages", "items.exact-count");
    for (const [index, expected] of EXPECTED_PAGE_IDENTITIES.entries()) {
      const item = pages.items?.[index];
      if (!exactKeys(item, ["order", "handle", "route", "title", "seo_title", "seo_description", "approved_seo_sha256", "content_source", "approved_content_sha256"], issues, "pages", "item.keys")) continue;
      const identity = Object.fromEntries(Object.keys(expected).map((key) => [key, item[key]]));
      if (!same(identity, expected)) add(issues, "pages", "item.identity");
      validateVisibleText(item.title, issues, "pages", "item.title");
      validateVisibleText(item.seo_title, issues, "pages", "item.seo-title");
      validateVisibleText(item.seo_description, issues, "pages", "item.seo-description");
      if (item.approved_seo_sha256 !== canonicalSha256({ title: item.seo_title, description: item.seo_description }) || !validSha(item.approved_seo_sha256)) add(issues, "pages", "item.seo-sha256");
      if (!validSha(item.approved_content_sha256)) add(issues, "pages", "item.content-sha256");
    }
  }

  const collections = contract.collections;
  if (exactKeys(collections, ["items"], issues, "collections", "root.keys")) {
    validateSequentialOrder(collections.items, issues, "collections");
    if (!Array.isArray(collections.items) || collections.items.length !== EXPECTED_COLLECTION_IDENTITIES.length) add(issues, "collections", "items.exact-count");
    for (const [index, expected] of EXPECTED_COLLECTION_IDENTITIES.entries()) {
      const item = collections.items?.[index];
      if (!exactKeys(item, [
        "order", "handle", "route", "title", "seo_title", "seo_description", "approved_seo_sha256", "description_source", "approved_description_sha256",
        "rendered_html_approval_status", "approved_rendered_html_sha256", "media_approval_status",
        "approved_image_sha256", "approved_image_alt", "membership_approval_status", "approved_product_handles",
      ], issues, "collections", "item.keys")) continue;
      const identity = Object.fromEntries(Object.keys(expected).map((key) => [key, item[key]]));
      if (!same(identity, expected)) add(issues, "collections", "item.identity");
      validateVisibleText(item.title, issues, "collections", "item.title");
      validateVisibleText(item.seo_title, issues, "collections", "item.seo-title");
      validateVisibleText(item.seo_description, issues, "collections", "item.seo-description");
      if (item.approved_seo_sha256 !== canonicalSha256({ title: item.seo_title, description: item.seo_description }) || !validSha(item.approved_seo_sha256)) add(issues, "collections", "item.seo-sha256");
      if (!validSha(item.approved_description_sha256)) add(issues, "collections", "item.description-sha256");
      if (item.rendered_html_approval_status === "pending") {
        if (item.approved_rendered_html_sha256 !== null) add(issues, "collections", "item.rendered-html-pending-state");
      } else if (item.rendered_html_approval_status !== "approved" || !validSha(item.approved_rendered_html_sha256)) {
        add(issues, "collections", "item.rendered-html-approval");
      }
      if (item.media_approval_status === "pending") {
        if (item.approved_image_sha256 !== null || item.approved_image_alt !== null) add(issues, "collections", "item.media-pending-state");
      } else if (item.media_approval_status === "approved") {
        if (!validSha(item.approved_image_sha256)) add(issues, "collections", "item.image-sha256");
        validateVisibleText(item.approved_image_alt, issues, "collections", "item.image-alt");
      } else {
        add(issues, "collections", "item.media-approval");
      }
      if (item.membership_approval_status === "pending") {
        if (item.approved_product_handles !== null) add(issues, "collections", "item.membership-pending-state");
      } else if (item.membership_approval_status !== "approved" || !Array.isArray(item.approved_product_handles) ||
          item.approved_product_handles.length === 0 || new Set(item.approved_product_handles).size !== item.approved_product_handles.length ||
          item.approved_product_handles.some((handle) => !EXPECTED_STORE_PRODUCT_HANDLES.includes(handle))) {
        add(issues, "collections", "item.membership-approval");
      } else if (item.handle === "mochirii-cosmetics" && !sameSet(item.approved_product_handles, EXPECTED_STORE_PRODUCT_HANDLES)) {
        add(issues, "collections", "item.main-membership");
      }
    }
  }

  const navigation = contract.navigation;
  if (exactKeys(navigation, ["header", "footer_groups", "expected_sha256"], issues, "navigation", "root.keys")) {
    validateNavigationLinks(navigation.header, issues, "navigation.header");
    validateSequentialOrder(navigation.footer_groups, issues, "navigation.footer");
    for (const group of Array.isArray(navigation.footer_groups) ? navigation.footer_groups : []) {
      if (!exactKeys(group, ["order", "identity", "heading", "links"], issues, "navigation.footer", "group.keys")) continue;
      if (group.heading !== null) validateVisibleText(group.heading, issues, "navigation.footer", "group.heading");
      validateNavigationLinks(group.links, issues, "navigation.footer");
    }
    if (!same(navigation.header, EXPECTED_HEADER_NAVIGATION) || !same(navigation.footer_groups, EXPECTED_FOOTER_NAVIGATION)) {
      add(issues, "navigation", "expectations.exact");
    }
    const expectedHash = canonicalSha256({ header: navigation.header, footer_groups: navigation.footer_groups });
    if (navigation.expected_sha256 !== expectedHash) add(issues, "navigation", "expectations.sha256");
  }

  const filters = contract.search_and_filters;
  if (exactKeys(filters, ["filters", "forbidden_filter_params", "expected_sha256"], issues, "search-and-filters", "root.keys")) {
    validateSequentialOrder(filters.filters, issues, "search-and-filters");
    if (!same(filters.filters, EXPECTED_SEARCH_FILTERS)) add(issues, "search-and-filters", "filters.exact");
    if (!same(filters.forbidden_filter_params, ["filter.p.vendor"])) add(issues, "search-and-filters", "vendor-filter.forbidden");
    for (const item of Array.isArray(filters.filters) ? filters.filters : []) {
      if (!exactKeys(item, ["order", "label", "param_name", "type"], issues, "search-and-filters", "filter.keys")) continue;
      validateVisibleText(item.label, issues, "search-and-filters", "filter.label");
    }
    const expectedHash = canonicalSha256({ filters: filters.filters, forbidden_filter_params: filters.forbidden_filter_params });
    if (filters.expected_sha256 !== expectedHash) add(issues, "search-and-filters", "expectations.sha256");
  }

  const policies = contract.policies;
  if (exactKeys(policies, ["items"], issues, "policies", "root.keys")) {
    validateSequentialOrder(policies.items, issues, "policies");
    if (!Array.isArray(policies.items) || policies.items.length !== EXPECTED_POLICIES.length) add(issues, "policies", "items.exact-count");
    for (const [index, expected] of EXPECTED_POLICIES.entries()) {
      const item = policies.items?.[index];
      if (!exactKeys(item, ["order", "identity", "customer_label", "route", "expected_title", "approval_status", "approved_content_sha256"], issues, "policies", "item.keys")) continue;
      const identity = Object.fromEntries(Object.keys(expected).map((key) => [key, item[key]]));
      if (!same(identity, expected)) add(issues, "policies", "item.identity");
      validateVisibleText(item.customer_label, issues, "policies", "item.customer-label");
      validateVisibleText(item.expected_title, issues, "policies", "item.title");
      if (item.approval_status === "pending") {
        if (item.approved_content_sha256 !== null) add(issues, "policies", "item.pending-state");
      } else if (item.approval_status === "approved") {
        if (!validSha(item.approved_content_sha256)) add(issues, "policies", "item.approved-sha256");
      } else {
        add(issues, "policies", "item.approval-status");
      }
    }
  }

  const settings = contract.settings;
  if (exactKeys(settings, ["expected", "expected_sha256"], issues, "settings", "root.keys")) {
    if (!same(settings.expected, EXPECTED_SETTINGS)) add(issues, "settings", "expectations.exact");
    if (settings.expected_sha256 !== canonicalSha256(settings.expected)) add(issues, "settings", "expectations.sha256");
  }

  const notifications = contract.notifications;
  if (exactKeys(notifications, ["sender_presentation", "items"], issues, "notifications", "root.keys")) {
    const sender = notifications.sender_presentation;
    if (exactKeys(sender, [
      "display_name",
      "approval_status",
      "approved_sender_address_sha256",
      "approved_sender_domain_sha256",
    ], issues, "notifications", "sender.keys")) {
      if (sender.display_name !== EXPECTED_NOTIFICATION_SENDER.display_name) add(issues, "notifications", "sender.display-name");
      if (sender.approval_status === "pending") {
        if (sender.approved_sender_address_sha256 !== null || sender.approved_sender_domain_sha256 !== null) {
          add(issues, "notifications", "sender.pending-state");
        }
      } else if (sender.approval_status !== "approved" || !validSha(sender.approved_sender_address_sha256) ||
          !validSha(sender.approved_sender_domain_sha256)) {
        add(issues, "notifications", "sender.approval");
      }
    }
    validateSequentialOrder(notifications.items, issues, "notifications");
    if (!Array.isArray(notifications.items) || notifications.items.length !== EXPECTED_NOTIFICATION_IDENTITIES.length) {
      add(issues, "notifications", "items.exact-count");
    }
    for (const [index, expected] of EXPECTED_NOTIFICATION_IDENTITIES.entries()) {
      const item = notifications.items?.[index];
      if (!exactKeys(item, ["order", "identity", "customer_label", "approval_status", "approved_subject", "approved_subject_sha256", "approved_body_sha256"], issues, "notifications", "item.keys")) continue;
      if (!same({ order: item.order, identity: item.identity, customer_label: item.customer_label }, expected)) {
        add(issues, "notifications", "item.identity");
      }
      validateVisibleText(item.customer_label, issues, "notifications", "item.customer-label");
      if (item.approval_status === "pending") {
        if (item.approved_subject !== null || item.approved_subject_sha256 !== null || item.approved_body_sha256 !== null) {
          add(issues, "notifications", "item.pending-state");
        }
      } else if (item.approval_status === "approved") {
        validateVisibleText(item.approved_subject, issues, "notifications", "item.subject");
        if (item.approved_subject_sha256 !== textSha256(item.approved_subject)) add(issues, "notifications", "item.subject-sha256");
        if (!validSha(item.approved_body_sha256)) add(issues, "notifications", "item.body-sha256");
      } else {
        add(issues, "notifications", "item.approval-status");
      }
    }
  }
  return { issues };
}

const EMBLEM_SOURCE_MARKERS = Object.freeze({
  "storefront-header-logo": `<img src="{{ 'mochirii-emblem.webp' | asset_url }}" alt="" width="56" height="56"`,
  "storefront-footer-logo": `<img src="{{ 'mochirii-emblem.webp' | asset_url }}" alt="" width="56" height="56"`,
  "password-page-logo": `<img src="{{ 'mochirii-emblem.webp' | asset_url }}" alt="" width="56" height="56"`,
  "gift-card-logo": `<img src="{{ 'mochirii-emblem.webp' | asset_url }}" alt="" width="56" height="56"`,
  "structured-data-logo": `{% assign emblem_url = 'mochirii-emblem.webp' | asset_url | prepend: 'https:' %}`,
  "storefront-favicon": `<link rel="icon" type="image/webp" sizes="224x224" href="{{ 'mochirii-emblem.webp' | asset_url }}">`,
  "password-favicon": `<link rel="icon" type="image/webp" sizes="224x224" href="{{ 'mochirii-emblem.webp' | asset_url }}">`,
});

function sourceText(sources, relativePath) {
  if (sources?.files instanceof Map) return sources.files.get(relativePath);
  return sources?.files?.[relativePath];
}

function requireSourceToken(source, token, issues, surface, category, expectedCount = null) {
  const count = typeof source === "string" ? source.split(token).length - 1 : 0;
  if ((expectedCount === null && count < 1) || (expectedCount !== null && count !== expectedCount)) {
    add(issues, surface, category);
  }
}

function requireSourceOrder(source, tokens, issues, surface) {
  let cursor = -1;
  for (const token of tokens) {
    const index = typeof source === "string" ? source.indexOf(token, cursor + 1) : -1;
    if (index < 0 || index <= cursor) {
      add(issues, surface, "source.order");
      return;
    }
    cursor = index;
  }
}

export function validateProviderSurfaceSourceBindings(contract, sources) {
  const issues = [];
  const canonicalReference = contract?.brand_identity?.canonical_reference;
  const emblem = contract?.brand_identity?.storefront_derivative;
  if (!(sources?.canonical_emblem_bytes instanceof Uint8Array) ||
      createHash("sha256").update(sources.canonical_emblem_bytes ?? new Uint8Array()).digest("hex") !== canonicalReference?.sha256) {
    add(issues, "brand-identity", "source.canonical-emblem-sha256");
  }
  if (!(sources?.storefront_emblem_bytes instanceof Uint8Array) ||
      createHash("sha256").update(sources.storefront_emblem_bytes ?? new Uint8Array()).digest("hex") !== emblem?.sha256) {
    add(issues, "brand-identity", "source.emblem-sha256");
  }
  const metadata = sources?.emblem_metadata;
  if (metadata?.format !== emblem?.format || metadata?.width !== emblem?.width || metadata?.height !== emblem?.height) {
    add(issues, "brand-identity", "source.emblem-metadata");
  }
  if (!(sources?.homepage_hero_bytes instanceof Uint8Array) ||
      createHash("sha256").update(sources.homepage_hero_bytes ?? new Uint8Array()).digest("hex") !== contract?.homepage?.expected?.temporary_hero_fallback_sha256) {
    add(issues, "homepage", "source.hero-image-sha256");
  }
  for (const binding of contract?.brand_identity?.theme_bindings ?? []) {
    requireSourceToken(
      sourceText(sources, binding.source_path),
      EMBLEM_SOURCE_MARKERS[binding.surface],
      issues,
      "brand-identity",
      `source.${binding.surface}`,
    );
  }

  const home = sourceText(sources, "sections/main-index.liquid");
  for (const [field, value] of Object.entries(contract?.homepage?.expected ?? {})) {
    if (["featured_collection_handle", "seo_title", "seo_description", "temporary_hero_fallback_asset_path", "temporary_hero_fallback_sha256", "hero_media_approval_status", "approved_hero_image_sha256", "approved_hero_image_alt", "featured_products_approval_status", "approved_featured_product_handles", "primary_cta_destination"].includes(field)) continue;
    const escaped = JSON.stringify(value).slice(1, -1);
    if (!home?.includes(escaped)) add(issues, "homepage", `source.expected.${field}`);
  }
  for (const token of [
    "collections['mochirii-cosmetics']",
    "'mochirii-page-password.webp' | asset_url",
    "section.settings.hero_eyebrow | escape",
    "section.settings.hero_heading | escape",
    "section.settings.hero_text | escape",
    "primary_link | escape",
    "section.settings.primary_cta_label | escape",
    "section.settings.featured_heading | escape",
    "section.settings.collections_heading | escape",
    "section.settings.standards_heading | escape",
    "section.settings.standards_intro | escape",
    "section.settings.standard_one_heading | escape",
    "section.settings.standard_one_text | escape",
    "section.settings.standard_two_heading | escape",
    "section.settings.standard_two_text | escape",
    "section.settings.standard_three_heading | escape",
    "section.settings.standard_three_text | escape",
    "section.settings.policy_note | escape",
    "routine_url | escape",
    "routine_title | escape",
    "shop.shipping_policy.url | escape",
    "shop.refund_policy.url | escape",
    "contact_page.url | escape",
  ]) requireSourceToken(home, token, issues, "homepage", "source.escape-or-binding");

  const listCollections = sourceText(sources, "sections/main-list-collections.liquid");
  for (const token of [
    `>${contract?.collections_index?.expected?.eyebrow}</p>`,
    `"default": "${contract?.collections_index?.expected?.heading}"`,
    `"default": "${contract?.collections_index?.expected?.intro}"`,
    "section.settings.heading | escape",
    "section.settings.intro | escape",
    "routine_url | escape",
    "routine_title | escape",
  ]) requireSourceToken(listCollections, token, issues, "collections-index", "source.escape-or-binding");

  const pageSection = sourceText(sources, "sections/main-page.liquid");
  for (const token of [
    "page.title | escape",
    "section.settings.eyebrow | escape",
    "section.settings.intro | escape",
    "form.body | escape",
    "catalog_url | escape",
    "{{ page.content }}",
  ]) requireSourceToken(pageSection, token, issues, "pages", "source.escape-or-rich-content");

  const header = sourceText(sources, "sections/header.liquid");
  const nav = sourceText(sources, "snippets/primary-navigation-links.liquid");
  for (const token of [
    "collections['mochirii-cosmetics']",
    "catalog_url | append: '#shop-filters'",
    "routes.collections_url | append: '#routine-collections'",
    "pages['about']",
    "pages['faq']",
  ]) requireSourceToken(header, token, issues, "navigation", "source.header-binding");
  requireSourceToken(nav, "required_navigation_labels = 'Shop|Product type|Skin needs|Routine|About|Help'", issues, "navigation", "source.header-order");
  requireSourceOrder(nav, [">Search</a>", "Cart <span"], issues, "navigation.header");

  const footer = sourceText(sources, "sections/footer.liquid");
  requireSourceOrder(footer, [
    ">Visit Mochirii Guild</a>",
    "<h2>Support</h2>",
    ">Contact</a>",
    ">FAQ</a>",
    ">About</a>",
    ">Ingredients &amp; Standards</a>",
    ">Accessibility</a>",
    "<h2>Policies</h2>",
    ">Shipping</a>",
    ">Returns</a>",
    ">Privacy</a>",
    ">Terms</a>",
    ">Privacy Choices</a>",
  ], issues, "navigation.footer");

  const collection = sourceText(sources, "sections/main-collection.liquid");
  for (const item of EXPECTED_SEARCH_FILTERS) {
    const signature = `${item.param_name}|${item.type}`;
    requireSourceToken(collection, signature, issues, "search-and-filters", "source.filter-allowlist", 2);
    if (item.param_name.startsWith("filter.p.m.custom.")) {
      const key = item.param_name.slice("filter.p.m.custom.".length);
      const mapping = SHOPIFY_PUBLICATION_MAPPING.metafields[key];
      if (mapping?.namespace !== "custom" || mapping?.key !== key) add(issues, "search-and-filters", "source.metafield-mapping");
    }
  }
  if (/filter[.]p[.]vendor|product[.]vendor|\bvendor\b/iu.test(collection ?? "")) add(issues, "search-and-filters", "source.vendor-filter");

  const launchPages = sourceText(sources, "content/launch-pages.v1.json");
  for (const policy of EXPECTED_POLICIES.slice(0, 2)) {
    requireSourceToken(launchPages, policy.route, issues, "policies", "source.launch-page-route");
  }
  requireSourceToken(footer, "shop.shipping_policy", issues, "policies", "source.footer-policy");
  requireSourceToken(footer, "shop.refund_policy", issues, "policies", "source.footer-policy");
  requireSourceToken(footer, "shop.privacy_policy", issues, "policies", "source.footer-policy");
  requireSourceToken(footer, "shop.terms_of_service", issues, "policies", "source.footer-policy");

  let settingsData;
  let settingsSchema;
  try {
    const parseThemeJson = (value) => JSON.parse(value.replace(/^\s*[/][*][\s\S]*?[*][/]\s*/u, ""));
    settingsData = parseThemeJson(sourceText(sources, "config/settings_data.json"));
    settingsSchema = parseThemeJson(sourceText(sources, "config/settings_schema.json"));
  } catch {
    add(issues, "settings", "source.json");
  }
  if (settingsData?.current?.checkout_cta_enabled !== false) add(issues, "settings", "source.checkout-cta-enabled");
  const checkoutCtaDefinition = settingsSchema?.flatMap((group) => group.settings ?? [])
    .find((setting) => setting.id === "checkout_cta_enabled");
  if (checkoutCtaDefinition?.type !== "checkbox" || checkoutCtaDefinition?.default !== false) {
    add(issues, "settings", "source.checkout-cta-default");
  }
  for (const field of [
    "background_color", "text_color", "accent_color", "default_meta_description", "storefront_mode_text",
    "empty_catalog_heading", "empty_catalog_body", "footer_summary", "checkout_cta_enabled",
  ]) {
    if (settingsData?.current?.[field] !== contract?.settings?.expected?.[field]) add(issues, "settings", `source.${field}`);
  }
  if (Object.hasOwn(settingsData?.current ?? {}, "social_share_image") && settingsData.current.social_share_image !== null && settingsData.current.social_share_image !== "") {
    add(issues, "settings", "source.social-share-image-setting");
  }
  const passwordPage = sourceText(sources, "sections/main-password.liquid");
  for (const token of [
    `"default": "${contract.settings.expected.password_eyebrow}"`,
    `"default": "${contract.settings.expected.password_heading}"`,
    `"default": "${contract.settings.expected.password_intro}"`,
    "section.settings.eyebrow | escape",
    "section.settings.heading | escape",
    "section.settings.intro | escape",
  ]) requireSourceToken(passwordPage, token, issues, "settings", "source.password-copy");
  for (const token of [
    `"default": "${contract.settings.expected.footer_section_summary}"`,
    "section.settings.summary_text | default: settings.footer_summary | escape",
    "linklists['footer']",
  ]) requireSourceToken(footer, token, issues, "settings", "source.footer-settings");
  requireSourceToken(header, "linklists['main-menu']", issues, "settings", "source.header-menu");
  const seoMeta = sourceText(sources, "snippets/seo-meta.liquid");
  requireSourceToken(seoMeta, "settings.social_share_image", issues, "settings", "source.social-share-image");
  requireSourceToken(seoMeta, "'mochirii-page-password.webp' | asset_url", issues, "settings", "source.social-share-fallback");
  const themeLayout = sourceText(sources, "layout/theme.liquid");
  for (const token of [
    "settings.background_color | default: '#fffaf0' | escape",
    "settings.text_color | default: '#061610' | escape",
    "settings.accent_color | default: '#1f745f' | escape",
  ]) requireSourceToken(themeLayout, token, issues, "settings", "source.color-escape");
  const cart = sourceText(sources, "sections/main-cart.liquid");
  for (const token of [
    "catalog_url | escape", "routes.cart_url | escape", "item.url | escape", "item.product.title | escape",
    "item.url_to_remove | escape", "shop.shipping_policy.url | escape", "shop.refund_policy.url | escape",
  ]) requireSourceToken(cart, token, issues, "settings", "source.cart-escape");
  for (const [path, tokens] of [
    ["sections/main-404.liquid", ["routes.search_url | escape", "catalog_url | escape"]],
    ["sections/main-search.liquid", ["routes.search_url | escape", "routes.all_products_collection_url | escape"]],
  ]) {
    const source = sourceText(sources, path);
    for (const token of tokens) requireSourceToken(source, token, issues, "settings", "source.route-escape");
  }

  let approvedCopy;
  let launchPageCopy;
  let productFacts;
  try {
    approvedCopy = JSON.parse(sourceText(sources, "content/approved-customer-copy.json"));
    launchPageCopy = JSON.parse(sourceText(sources, "content/launch-pages.v1.json"));
    productFacts = JSON.parse(sourceText(sources, "content/product-facts.v3.json"));
  } catch {
    add(issues, "provider-surfaces", "source.customer-copy-json");
  }
  if (productFacts?.brand_mark?.canonical_emblem?.asset_path !== contract.brand_identity.canonical_reference.asset_path ||
      productFacts?.brand_mark?.canonical_emblem?.sha256 !== contract.brand_identity.canonical_reference.sha256 ||
      productFacts?.brand_mark?.storefront_derivative?.asset_path !== contract.brand_identity.storefront_derivative.asset_path ||
      productFacts?.brand_mark?.storefront_derivative?.sha256 !== contract.brand_identity.storefront_derivative.sha256) {
    add(issues, "brand-identity", "source.product-facts-brand-parity");
  }
  for (const item of contract?.pages?.items ?? []) {
    const sourceRecord = ["about", "contact"].includes(item.handle)
      ? approvedCopy?.pages?.find((record) => record.handle === item.handle)
      : launchPageCopy?.pages?.find((record) => record.handle === item.handle);
    const body = sourceRecord?.bodyHtml ?? sourceRecord?.body_html;
    const seoTitle = sourceRecord?.seoTitle ?? sourceRecord?.seo_title;
    const seoDescription = sourceRecord?.seoDescription ?? sourceRecord?.seo_description;
    if (sourceRecord?.title !== item.title || seoTitle !== item.seo_title || seoDescription !== item.seo_description ||
        canonicalSha256({ title: seoTitle, description: seoDescription }) !== item.approved_seo_sha256 ||
        textSha256(body ?? "") !== item.approved_content_sha256) {
      add(issues, "pages", "source.content-parity");
    }
    validateRichCustomerBody(body, issues, "pages", "source.body-language");
  }
  for (const item of contract?.collections?.items ?? []) {
    const sourceRecord = approvedCopy?.collections?.find((record) => record.handle === item.handle);
    if (sourceRecord?.title !== item.title || sourceRecord?.seoTitle !== item.seo_title || sourceRecord?.seoDescription !== item.seo_description ||
        canonicalSha256({ title: sourceRecord?.seoTitle, description: sourceRecord?.seoDescription }) !== item.approved_seo_sha256 ||
        textSha256(sourceRecord?.description ?? "") !== item.approved_description_sha256) {
      add(issues, "collections", "source.description-parity");
    }
    validateVisibleText(sourceRecord?.description, issues, "collections", "source.description-language");
    if (item.membership_approval_status === "approved") {
      const productHandles = productFacts?.products?.map((product) => product.handle) ?? [];
      const expectedMembership = item.handle === "mochirii-cosmetics"
        ? productHandles
        : productFacts?.products?.filter((product) => product.facts?.collection_handles?.includes(item.handle)).map((product) => product.handle);
      if (!sameSet(productHandles, EXPECTED_STORE_PRODUCT_HANDLES) || !sameSet(item.approved_product_handles, expectedMembership ?? [])) {
        add(issues, "collections", "source.product-facts-membership-parity");
      }
    }
  }
  for (const product of approvedCopy?.products ?? []) {
    for (const [field, value] of Object.entries(product.copy ?? {})) {
      validateVisibleText(value, issues, "products", `source.${field}-language`);
    }
  }
  if (!same(approvedCopy?.collectionsIndex, contract?.collections_index?.expected)) add(issues, "collections-index", "source.copy-parity");
  if (approvedCopy?.home?.seoTitle !== contract?.homepage?.expected?.seo_title ||
      approvedCopy?.home?.seoDescription !== contract?.homepage?.expected?.seo_description) {
    add(issues, "homepage", "source.seo-parity");
  }
  const approvedTheme = approvedCopy?.theme;
  const homeCopyParity = approvedTheme &&
    contract.homepage.expected.hero_text === approvedTheme.heroIntroduction &&
    contract.homepage.expected.featured_heading === approvedTheme.featuredHeading &&
    contract.homepage.expected.collections_heading === approvedTheme.collectionsHeading &&
    contract.homepage.expected.standards_heading === approvedTheme.detailsHeading &&
    contract.homepage.expected.standards_intro === approvedTheme.detailsIntroduction &&
    contract.homepage.expected.policy_note === approvedTheme.policyBand;
  if (!homeCopyParity) add(issues, "homepage", "source.copy-parity");
  return { issues };
}

const EVIDENCE_ROOT_KEYS = Object.freeze([
  "schema_version",
  "record_type",
  "source_contract_sha256",
  "captured_at",
  "candidate",
  "brand_identity",
  "homepage",
  "collections_index",
  "pages",
  "collections",
  "navigation",
  "search_and_filters",
  "policies",
  "settings",
  "domains",
  "notifications",
]);

function validateEvidenceScope(record, candidate, issues, surface) {
  if (!exactKeys(record, ["candidate_theme_id", "package_sha256"], issues, surface, "scope.keys")) return;
  if (record.candidate_theme_id !== candidate?.theme_id) add(issues, surface, "scope.theme-linkage");
  if (record.package_sha256 !== candidate?.package_sha256) add(issues, surface, "scope.package-linkage");
}

export function validateProviderSurfaceReadback(contract, evidence, options = {}) {
  const issues = [];
  if (validateProviderSurfacesContract(contract).issues.length > 0) {
    add(issues, "provider-readback", "source-contract.invalid");
    return { issues };
  }
  if (!exactKeys(evidence, EVIDENCE_ROOT_KEYS, issues, "provider-readback", "root.keys")) return { issues };
  if (evidence.schema_version !== 1 || evidence.record_type !== "mochirii-private-provider-surface-readback") {
    add(issues, "provider-readback", "root.identity");
  }
  if (evidence.source_contract_sha256 !== providerSurfaceContractSha256(contract)) add(issues, "provider-readback", "root.contract-linkage");
  const capturedAt = Date.parse(evidence.captured_at);
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  if (!validTimestamp(evidence.captured_at) || capturedAt > now || now - capturedAt > PRIVATE_READBACK_MAX_AGE_MS) {
    add(issues, "provider-readback", "root.freshness");
  }

  const candidate = evidence.candidate;
  if (exactKeys(candidate, ["theme_id", "admin_status", "published", "package_sha256"], issues, "candidate", "root.keys")) {
    if (typeof candidate.theme_id !== "string" || !/^\d+$/u.test(candidate.theme_id)) add(issues, "candidate", "theme-id");
    if (options.expectedCandidateThemeId !== undefined && candidate.theme_id !== options.expectedCandidateThemeId) add(issues, "candidate", "theme-id-policy");
    if (candidate.admin_status !== "Draft" || candidate.published !== false) add(issues, "candidate", "status-semantics");
    if (!validSha(candidate.package_sha256)) add(issues, "candidate", "package-sha256");
    if (options.expectedPackageSha256 !== undefined && candidate.package_sha256 !== options.expectedPackageSha256) add(issues, "candidate", "package-policy");
  }

  const brand = evidence.brand_identity;
  if (exactKeys(brand, ["scope", "canonical_reference_sha256", "storefront_derivative_sha256", "provider_logo_readbacks"], issues, "brand-identity", "root.keys")) {
    validateEvidenceScope(brand.scope, candidate, issues, "brand-identity");
    if (brand.canonical_reference_sha256 !== contract.brand_identity.canonical_reference.sha256 ||
        brand.storefront_derivative_sha256 !== contract.brand_identity.storefront_derivative.sha256) {
      add(issues, "brand-identity", "emblem-reference-parity");
    }
    validateSequentialOrder(brand.provider_logo_readbacks, issues, "brand-identity");
    if (!Array.isArray(brand.provider_logo_readbacks) || brand.provider_logo_readbacks.length !== EXPECTED_PROVIDER_LOGO_SURFACES.length) {
      add(issues, "brand-identity", "provider-logo.exact-count");
    }
    for (const [index, expectedSurface] of EXPECTED_PROVIDER_LOGO_SURFACES.entries()) {
      const item = brand.provider_logo_readbacks?.[index];
      if (!exactKeys(item, ["order", "surface", "configuration_available", "status", "selected_asset_sha256", "readback_sha256"], issues, "brand-identity", "provider-logo.keys")) continue;
      if (item.surface !== expectedSurface || !validSha(item.readback_sha256)) add(issues, "brand-identity", "provider-logo.identity");
      if (item.configuration_available === true) {
        if (item.status !== "matched" || item.selected_asset_sha256 !== contract.brand_identity.storefront_derivative.sha256) add(issues, "brand-identity", "provider-logo.configurable-parity");
      } else if (item.configuration_available === false) {
        if (item.status !== "not-configurable" || item.selected_asset_sha256 !== null) add(issues, "brand-identity", "provider-logo.not-configurable-state");
      } else {
        add(issues, "brand-identity", "provider-logo.pending");
      }
    }
  }

  const homepage = evidence.homepage;
  if (exactKeys(homepage, ["scope", "values", "observed_sha256", "hero_image_sha256", "hero_image_alt", "featured_product_handles"], issues, "homepage", "root.keys")) {
    validateEvidenceScope(homepage.scope, candidate, issues, "homepage");
    if (!same(homepage.values, contract.homepage.expected)) add(issues, "homepage", "readback.exact-parity");
    if (homepage.observed_sha256 !== canonicalSha256(homepage.values)) add(issues, "homepage", "readback.sha256");
    if (contract.homepage.expected.hero_media_approval_status !== "approved" || !validSha(contract.homepage.expected.approved_hero_image_sha256)) {
      add(issues, "homepage", "source-approval.hero-pending");
    } else if (homepage.hero_image_sha256 !== contract.homepage.expected.approved_hero_image_sha256) {
      add(issues, "homepage", "readback.hero-image");
    }
    if (homepage.hero_image_alt !== contract.homepage.expected.approved_hero_image_alt) {
      add(issues, "homepage", "readback.hero-image-alt");
    }
    if (contract.homepage.expected.featured_products_approval_status !== "approved" || !Array.isArray(contract.homepage.expected.approved_featured_product_handles)) {
      add(issues, "homepage", "source-approval.featured-products-pending");
    } else if (!same(homepage.featured_product_handles, contract.homepage.expected.approved_featured_product_handles)) {
      add(issues, "homepage", "readback.featured-products");
    }
  }

  const collectionsIndex = evidence.collections_index;
  if (exactKeys(collectionsIndex, ["scope", "values", "observed_sha256"], issues, "collections-index", "root.keys")) {
    validateEvidenceScope(collectionsIndex.scope, candidate, issues, "collections-index");
    if (!same(collectionsIndex.values, contract.collections_index.expected)) add(issues, "collections-index", "readback.exact-parity");
    if (collectionsIndex.observed_sha256 !== canonicalSha256(collectionsIndex.values)) add(issues, "collections-index", "readback.sha256");
  }

  const pages = evidence.pages;
  if (exactKeys(pages, ["items"], issues, "pages", "root.keys")) {
    validateSequentialOrder(pages.items, issues, "pages");
    if (!Array.isArray(pages.items) || pages.items.length !== contract.pages.items.length) add(issues, "pages", "readback.exact-count");
    for (const [index, expected] of contract.pages.items.entries()) {
      const item = pages.items?.[index];
      if (!exactKeys(item, ["order", "handle", "route", "title", "seo_title", "seo_description", "seo_sha256", "content_sha256"], issues, "pages", "item.keys")) continue;
      if (item.order !== expected.order || item.handle !== expected.handle || item.route !== expected.route || item.title !== expected.title ||
          item.seo_title !== expected.seo_title || item.seo_description !== expected.seo_description || item.seo_sha256 !== expected.approved_seo_sha256) {
        add(issues, "pages", "readback.identity");
      }
      if (item.content_sha256 !== expected.approved_content_sha256) add(issues, "pages", "readback.content-sha256");
    }
  }

  const collections = evidence.collections;
  if (exactKeys(collections, ["items"], issues, "collections", "root.keys")) {
    validateSequentialOrder(collections.items, issues, "collections");
    if (!Array.isArray(collections.items) || collections.items.length !== contract.collections.items.length) add(issues, "collections", "readback.exact-count");
    for (const [index, expected] of contract.collections.items.entries()) {
      const item = collections.items?.[index];
      if (!exactKeys(item, [
        "order", "handle", "route", "title", "seo_title", "seo_description", "seo_sha256", "description_sha256", "rendered_html_sha256",
        "image_sha256", "image_alt", "product_handles",
      ], issues, "collections", "item.keys")) continue;
      if (item.order !== expected.order || item.handle !== expected.handle || item.route !== expected.route || item.title !== expected.title ||
          item.seo_title !== expected.seo_title || item.seo_description !== expected.seo_description || item.seo_sha256 !== expected.approved_seo_sha256) {
        add(issues, "collections", "readback.identity");
      }
      if (item.description_sha256 !== expected.approved_description_sha256) add(issues, "collections", "readback.description-sha256");
      if (expected.rendered_html_approval_status !== "approved" || !validSha(expected.approved_rendered_html_sha256)) {
        add(issues, "collections", "source-approval.rendered-html-pending");
      } else if (item.rendered_html_sha256 !== expected.approved_rendered_html_sha256) {
        add(issues, "collections", "readback.rendered-html-sha256");
      }
      if (expected.media_approval_status !== "approved" || !validSha(expected.approved_image_sha256) || typeof expected.approved_image_alt !== "string") {
        add(issues, "collections", "source-approval.media-pending");
      } else if (item.image_sha256 !== expected.approved_image_sha256 || item.image_alt !== expected.approved_image_alt) {
        add(issues, "collections", "readback.media-parity");
      }
      if (expected.membership_approval_status !== "approved" || !Array.isArray(expected.approved_product_handles)) {
        add(issues, "collections", "source-approval.membership-pending");
      } else if (!same(item.product_handles, expected.approved_product_handles)) {
        add(issues, "collections", "readback.membership-parity");
      }
    }
  }

  const navigation = evidence.navigation;
  if (exactKeys(navigation, ["scope", "observed", "observed_sha256"], issues, "navigation", "root.keys")) {
    validateEvidenceScope(navigation.scope, candidate, issues, "navigation");
    const expected = { header: contract.navigation.header, footer_groups: contract.navigation.footer_groups };
    if (!same(navigation.observed, expected)) add(issues, "navigation", "readback.exact-parity");
    if (navigation.observed_sha256 !== canonicalSha256(navigation.observed)) add(issues, "navigation", "readback.sha256");
  }

  const filters = evidence.search_and_filters;
  if (exactKeys(filters, ["scope", "observed_filters", "vendor_filter_present", "observed_sha256"], issues, "search-and-filters", "root.keys")) {
    validateEvidenceScope(filters.scope, candidate, issues, "search-and-filters");
    if (!same(filters.observed_filters, contract.search_and_filters.filters)) add(issues, "search-and-filters", "readback.exact-parity");
    if (filters.vendor_filter_present !== false) add(issues, "search-and-filters", "readback.vendor-filter");
    if (filters.observed_sha256 !== canonicalSha256({ filters: filters.observed_filters, vendor_filter_present: filters.vendor_filter_present })) {
      add(issues, "search-and-filters", "readback.sha256");
    }
  }

  const policies = evidence.policies;
  if (exactKeys(policies, ["items"], issues, "policies", "root.keys")) {
    validateSequentialOrder(policies.items, issues, "policies");
    if (!Array.isArray(policies.items) || policies.items.length !== contract.policies.items.length) add(issues, "policies", "readback.exact-count");
    for (const [index, expected] of contract.policies.items.entries()) {
      const item = policies.items?.[index];
      if (!exactKeys(item, ["order", "identity", "route", "title", "content_sha256", "normalized_body", "detected_third_party_names"], issues, "policies", "item.keys")) continue;
      if (expected.approval_status !== "approved" || !validSha(expected.approved_content_sha256)) add(issues, "policies", "source-approval.pending");
      if (item.order !== expected.order || item.identity !== expected.identity || item.route !== expected.route || item.title !== expected.expected_title) add(issues, "policies", "readback.identity");
      if (item.content_sha256 !== expected.approved_content_sha256) add(issues, "policies", "readback.content-sha256");
      if (typeof item.normalized_body !== "string" || item.normalized_body.trim() !== item.normalized_body ||
          item.normalized_body.length === 0 || textSha256(item.normalized_body) !== item.content_sha256) {
        add(issues, "policies", "readback.body-hash");
      } else {
        validatePrivateBody(
          item.normalized_body,
          item.detected_third_party_names,
          "policies-and-privacy",
          item.route,
          evidence,
          options,
          issues,
          "policies",
        );
      }
    }
  }

  const settings = evidence.settings;
  if (exactKeys(settings, ["scope", "values", "observed_sha256"], issues, "settings", "root.keys")) {
    validateEvidenceScope(settings.scope, candidate, issues, "settings");
    if (!same(settings.values, contract.settings.expected)) add(issues, "settings", "readback.exact-parity");
    if (settings.observed_sha256 !== canonicalSha256(settings.values)) add(issues, "settings", "readback.sha256");
  }

  const domains = evidence.domains;
  if (exactKeys(domains, [
    "scope",
    "primary_customer_domain",
    "primary_customer_url",
    "shop_url",
    "canonical_url_hosts",
    "json_ld_url_hosts",
    "customer_absolute_link_hosts",
    "observed_sha256",
  ], issues, "domains", "root.keys")) {
    validateEvidenceScope(domains.scope, candidate, issues, "domains");
    const expectedDomain = contract.settings.expected.primary_customer_domain;
    const expectedUrl = contract.settings.expected.primary_customer_url;
    if (domains.primary_customer_domain !== expectedDomain || domains.primary_customer_url !== expectedUrl ||
        domains.shop_url !== expectedUrl || !same(domains.canonical_url_hosts, [expectedDomain]) ||
        !same(domains.json_ld_url_hosts, [expectedDomain]) ||
        !same(domains.customer_absolute_link_hosts, [expectedDomain, "mochirii.com"])) {
      add(issues, "domains", "readback.exact-parity");
    }
    const values = withoutKeys(domains, ["scope", "observed_sha256"]);
    if (domains.observed_sha256 !== canonicalSha256(values)) add(issues, "domains", "readback.sha256");
  }

  const notifications = evidence.notifications;
  if (exactKeys(notifications, ["sender", "items"], issues, "notifications", "root.keys")) {
    const sender = notifications.sender;
    if (exactKeys(sender, [
      "display_name",
      "sender_address_sha256",
      "sender_domain_sha256",
      "authenticated",
      "domain_ownership_status",
      "readback_sha256",
    ], issues, "notifications", "sender.keys")) {
      const sourceSender = contract.notifications.sender_presentation;
      if (sourceSender.approval_status !== "approved") {
        add(issues, "notifications", "source-approval.sender-pending");
      } else if (sender.display_name !== sourceSender.display_name ||
          sender.sender_address_sha256 !== sourceSender.approved_sender_address_sha256 ||
          sender.sender_domain_sha256 !== sourceSender.approved_sender_domain_sha256 ||
          sender.authenticated !== true || sender.domain_ownership_status !== "approved") {
        add(issues, "notifications", "readback.sender-parity");
      }
      const senderValues = withoutKeys(sender, ["readback_sha256"]);
      if (sender.readback_sha256 !== canonicalSha256(senderValues)) add(issues, "notifications", "readback.sender-sha256");
    }
    validateSequentialOrder(notifications.items, issues, "notifications");
    if (!Array.isArray(notifications.items) || notifications.items.length !== contract.notifications.items.length) add(issues, "notifications", "readback.exact-count");
    for (const [index, expected] of contract.notifications.items.entries()) {
      const item = notifications.items?.[index];
      if (!exactKeys(item, ["order", "identity", "subject", "subject_sha256", "body_sha256", "normalized_body", "detected_third_party_names"], issues, "notifications", "item.keys")) continue;
      if (expected.approval_status !== "approved" || !validSha(expected.approved_subject_sha256) || !validSha(expected.approved_body_sha256)) {
        add(issues, "notifications", "source-approval.pending");
      }
      if (item.order !== expected.order || item.identity !== expected.identity || item.subject !== expected.approved_subject) add(issues, "notifications", "readback.identity");
      validateVisibleText(item.subject, issues, "notifications", "readback.subject");
      if (item.subject_sha256 !== expected.approved_subject_sha256 || item.subject_sha256 !== textSha256(item.subject)) add(issues, "notifications", "readback.subject-sha256");
      if (item.body_sha256 !== expected.approved_body_sha256) add(issues, "notifications", "readback.body-sha256");
      if (typeof item.normalized_body !== "string" || item.normalized_body.trim() !== item.normalized_body ||
          item.normalized_body.length === 0 || textSha256(item.normalized_body) !== item.body_sha256) {
        add(issues, "notifications", "readback.body-hash");
      } else {
        validatePrivateBody(
          item.normalized_body,
          item.detected_third_party_names,
          "notifications",
          `notification:${item.identity}`,
          evidence,
          options,
          issues,
          "notifications",
        );
      }
    }
  }
  return { issues };
}

export function summarizeProviderSurfaceIssues(issues) {
  const counts = new Map();
  for (const issue of issues) {
    const key = `${issue?.surface ?? "provider-surfaces"}\u0000${issue?.category ?? "invalid"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [surface, category] = key.split("\u0000");
    return { surface, category, count };
  }).sort((left, right) => left.surface.localeCompare(right.surface) || left.category.localeCompare(right.category));
}
