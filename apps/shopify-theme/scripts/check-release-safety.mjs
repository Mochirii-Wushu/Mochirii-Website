import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutPrimitiveCategories } from "./lib/checkout-cta-safety.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

function readThemeJson(relativePath) {
  return JSON.parse(read(relativePath).replace(/^\s*[/][*][\s\S]*?[*][/]\s*/u, ""));
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function requireText(relativePath, source, expected) {
  if (!source.includes(expected)) {
    failures.push(`${relativePath}: missing release-safety contract: ${expected}`);
  }
}

const settings = readThemeJson("config/settings_data.json");
if (settings.current?.checkout_cta_enabled !== false) {
  failures.push("config/settings_data.json: checkout_cta_enabled must remain false");
}
for (const removedSetting of ["checkout_enabled", "product_publication_approved", "show_internal_product_meta"]) {
  if (Object.hasOwn(settings.current ?? {}, removedSetting)) {
    failures.push(`config/settings_data.json: obsolete or unsafe setting is forbidden: ${removedSetting}`);
  }
}
for (const immutableWordmarkSetting of ["brand_display_name", "corporate_display_name"]) {
  if (Object.hasOwn(settings.current ?? {}, immutableWordmarkSetting)) {
    failures.push(`config/settings_data.json: immutable Mochirii Cosmetics wordmark cannot be a setting: ${immutableWordmarkSetting}`);
  }
}

const schema = readThemeJson("config/settings_schema.json");
const schemaSettings = schema.flatMap((group) => group.settings ?? []);
const checkoutCtaControl = schemaSettings.find((setting) => setting.id === "checkout_cta_enabled");
if (!checkoutCtaControl || checkoutCtaControl.type !== "checkbox" || checkoutCtaControl.default !== false ||
    !checkoutCtaControl.info?.includes("Controls only this theme's cart-page button") ||
    !checkoutCtaControl.info?.includes("It does not disable other checkout routes")) {
  failures.push("config/settings_schema.json: checkout_cta_enabled must be a false-by-default presentation-only control");
}
for (const removedSetting of ["checkout_enabled", "product_publication_approved", "show_internal_product_meta"]) {
  if (schemaSettings.some((setting) => setting.id === removedSetting)) {
    failures.push(`config/settings_schema.json: obsolete or unsafe setting is forbidden: ${removedSetting}`);
  }
}
for (const immutableWordmarkSetting of ["brand_display_name", "corporate_display_name"]) {
  if (schemaSettings.some((setting) => setting.id === immutableWordmarkSetting)) {
    failures.push(`config/settings_schema.json: immutable Mochirii Cosmetics wordmark cannot be editable: ${immutableWordmarkSetting}`);
  }
}

const liquidFiles = walk(appRoot)
  .filter((file) => path.extname(file) === ".liquid")
  .map((file) => ({
    relativePath: path.relative(appRoot, file).split(path.sep).join("/"),
    source: readFileSync(file, "utf8"),
  }));

const runtimeRoots = ["assets", "blocks", "config", "layout", "locales", "sections", "snippets", "templates"];
const checkoutRuntimeFiles = runtimeRoots
  .flatMap((root) => walk(path.join(appRoot, root)))
  .filter((file) => [".js", ".json", ".liquid"].includes(path.extname(file)))
  .map((file) => ({
    relativePath: path.relative(appRoot, file).split(path.sep).join("/"),
    source: readFileSync(file, "utf8"),
  }));
for (const { relativePath, source } of checkoutRuntimeFiles) {
  for (const category of checkoutPrimitiveCategories(source)) {
    failures.push(`${relativePath}: contains forbidden ${category}`);
  }
}

const forbiddenRuntimePatterns = [
  ["internal product metadata setting", /show_internal_product_meta/iu],
  ["obsolete publication setting", /product_publication_approved/iu],
  ["internal SKU output", /selected_variant[.]sku|variant[.]sku/iu],
  ["internal weight output", /weight_with_unit|selected_variant[.]weight/iu],
  ["vendor identity output", /product[.]vendor/iu],
  ["HS code output", /hs[_ -]?code/iu],
  ["editable storefront wordmark", /settings[.](?:brand_display_name|corporate_display_name)/u],
];

for (const { relativePath, source } of liquidFiles) {
  for (const [label, pattern] of forbiddenRuntimePatterns) {
    if (pattern.test(source)) failures.push(`${relativePath}: contains forbidden ${label}`);
  }
  if (relativePath !== "sections/main-cart.liquid" && /name=["']checkout["']/iu.test(source)) {
    failures.push(`${relativePath}: checkout submission exists outside the guarded cart surface`);
  }
}

const cart = read("sections/main-cart.liquid");
for (const token of [
  "{% if settings.checkout_cta_enabled %}",
  '<button class="button" type="submit" name="checkout">Checkout</button>',
  '<button class="button" type="button" disabled="disabled">Checkout opens when the store launches.</button>',
]) {
  requireText("sections/main-cart.liquid", cart, token);
}

const header = read("sections/header.liquid");
for (const token of [
  "site-nav--desktop",
  "mobile-menu__summary",
  "mobile-menu__panel",
  "primary-navigation-links",
  "settings.storefront_mode_text | escape",
  'aria-label="Mochirii Cosmetics skincare storefront home"',
  '<span class="brand-text">Mochirii Cosmetics</span>',
  "{% assign about_url = about_page.url %}",
  "{% assign help_url = faq_page.url %}",
]) {
  requireText("sections/header.liquid", header, token);
}

const themeStyles = read("assets/mochirii-theme.css");
for (const token of [
  ".site-nav--desktop",
  ".site-nav__sublist",
  ".site-nav__item--expanded > .site-nav__sublist",
  ".site-nav__toggle",
  ".mobile-menu__summary",
  ".mobile-menu__panel",
  "max-height: calc(100dvh - 6rem);",
  "overflow-y: auto;",
  "overscroll-behavior: contain;",
  '.field [aria-invalid="true"]',
  "@media (max-width: 960px)",
]) {
  requireText("assets/mochirii-theme.css", themeStyles, token);
}

const product = read("sections/main-product.liquid");
for (const token of [
  "{% form 'product', product, class: 'product-form product-purchase' %}",
  'data-product-variant-status aria-live="polite" aria-atomic="true"',
  "warnings.review_result == 'label-matched'",
  "{% if show_warnings %}",
  "certifications.review_result == 'verified-wording'",
  "{% if show_certifications %}",
  "product.metafields.custom.functional_identity",
  "product.metafields.custom.card_benefit",
  "product.metafields.custom.benefits.value",
  "product.metafields.custom.skin_type.value",
  "product.metafields.custom.appearance_concerns.value",
  "product.metafields.custom.routine_step",
  "product.metafields.custom.usage_directions",
  "product.metafields.custom.key_ingredient_details.value",
  "product.metafields.custom.ingredients_inci",
  "product.metafields.custom.warnings",
  "product.metafields.custom.texture",
  "product.metafields.custom.finish",
  "product.metafields.custom.fragrance_status",
  "product.metafields.custom.country_of_origin",
  "product.metafields.custom.package_details",
  "product.metafields.custom.certifications.value",
  "product.metafields.custom.complementary_products.value",
  "product.metafields.custom.volume",
  "volume_facts.display",
  "usage_directions.text",
  "usage_directions.frequency",
  "usage_directions.amount",
  "usage_directions.routine_timing",
  "usage_directions.rinse_behavior",
  "ingredient.name",
  "ingredient.cosmetic_role",
  "warning_incompatibilities",
  "certification_items",
  "Mochirii routine companions",
]) {
  requireText("sections/main-product.liquid", product, token);
}
for (const [label, pattern] of [
  ["generic warning fallback", /Warning information is not available|No additional product-specific warnings are listed/iu],
  ["unreviewed materials fallback", /custom[.]materials/iu],
  ["uncontrolled product type", /product[.]type/iu],
  ["uncontrolled product tags", /product[.]tags/iu],
  ["vendor-managed product description", /product[.]description/iu],
  ["vendor identity", /product[.]vendor/iu],
]) {
  if (pattern.test(product)) failures.push(`sections/main-product.liquid: contains ${label}`);
}

const themeScript = read("assets/mochirii-theme.js");
for (const token of [
  "variantStatus.textContent",
  'field.setAttribute("aria-invalid", "true")',
  'field.setAttribute("aria-describedby", error.id)',
  'form.querySelector("[data-contact-error-summary]")',
  'document.querySelectorAll("[data-navigation-toggle]")',
  'submenu.querySelectorAll("[data-navigation-toggle]")',
  'mobileMenu.addEventListener("toggle"',
  'mobileMenu.open = false',
  "const samePageHashTarget = (link) =>",
  'document.addEventListener("click", (event) =>',
  'target.setAttribute("tabindex", "-1")',
  "target.focus()",
]) {
  requireText("assets/mochirii-theme.js", themeScript, token);
}

const contactPage = read("sections/main-page.liquid");
for (const token of [
  "data-contact-error-summary",
  "data-contact-field",
  'aria-invalid="true" aria-describedby=',
  "data-contact-field-error",
]) {
  requireText("sections/main-page.liquid", contactPage, token);
}

const primaryNavigation = read("snippets/primary-navigation-links.liquid");
for (const token of [
  'class="site-nav__list"',
  "required_navigation_labels = 'Shop|Product type|Skin needs|Routine|About|Help'",
  "matching_menu_link",
  "{% if required_url != blank %}",
  "child_url_prefix == '/'",
  "child_url_protocol_relative != '//'",
  "child_url_encoded contains '%5C'",
  "grandchild_url_prefix == '/'",
  "grandchild_url_protocol_relative != '//'",
  "grandchild_url_encoded contains '%5C'",
  "grandchild_link",
  "data-navigation-toggle",
  'aria-expanded="false"',
  "{{ required_label | escape }}",
  "{{ child_link.title | escape }}",
  "{{ grandchild_link.title | escape }}",
]) {
  requireText("snippets/primary-navigation-links.liquid", primaryNavigation, token);
}

for (const token of [
  "navigation_id: 'desktop-primary'",
  "navigation_id: 'mobile-primary'",
]) {
  requireText("sections/header.liquid", header, token);
}

if (themeStyles.includes(".site-nav__item:hover > .site-nav__sublist")) {
  failures.push("assets/mochirii-theme.css: disclosure state must exclusively control desktop nested navigation");
}
if (/(?:^|\n)\.mobile-menu__panel\s+\.site-nav__toggle\s*\{[^}]*display:\s*none/iu.test(themeStyles)) {
  failures.push("assets/mochirii-theme.css: mobile navigation disclosure controls must remain visible when JavaScript is available");
}
for (const token of [
  ".mobile-menu__panel .site-nav__toggle {\n  display: inline-flex;",
  "html:not(.theme-js-ready) .mobile-menu__panel .site-nav__sublist",
]) {
  requireText("assets/mochirii-theme.css", themeStyles, token);
}

const footer = read("sections/footer.liquid");
requireText("sections/footer.liquid", footer, "{% if link.url != blank %}");
for (const token of [
  '>Contact</a>',
  '>FAQ</a>',
  '>Shipping</a>',
  '>Returns</a>',
  '>About</a>',
  '>Ingredients &amp; Standards</a>',
  '>Accessibility</a>',
  '>Privacy</a>',
  '>Terms</a>',
  '>Privacy Choices</a>',
  "privacy_choices_url",
  "privacy_url_encoded contains '%5C'",
  "privacy_url_downcase contains '%5c'",
  "section.settings.summary_text | default: settings.footer_summary | escape",
  "Mochirii Cosmetics. All rights reserved.",
  "contact_page.url | escape }}\">Contact Mochirii Cosmetics.",
  "{% if contact_page != blank %}<a href=\"{{ contact_page.url | escape }}\">Contact</a>{% endif %}",
  "{% if shop.shipping_policy != blank %}<a href=\"{{ shop.shipping_policy.url | escape }}\">Shipping</a>{% endif %}",
]) {
  requireText("sections/footer.liquid", footer, token);
}
if (footer.includes("/pages/data-sharing-opt-out")) {
  failures.push("sections/footer.liquid: privacy choices must come from a configured provider menu link");
}
if (/default:\s*["']\/(?:pages|policies)\//u.test(footer)) {
  failures.push("sections/footer.liquid: missing provider pages or policies must be omitted, not linked to synthetic routes");
}

for (const token of [
  "usage_text | escape | newline_to_br",
  "warning_text | escape | newline_to_br",
  "package_details | escape | newline_to_br",
  "ingredient_name | escape",
  "ingredient_role | escape",
  "ingredients_inci | escape",
  "certification_items | join: ', ' | escape",
]) {
  requireText("sections/main-product.liquid", product, token);
}

const productCard = read("snippets/product-card.liquid");
for (const token of [
  "line_label | escape",
  "product.title | escape",
  "card_benefit | truncate: 118 | escape",
  "volume_display | escape",
]) {
  requireText("snippets/product-card.liquid", productCard, token);
}

const structuredData = read("snippets/structured-data.liquid");
for (const token of [
  '"@type": "Product"',
  '"@type": "Brand"',
  '"name": "Mochirii Cosmetics"',
  "product.metafields.custom.card_benefit",
  "product.metafields.custom.volume",
  "structured_volume_facts.display",
  "product.metafields.custom.usage_directions.value",
  "structured_usage.frequency",
  "structured_usage.amount",
  "structured_usage.routine_timing",
  "structured_usage.rinse_behavior",
  "product.metafields.custom.key_ingredient_details.value",
  "ingredient.name",
  "ingredient.cosmetic_role",
  "structured_warnings.review_result == 'label-matched'",
  "structured_certifications.review_result == 'verified-wording'",
  '"additionalProperty"',
  '"priceCurrency"',
  '"availability"',
]) {
  requireText("snippets/structured-data.liquid", structuredData, token);
}
for (const [label, pattern] of [
  ["automatic product structured data", /product\s*[|]\s*structured_data/iu],
  ["vendor identity", /product[.]vendor/iu],
  ["vendor-managed product description", /product[.]description/iu],
  ["unreviewed materials fallback", /custom[.]materials/iu],
]) {
  if (pattern.test(structuredData)) failures.push(`snippets/structured-data.liquid: contains ${label}`);
}

const home = read("sections/main-index.liquid");
requireText("sections/main-index.liquid", home, "'mochirii-page-password.webp' | asset_url");
for (const token of [
  "hero_image != blank and hero_alt != blank",
  'alt="Abstract green Mochirii Cosmetics artwork."',
  "Hero image alt text (required when image is set)",
]) {
  requireText("sections/main-index.liquid", home, token);
}
for (const [label, pattern] of [
  ["automatic first-product hero fallback", /hero_product|collections[.]all[.]products[.]first|catalog_collection[.]products[.]first/iu],
  ["forced bestseller claim", /\bbestsellers?\b/iu],
]) {
  if (pattern.test(home)) failures.push(`sections/main-index.liquid: contains ${label}`);
}

const collection = read("sections/main-collection.liquid");
for (const token of [
  '<form id="shop-filters"',
  "'filter.v.availability|boolean', 'filter.v.price|price_range', 'filter.p.m.custom.product_type|list', 'filter.p.m.custom.skin_type|list', 'filter.p.m.custom.appearance_concerns|list', 'filter.p.m.custom.routine_step|list', 'filter.p.m.custom.key_ingredients|list'",
  'step="0.01"',
  'action="{{ collection.url | escape }}"',
  'name="{{ filter.param_name | escape }}"',
  'value="{{ filter.true_value.value | escape }}"',
  'value="{{ filter.false_value.value | escape }}"',
  'name="{{ value.param_name | escape }}"',
  'value="{{ value.value | escape }}"',
  "collection.title | escape",
  "settings.empty_catalog_heading | escape",
  "settings.empty_catalog_body | escape",
  "catalog_url | escape",
  "money_without_currency | replace: ',', '' | escape",
]) {
  requireText("sections/main-collection.liquid", collection, token);
}
if ((collection.match(/step="0[.]01"/gu) ?? []).length !== 2) {
  failures.push("sections/main-collection.liquid: both price filter inputs must use cent precision");
}
if (/\bvendor\b/iu.test(collection)) {
  failures.push("sections/main-collection.liquid: Vendor filter or output is forbidden");
}

const giftCard = read("templates/gift_card.liquid");
if (/(?:apple_wallet|add_to_wallet|wallet_pass)/iu.test(giftCard)) {
  failures.push("templates/gift_card.liquid: wallet-provider surfaces must remain absent");
}
requireText("templates/gift_card.liquid", giftCard, "assign storefront_name = 'Mochirii Cosmetics'");

for (const relativePath of ["sections/main-index.liquid", "sections/main-collection.liquid"]) {
  const source = read(relativePath);
  if (/render 'product-card'[^\n]*(?:image_loading|image_fetchpriority)/u.test(source)) {
    failures.push(`${relativePath}: below-fold product cards must not be forced eager or high-priority`);
  }
}

for (const relativePath of [
  "sections/main-cart.liquid",
  "sections/main-index.liquid",
  "sections/main-product.liquid",
  "snippets/product-card.liquid",
]) {
  const source = read(relativePath);
  if (/[.]alt\s*[|]\s*default\s*:/iu.test(source)) {
    failures.push(`${relativePath}: media alt text must not fall back to a product or collection title`);
  }
}

const search = read("sections/main-search.liquid");
requireText(
  "sections/main-search.liquid",
  search,
  "Try another product name or ingredient, or browse all skincare.",
);

const filterMetafieldTool = read("scripts/lib/shopify-filter-metafield-csv.mjs");
for (const token of [
  "SHOPIFY_FILTER_METAFIELD_DEFINITIONS",
  "buildShopifyFilterMetafieldInputs",
  "Exactly 20 manifest products are required",
  "skin_type_options",
  "concern_options",
  "list.single_line_text_field",
]) {
  requireText("scripts/lib/shopify-filter-metafield-csv.mjs", filterMetafieldTool, token);
}

const productCopyTool = read("scripts/lib/shopify-product-copy-csv.mjs");
for (const token of [
  "SHOPIFY_PRODUCT_COPY_UPDATE_HEADERS",
  "buildShopifyProductCopyRows",
  "serializeShopifyProductCopyRows",
  "Exactly 20 approved public-copy products are required",
  "does not match the approved copy-only columns",
]) {
  requireText("scripts/lib/shopify-product-copy-csv.mjs", productCopyTool, token);
}

for (const [relativePath, source] of [
  ["scripts/lib/shopify-filter-metafield-csv.mjs", filterMetafieldTool],
  ["scripts/lib/shopify-product-copy-csv.mjs", productCopyTool],
]) {
  for (const [label, pattern] of [
    ["filesystem access", /(?:node:fs|from ["']fs["'])/iu],
    ["child-process execution", /(?:node:child_process|child_process)/iu],
    ["environment access", /process[.]env/iu],
    ["network access", /\bfetch\s*[(]|https?:\/\//iu],
    ["provider mutation operation", /\b(?:mutation|adminApi|graphql|productUpdate)\b/iu],
  ]) {
    if (pattern.test(source)) failures.push(`${relativePath}: generic tooling contains ${label}`);
  }
}

const seoMeta = read("snippets/seo-meta.liquid");
for (const token of [
  "assign storefront_name = 'Mochirii Cosmetics'",
  "settings.default_meta_description",
  "seo_title | replace: '&amp;', '&'",
  "seo_title | escape",
  "product.metafields.custom.card_benefit.value",
  "assign social_image = settings.social_share_image",
  "'mochirii-page-password.webp' | asset_url",
  "assign social_image_url",
  "social_image_width",
  "social_image_height",
]) {
  requireText("snippets/seo-meta.liquid", seoMeta, token);
}
for (const [label, pattern] of [
  ["automatic product social image", /product[.]featured_(?:media|image)/iu],
  ["automatic collection social image", /collection[.]image/iu],
  ["automatic page social image", /\bpage_image\b/iu],
  ["automatic first-product social image", /products[.]first/iu],
  ["vendor-managed product description", /product[.]description/iu],
]) {
  if (pattern.test(seoMeta)) failures.push(`snippets/seo-meta.liquid: contains ${label}`);
}
if (!/if request[.]page_type == 'product'[\s\S]*?assign seo_description = product[.]metafields[.]custom[.]card_benefit[.]value[\s\S]*?else[\s\S]*?assign seo_description = seo_description_override [|] default: page_description/u.test(seoMeta)) {
  failures.push("snippets/seo-meta.liquid: product descriptions must use controlled card_benefit while non-product pages retain their normal SEO source");
}

const themeLayout = read("layout/theme.liquid");
for (const token of [
  "assign storefront_name = 'Mochirii Cosmetics'",
  "request.page_type == 'product'",
  "product.metafields.custom.card_benefit.value",
  "request.page_type == 'page'",
  "page.title | append: page.title",
  "public_page_title | slice: 0, duplicated_page_title_prefix_length",
  "public_page_title | remove_first: page.title",
]) {
  requireText("layout/theme.liquid", themeLayout, token);
}

const passwordLayout = read("layout/password.liquid");
for (const token of [
  'lang="{{ request.locale.iso_code | escape }}"',
  "<title>Mochirii Cosmetics</title>",
  "settings.background_color | default: '#fffaf0' | escape",
  "settings.text_color | default: '#061610' | escape",
  "settings.accent_color | default: '#1f745f' | escape",
]) {
  requireText("layout/password.liquid", passwordLayout, token);
}

const passwordSection = read("sections/main-password.liquid");
for (const token of [
  'aria-label="Mochirii Cosmetics storefront home"',
  '<span class="brand-text">Mochirii Cosmetics</span>',
  "section.settings.eyebrow | escape",
  "section.settings.heading | escape",
  "section.settings.intro | escape",
  "section.id | escape",
  "The password did not match. Try again.",
]) {
  requireText("sections/main-password.liquid", passwordSection, token);
}
if (/form[.]errors\s*[|]\s*default_errors/u.test(passwordSection)) {
  failures.push("sections/main-password.liquid: password errors must use controlled Mochirii copy");
}

const productFactsContract = read("scripts/lib/product-facts-contract.mjs");
for (const token of [
  "normalizeLanguageForPolicy",
  "prohibitedMoodPattern",
  "metricConversionIsWithinLabelTolerance",
  "publicMediaReferencePattern",
  "media.duplicate-role",
  "media.duplicate-reference",
  "media.missing-outer-box",
]) {
  requireText("scripts/lib/product-facts-contract.mjs", productFactsContract, token);
}
if (!/if request[.]page_type == 'product'[\s\S]*?assign public_page_description = product[.]metafields[.]custom[.]card_benefit[.]value [|] strip[\s\S]*?else[\s\S]*?assign public_page_description = page_description [|] default: settings[.]default_meta_description/u.test(themeLayout)) {
  failures.push("layout/theme.liquid: product meta description must use controlled card_benefit without a page_description fallback");
}

const customerCopyCheck = read("scripts/check-customer-facing-copy.mjs");
for (const token of [
  "const runtimeCopyRoots = [",
  "Customer-facing copy guard OK (${files.length} runtime files).",
]) {
  requireText("scripts/check-customer-facing-copy.mjs", customerCopyCheck, token);
}
if (/runtimeCopyRoots\s*=\s*\[[\s\S]*?["']content["']/u.test(customerCopyCheck)) {
  failures.push("scripts/check-customer-facing-copy.mjs: broad runtime scan must not inspect evidence-reviewed content contracts");
}

if (failures.length) {
  console.error("Shopify release-safety check failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Shopify release-safety check OK (${liquidFiles.length} Liquid files; products visible, ` +
  "theme checkout CTA disabled; Shopify checkout remains provider-controlled).",
);
