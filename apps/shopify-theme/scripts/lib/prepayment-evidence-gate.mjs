import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  redactedPriceVerification,
  verifyPrivatePriceLedger,
} from "./private-price-rule.mjs";
import {
  REQUIRED_RENDERED_ROUTE_CATEGORIES,
  customerLanguageCompanyMatches,
  customerLanguageIssueCategories,
  exactCustomerLanguageCompanyName,
  normalizeCustomerLanguageForPolicy,
} from "./launch-content-contracts.mjs";
import {
  privateArtifactBindingKey,
  validatePrivateArtifactIndex,
} from "./private-artifact-index.mjs";
import { expectedShopifyProjection } from "./product-facts-contract.mjs";
import {
  providerSurfaceContractSha256,
  validateProviderSurfaceReadback,
  validateProviderSurfacesContract,
} from "./provider-surfaces-contract.mjs";
import { validateActiveSourceManifest } from "./active-source-manifest.mjs";

export const PREPAYMENT_GATE_POLICY = Object.freeze({
  gate: "mochirii-prepayment-complete",
  schema_version: 2,
  maximum_capture_age_hours: 24,
  repository: "Mochirii-Wushu/Mochirii-Website",
  branch: "main",
  market_country: "US",
  market_currency: "USD",
  candidate_theme_id: "141514408011",
  candidate_theme_status: "Draft",
  canonical_emblem_asset: "apps/web/public/assets/img/brand/emblem.webp",
  canonical_emblem_sha256: "ed9fe4c522bc2b0d1c2072c1c098f241ee52f0ceec0307cb531ce440e730bb60",
  storefront_emblem_asset: "apps/shopify-theme/assets/mochirii-emblem.webp",
  storefront_emblem_sha256: "ad96d3428572404d9f5c1d7387669b5680920079cdf8cc637fdebfa217d00df4",
  wordmark: "Mochirii Cosmetics",
  required_checks: Object.freeze([
    "validate",
    "validate-next",
    "validate-theme",
    "validate-social",
    "Vercel",
    "Supabase Preview",
  ]),
});

export const EXPECTED_PRODUCT_HANDLES = Object.freeze([
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

export const REQUIRED_EVIDENCE_KINDS = Object.freeze([
  "artifact-index",
  "source-readback",
  "theme-package",
  "candidate-theme-readback",
  "rendered-route-readback",
  "product-review",
  "private-price-ledger",
  "private-price-shopify-readback",
  "private-price-report",
  "launch-pages-readback",
  "provider-surface-readback",
  "mandatory-name-review",
  "fulfillment-shipping-readback",
  "operations-readback",
  "accessibility-performance-readback",
]);

export const REQUIRED_SEARCH_QUERIES = Object.freeze([
  "moisturizer",
  "moisturiser",
  "niacinimide",
  "hyaluronic",
  "retinol",
  "cleanser",
]);

const EXPECTED_COLLECTION_HANDLES = Object.freeze([
  "mochirii-cosmetics",
  "cleanse-tone",
  "hydrate-barrier",
  "brighten-smooth",
  "age-support-nourish",
]);

const EXPECTED_POLICY_IDENTITIES = Object.freeze([
  "refund-policy",
  "shipping-policy",
  "privacy-policy",
  "terms-of-service",
  "privacy-choices",
]);

const EXPECTED_NOTIFICATION_IDENTITIES = Object.freeze([
  "order-confirmation",
  "shipping-confirmation",
  "delivery-confirmation",
]);

const EVIDENCE_DOCUMENT_KEYS = Object.freeze([
  "schema_version",
  "evidence_kind",
  "captured_at",
  "repository",
  "source_commit_sha",
  "source_tree_sha",
  "candidate_theme_id",
  "expected_product_handles",
  "reviewer",
  "claim",
]);

const EVIDENCE_REVIEWER_KEYS = Object.freeze(["reviewer_id", "role", "reviewed_at"]);
const REVIEWER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{2,127}$/u;
const PLACEHOLDER_PATTERN = /(?:^|[-_.])(placeholder|unknown|todo|tbd|example)(?:$|[-_.])/iu;
const GID_VARIANT_PATTERN = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/u;
const GID_PRODUCT_PATTERN = /^gid:\/\/shopify\/Product\/[1-9]\d*$/u;
const GID_MEDIA_IMAGE_PATTERN = /^gid:\/\/shopify\/MediaImage\/[1-9]\d*$/u;
const USD_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/u;
const US_POSTAL_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/u;
const US_REGION_PATTERN = /^[A-Z]{2}$/u;
const SHOPIFY_ADMIN_API_VERSION = "2026-07";

const REQUIRED_SHIPPING_CASES = Object.freeze([
  "contiguous-us-light",
  "contiguous-us-standard",
  "contiguous-us-heavy",
  "alaska",
  "hawaii",
  "us-territories",
  "military-address",
  "po-box",
]);

const CONTIGUOUS_RATE_CASES = Object.freeze([
  "contiguous-us-light",
  "contiguous-us-standard",
  "contiguous-us-heavy",
]);

const EVIDENCE_REVIEWER_ROLES = Object.freeze({
  "artifact-index": "evidence-custodian",
  "source-readback": "release-reviewer",
  "theme-package": "theme-engineer",
  "candidate-theme-readback": "shopify-operator",
  "rendered-route-readback": "storefront-reviewer",
  "product-review": "product-evidence-custodian",
  "private-price-ledger": "pricing-reviewer",
  "private-price-shopify-readback": "shopify-operator",
  "private-price-report": "pricing-reviewer",
  "launch-pages-readback": "content-reviewer",
  "provider-surface-readback": "shopify-operator",
  "mandatory-name-review": "compliance-reviewer",
  "fulfillment-shipping-readback": "fulfillment-owner",
  "operations-readback": "compliance-reviewer",
  "accessibility-performance-readback": "accessibility-reviewer",
});

const ROOT_KEYS = Object.freeze([
  "schema_version",
  "gate",
  "captured_at",
  "market",
  "source",
  "candidate_theme",
  "rendered_routes",
  "product_review",
  "private_price",
  "launch_pages",
  "provider_surfaces",
  "mandatory_name_review",
  "fulfillment_shipping",
  "operational_gates",
  "quality_assurance",
  "final_phase_exclusions",
  "artifact_index_evidence_ref",
  "evidence_files",
]);

const PRODUCT_RECORD_KEYS = Object.freeze([
  "handle",
  "product_record_id",
  "variant_record_id",
  "active",
  "facts_pass",
  "formula_mapping_pass",
  "front_label_pass",
  "technical_panel_pass",
  "outer_box_pass",
  "media_pass",
  "emblem_pass",
  "wordmark_pass",
  "other_brand_absent_pass",
]);

const ROUTE_RESULT_KEYS = Object.freeze([
  "category",
  "checked_route_count",
  "http_pass",
  "readback_pass",
]);

const EVIDENCE_FILE_KEYS = Object.freeze(["id", "kind", "path", "sha256"]);
const SHA1_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REPEATED_CHARACTER_SHA1_PATTERN = /^([0-9a-f])\1{39}$/u;
const REPEATED_CHARACTER_SHA256_PATTERN = /^([0-9a-f])\1{63}$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_INVALID_CHARACTER_PATTERN = /[<>:"|?*\[\]\u0000-\u001f]/u;
const MAX_EVIDENCE_PATH_LENGTH = 1024;
const PRIVATE_FORMULA_RECORD_KEYS = Object.freeze([
  "schema_version",
  "record_type",
  "handle",
  "captured_at",
  "market",
  "source_catalog_record_sha256",
  "identity",
  "formula_identity_sha256",
  "approved_unit",
  "status",
]);
const PRIVATE_FORMULA_IDENTITY_KEYS = Object.freeze([
  "catalog_product_identifier",
  "catalog_variant_identifier",
  "formula_or_technical_panel_identifier",
  "region",
]);
const PRIVATE_APPROVED_UNIT_KEYS = Object.freeze([
  "front_label_sha256",
  "technical_panel_sha256",
  "outer_box_sha256",
]);
const PRIVATE_OCR_RECORD_KEYS = Object.freeze([
  "schema_version",
  "record_type",
  "handle",
  "role",
  "public_reference",
  "source_image_sha256",
  "captured_at",
  "engine",
  "pages",
  "normalized_text_sha256",
  "semantic_fields",
  "reviewed_block_consumers",
]);
const PRIVATE_OCR_ENGINE_KEYS = Object.freeze(["name", "version", "configuration_sha256"]);
const PRIVATE_OCR_PAGE_KEYS = Object.freeze(["page_number", "width", "height", "blocks"]);
const PRIVATE_OCR_BLOCK_KEYS = Object.freeze(["index", "text", "confidence_basis_points", "bbox"]);
const PRIVATE_OCR_BBOX_KEYS = Object.freeze(["x", "y", "width", "height"]);
const PRIVATE_OCR_SEMANTIC_FIELD_KEYS = Object.freeze([
  "field",
  "block_refs",
  "normalized_observed_sha256",
]);
const PRIVATE_OCR_BLOCK_REF_KEYS = Object.freeze(["page_number", "block_index"]);
const PRIVATE_OCR_REVIEWED_BLOCK_CONSUMER_KEYS = Object.freeze([
  "page_number",
  "block_index",
  "consumer_kind",
  "approved_fact_field",
  "technical_code_kind",
  "approved_artwork_sha256",
  "text_sha256",
  "reviewer",
  "reviewed_at",
]);
const PRIVATE_OCR_COMPARABLE_FIELDS = Object.freeze([
  "wordmark",
  "public_title",
  "functional_identity",
  "ingredients_inci",
  "usage_directions",
  "warnings",
  "volume",
  "country_of_origin",
  "certifications",
]);
const PRIVATE_OCR_TECHNICAL_CODE_KINDS = Object.freeze(new Set([
  "batch",
  "lot",
  "pao",
  "barcode",
  "recycling",
]));
const PRIVATE_LABEL_REVIEW_KEYS = Object.freeze([
  "schema_version",
  "record_type",
  "handle",
  "formula_identity_sha256",
  "reviewed_at",
  "canonical_emblem_sha256",
  "wordmark",
  "media",
]);
const PRIVATE_LABEL_REVIEW_MEDIA_KEYS = Object.freeze([
  "role",
  "public_reference",
  "source_image_sha256",
  "ocr_output_sha256",
  "inspection",
  "legible",
  "approved_unit_match",
  "emblem_comparison",
  "emblem_matches",
  "wordmark_matches",
  "other_brand_absent",
  "fact_hashes",
  "ocr_comparisons",
]);
const PRIVATE_LABEL_OCR_COMPARISON_KEYS = Object.freeze([
  "field",
  "expected_normalized_sha256",
  "observed_normalized_sha256",
  "match",
]);
const PRIVATE_LABEL_EMBLEM_COMPARISON_KEYS = Object.freeze([
  "canonical_emblem_sha256",
  "source_image_sha256",
  "match",
]);
const PRIVATE_IMAGE_INSPECTION_KEYS = Object.freeze(["format", "width", "height", "pages"]);
const PRIVATE_LABEL_FACT_HASH_KEYS = Object.freeze([
  "public_title",
  "functional_identity",
  "ingredients_inci",
  "usage_directions",
  "warnings",
  "volume",
  "country_of_origin",
  "certifications",
]);
const REQUIRED_OCR_MEDIA_ROLES = Object.freeze([
  "front",
  "technical-panel",
  "outer-box",
  "texture",
  "scale",
  "use",
]);
const PRIVATE_SHIPPING_MAPPING_RECORD_KEYS = Object.freeze([
  "schema_version",
  "record_type",
  "captured_at",
  "authenticated_source",
  "authentication_evidence_sha256",
  "market",
  "handle",
  "product_record_id",
  "variant_record_id",
  "formula_identity_sha256",
  "source_catalog_record_sha256",
  "supplier_expected_weight_grams",
  "status",
]);

const ROUTE_COUNT_REQUIREMENTS = Object.freeze(new Map([
  ["home", 1],
  ["collections", 5],
  ["products", 20],
  ["search-and-filters", 7],
  ["cart", 1],
  ["contact", 1],
  ["policies-and-privacy", 5],
  ["accounts", 1],
  ["errors", 2],
  ["password", 1],
  ["notifications", 3],
]));

function add(issues, gate, category) {
  issues.push({ gate, category });
}

function exactKeys(value, keys, issues, gate, category) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add(issues, gate, `${category}.type`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    add(issues, gate, `${category}.keys`);
    return false;
  }
  return true;
}

function nonemptyString(value, issues, gate, category) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    add(issues, gate, `${category}.text`);
    return false;
  }
  return true;
}

function validSha256(value) {
  return typeof value === "string" &&
    SHA256_PATTERN.test(value) &&
    !REPEATED_CHARACTER_SHA256_PATTERN.test(value);
}

function validGitObjectId(value) {
  return typeof value === "string" && SHA1_PATTERN.test(value) &&
    !REPEATED_CHARACTER_SHA1_PATTERN.test(value);
}

function validLighthouseScore(value, minimum = 0) {
  return Number.isFinite(value) && value >= minimum && value <= 100;
}

function accountableIdentifier(value, issues, gate, category) {
  if (typeof value !== "string" || !REVIEWER_ID_PATTERN.test(value) || PLACEHOLDER_PATTERN.test(value)) {
    add(issues, gate, `${category}.identity`);
    return false;
  }
  return true;
}

function exactBoolean(value, expected, issues, gate, category) {
  if (value !== expected) add(issues, gate, category);
}

function exactValue(value, expected, issues, gate, category) {
  if (value !== expected) add(issues, gate, category);
}

function sameSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function captureMilliseconds(value) {
  if (typeof value !== "string") return Number.NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return Number.NaN;
  return parsed;
}

function reviewDateMilliseconds(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : Number.NaN;
}

function requireFreshCapture(value, issues, gate, category, now) {
  const captured = captureMilliseconds(value);
  if (!Number.isFinite(captured)) {
    add(issues, gate, `${category}.format`);
    return;
  }
  const maximumAge = PREPAYMENT_GATE_POLICY.maximum_capture_age_hours * 60 * 60 * 1000;
  if (captured > now || now - captured > maximumAge) add(issues, gate, `${category}.freshness`);
}

function requireOrderedTimestamp(value, minimum, maximum, issues, gate, category) {
  const timestamp = captureMilliseconds(value);
  if (!Number.isFinite(timestamp)) {
    add(issues, gate, `${category}.format`);
    return Number.NaN;
  }
  if ((Number.isFinite(minimum) && timestamp < minimum) ||
      (Number.isFinite(maximum) && timestamp > maximum)) {
    add(issues, gate, `${category}.order`);
  }
  return timestamp;
}

function requireFreshObservation(value, envelopeCapture, issues, gate, category, now) {
  const maximumAge = PREPAYMENT_GATE_POLICY.maximum_capture_age_hours * 60 * 60 * 1000;
  return requireOrderedTimestamp(
    value,
    now - maximumAge,
    Math.min(now, envelopeCapture),
    issues,
    gate,
    category,
  );
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function evidencePathIsSafe(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 ||
      relativePath.length > MAX_EVIDENCE_PATH_LENGTH || relativePath.trim() !== relativePath ||
      relativePath.includes("\\") || path.posix.isAbsolute(relativePath) ||
      path.posix.normalize(relativePath) !== relativePath ||
      !relativePath.startsWith(".artifacts/operations/")) {
    return false;
  }
  return relativePath.split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." &&
    segment.trim() === segment && !segment.endsWith(".") && !segment.endsWith(" ") &&
    !WINDOWS_INVALID_CHARACTER_PATTERN.test(segment) && !WINDOWS_RESERVED_NAME_PATTERN.test(segment));
}

function containsSymbolicLink(repositoryRoot, absolutePath) {
  const relative = path.relative(repositoryRoot, absolutePath);
  if (!isInside(absolutePath, repositoryRoot) || relative === "") return true;
  let cursor = repositoryRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

function defaultPrivatePathGitStatus(repositoryRoot, repositoryRelativePath) {
  const run = (args) => spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const tracked = run(["ls-files", "--error-unmatch", "--", repositoryRelativePath]);
  const ignored = run(["check-ignore", "-q", "--no-index", "--", repositoryRelativePath]);
  if (![0, 1].includes(tracked.status) || ![0, 1].includes(ignored.status)) return null;
  return { tracked: tracked.status === 0, ignored: ignored.status === 0 };
}

function validatePrivatePathGitStatus(relativePath, context, issues, gate, category) {
  try {
    const status = (context.artifactGitPathStatus ??
      ((candidate) => defaultPrivatePathGitStatus(context.repositoryRoot, candidate)))(relativePath);
    if (!status || typeof status.tracked !== "boolean" || typeof status.ignored !== "boolean") {
      add(issues, gate, `${category}.git-status`);
      return;
    }
    if (status.tracked) add(issues, gate, `${category}.tracked`);
    if (!status.ignored) add(issues, gate, `${category}.not-ignored`);
  } catch {
    add(issues, gate, `${category}.git-status`);
  }
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function contractDigest(value) {
  return digest(Buffer.from(JSON.stringify(canonicalJson(value)) ?? "null", "utf8"));
}

function positiveUsdAmount(value) {
  return typeof value === "string" && USD_AMOUNT_PATTERN.test(value) && Number(value) > 0;
}

function validateShopifyProductReadback(
  readback,
  expectedProjection,
  publicRecord,
  envelopeCapture,
  issues,
  now,
) {
  const gate = "product-review";
  const keys = [
    "observed_at",
    "product_id",
    "status",
    "variant_ids",
    "has_only_default_variant",
    "default_variant",
    "handle",
    "title",
    "vendor",
    "description_html",
    "seo",
    "metafields",
    "collection_handles",
    "media",
    "record_sha256",
  ];
  if (!exactKeys(readback, keys, issues, gate, "evidence.product.shopify-readback")) return;
  requireFreshObservation(
    readback.observed_at,
    envelopeCapture,
    issues,
    gate,
    "evidence.product.shopify-readback-observed-at",
    now,
  );
  exactValue(readback.product_id, publicRecord?.product_record_id, issues, gate, "evidence.product.shopify-product-id");
  exactValue(readback.status, "ACTIVE", issues, gate, "evidence.product.shopify-status");
  if (!Array.isArray(readback.variant_ids) || readback.variant_ids.length !== 1) {
    add(issues, gate, "evidence.product.shopify-variant-count");
  } else {
    exactValue(
      readback.variant_ids[0],
      publicRecord?.variant_record_id,
      issues,
      gate,
      "evidence.product.shopify-variant-id",
    );
  }
  exactBoolean(
    readback.has_only_default_variant,
    expectedProjection?.variant_presentation?.has_only_default_variant,
    issues,
    gate,
    "evidence.product.shopify-has-only-default-variant",
  );
  if (exactKeys(
    readback.default_variant,
    ["id", "title", "selected_options"],
    issues,
    gate,
    "evidence.product.shopify-default-variant",
  )) {
    exactValue(
      readback.default_variant.id,
      publicRecord?.variant_record_id,
      issues,
      gate,
      "evidence.product.shopify-default-variant-id",
    );
    exactValue(
      readback.default_variant.title,
      expectedProjection?.variant_presentation?.title,
      issues,
      gate,
      "evidence.product.shopify-default-variant-title",
    );
    if (JSON.stringify(canonicalJson(readback.default_variant.selected_options)) !==
        JSON.stringify(canonicalJson(expectedProjection?.variant_presentation?.selected_options))) {
      add(issues, gate, "evidence.product.shopify-default-variant-selected-options");
    }
  }
  for (const field of ["handle", "title", "vendor", "description_html"]) {
    exactValue(readback[field], expectedProjection?.[field], issues, gate, `evidence.product.shopify-${field}`);
  }
  if (JSON.stringify(canonicalJson(readback.seo)) !== JSON.stringify(canonicalJson(expectedProjection?.seo))) {
    add(issues, gate, "evidence.product.shopify-seo");
  }
  if (JSON.stringify(canonicalJson(readback.metafields)) !==
      JSON.stringify(canonicalJson(expectedProjection?.metafields))) {
    add(issues, gate, "evidence.product.shopify-metafields");
  }
  if (!sameSet(readback.collection_handles, expectedProjection?.collection_handles ?? []) ||
      JSON.stringify(readback.collection_handles) !==
        JSON.stringify([...(expectedProjection?.collection_handles ?? [])].sort())) {
    add(issues, gate, "evidence.product.shopify-collections");
  }
  const expectedMedia = Array.isArray(expectedProjection?.media) ? expectedProjection.media : [];
  const actualMedia = Array.isArray(readback.media) ? readback.media : [];
  if (actualMedia.length !== expectedMedia.length) add(issues, gate, "evidence.product.shopify-media-count");
  const mediaIds = [];
  for (const [index, media] of actualMedia.entries()) {
    if (!exactKeys(media, [
      "media_id",
      "position",
      "media_content_type",
      "status",
      "role",
      "public_reference",
      "original_source_sha256",
      "alt_text",
      "emblem_matches",
      "wordmark_matches",
      "other_brand_absent",
    ], issues, gate, "evidence.product.shopify-media")) continue;
    const expected = expectedMedia[index];
    if (!GID_MEDIA_IMAGE_PATTERN.test(media.media_id ?? "")) {
      add(issues, gate, "evidence.product.shopify-media-id");
    }
    mediaIds.push(media.media_id);
    exactValue(media.position, index + 1, issues, gate, "evidence.product.shopify-media-position");
    exactValue(media.media_content_type, "IMAGE", issues, gate, "evidence.product.shopify-media-type");
    exactValue(media.status, "READY", issues, gate, "evidence.product.shopify-media-status");
    for (const [actualField, expectedField] of [
      ["role", "role"],
      ["public_reference", "public_reference"],
      ["original_source_sha256", "asset_sha256"],
      ["alt_text", "alt_text"],
    ]) {
      exactValue(
        media[actualField],
        expected?.[expectedField],
        issues,
        gate,
        `evidence.product.shopify-media-${actualField}`,
      );
    }
    for (const field of ["emblem", "wordmark"]) {
      const expectation = expected?.brand_mark_expectation?.[field];
      const actualField = `${field}_matches`;
      exactValue(
        media[actualField],
        expectation === "required" ? true : null,
        issues,
        gate,
        `evidence.product.shopify-media-${actualField}`,
      );
    }
    exactBoolean(
      media.other_brand_absent,
      true,
      issues,
      gate,
      "evidence.product.shopify-media-other_brand_absent",
    );
  }
  if (new Set(mediaIds).size !== mediaIds.length) add(issues, gate, "evidence.product.shopify-media-id-duplicate");
  const recordWithoutDigest = Object.fromEntries(
    Object.entries(readback).filter(([key]) => key !== "record_sha256"),
  );
  exactValue(
    readback.record_sha256,
    contractDigest(recordWithoutDigest),
    issues,
    gate,
    "evidence.product.shopify-record-sha",
  );
}

function loadSourceContracts(repositoryRoot, issues) {
  const gate = "source-contracts";
  const files = {
    activeSourceManifest: "apps/shopify-theme/ACTIVE-SOURCE-MANIFEST.v1.json",
    activeSourceManifestSchema: "apps/shopify-theme/ACTIVE-SOURCE-MANIFEST.v1.schema.json",
    productFacts: "apps/shopify-theme/content/product-facts.v3.json",
    launchPages: "apps/shopify-theme/content/launch-pages.v1.json",
    mandatoryNames: "apps/shopify-theme/content/mandatory-name-exceptions.v1.json",
    providerSurfaces: "apps/shopify-theme/content/provider-surfaces.v1.json",
    searchExpectations: "apps/shopify-theme/content/storefront-search-expectations.v1.json",
  };
  const contracts = {};
  for (const [name, relativePath] of Object.entries(files)) {
    try {
      contracts[name] = JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
    } catch {
      add(issues, gate, `${name}.parse`);
    }
  }
  return contracts;
}

function validateRepositorySource(source, repositoryRoot, issues) {
  const gate = "source-worktree";
  const git = (...args) => execFileSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    exactValue(git("rev-parse", "HEAD"), source?.commit_sha, issues, gate, "head-commit");
    exactValue(git("rev-parse", "HEAD^{tree}"), source?.tree_sha, issues, gate, "head-tree");
    exactValue(git("show", "-s", "--format=%T", source?.commit_sha ?? ""), source?.tree_sha, issues, gate, "commit-tree");
    exactValue(git("symbolic-ref", "--short", "HEAD"), PREPAYMENT_GATE_POLICY.branch, issues, gate, "branch");
    if (git("status", "--porcelain", "--untracked-files=all") !== "") add(issues, gate, "dirty");
  } catch {
    add(issues, gate, "git-readback");
  }
}

function readJsonEvidence(record, issues, gate, category) {
  if (!record?.buffer) return null;
  if (record.document !== undefined) return record.document;
  try {
    record.document = JSON.parse(record.buffer.toString("utf8"));
  } catch {
    record.document = null;
    add(issues, gate, `${category}.parse`);
  }
  return record.document;
}

function validateEvidenceEnvelope(record, expectedKind, bundle, issues, now) {
  const gate = "evidence-record";
  const document = readJsonEvidence(record, issues, gate, `${expectedKind}.document`);
  if (!document || !exactKeys(document, EVIDENCE_DOCUMENT_KEYS, issues, gate, `${expectedKind}.envelope`)) {
    return null;
  }
  exactValue(document.schema_version, 1, issues, gate, `${expectedKind}.schema-version`);
  exactValue(document.evidence_kind, expectedKind, issues, gate, `${expectedKind}.kind`);
  requireFreshCapture(document.captured_at, issues, gate, `${expectedKind}.capture`, now);
  exactValue(document.repository, PREPAYMENT_GATE_POLICY.repository, issues, gate, `${expectedKind}.repository`);
  if (!validGitObjectId(document.source_commit_sha) ||
      document.source_commit_sha !== bundle.source?.commit_sha) {
    add(issues, gate, `${expectedKind}.source-commit-linkage`);
  }
  if (!validGitObjectId(document.source_tree_sha) ||
      document.source_tree_sha !== bundle.source?.tree_sha) {
    add(issues, gate, `${expectedKind}.source-tree-linkage`);
  }
  exactValue(
    document.candidate_theme_id,
    bundle.candidate_theme?.theme_id,
    issues,
    gate,
    `${expectedKind}.candidate-theme-linkage`,
  );
  if (!sameSet(document.expected_product_handles, EXPECTED_PRODUCT_HANDLES)) {
    add(issues, gate, `${expectedKind}.product-identity-set`);
  }
  if (exactKeys(document.reviewer, EVIDENCE_REVIEWER_KEYS, issues, gate, `${expectedKind}.reviewer`)) {
    accountableIdentifier(document.reviewer.reviewer_id, issues, gate, `${expectedKind}.reviewer`);
    exactValue(
      document.reviewer.role,
      EVIDENCE_REVIEWER_ROLES[expectedKind],
      issues,
      gate,
      `${expectedKind}.reviewer-role`,
    );
    const captured = captureMilliseconds(document.captured_at);
    requireOrderedTimestamp(document.reviewer.reviewed_at, captured, now, issues, gate, `${expectedKind}.reviewed-at`);
  }
  if (!document.claim || typeof document.claim !== "object" || Array.isArray(document.claim)) {
    add(issues, gate, `${expectedKind}.claim.type`);
    return null;
  }
  return document;
}

function validateEvidenceBoundary(bundlePath, context, issues) {
  const gate = "evidence";
  const { repositoryRoot } = context;
  const allowedRoot = path.join(repositoryRoot, ".artifacts", "operations");
  const gitignorePath = path.join(repositoryRoot, ".gitignore");
  if (!existsSync(gitignorePath) ||
      !readFileSync(gitignorePath, "utf8").split(/\r?\n/u).includes(".artifacts/operations/")) {
    add(issues, gate, "ignored-boundary.configuration");
  }
  if (typeof bundlePath !== "string" || !existsSync(bundlePath) || !existsSync(allowedRoot)) {
    add(issues, gate, "bundle.boundary");
    return null;
  }
  try {
    const namedBundle = path.resolve(bundlePath);
    const bundleRelativePath = path.relative(repositoryRoot, namedBundle).split(path.sep).join("/");
    if (!evidencePathIsSafe(bundleRelativePath) || !lstatSync(namedBundle).isFile() ||
        containsSymbolicLink(repositoryRoot, namedBundle) || containsSymbolicLink(repositoryRoot, allowedRoot)) {
      add(issues, gate, "bundle.boundary");
      return null;
    }
    const realAllowedRoot = realpathSync(allowedRoot);
    const realBundle = realpathSync(namedBundle);
    const realRepositoryRoot = realpathSync(repositoryRoot);
    if (!lstatSync(realBundle).isFile() || !isInside(realAllowedRoot, realRepositoryRoot) ||
        !isInside(realBundle, realAllowedRoot)) {
      add(issues, gate, "bundle.boundary");
      return null;
    }
    validatePrivatePathGitStatus(bundleRelativePath, context, issues, gate, "bundle");
    return { allowedRoot, realAllowedRoot, realBundle, bundleRelativePath };
  } catch {
    add(issues, gate, "bundle.boundary");
    return null;
  }
}

function validateEvidenceFiles(files, context, issues) {
  const gate = "evidence";
  const records = new Map();
  if (!Array.isArray(files) || files.length !== REQUIRED_EVIDENCE_KINDS.length) {
    add(issues, gate, "files.exact-count");
    return records;
  }
  const ids = [];
  const kinds = [];
  const paths = [];
  for (const entry of files) {
    if (!exactKeys(entry, EVIDENCE_FILE_KEYS, issues, gate, "file")) continue;
    if (!SLUG_PATTERN.test(entry.id ?? "")) add(issues, gate, "file.id");
    if (!REQUIRED_EVIDENCE_KINDS.includes(entry.kind)) add(issues, gate, "file.kind");
    if (!evidencePathIsSafe(entry.path)) add(issues, gate, "file.path");
    if (!validSha256(entry.sha256)) add(issues, gate, "file.sha256");
    ids.push(entry.id);
    kinds.push(entry.kind);
    paths.push(entry.path);
    if (!evidencePathIsSafe(entry.path)) continue;
    const absolute = path.resolve(context.repositoryRoot, ...entry.path.split("/"));
    try {
      if (!lstatSync(absolute).isFile() || containsSymbolicLink(context.repositoryRoot, absolute)) {
        add(issues, gate, "file.boundary");
        continue;
      }
      const realFile = realpathSync(absolute);
      if (!lstatSync(realFile).isFile() || !isInside(realFile, context.boundary.realAllowedRoot) ||
          realFile === context.boundary.realBundle) {
        add(issues, gate, "file.boundary");
        continue;
      }
      validatePrivatePathGitStatus(entry.path, context, issues, gate, "file");
      const buffer = readFileSync(realFile);
      if (digest(buffer) !== entry.sha256) add(issues, gate, "file.hash-mismatch");
      const record = { ...entry, buffer };
      readJsonEvidence(record, issues, gate, "file");
      records.set(entry.id, record);
    } catch {
      add(issues, gate, "file.missing");
    }
  }
  if (new Set(ids).size !== ids.length) add(issues, gate, "file.duplicate-id");
  if (new Set(paths).size !== paths.length) add(issues, gate, "file.duplicate-path");
  if (!sameSet(kinds, REQUIRED_EVIDENCE_KINDS)) add(issues, gate, "file.kind-set");
  return records;
}

function validateArtifactIndexReference(bundle, evidence, referencedIds, issues, context) {
  const gate = "artifact-index";
  const record = requireEvidenceReference(
    bundle.artifact_index_evidence_ref,
    "artifact-index",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "artifact-index", issues, gate, "evidence");
  if (!claim) return null;
  const result = validatePrivateArtifactIndex(claim, {
    repositoryRoot: context.repositoryRoot,
    allowedRoot: context.boundary.realAllowedRoot,
    gitPathStatus: context.artifactGitPathStatus,
    imageInspector: context.artifactImageInspector,
    evidencePaths: [
      context.boundary.realBundle,
      ...[...evidence.values()].map((item) => item.path),
    ],
  });
  for (const category of result.issues) add(issues, gate, category);
  return result;
}

function requirePrivateArtifactBinding(index, query, expectedSha256, context, issues, gate, category) {
  if (!index?.ok) return null;
  const artifact = index.resolveBinding(query);
  if (!artifact) {
    add(issues, gate, `${category}.missing`);
    return null;
  }
  exactValue(artifact.sha256, expectedSha256, issues, gate, `${category}.sha256`);
  const identity = privateArtifactBindingKey(query);
  if (identity) context.usedArtifactBindings.add(identity);
  return artifact;
}

function readPrivateJsonArtifact(artifact, context, issues, gate, category) {
  if (!artifact) return null;
  if (artifact.content_type !== "application/json" || !evidencePathIsSafe(artifact.artifact_path)) {
    add(issues, gate, `${category}.content-type`);
    return null;
  }
  try {
    const absolute = path.resolve(context.repositoryRoot, ...artifact.artifact_path.split("/"));
    const record = JSON.parse(readFileSync(absolute, "utf8"));
    if (contractDigest(record) !== artifact.sha256) {
      add(issues, gate, `${category}.sha256`);
      return null;
    }
    return record;
  } catch {
    add(issues, gate, `${category}.invalid`);
    return null;
  }
}

function validatePrivateFormulaRecord(record, product, sourceProduct, envelopeCapture, issues, now) {
  const gate = "product-review";
  const category = "evidence.product.formula-record";
  if (!exactKeys(record, PRIVATE_FORMULA_RECORD_KEYS, issues, gate, category)) return null;
  exactValue(record.schema_version, 1, issues, gate, `${category}.schema-version`);
  exactValue(record.record_type, "mochirii-private-formula-mapping", issues, gate, `${category}.record-type`);
  exactValue(record.handle, product.handle, issues, gate, `${category}.handle`);
  exactValue(record.market, "US", issues, gate, `${category}.market`);
  exactValue(record.status, "approved", issues, gate, `${category}.status`);
  const capturedAt = requireFreshObservation(
    record.captured_at,
    envelopeCapture,
    issues,
    gate,
    `${category}.captured-at`,
    now,
  );
  if (!validSha256(record.source_catalog_record_sha256)) {
    add(issues, gate, `${category}.source-catalog-record-sha256`);
  }
  if (exactKeys(record.identity, PRIVATE_FORMULA_IDENTITY_KEYS, issues, gate, `${category}.identity`)) {
    for (const field of PRIVATE_FORMULA_IDENTITY_KEYS) {
      nonemptyString(record.identity[field], issues, gate, `${category}.identity.${field}`);
    }
    exactValue(record.identity.region, "US", issues, gate, `${category}.identity.region`);
    exactValue(
      record.formula_identity_sha256,
      contractDigest(record.identity),
      issues,
      gate,
      `${category}.identity-sha256`,
    );
  }
  exactValue(
    record.formula_identity_sha256,
    product.formula_identity_sha256,
    issues,
    gate,
    `${category}.product-identity-parity`,
  );
  if (!exactKeys(record.approved_unit, PRIVATE_APPROVED_UNIT_KEYS, issues, gate, `${category}.approved-unit`)) {
    return { capturedAt, sourceCatalogRecordSha256: record.source_catalog_record_sha256 };
  }
  const labelFields = [
    ["front_label_sha256", "front"],
    ["technical_panel_sha256", "technical-panel"],
    ["outer_box_sha256", "outer-box"],
  ];
  for (const [field, role] of labelFields) {
    if (!validSha256(record.approved_unit[field])) {
      add(issues, gate, `${category}.approved-unit.${field}`);
    }
    exactValue(record.approved_unit[field], product[field], issues, gate, `${category}.approved-unit-product-parity`);
    const media = sourceProduct?.facts?.media?.find((item) => item.role === role);
    exactValue(
      record.approved_unit[field],
      media?.asset_sha256,
      issues,
      gate,
      `${category}.approved-unit-media-parity`,
    );
  }
  return {
    capturedAt,
    sourceCatalogRecordSha256: record.source_catalog_record_sha256,
  };
}

function normalizeOcrComparableText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function labelComparableText(field, sourceProduct) {
  const facts = sourceProduct?.facts;
  switch (field) {
    case "wordmark":
      return PREPAYMENT_GATE_POLICY.wordmark;
    case "public_title":
      return sourceProduct?.public_title;
    case "functional_identity":
    case "ingredients_inci":
    case "country_of_origin":
      return facts?.[field];
    case "usage_directions": {
      const directions = facts?.usage_directions;
      if (!directions || typeof directions !== "object" || Array.isArray(directions)) return null;
      return [
        directions.text,
        directions.frequency,
        directions.amount,
        ...(Array.isArray(directions.routine_timing) ? directions.routine_timing : []),
        directions.rinse_behavior,
      ].filter((item) => typeof item === "string" && item.length > 0).join(" ");
    }
    case "warnings": {
      const warnings = facts?.warnings;
      if (warnings?.review_result !== "label-matched") return null;
      return [
        warnings.text,
        ...(Array.isArray(warnings.incompatibilities) ? warnings.incompatibilities : []),
      ].filter((item) => typeof item === "string" && item.length > 0).join(" ");
    }
    case "volume":
      return facts?.volume?.display;
    case "certifications": {
      const certifications = facts?.certifications;
      if (certifications?.review_result !== "verified-wording" ||
          !Array.isArray(certifications.items) || certifications.items.length === 0) return null;
      return certifications.items.join(" ");
    }
    default:
      return null;
  }
}

function expectedPrivateOcrComparisons(sourceProduct, role) {
  const factFields = {
    front: ["public_title", "functional_identity"],
    "technical-panel": ["ingredients_inci", "usage_directions", "warnings", "volume"],
    "outer-box": ["country_of_origin", "certifications"],
    texture: [],
    scale: [],
    use: [],
  }[role] ?? [];
  return ["wordmark", ...factFields].flatMap((field) => {
    const exactText = labelComparableText(field, sourceProduct);
    const normalized = normalizeOcrComparableText(exactText);
    return normalized.length === 0
      ? []
      : [{
        field,
        expected_exact_text: exactText.normalize("NFC").trim(),
        expected_normalized_sha256: digest(Buffer.from(normalized, "utf8")),
      }];
  });
}

function expectedPrivateOcrComparables(sourceProduct) {
  return PRIVATE_OCR_COMPARABLE_FIELDS.flatMap((field) => {
    const exactText = labelComparableText(field, sourceProduct);
    return normalizeOcrComparableText(exactText).length === 0
      ? []
      : [[field, exactText.normalize("NFC").trim()]];
  });
}

function validGtin(value) {
  const match = /^(?:(?:UPC|EAN|GTIN)\s*:?\s*)?([0-9]{8}|[0-9]{12,14})$/iu.exec(value);
  if (!match) return false;
  const digits = match[1];
  let sum = 0;
  for (let index = digits.length - 2, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(digits[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function validReviewedTechnicalCode(kind, value) {
  if (typeof value !== "string") return false;
  switch (kind) {
    case "batch":
      return /^BATCH(?:\s+(?:NO[.]?|NUMBER))?\s*[:#]?\s+[A-Z0-9][A-Z0-9.-]{2,31}$/iu.test(value);
    case "lot":
      return /^LOT(?:\s+(?:NO[.]?|NUMBER))?\s*[:#]?\s+[A-Z0-9][A-Z0-9.-]{2,31}$/iu.test(value);
    case "pao":
      return /^(?:PAO\s*:?\s*)?(?:3|6|9|12|18|24|30|36)\s?M$/iu.test(value);
    case "barcode":
      return validGtin(value);
    case "recycling":
      return /^(?:PETE?\s*1|HDPE\s*2|PVC\s*3|LDPE\s*4|PP\s*5|PS\s*6|OTHER\s*7|PAP\s*(?:20|21|22)|FE\s*40|ALU\s*41|GL\s*(?:70|71|72))$/iu.test(value);
    default:
      return false;
  }
}

function validateReviewedOcrBlockConsumers(
  consumers,
  blocksByIdentity,
  expected,
  capturedAt,
  envelopeCapture,
  issues,
  now,
) {
  const gate = "product-review";
  const category = "evidence.product.ocr-record.reviewed-block-consumer";
  const counts = new Map();
  if (!Array.isArray(consumers)) {
    add(issues, gate, `${category}.type`);
    return counts;
  }
  const approvedComparables = new Map(expected.approved_comparables ?? []);
  for (const consumer of consumers) {
    if (!exactKeys(consumer, PRIVATE_OCR_REVIEWED_BLOCK_CONSUMER_KEYS, issues, gate, category)) continue;
    let valid = true;
    const invalidate = (suffix) => {
      add(issues, gate, `${category}.${suffix}`);
      valid = false;
    };
    if (!Number.isSafeInteger(consumer.page_number) || consumer.page_number <= 0 ||
        !Number.isSafeInteger(consumer.block_index) || consumer.block_index < 0) {
      invalidate("identity");
    }
    const identity = `${consumer.page_number}\u0000${consumer.block_index}`;
    const blockText = blocksByIdentity.get(identity);
    if (typeof blockText !== "string") invalidate("missing-block");
    if (consumer.approved_artwork_sha256 !== expected.source_image_sha256 ||
        !validSha256(consumer.approved_artwork_sha256)) {
      invalidate("approved-artwork-sha256");
    }
    const expectedTextSha256 = typeof blockText === "string"
      ? digest(Buffer.from(blockText.normalize("NFC"), "utf8"))
      : null;
    if (!validSha256(consumer.text_sha256) || consumer.text_sha256 !== expectedTextSha256) {
      invalidate("text-sha256");
    }
    if (!accountableIdentifier(consumer.reviewer, issues, gate, `${category}.reviewer`)) valid = false;
    const reviewedAt = requireOrderedTimestamp(
      consumer.reviewed_at,
      capturedAt,
      Math.min(envelopeCapture, now),
      issues,
      gate,
      `${category}.reviewed-at`,
    );
    if (!Number.isFinite(reviewedAt) || reviewedAt < capturedAt || reviewedAt > Math.min(envelopeCapture, now)) {
      valid = false;
    }
    if (consumer.consumer_kind === "approved-fact-duplicate") {
      if (typeof consumer.approved_fact_field !== "string" ||
          !approvedComparables.has(consumer.approved_fact_field)) {
        invalidate("approved-fact-field");
      }
      if (consumer.technical_code_kind !== null) invalidate("technical-code-null");
      if (typeof blockText === "string" &&
          blockText.normalize("NFC").trim() !== approvedComparables.get(consumer.approved_fact_field)) {
        invalidate("approved-fact-text");
      }
    } else if (consumer.consumer_kind === "technical-code") {
      if (consumer.approved_fact_field !== null) invalidate("approved-fact-null");
      if (!PRIVATE_OCR_TECHNICAL_CODE_KINDS.has(consumer.technical_code_kind)) {
        invalidate("technical-code-kind");
      } else if (!validReviewedTechnicalCode(consumer.technical_code_kind, blockText)) {
        invalidate("technical-code-text");
      }
    } else {
      invalidate("consumer-kind");
    }
    if (valid) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

function reviewedMandatoryExceptionAuthorizationCount(
  contract,
  handle,
  role,
  ocrText,
  ocrCapturedAt,
  envelopeCapture,
  now,
  expectedCompany = null,
) {
  const renderedReview = contract?.rendered_review;
  const renderedReviewDate = typeof renderedReview?.review_date === "string"
    ? renderedReview.review_date
    : "";
  const renderedReviewTimestamp = reviewDateMilliseconds(renderedReviewDate);
  const latestEvidenceTimestamp = Math.min(ocrCapturedAt, envelopeCapture, now);
  const registerReviewed = contract?.status === "reviewed" &&
    renderedReview?.status === "reviewed" &&
    typeof renderedReview.reviewer === "string" && renderedReview.reviewer.trim().length > 0 &&
    Number.isFinite(renderedReviewTimestamp) &&
    Number.isFinite(latestEvidenceTimestamp) &&
    renderedReviewTimestamp <= latestEvidenceTimestamp &&
    Array.isArray(renderedReview.reviewed_route_categories) &&
    renderedReview.reviewed_route_categories.includes("products");
  if (!registerReviewed || !Array.isArray(contract.entries)) return 0;
  const route = `/products/${handle}`;
  const surface = `product-media:${role}`;
  return contract.entries.filter((entry) => {
    const reviewDate = typeof entry?.review_date === "string" ? entry.review_date : "";
    const parsedReviewDate = reviewDateMilliseconds(reviewDate);
    const reviewedEntry = typeof entry?.reviewer === "string" && entry.reviewer.trim().length > 0 &&
      Number.isFinite(parsedReviewDate) &&
      parsedReviewDate <= renderedReviewTimestamp && parsedReviewDate <= latestEvidenceTimestamp;
    const mandatoryBasis = typeof entry?.legal_or_contractual_reason === "string" &&
      /\b(?:legal|law|required|regulation|contract|contractual|agreement|carrier|certification|privacy|label)\b/iu
        .test(entry.legal_or_contractual_reason);
    const normalizedOcrText = normalizeCustomerLanguageForPolicy(
      ocrText,
      { joinInternalSeparators: true },
    );
    const normalizedApprovedWording = normalizeCustomerLanguageForPolicy(
      entry?.exact_approved_wording,
      { joinInternalSeparators: true },
    );
    const exactWordingPresent = normalizedApprovedWording.length > 0 &&
      normalizedOcrText === normalizedApprovedWording;
    const normalizedExactName = normalizeCustomerLanguageForPolicy(
      entry?.exact_name,
      { joinInternalSeparators: true },
    );
    const knownCanonicalCompanyName = exactCustomerLanguageCompanyName(entry?.exact_name);
    const canonicalExactName = knownCanonicalCompanyName === null ||
      entry.exact_name === knownCanonicalCompanyName;
    const exactNamePresent = normalizedExactName.length > 0 &&
      ` ${normalizedApprovedWording} `.includes(` ${normalizedExactName} `);
    const expectedCompanyMatches = expectedCompany === null || (
      entry.exact_name === expectedCompany &&
      exactCustomerLanguageCompanyName(entry.exact_name) === expectedCompany
    );
    return reviewedEntry &&
      mandatoryBasis &&
      exactWordingPresent &&
      exactNamePresent &&
      canonicalExactName &&
      entry.route === route &&
      entry.surface === surface &&
      expectedCompanyMatches;
  }).length;
}

function validatePrivateOcrRecord(record, expected, imageArtifact, envelopeCapture, issues, now) {
  const gate = "product-review";
  const category = "evidence.product.ocr-record";
  if (!exactKeys(record, PRIVATE_OCR_RECORD_KEYS, issues, gate, category)) return null;
  exactValue(record.schema_version, 1, issues, gate, `${category}.schema-version`);
  exactValue(record.record_type, "mochirii-private-ocr-output", issues, gate, `${category}.record-type`);
  for (const field of ["handle", "role", "public_reference", "source_image_sha256"]) {
    exactValue(record[field], expected[field], issues, gate, `${category}.${field}`);
  }
  const capturedAt = requireFreshObservation(
    record.captured_at,
    envelopeCapture,
    issues,
    gate,
    `${category}.captured-at`,
    now,
  );
  if (exactKeys(record.engine, PRIVATE_OCR_ENGINE_KEYS, issues, gate, `${category}.engine`)) {
    nonemptyString(record.engine.name, issues, gate, `${category}.engine.name`);
    nonemptyString(record.engine.version, issues, gate, `${category}.engine.version`);
    if (!validSha256(record.engine.configuration_sha256)) {
      add(issues, gate, `${category}.engine.configuration-sha256`);
    }
  }
  const imageMetadata = imageArtifact?.image_metadata;
  if (!exactKeys(imageMetadata, PRIVATE_IMAGE_INSPECTION_KEYS, issues, gate, `${category}.image-metadata`)) {
    return { capturedAt };
  }
  if (!Array.isArray(record.pages) || record.pages.length !== imageMetadata.pages || record.pages.length === 0) {
    add(issues, gate, `${category}.pages`);
  }
  const textBlocks = [];
  const blocksByIdentity = new Map();
  for (const [pageIndex, page] of (Array.isArray(record.pages) ? record.pages : []).entries()) {
    if (!exactKeys(page, PRIVATE_OCR_PAGE_KEYS, issues, gate, `${category}.page`)) continue;
    exactValue(page.page_number, pageIndex + 1, issues, gate, `${category}.page-number`);
    exactValue(page.width, imageMetadata.width, issues, gate, `${category}.page-width`);
    exactValue(page.height, imageMetadata.height, issues, gate, `${category}.page-height`);
    if (!Array.isArray(page.blocks) || page.blocks.length === 0) add(issues, gate, `${category}.blocks`);
    for (const [blockIndex, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      if (!exactKeys(block, PRIVATE_OCR_BLOCK_KEYS, issues, gate, `${category}.block`)) continue;
      exactValue(block.index, blockIndex, issues, gate, `${category}.block-index`);
      if (nonemptyString(block.text, issues, gate, `${category}.block-text`)) {
        exactValue(block.text, block.text.normalize("NFC"), issues, gate, `${category}.block-text-normalization`);
        textBlocks.push(block.text.normalize("NFC"));
        blocksByIdentity.set(`${pageIndex + 1}\u0000${blockIndex}`, block.text.normalize("NFC"));
      }
      if (!Number.isSafeInteger(block.confidence_basis_points) || block.confidence_basis_points < 0 ||
          block.confidence_basis_points > 10_000) {
        add(issues, gate, `${category}.block-confidence`);
      }
      if (!exactKeys(block.bbox, PRIVATE_OCR_BBOX_KEYS, issues, gate, `${category}.bbox`)) continue;
      const { x, y, width, height } = block.bbox;
      if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
          x + width > page.width || y + height > page.height) {
        add(issues, gate, `${category}.bbox-bounds`);
      }
    }
  }
  exactValue(
    record.normalized_text_sha256,
    digest(Buffer.from(textBlocks.join("\n"), "utf8")),
    issues,
    gate,
    `${category}.normalized-text-sha256`,
  );
  if (textBlocks.some((textBlock) =>
    customerLanguageIssueCategories(textBlock).includes("inconsistent-brand"))) {
    add(issues, gate, `${category}.inconsistent-brand`);
  }
  const expectedSemantics = Array.isArray(expected.semantic_comparisons)
    ? expected.semantic_comparisons
    : [];
  if (!Array.isArray(record.semantic_fields) || record.semantic_fields.length !== expectedSemantics.length) {
    add(issues, gate, `${category}.semantic-fields-count`);
  }
  const semanticObservedShaByField = new Map();
  const semanticBlockUseCounts = new Map();
  const semanticFields = [];
  for (const [index, semantic] of (Array.isArray(record.semantic_fields) ? record.semantic_fields : []).entries()) {
    if (!exactKeys(semantic, PRIVATE_OCR_SEMANTIC_FIELD_KEYS, issues, gate, `${category}.semantic-field`)) continue;
    const expectedSemantic = expectedSemantics[index];
    exactValue(semantic.field, expectedSemantic?.field, issues, gate, `${category}.semantic-field-name`);
    semanticFields.push(semantic.field);
    if (!Array.isArray(semantic.block_refs) || semantic.block_refs.length === 0) {
      add(issues, gate, `${category}.semantic-block-refs`);
      continue;
    }
    const blockIdentities = [];
    const selectedText = [];
    for (const blockRef of semantic.block_refs) {
      if (!exactKeys(blockRef, PRIVATE_OCR_BLOCK_REF_KEYS, issues, gate, `${category}.semantic-block-ref`)) continue;
      if (!Number.isSafeInteger(blockRef.page_number) || blockRef.page_number <= 0 ||
          !Number.isSafeInteger(blockRef.block_index) || blockRef.block_index < 0) {
        add(issues, gate, `${category}.semantic-block-ref-identity`);
        continue;
      }
      const identity = `${blockRef.page_number}\u0000${blockRef.block_index}`;
      blockIdentities.push(identity);
      const blockText = blocksByIdentity.get(identity);
      if (typeof blockText !== "string") {
        add(issues, gate, `${category}.semantic-block-ref-missing`);
        continue;
      }
      semanticBlockUseCounts.set(identity, (semanticBlockUseCounts.get(identity) ?? 0) + 1);
      selectedText.push(blockText);
    }
    if (new Set(blockIdentities).size !== blockIdentities.length) {
      add(issues, gate, `${category}.semantic-block-ref-duplicate`);
    }
    const normalizedObserved = normalizeOcrComparableText(selectedText.join(" "));
    if (normalizedObserved.length === 0) add(issues, gate, `${category}.semantic-observed-empty`);
    exactValue(
      selectedText.join(" ").normalize("NFC").trim(),
      expectedSemantic?.expected_exact_text,
      issues,
      gate,
      `${category}.semantic-exact-text`,
    );
    const observedSha = digest(Buffer.from(normalizedObserved, "utf8"));
    exactValue(
      semantic.normalized_observed_sha256,
      observedSha,
      issues,
      gate,
      `${category}.semantic-observed-sha256`,
    );
    semanticObservedShaByField.set(semantic.field, observedSha);
  }
  if (new Set(semanticFields).size !== semanticFields.length ||
      JSON.stringify(semanticFields) !== JSON.stringify(expectedSemantics.map((item) => item.field))) {
    add(issues, gate, `${category}.semantic-field-set`);
  }
  const reviewedBlockConsumerCounts = validateReviewedOcrBlockConsumers(
    record.reviewed_block_consumers,
    blocksByIdentity,
    expected,
    capturedAt,
    envelopeCapture,
    issues,
    now,
  );
  let hasUnapprovedCompany = false;
  let hasUnconsumedBlock = false;
  let hasMultiplyConsumedBlock = false;
  for (const [identity, textBlock] of blocksByIdentity) {
    const semanticConsumerCount = semanticBlockUseCounts.get(identity) ?? 0;
    const reviewedBlockConsumerCount = reviewedBlockConsumerCounts.get(identity) ?? 0;
    const exceptionConsumerCount = reviewedMandatoryExceptionAuthorizationCount(
      expected.mandatory_name_exceptions,
      expected.handle,
      expected.role,
      textBlock,
      capturedAt,
      envelopeCapture,
      now,
    );
    for (const company of customerLanguageCompanyMatches(textBlock)) {
      const exactCompanyExceptionCount = reviewedMandatoryExceptionAuthorizationCount(
        expected.mandatory_name_exceptions,
        expected.handle,
        expected.role,
        textBlock,
        capturedAt,
        envelopeCapture,
        now,
        company,
      );
      if (semanticConsumerCount !== 0 || exactCompanyExceptionCount !== 1) {
        hasUnapprovedCompany = true;
      }
    }
    const totalConsumerCount = semanticConsumerCount + reviewedBlockConsumerCount + exceptionConsumerCount;
    if (totalConsumerCount === 0) hasUnconsumedBlock = true;
    if (totalConsumerCount > 1) hasMultiplyConsumedBlock = true;
  }
  if (hasUnapprovedCompany) add(issues, gate, `${category}.unapproved-company`);
  if (hasUnconsumedBlock) add(issues, gate, `${category}.block-unconsumed`);
  if (hasMultiplyConsumedBlock) add(issues, gate, `${category}.block-multiple-consumers`);
  return { capturedAt, semanticObservedShaByField };
}

function expectedPrivateLabelFactHashes(sourceProduct, role) {
  const expected = Object.fromEntries(PRIVATE_LABEL_FACT_HASH_KEYS.map((field) => [field, null]));
  const roleFields = {
    front: ["public_title", "functional_identity"],
    "technical-panel": ["ingredients_inci", "usage_directions", "warnings", "volume"],
    "outer-box": ["country_of_origin", "certifications"],
  }[role] ?? [];
  for (const field of roleFields) {
    const value = field === "public_title" ? sourceProduct?.public_title : sourceProduct?.facts?.[field];
    expected[field] = contractDigest(value);
  }
  return expected;
}

function validatePrivateLabelReviewRecord(
  record,
  product,
  sourceProduct,
  imageArtifacts,
  ocrArtifacts,
  formulaCapturedAt,
  reviewerReviewedAt,
  issues,
) {
  const gate = "product-review";
  const category = "evidence.product.label-media-review";
  if (!exactKeys(record, PRIVATE_LABEL_REVIEW_KEYS, issues, gate, category)) return;
  exactValue(record.schema_version, 1, issues, gate, `${category}.schema-version`);
  exactValue(record.record_type, "mochirii-private-label-media-review", issues, gate, `${category}.record-type`);
  exactValue(record.handle, product.handle, issues, gate, `${category}.handle`);
  exactValue(record.formula_identity_sha256, product.formula_identity_sha256, issues, gate, `${category}.formula-identity`);
  exactValue(
    record.canonical_emblem_sha256,
    PREPAYMENT_GATE_POLICY.canonical_emblem_sha256,
    issues,
    gate,
    `${category}.canonical-emblem`,
  );
  exactValue(record.wordmark, PREPAYMENT_GATE_POLICY.wordmark, issues, gate, `${category}.wordmark`);
  const reviewedAt = requireOrderedTimestamp(
    record.reviewed_at,
    formulaCapturedAt,
    reviewerReviewedAt,
    issues,
    gate,
    `${category}.reviewed-at`,
  );
  const expectedMedia = Array.isArray(sourceProduct?.facts?.media) ? sourceProduct.facts.media : [];
  if (!Array.isArray(record.media) || record.media.length !== expectedMedia.length) {
    add(issues, gate, `${category}.media-count`);
  }
  const identities = [];
  for (const [index, item] of (Array.isArray(record.media) ? record.media : []).entries()) {
    if (!exactKeys(item, PRIVATE_LABEL_REVIEW_MEDIA_KEYS, issues, gate, `${category}.media`)) continue;
    const expected = expectedMedia[index];
    identities.push(`${item.role}\u0000${item.public_reference}`);
    exactValue(item.role, expected?.role, issues, gate, `${category}.media-role`);
    exactValue(item.public_reference, expected?.public_reference, issues, gate, `${category}.media-public-reference`);
    exactValue(item.source_image_sha256, expected?.asset_sha256, issues, gate, `${category}.media-source-image`);
    exactBoolean(item.legible, true, issues, gate, `${category}.media-legible`);
    exactBoolean(item.approved_unit_match, true, issues, gate, `${category}.media-unit-match`);
    exactBoolean(item.other_brand_absent, true, issues, gate, `${category}.media-other-brand-absent`);
    if (exactKeys(
      item.emblem_comparison,
      PRIVATE_LABEL_EMBLEM_COMPARISON_KEYS,
      issues,
      gate,
      `${category}.media-emblem-comparison`,
    )) {
      exactValue(
        item.emblem_comparison.canonical_emblem_sha256,
        PREPAYMENT_GATE_POLICY.canonical_emblem_sha256,
        issues,
        gate,
        `${category}.media-emblem-comparison-canonical`,
      );
      exactValue(
        item.emblem_comparison.source_image_sha256,
        item.source_image_sha256,
        issues,
        gate,
        `${category}.media-emblem-comparison-source`,
      );
      exactBoolean(
        item.emblem_comparison.match,
        true,
        issues,
        gate,
        `${category}.media-emblem-comparison-match`,
      );
    }
    const identity = `${item.role}\u0000${item.public_reference}`;
    const imageArtifact = imageArtifacts.get(identity);
    if (!imageArtifact?.image_metadata) {
      add(issues, gate, `${category}.media-image-metadata`);
    }
    const ocr = ocrArtifacts.get(identity);
    if (REQUIRED_OCR_MEDIA_ROLES.includes(item.role)) {
      exactValue(item.ocr_output_sha256, ocr?.sha256, issues, gate, `${category}.media-ocr`);
      requireOrderedTimestamp(
        record.reviewed_at,
        ocr?.capturedAt,
        reviewerReviewedAt,
        issues,
        gate,
        `${category}.media-review-order`,
      );
    } else {
      exactValue(item.ocr_output_sha256, null, issues, gate, `${category}.media-ocr-not-applicable`);
    }
    for (const field of ["emblem", "wordmark"]) {
      exactBoolean(item[`${field}_matches`], true, issues, gate, `${category}.media-${field}`);
    }
    if (exactKeys(item.inspection, PRIVATE_IMAGE_INSPECTION_KEYS, issues, gate, `${category}.media-inspection`)) {
      for (const field of PRIVATE_IMAGE_INSPECTION_KEYS) {
        exactValue(item.inspection[field], imageArtifact?.image_metadata?.[field], issues, gate, `${category}.media-inspection-${field}`);
      }
    }
    if (exactKeys(item.fact_hashes, PRIVATE_LABEL_FACT_HASH_KEYS, issues, gate, `${category}.media-fact-hashes`)) {
      const expectedFactHashes = expectedPrivateLabelFactHashes(sourceProduct, item.role);
      for (const field of PRIVATE_LABEL_FACT_HASH_KEYS) {
        exactValue(item.fact_hashes[field], expectedFactHashes[field], issues, gate, `${category}.media-fact-${field}`);
      }
    }
    const expectedComparisons = expectedPrivateOcrComparisons(sourceProduct, item.role);
    const actualComparisons = Array.isArray(item.ocr_comparisons) ? item.ocr_comparisons : [];
    if (actualComparisons.length !== expectedComparisons.length) {
      add(issues, gate, `${category}.media-ocr-comparison-count`);
    }
    const comparisonFields = [];
    for (const [comparisonIndex, comparison] of actualComparisons.entries()) {
      if (!exactKeys(
        comparison,
        PRIVATE_LABEL_OCR_COMPARISON_KEYS,
        issues,
        gate,
        `${category}.media-ocr-comparison`,
      )) continue;
      const expectedComparison = expectedComparisons[comparisonIndex];
      comparisonFields.push(comparison.field);
      exactValue(
        comparison.field,
        expectedComparison?.field,
        issues,
        gate,
        `${category}.media-ocr-comparison-field`,
      );
      exactValue(
        comparison.expected_normalized_sha256,
        expectedComparison?.expected_normalized_sha256,
        issues,
        gate,
        `${category}.media-ocr-comparison-expected`,
      );
      exactValue(
        comparison.observed_normalized_sha256,
        ocr?.semanticObservedShaByField?.get(comparison.field),
        issues,
        gate,
        `${category}.media-ocr-comparison-observed`,
      );
      exactBoolean(
        comparison.match,
        true,
        issues,
        gate,
        `${category}.media-ocr-comparison-match`,
      );
      exactValue(
        comparison.observed_normalized_sha256,
        comparison.expected_normalized_sha256,
        issues,
        gate,
        `${category}.media-ocr-comparison-parity`,
      );
    }
    if (new Set(comparisonFields).size !== comparisonFields.length ||
        JSON.stringify(comparisonFields) !== JSON.stringify(expectedComparisons.map((item) => item.field))) {
      add(issues, gate, `${category}.media-ocr-comparison-set`);
    }
  }
  const expectedIdentities = expectedMedia.map((item) => `${item.role}\u0000${item.public_reference}`);
  if (!sameSet(identities, expectedIdentities) || JSON.stringify(identities) !== JSON.stringify(expectedIdentities)) {
    add(issues, gate, `${category}.media-set`);
  }
  return { reviewedAt };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseThemeZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 98 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
  const searchStart = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0 || endOffset + 22 > buffer.length) return null;
  const disk = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntries = buffer.readUInt16LE(endOffset + 8);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const commentLength = buffer.readUInt16LE(endOffset + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries < 2 ||
      endOffset + 22 + commentLength !== buffer.length || centralOffset + centralSize !== endOffset) return null;
  const files = new Map();
  const directories = new Set();
  const names = new Set();
  const dataRanges = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) return null;
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > endOffset) return null;
    const name = buffer.toString("utf8", nameStart, nameEnd);
    if (name.length === 0 || name.includes("\\") || path.posix.isAbsolute(name) || name.split("/").includes("..")) {
      return null;
    }
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    if ((flags & 0x0001) !== 0 || ![0, 8].includes(method) || (unixMode & 0o170000) === 0o120000 || names.has(name)) {
      return null;
    }
    names.add(name);
    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localFlags !== flags || localMethod !== method || localNameEnd > centralOffset ||
        buffer.toString("utf8", localNameStart, localNameEnd) !== name) return null;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) return null;
    dataRanges.push([localOffset, dataEnd]);
    let contents;
    try {
      const compressed = buffer.subarray(dataStart, dataEnd);
      contents = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    } catch {
      return null;
    }
    if (contents.length !== uncompressedSize || crc32(contents) !== expectedCrc) return null;
    if (name.endsWith("/")) {
      if (contents.length !== 0) return null;
      directories.add(name);
    } else {
      files.set(name, contents);
    }
    cursor = nameEnd + extraLength + entryCommentLength;
  }
  dataRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < dataRanges.length; index += 1) {
    if (dataRanges[index][0] < dataRanges[index - 1][1]) return null;
  }
  if (cursor !== endOffset || !files.has("layout/theme.liquid") || !files.has("config/settings_schema.json")) return null;
  return { files, directories };
}

function validateThemePackageArtifact(record, context, issues) {
  const gate = "theme-package";
  const claim = record?.validatedDocument?.claim;
  if (!claim || !exactKeys(claim, [
    "package_path",
    "package_sha256",
    "size_bytes",
    "active_source_manifest_sha256",
    "runtime_file_count",
    "source_commit_sha",
    "source_tree_sha",
    "candidate_theme_id",
  ], issues, gate, "claim")) return;
  if (!evidencePathIsSafe(claim.package_path) || !validSha256(claim.package_sha256) ||
      !Number.isSafeInteger(claim.size_bytes) || claim.size_bytes < 98) {
    add(issues, gate, "artifact.contract");
    return;
  }
  const absolute = path.resolve(context.repositoryRoot, ...claim.package_path.split("/"));
  try {
    if (!lstatSync(absolute).isFile() || containsSymbolicLink(context.repositoryRoot, absolute)) {
      add(issues, gate, "artifact.boundary");
      return;
    }
    const realPackage = realpathSync(absolute);
    if (!lstatSync(realPackage).isFile() || !isInside(realPackage, context.boundary.realAllowedRoot) ||
        realPackage === context.boundary.realBundle || realPackage === realpathSync(record.path.startsWith(".")
          ? path.resolve(context.repositoryRoot, ...record.path.split("/"))
          : record.path)) {
      add(issues, gate, "artifact.boundary");
      return;
    }
    validatePrivatePathGitStatus(claim.package_path, context, issues, gate, "artifact");
    const buffer = readFileSync(realPackage);
    if (buffer.length !== claim.size_bytes) add(issues, gate, "artifact.size");
    if (digest(buffer) !== claim.package_sha256) add(issues, gate, "artifact.hash-mismatch");
    const archive = parseThemeZip(buffer);
    if (!archive) {
      add(issues, gate, "artifact.zip-structure");
      return;
    }
    const manifest = context.sourceContracts?.activeSourceManifest;
    const manifestSchema = context.sourceContracts?.activeSourceManifestSchema;
    const manifestFailures = validateActiveSourceManifest(
      manifest,
      manifestSchema,
      path.join(context.repositoryRoot, "apps/shopify-theme"),
      context.repositoryRoot,
    );
    if (manifestFailures.length > 0) {
      add(issues, gate, "artifact.active-source-manifest");
      return;
    }
    exactValue(
      claim.active_source_manifest_sha256,
      contractDigest(manifest),
      issues,
      gate,
      "artifact.active-source-manifest-sha",
    );
    exactValue(claim.runtime_file_count, manifest.files.length, issues, gate, "artifact.runtime-file-count");
    const expectedFiles = new Map();
    for (const entry of manifest.files) {
      if (!entry || typeof entry.path !== "string" || !entry.path.startsWith("apps/shopify-theme/") ||
          !validSha256(entry.sha256)) {
        add(issues, gate, "artifact.active-source-manifest-entry");
        continue;
      }
      const packageName = entry.path.slice("apps/shopify-theme/".length);
      if (packageName.length === 0 || packageName.includes("\\") || path.posix.isAbsolute(packageName) ||
          packageName.split("/").includes("..") || path.posix.normalize(packageName) !== packageName) {
        add(issues, gate, "artifact.active-source-manifest-path");
        continue;
      }
      if (expectedFiles.has(packageName)) {
        add(issues, gate, "artifact.active-source-manifest-duplicate");
        continue;
      }
      expectedFiles.set(packageName, entry.sha256);
      try {
        if (digest(readFileSync(path.join(context.repositoryRoot, ...entry.path.split("/")))) !== entry.sha256) {
          add(issues, gate, "artifact.source-manifest-parity");
        }
      } catch {
        add(issues, gate, "artifact.source-file-missing");
      }
    }
    if (!sameSet([...archive.files.keys()], [...expectedFiles.keys()])) add(issues, gate, "artifact.runtime-file-set");
    for (const [name, expectedSha] of expectedFiles) {
      const contents = archive.files.get(name);
      if (!contents || digest(contents) !== expectedSha) add(issues, gate, "artifact.runtime-content");
    }
    for (const directory of archive.directories) {
      if (![...expectedFiles.keys()].some((name) => name.startsWith(directory))) {
        add(issues, gate, "artifact.unexpected-directory");
      }
    }
  } catch {
    add(issues, gate, "artifact.missing");
  }
}

function validateEvidenceDocuments(evidence, bundle, context, issues, now) {
  for (const record of evidence.values()) {
    record.validatedDocument = validateEvidenceEnvelope(record, record.kind, bundle, issues, now);
  }
  const packageRecord = [...evidence.values()].find((record) => record.kind === "theme-package");
  validateThemePackageArtifact(packageRecord, context, issues);
}

function requireEvidenceReference(reference, expectedKind, evidence, referencedIds, issues, gate, category) {
  if (!nonemptyString(reference, issues, gate, category)) return null;
  referencedIds.add(reference);
  const record = evidence.get(reference);
  if (!record) {
    add(issues, gate, `${category}.missing`);
    return null;
  }
  if (record.kind !== expectedKind) add(issues, gate, `${category}.kind`);
  return record;
}

function evidenceClaim(record, expectedKind, issues, gate, category) {
  const document = record?.validatedDocument;
  if (!document || document.evidence_kind !== expectedKind) {
    add(issues, gate, `${category}.record`);
    return null;
  }
  return document.claim;
}

function validateSource(source, evidence, referencedIds, issues, now) {
  const gate = "source";
  const keys = [
    "captured_at",
    "repository",
    "branch",
    "commit_sha",
    "tree_sha",
    "pull_request_merged",
    "protected_main",
    "accountable_human_review",
    "required_checks_passed",
    "package_sha256",
    "source_evidence_ref",
    "package_evidence_ref",
  ];
  if (!exactKeys(source, keys, issues, gate, "contract")) return;
  requireFreshCapture(source.captured_at, issues, gate, "capture", now);
  exactValue(source.repository, PREPAYMENT_GATE_POLICY.repository, issues, gate, "repository");
  exactValue(source.branch, PREPAYMENT_GATE_POLICY.branch, issues, gate, "branch");
  if (!validGitObjectId(source.commit_sha)) add(issues, gate, "commit-sha");
  if (!validGitObjectId(source.tree_sha)) add(issues, gate, "tree-sha");
  for (const field of ["pull_request_merged", "protected_main", "accountable_human_review", "required_checks_passed"]) {
    exactBoolean(source[field], true, issues, gate, field);
  }
  if (!validSha256(source.package_sha256)) add(issues, gate, "package-sha256");
  const sourceRecord = requireEvidenceReference(
    source.source_evidence_ref,
    "source-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "source-evidence",
  );
  const packageRecord = requireEvidenceReference(
    source.package_evidence_ref,
    "theme-package",
    evidence,
    referencedIds,
    issues,
    gate,
    "package-evidence",
  );
  const sourceClaim = evidenceClaim(sourceRecord, "source-readback", issues, gate, "source-evidence");
  if (sourceClaim && exactKeys(sourceClaim, [
    "repository",
    "branch",
    "commit_sha",
    "tree_sha",
    "pull_request_number",
    "pull_request_author_id",
    "pull_request_head_sha",
    "merged_at",
    "merge_commit_sha",
    "branch_protected",
    "approvals",
    "required_checks",
  ], issues, gate, "source-evidence.claim")) {
    exactValue(sourceRecord.validatedDocument.captured_at, source.captured_at, issues, gate, "source-evidence.capture-linkage");
    exactValue(sourceClaim.repository, source.repository, issues, gate, "source-evidence.repository");
    exactValue(sourceClaim.branch, source.branch, issues, gate, "source-evidence.branch");
    exactValue(sourceClaim.commit_sha, source.commit_sha, issues, gate, "source-evidence.commit");
    exactValue(sourceClaim.tree_sha, source.tree_sha, issues, gate, "source-evidence.tree");
    exactValue(sourceClaim.merge_commit_sha, source.commit_sha, issues, gate, "source-evidence.merge-commit");
    exactBoolean(sourceClaim.branch_protected, true, issues, gate, "source-evidence.branch-protected");
    if (!Number.isSafeInteger(sourceClaim.pull_request_number) || sourceClaim.pull_request_number < 1) {
      add(issues, gate, "source-evidence.pull-request-number");
    }
    accountableIdentifier(sourceClaim.pull_request_author_id, issues, gate, "source-evidence.pull-request-author");
    if (!validGitObjectId(sourceClaim.pull_request_head_sha)) add(issues, gate, "source-evidence.head-sha");
    const captured = captureMilliseconds(sourceRecord?.validatedDocument?.captured_at);
    const mergedAt = requireOrderedTimestamp(
      sourceClaim.merged_at,
      Number.NaN,
      captured,
      issues,
      gate,
      "source-evidence.merged-at",
    );
    if (!Array.isArray(sourceClaim.approvals) || sourceClaim.approvals.length === 0) {
      add(issues, gate, "source-evidence.approvals.exact-count");
    }
    const approvalReviewers = [];
    for (const approval of Array.isArray(sourceClaim.approvals) ? sourceClaim.approvals : []) {
      if (!exactKeys(approval, ["reviewer_id", "state", "submitted_at", "head_sha"], issues, gate, "source-evidence.approval")) continue;
      accountableIdentifier(approval.reviewer_id, issues, gate, "source-evidence.approval-reviewer");
      approvalReviewers.push(approval.reviewer_id);
      if (approval.reviewer_id === sourceClaim.pull_request_author_id) add(issues, gate, "source-evidence.self-review");
      exactValue(approval.state, "APPROVED", issues, gate, "source-evidence.approval-state");
      if (!validGitObjectId(approval.head_sha)) add(issues, gate, "source-evidence.approval-head-sha");
      exactValue(approval.head_sha, sourceClaim.pull_request_head_sha, issues, gate, "source-evidence.approval-head");
      requireOrderedTimestamp(approval.submitted_at, Number.NaN, mergedAt, issues, gate, "source-evidence.approval-time");
    }
    if (new Set(approvalReviewers).size !== approvalReviewers.length) add(issues, gate, "source-evidence.approval-reviewers");
    if (!Array.isArray(sourceClaim.required_checks) ||
        sourceClaim.required_checks.length !== PREPAYMENT_GATE_POLICY.required_checks.length) {
      add(issues, gate, "source-evidence.checks.exact-count");
    }
    const checkNames = [];
    for (const check of Array.isArray(sourceClaim.required_checks) ? sourceClaim.required_checks : []) {
      if (!exactKeys(check, ["name", "conclusion", "completed_at", "head_sha"], issues, gate, "source-evidence.check")) continue;
      checkNames.push(check.name);
      const acceptableConclusions = check.name === "Supabase Preview" ? ["SUCCESS", "SKIPPED"] : ["SUCCESS"];
      if (!acceptableConclusions.includes(check.conclusion)) add(issues, gate, "source-evidence.check-conclusion");
      if (!validGitObjectId(check.head_sha)) add(issues, gate, "source-evidence.check-head-sha");
      exactValue(check.head_sha, source.commit_sha, issues, gate, "source-evidence.check-head");
      requireOrderedTimestamp(
        check.completed_at,
        mergedAt,
        captured,
        issues,
        gate,
        "source-evidence.check-time",
      );
    }
    if (!sameSet(checkNames, PREPAYMENT_GATE_POLICY.required_checks)) add(issues, gate, "source-evidence.check-set");
  }

  const packageClaim = evidenceClaim(packageRecord, "theme-package", issues, gate, "package-evidence");
  if (packageClaim && exactKeys(packageClaim, [
    "package_path",
    "package_sha256",
    "size_bytes",
    "active_source_manifest_sha256",
    "runtime_file_count",
    "source_commit_sha",
    "source_tree_sha",
    "candidate_theme_id",
  ], issues, gate, "package-evidence.claim")) {
    exactValue(packageRecord.validatedDocument.captured_at, source.captured_at, issues, gate, "package-evidence.capture-linkage");
    exactValue(packageClaim.package_sha256, source.package_sha256, issues, gate, "package-linkage");
    exactValue(packageClaim.source_commit_sha, source.commit_sha, issues, gate, "package-source-commit");
    exactValue(packageClaim.source_tree_sha, source.tree_sha, issues, gate, "package-source-tree");
    exactValue(packageClaim.candidate_theme_id, PREPAYMENT_GATE_POLICY.candidate_theme_id, issues, gate, "package-theme-id");
  }
}

function validateCandidate(candidate, source, evidence, referencedIds, issues, now) {
  const gate = "candidate-theme";
  const keys = [
    "captured_at",
    "theme_id",
    "status",
    "checkout_cta_enabled",
    "password_protected",
    "published",
    "dedicated_hero_pass",
    "controlled_social_image_pass",
    "wordmark",
    "storefront_emblem_asset",
    "storefront_emblem_sha256",
    "source_commit_sha",
    "source_tree_sha",
    "package_sha256",
    "evidence_ref",
  ];
  if (!exactKeys(candidate, keys, issues, gate, "contract")) return;
  requireFreshCapture(candidate.captured_at, issues, gate, "capture", now);
  exactValue(candidate.theme_id, PREPAYMENT_GATE_POLICY.candidate_theme_id, issues, gate, "theme-id");
  exactValue(candidate.status, PREPAYMENT_GATE_POLICY.candidate_theme_status, issues, gate, "status");
  exactBoolean(candidate.checkout_cta_enabled, false, issues, gate, "checkout-cta-enabled");
  exactBoolean(candidate.password_protected, true, issues, gate, "password-protected");
  exactBoolean(candidate.published, false, issues, gate, "published");
  exactBoolean(candidate.dedicated_hero_pass, true, issues, gate, "dedicated-hero");
  exactBoolean(candidate.controlled_social_image_pass, true, issues, gate, "controlled-social-image");
  exactValue(candidate.wordmark, PREPAYMENT_GATE_POLICY.wordmark, issues, gate, "wordmark");
  exactValue(
    candidate.storefront_emblem_asset,
    PREPAYMENT_GATE_POLICY.storefront_emblem_asset,
    issues,
    gate,
    "storefront-emblem-asset",
  );
  exactValue(
    candidate.storefront_emblem_sha256,
    PREPAYMENT_GATE_POLICY.storefront_emblem_sha256,
    issues,
    gate,
    "storefront-emblem-sha",
  );
  if (candidate.source_commit_sha !== source?.commit_sha) add(issues, gate, "commit-linkage");
  if (candidate.source_tree_sha !== source?.tree_sha) add(issues, gate, "tree-linkage");
  if (candidate.package_sha256 !== source?.package_sha256) add(issues, gate, "package-linkage");
  const record = requireEvidenceReference(
    candidate.evidence_ref,
    "candidate-theme-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "candidate-theme-readback", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "readback_source",
    "theme_name",
    "theme_id",
    "status",
    "checkout_cta_enabled",
    "password_protected",
    "published",
    "dedicated_hero_pass",
    "controlled_social_image_pass",
    "wordmark",
    "storefront_emblem_asset",
    "storefront_emblem_sha256",
    "source_commit_sha",
    "source_tree_sha",
    "package_sha256",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, candidate.captured_at, issues, gate, "evidence.capture-linkage");
  exactValue(claim.readback_source, "authenticated-shopify-admin", issues, gate, "evidence.source");
  nonemptyString(claim.theme_name, issues, gate, "evidence.theme-name");
  for (const field of [
    "theme_id",
    "status",
    "checkout_cta_enabled",
    "password_protected",
    "published",
    "dedicated_hero_pass",
    "controlled_social_image_pass",
    "wordmark",
    "storefront_emblem_asset",
    "storefront_emblem_sha256",
    "source_commit_sha",
    "source_tree_sha",
    "package_sha256",
  ]) {
    exactValue(claim[field], candidate[field], issues, gate, `evidence.${field}`);
  }
}

function searchExpectationsFromSource(context, issues) {
  const gate = "search-contract";
  const contract = context.sourceContracts?.searchExpectations;
  if (!exactKeys(contract, [
    "$schema",
    "schema_version",
    "revision",
    "product_facts_revision",
    "locale",
    "brand",
    "status",
    "queries",
  ], issues, gate, "contract")) return new Map();
  exactValue(contract.$schema, "./storefront-search-expectations.v1.schema.json", issues, gate, "schema");
  exactValue(contract.schema_version, 1, issues, gate, "schema-version");
  nonemptyString(contract.revision, issues, gate, "revision");
  exactValue(contract.product_facts_revision, context.sourceContracts?.productFacts?.revision, issues, gate, "facts-revision");
  exactValue(contract.locale, "en-US", issues, gate, "locale");
  exactValue(contract.brand, PREPAYMENT_GATE_POLICY.wordmark, issues, gate, "brand");
  exactValue(contract.status, "prepared", issues, gate, "status");
  if (!Array.isArray(contract.queries) || contract.queries.length !== REQUIRED_SEARCH_QUERIES.length) {
    add(issues, gate, "queries.exact-count");
  }
  const expectations = new Map();
  for (const item of Array.isArray(contract.queries) ? contract.queries : []) {
    if (!exactKeys(item, ["query", "review_basis", "expected_handles"], issues, gate, "query")) continue;
    nonemptyString(item.review_basis, issues, gate, "query.review-basis");
    if (!REQUIRED_SEARCH_QUERIES.includes(item.query) || expectations.has(item.query)) {
      add(issues, gate, "query.identity");
      continue;
    }
    if (!Array.isArray(item.expected_handles) || item.expected_handles.length === 0 ||
        new Set(item.expected_handles).size !== item.expected_handles.length ||
        item.expected_handles.some((handle) => !EXPECTED_PRODUCT_HANDLES.includes(handle))) {
      add(issues, gate, "query.expected-handles");
      continue;
    }
    expectations.set(item.query, item.expected_handles);
  }
  if (!sameSet([...expectations.keys()], REQUIRED_SEARCH_QUERIES)) add(issues, gate, "query-set");
  return expectations;
}

function privacyChoicesReadback(evidence, issues, now) {
  const gate = "privacy-choices";
  const record = [...evidence.values()].find((item) => item.kind === "operations-readback");
  const readback = record?.validatedDocument?.claim?.privacy_choices_readback;
  if (!readback || !exactKeys(readback, [
    "authenticated_source",
    "configured",
    "menu_visible",
    "path",
    "observed_at",
    "readback_sha256",
  ], issues, gate, "readback")) return null;
  exactValue(readback.authenticated_source, "authenticated-shopify-admin", issues, gate, "source");
  exactBoolean(readback.configured, true, issues, gate, "configured");
  exactBoolean(readback.menu_visible, true, issues, gate, "menu-visible");
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(readback.path);
  } catch {
    decodedPath = "";
  }
  if (typeof readback.path !== "string" || !/^\/(?!\/)[^?#\\\u0000-\u001f\u007f]+$/u.test(readback.path) ||
      !/^\/(?!\/)[^?#\\\u0000-\u001f\u007f]+$/u.test(decodedPath)) {
    add(issues, gate, "path");
  }
  if (!validSha256(readback.readback_sha256)) add(issues, gate, "readback-sha");
  requireFreshObservation(
    readback.observed_at,
    captureMilliseconds(record?.validatedDocument?.captured_at),
    issues,
    gate,
    "observed-at",
    now,
  );
  return readback;
}

function validateRenderedRoutes(rendered, candidate, evidence, referencedIds, issues, now, context) {
  const gate = "rendered-routes";
  const searchExpectations = searchExpectationsFromSource(context, issues);
  const privacyReadback = privacyChoicesReadback(evidence, issues, now);
  if (!exactKeys(rendered, [
    "captured_at",
    "status",
    "results",
    "search_queries",
    "search_contract_revision",
    "search_contract_sha256",
    "sold_out_fixture_pass",
    "zero_result_pass",
    "server_error_pass",
    "evidence_ref",
  ], issues, gate, "contract")) return;
  requireFreshCapture(rendered.captured_at, issues, gate, "capture", now);
  exactValue(rendered.status, "pass", issues, gate, "status");
  if (!Array.isArray(rendered.results) || rendered.results.length !== REQUIRED_RENDERED_ROUTE_CATEGORIES.length) {
    add(issues, gate, "results.exact-count");
  }
  const categories = [];
  for (const result of Array.isArray(rendered.results) ? rendered.results : []) {
    if (!exactKeys(result, ROUTE_RESULT_KEYS, issues, gate, "result")) continue;
    categories.push(result.category);
    if (!REQUIRED_RENDERED_ROUTE_CATEGORIES.includes(result.category)) add(issues, gate, "result.category");
    const requiredCount = ROUTE_COUNT_REQUIREMENTS.get(result.category);
    if (!Number.isSafeInteger(result.checked_route_count) || result.checked_route_count !== (requiredCount ?? 1)) {
      add(issues, gate, "result.route-count");
    }
    exactBoolean(result.http_pass, true, issues, gate, "result.http");
    exactBoolean(result.readback_pass, true, issues, gate, "result.readback");
  }
  if (!sameSet(categories, REQUIRED_RENDERED_ROUTE_CATEGORIES)) add(issues, gate, "results.category-set");
  if (!sameSet(rendered.search_queries, REQUIRED_SEARCH_QUERIES)) add(issues, gate, "search-query-set");
  exactValue(
    rendered.search_contract_revision,
    context.sourceContracts?.searchExpectations?.revision,
    issues,
    gate,
    "search-contract-revision",
  );
  exactValue(
    rendered.search_contract_sha256,
    contractDigest(context.sourceContracts?.searchExpectations),
    issues,
    gate,
    "search-contract-sha",
  );
  exactBoolean(rendered.sold_out_fixture_pass, true, issues, gate, "sold-out-fixture");
  exactBoolean(rendered.zero_result_pass, true, issues, gate, "zero-result");
  exactBoolean(rendered.server_error_pass, true, issues, gate, "server-error");
  const record = requireEvidenceReference(
    rendered.evidence_ref,
    "rendered-route-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "rendered-route-readback", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "theme_id",
    "source_commit_sha",
    "source_tree_sha",
    "package_sha256",
    "search_contract_revision",
    "search_contract_sha256",
    "targets",
    "search_results",
    "sold_out_fixture",
    "server_error_fixture",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, rendered.captured_at, issues, gate, "evidence.capture-linkage");
  exactValue(claim.theme_id, PREPAYMENT_GATE_POLICY.candidate_theme_id, issues, gate, "evidence.theme-id");
  exactValue(claim.source_commit_sha, record.validatedDocument.source_commit_sha, issues, gate, "evidence.commit");
  exactValue(claim.source_tree_sha, record.validatedDocument.source_tree_sha, issues, gate, "evidence.tree");
  exactValue(claim.package_sha256, candidate?.package_sha256, issues, gate, "evidence.package-sha");
  exactValue(claim.search_contract_revision, rendered.search_contract_revision, issues, gate, "evidence.search-contract-revision");
  exactValue(claim.search_contract_sha256, rendered.search_contract_sha256, issues, gate, "evidence.search-contract-sha");

  if (!Array.isArray(claim.search_results) || claim.search_results.length !== REQUIRED_SEARCH_QUERIES.length + 1) {
    add(issues, gate, "evidence.search-results.exact-count");
  }
  const searchQueries = [];
  let zeroFixtureQuery = null;
  for (const result of Array.isArray(claim.search_results) ? claim.search_results : []) {
    if (!exactKeys(result, [
      "query",
      "expected_handles",
      "actual_handles",
      "zero_result_expected",
      "observed_at",
      "result_page_sha256",
    ], issues, gate, "evidence.search-result")) continue;
    if (!nonemptyString(result.query, issues, gate, "evidence.search-query")) continue;
    searchQueries.push(result.query);
    const expectedValid = Array.isArray(result.expected_handles) &&
      new Set(result.expected_handles).size === result.expected_handles.length &&
      result.expected_handles.every((handle) => EXPECTED_PRODUCT_HANDLES.includes(handle));
    const actualValid = Array.isArray(result.actual_handles) &&
      new Set(result.actual_handles).size === result.actual_handles.length &&
      result.actual_handles.every((handle) => EXPECTED_PRODUCT_HANDLES.includes(handle));
    if (!expectedValid) add(issues, gate, "evidence.search-expected-handles");
    if (!actualValid) add(issues, gate, "evidence.search-actual-handles");
    const policyExpectation = searchExpectations.get(result.query);
    if (policyExpectation && !sameSet(result.expected_handles, policyExpectation)) {
      add(issues, gate, "evidence.search-policy-expectation");
    }
    if (!sameSet(result.actual_handles, result.expected_handles ?? [])) add(issues, gate, "evidence.search-result-parity");
    exactBoolean(
      result.zero_result_expected,
      Array.isArray(result.expected_handles) && result.expected_handles.length === 0,
      issues,
      gate,
      "evidence.search-zero-expectation",
    );
    requireFreshObservation(
      result.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.search-observed-at",
      now,
    );
    if (!validSha256(result.result_page_sha256)) add(issues, gate, "evidence.search-page-sha");
    if (!REQUIRED_SEARCH_QUERIES.includes(result.query)) {
      if (zeroFixtureQuery !== null || !/^mochirii-zero-result-[a-z0-9-]+$/u.test(result.query) ||
          result.zero_result_expected !== true || result.expected_handles?.length !== 0 ||
          result.actual_handles?.length !== 0) {
        add(issues, gate, "evidence.search-zero-fixture");
      } else {
        zeroFixtureQuery = result.query;
      }
    }
  }
  if (!sameSet(searchQueries.filter((query) => REQUIRED_SEARCH_QUERIES.includes(query)), REQUIRED_SEARCH_QUERIES) ||
      zeroFixtureQuery === null || new Set(searchQueries).size !== searchQueries.length) {
    add(issues, gate, "evidence.search-query-set");
  }

  const expectedIdentities = new Map([
    ["home", ["home"]],
    ["collections", [...EXPECTED_COLLECTION_HANDLES]],
    ["products", [...EXPECTED_PRODUCT_HANDLES]],
    ["search-and-filters", searchQueries.map((query) => `search:${query}`)],
    ["cart", ["cart"]],
    ["contact", ["contact"]],
    ["policies-and-privacy", [...EXPECTED_POLICY_IDENTITIES]],
    ["accounts", ["account-login"]],
    ["errors", ["not-found", "server-error"]],
    ["password", ["password"]],
    ["notifications", [...EXPECTED_NOTIFICATION_IDENTITIES]],
  ]);
  const expectedTargetLocations = new Map([
    ["home\u0000home", "/"],
    ...EXPECTED_COLLECTION_HANDLES.map((identity) => [`collections\u0000${identity}`, `/collections/${identity}`]),
    ...EXPECTED_PRODUCT_HANDLES.map((identity) => [`products\u0000${identity}`, `/products/${identity}`]),
    ...searchQueries.map((query) => [
      `search-and-filters\u0000search:${query}`,
      `/search?q=${encodeURIComponent(query)}&type=product&options%5Bprefix%5D=last`,
    ]),
    ["cart\u0000cart", "/cart"],
    ["contact\u0000contact", "/pages/contact"],
    ["policies-and-privacy\u0000refund-policy", "/policies/refund-policy"],
    ["policies-and-privacy\u0000shipping-policy", "/policies/shipping-policy"],
    ["policies-and-privacy\u0000privacy-policy", "/policies/privacy-policy"],
    ["policies-and-privacy\u0000terms-of-service", "/policies/terms-of-service"],
    ["policies-and-privacy\u0000privacy-choices", privacyReadback?.path],
    ["accounts\u0000account-login", "/account/login"],
    ["errors\u0000not-found", "/__mochirii-fixtures/not-found"],
    ["errors\u0000server-error", "/__mochirii-fixtures/server-error"],
    ["password\u0000password", "/password"],
    ...EXPECTED_NOTIFICATION_IDENTITIES.map((identity) => [
      `notifications\u0000${identity}`,
      `notification:${identity}`,
    ]),
  ]);
  if (!Array.isArray(claim.targets) ||
      claim.targets.length !== [...expectedIdentities.values()].reduce((count, identities) => count + identities.length, 0)) {
    add(issues, gate, "evidence.targets.exact-count");
  }
  const actualByCategory = new Map(REQUIRED_RENDERED_ROUTE_CATEGORIES.map((category) => [category, []]));
  const targetByIdentity = new Map();
  for (const target of Array.isArray(claim.targets) ? claim.targets : []) {
    if (!exactKeys(target, [
      "category",
      "identity",
      "target",
      "observed_at",
      "http_status",
      "content_sha256",
      "review_status",
    ], issues, gate, "evidence.target")) continue;
    if (!actualByCategory.has(target.category)) {
      add(issues, gate, "evidence.target-category");
      continue;
    }
    actualByCategory.get(target.category).push(target.identity);
    const targetIdentity = `${target.category}\u0000${target.identity}`;
    if (targetByIdentity.has(targetIdentity)) add(issues, gate, "evidence.target-duplicate");
    targetByIdentity.set(targetIdentity, target);
    nonemptyString(target.identity, issues, gate, "evidence.target-identity");
    if (!nonemptyString(target.target, issues, gate, "evidence.target-location") || PLACEHOLDER_PATTERN.test(target.target)) {
      add(issues, gate, "evidence.target-location");
    }
    exactValue(
      target.target,
      expectedTargetLocations.get(`${target.category}\u0000${target.identity}`),
      issues,
      gate,
      "evidence.target-location-linkage",
    );
    const expectedStatus = target.category === "notifications" ? null :
      target.identity === "not-found" ? 404 : target.identity === "server-error" ? 500 : 200;
    exactValue(target.http_status, expectedStatus, issues, gate, "evidence.target-http-status");
    exactValue(target.review_status, "pass", issues, gate, "evidence.target-review");
    if (!validSha256(target.content_sha256)) add(issues, gate, "evidence.target-content-sha");
    requireFreshObservation(
      target.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.target-observed-at",
      now,
    );
  }
  for (const [category, identities] of expectedIdentities) {
    if (!sameSet(actualByCategory.get(category), identities)) add(issues, gate, `evidence.targets.${category}`);
  }
  for (const result of Array.isArray(claim.search_results) ? claim.search_results : []) {
    const target = targetByIdentity.get(`search-and-filters\u0000search:${result?.query}`);
    if (!target) {
      add(issues, gate, "evidence.search-target.missing");
      continue;
    }
    exactValue(result.result_page_sha256, target.content_sha256, issues, gate, "evidence.search-target.content-sha256");
    exactValue(result.observed_at, target.observed_at, issues, gate, "evidence.search-target.observed-at");
  }

  if (exactKeys(claim.sold_out_fixture, [
    "handle",
    "expected_availability",
    "actual_availability",
    "fixture_unpublished",
    "observed_at",
    "content_sha256",
  ], issues, gate, "evidence.sold-out-fixture")) {
    if (!HANDLE_PATTERN.test(claim.sold_out_fixture.handle ?? "") ||
        EXPECTED_PRODUCT_HANDLES.includes(claim.sold_out_fixture.handle)) add(issues, gate, "evidence.sold-out-fixture-handle");
    exactValue(claim.sold_out_fixture.expected_availability, "out-of-stock", issues, gate, "evidence.sold-out-expected");
    exactValue(claim.sold_out_fixture.actual_availability, "out-of-stock", issues, gate, "evidence.sold-out-actual");
    exactBoolean(claim.sold_out_fixture.fixture_unpublished, true, issues, gate, "evidence.sold-out-unpublished");
    if (!validSha256(claim.sold_out_fixture.content_sha256)) add(issues, gate, "evidence.sold-out-sha");
    requireFreshObservation(
      claim.sold_out_fixture.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.sold-out-observed-at",
      now,
    );
  }
  if (exactKeys(claim.server_error_fixture, [
    "expected_http_status",
    "actual_http_status",
    "branded_error_copy_pass",
    "observed_at",
    "content_sha256",
  ], issues, gate, "evidence.server-error-fixture")) {
    exactValue(claim.server_error_fixture.expected_http_status, 500, issues, gate, "evidence.server-error-expected");
    exactValue(claim.server_error_fixture.actual_http_status, 500, issues, gate, "evidence.server-error-actual");
    exactBoolean(claim.server_error_fixture.branded_error_copy_pass, true, issues, gate, "evidence.server-error-copy");
    if (!validSha256(claim.server_error_fixture.content_sha256)) add(issues, gate, "evidence.server-error-sha");
    requireFreshObservation(
      claim.server_error_fixture.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.server-error-observed-at",
      now,
    );
    const renderedServerError = targetByIdentity.get("errors\u0000server-error");
    if (!renderedServerError) {
      add(issues, gate, "evidence.server-error-target.missing");
    } else {
      exactValue(
        claim.server_error_fixture.content_sha256,
        renderedServerError.content_sha256,
        issues,
        gate,
        "evidence.server-error-target.content-sha256",
      );
      exactValue(
        claim.server_error_fixture.observed_at,
        renderedServerError.observed_at,
        issues,
        gate,
        "evidence.server-error-target.observed-at",
      );
    }
  }
}

function validateProductReview(review, evidence, referencedIds, issues, now, context) {
  const gate = "product-review";
  const factsContract = context.sourceContracts?.productFacts;
  const keys = [
    "captured_at",
    "status",
    "product_facts_schema_version",
    "product_facts_revision",
    "product_facts_sha256",
    "canonical_emblem",
    "storefront_emblem",
    "wordmark",
    "products",
    "evidence_ref",
  ];
  if (!exactKeys(review, keys, issues, gate, "contract")) return { productIdentities: [] };
  requireFreshCapture(review.captured_at, issues, gate, "capture", now);
  exactValue(review.status, "pass", issues, gate, "status");
  exactValue(review.product_facts_schema_version, 3, issues, gate, "facts-schema-version");
  exactValue(review.product_facts_revision, factsContract?.revision, issues, gate, "facts-revision");
  exactValue(review.product_facts_sha256, contractDigest(factsContract), issues, gate, "facts-sha");
  exactValue(factsContract?.status, "complete", issues, gate, "facts-status");
  for (const [field, asset, sha] of [
    ["canonical_emblem", PREPAYMENT_GATE_POLICY.canonical_emblem_asset, PREPAYMENT_GATE_POLICY.canonical_emblem_sha256],
    ["storefront_emblem", PREPAYMENT_GATE_POLICY.storefront_emblem_asset, PREPAYMENT_GATE_POLICY.storefront_emblem_sha256],
  ]) {
    if (!exactKeys(review[field], ["asset_path", "sha256"], issues, gate, field)) continue;
    exactValue(review[field].asset_path, asset, issues, gate, `${field}.asset-path`);
    exactValue(review[field].sha256, sha, issues, gate, `${field}.sha256`);
  }
  exactValue(review.wordmark, PREPAYMENT_GATE_POLICY.wordmark, issues, gate, "wordmark");
  if (!Array.isArray(review.products) || review.products.length !== 20) add(issues, gate, "products.exact-count");
  const handles = [];
  const productIds = [];
  const variantIds = [];
  const productIdentities = [];
  for (const product of Array.isArray(review.products) ? review.products : []) {
    if (!exactKeys(product, PRODUCT_RECORD_KEYS, issues, gate, "product")) continue;
    if (!HANDLE_PATTERN.test(product.handle ?? "")) add(issues, gate, "product.handle");
    if (!nonemptyString(product.product_record_id, issues, gate, "product.product-record-id") ||
        !GID_PRODUCT_PATTERN.test(product.product_record_id)) {
      add(issues, gate, "product.product-record-id");
      continue;
    }
    if (!nonemptyString(product.variant_record_id, issues, gate, "product.variant-record-id") ||
        !GID_VARIANT_PATTERN.test(product.variant_record_id)) {
      add(issues, gate, "product.variant-record-id");
      continue;
    }
    handles.push(product.handle);
    productIds.push(product.product_record_id);
    variantIds.push(product.variant_record_id);
    productIdentities.push({
      handle: product.handle,
      product_id: product.product_record_id,
      variant_id: product.variant_record_id,
      formula_identity_sha256: null,
      source_catalog_record_sha256: null,
    });
    for (const field of PRODUCT_RECORD_KEYS.slice(3)) exactBoolean(product[field], true, issues, gate, `product.${field}`);
  }
  if (!sameSet(handles, EXPECTED_PRODUCT_HANDLES)) add(issues, gate, "products.identity-set");
  if (new Set(productIds).size !== productIds.length) add(issues, gate, "products.product-identity");
  if (new Set(variantIds).size !== variantIds.length) add(issues, gate, "products.variant-identity");
  const productIdByHandle = new Map(productIdentities.map((identity) => [identity.handle, identity.product_id]));
  const record = requireEvidenceReference(
    review.evidence_ref,
    "product-review",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "product-review", issues, gate, "evidence");
  if (claim && exactKeys(claim, [
    "product_facts_schema_version",
    "product_facts_revision",
    "product_facts_sha256",
    "canonical_emblem",
    "storefront_emblem",
    "wordmark",
    "readback_source",
    "admin_api_version",
    "products",
  ], issues, gate, "evidence.claim")) {
    exactValue(record.validatedDocument.captured_at, review.captured_at, issues, gate, "evidence.capture-linkage");
    exactValue(claim.product_facts_schema_version, review.product_facts_schema_version, issues, gate, "evidence.facts-schema");
    exactValue(claim.product_facts_revision, review.product_facts_revision, issues, gate, "evidence.facts-revision");
    exactValue(claim.product_facts_sha256, review.product_facts_sha256, issues, gate, "evidence.facts-sha");
    if (JSON.stringify(claim.canonical_emblem) !== JSON.stringify(review.canonical_emblem)) add(issues, gate, "evidence.canonical-emblem");
    if (JSON.stringify(claim.storefront_emblem) !== JSON.stringify(review.storefront_emblem)) add(issues, gate, "evidence.storefront-emblem");
    exactValue(claim.wordmark, review.wordmark, issues, gate, "evidence.wordmark");
    exactValue(
      claim.readback_source,
      "authenticated-shopify-admin-graphql",
      issues,
      gate,
      "evidence.shopify-readback-source",
    );
    exactValue(
      claim.admin_api_version,
      SHOPIFY_ADMIN_API_VERSION,
      issues,
      gate,
      "evidence.shopify-admin-api-version",
    );
    if (!Array.isArray(claim.products) || claim.products.length !== EXPECTED_PRODUCT_HANDLES.length) {
      add(issues, gate, "evidence.products.exact-count");
    }
    const reviewByHandle = new Map((Array.isArray(review.products) ? review.products : []).map((item) => [item.handle, item]));
    const sourceByHandle = new Map((Array.isArray(factsContract?.products) ? factsContract.products : [])
      .map((item) => [item.handle, item]));
    const evidenceHandles = [];
    for (const product of Array.isArray(claim.products) ? claim.products : []) {
      if (!exactKeys(product, [
        ...PRODUCT_RECORD_KEYS,
        "formula_identity_sha256",
        "formula_record_sha256",
        "facts_record_sha256",
        "front_label_sha256",
        "technical_panel_sha256",
        "outer_box_sha256",
        "label_media_review_record_sha256",
        "media_records",
        "shopify_readback",
        "reviewed_at",
      ], issues, gate, "evidence.product")) continue;
      evidenceHandles.push(product.handle);
      const publicRecord = reviewByHandle.get(product.handle);
      for (const field of PRODUCT_RECORD_KEYS) {
        if (product[field] !== publicRecord?.[field]) add(issues, gate, `evidence.product.${field}`);
      }
      for (const field of [
        "formula_identity_sha256",
        "formula_record_sha256",
        "facts_record_sha256",
        "front_label_sha256",
        "technical_panel_sha256",
        "outer_box_sha256",
        "label_media_review_record_sha256",
      ]) {
        if (!validSha256(product[field])) add(issues, gate, `evidence.product.${field}`);
      }
      const sourceProduct = sourceByHandle.get(product.handle);
      if (sourceProduct?.review_status !== "complete" || !sourceProduct?.facts ||
          typeof sourceProduct.facts !== "object" || Array.isArray(sourceProduct.facts)) {
        add(issues, gate, "evidence.product.source-facts-incomplete");
      }
      const envelopeCapture = captureMilliseconds(record.validatedDocument.captured_at);
      const reviewerReviewedAt = captureMilliseconds(record.validatedDocument.reviewer.reviewed_at);
      const formulaArtifact = requirePrivateArtifactBinding(
        context.artifactIndex,
        {
          scope: "product",
          handle: product.handle,
          field: "formula_record_sha256",
          role: null,
          public_reference: null,
        },
        product.formula_record_sha256,
        context,
        issues,
        gate,
        "evidence.product.formula_record_sha256-artifact",
      );
      const formulaRecord = readPrivateJsonArtifact(
        formulaArtifact,
        context,
        issues,
        gate,
        "evidence.product.formula-record-artifact",
      );
      const formulaValidation = formulaRecord
        ? validatePrivateFormulaRecord(
          formulaRecord,
          product,
          sourceProduct,
          envelopeCapture,
          issues,
          now,
        )
        : null;
      for (const field of ["front_label_sha256", "technical_panel_sha256", "outer_box_sha256"]) {
        requirePrivateArtifactBinding(
          context.artifactIndex,
          {
            scope: "product",
            handle: product.handle,
            field,
            role: null,
            public_reference: null,
          },
          product[field],
          context,
          issues,
          gate,
          `evidence.product.${field}-artifact`,
        );
      }
      const linkedIdentity = productIdentities.find((item) => item.handle === product.handle);
      if (linkedIdentity) {
        linkedIdentity.formula_identity_sha256 = product.formula_identity_sha256;
        linkedIdentity.source_catalog_record_sha256 = formulaValidation?.sourceCatalogRecordSha256 ?? null;
      }
      exactValue(
        product.facts_record_sha256,
        contractDigest(sourceProduct),
        issues,
        gate,
        "evidence.product.facts-record-sha",
      );
      const expectedMedia = Array.isArray(sourceProduct?.facts?.media) ? sourceProduct.facts.media : [];
      const actualMedia = Array.isArray(product.media_records) ? product.media_records : [];
      const actualMediaKeys = [];
      const mediaArtifactHashes = [];
      const imageArtifacts = new Map();
      const ocrArtifacts = new Map();
      for (const media of actualMedia) {
        if (!exactKeys(media, [
          "role",
          "public_reference",
          "alt_text",
          "artifact_sha256",
          "ocr_output_sha256",
        ], issues, gate, "evidence.product.media")) continue;
        const mediaIdentity = `${media.role}\u0000${media.public_reference}`;
        actualMediaKeys.push(`${mediaIdentity}\u0000${media.alt_text}`);
        mediaArtifactHashes.push(media.artifact_sha256);
        if (!validSha256(media.artifact_sha256)) add(issues, gate, "evidence.product.media-artifact-sha");
        const expected = expectedMedia.find((item) =>
          item.role === media.role && item.public_reference === media.public_reference);
        exactValue(media.alt_text, expected?.alt_text, issues, gate, "evidence.product.media-alt-text");
        exactValue(media.artifact_sha256, expected?.asset_sha256, issues, gate, "evidence.product.media-source-sha");
        const imageArtifact = requirePrivateArtifactBinding(
          context.artifactIndex,
          {
            scope: "product",
            handle: product.handle,
            field: "media_records.artifact_sha256",
            role: media.role,
            public_reference: media.public_reference,
          },
          media.artifact_sha256,
          context,
          issues,
          gate,
          "evidence.product.media-artifact",
        );
        if (imageArtifact) imageArtifacts.set(mediaIdentity, imageArtifact);
        if (REQUIRED_OCR_MEDIA_ROLES.includes(media.role)) {
          if (!validSha256(media.ocr_output_sha256)) {
            add(issues, gate, "evidence.product.media-ocr-sha");
          }
          const ocrArtifact = requirePrivateArtifactBinding(
            context.artifactIndex,
            {
              scope: "product",
              handle: product.handle,
              field: "media_records.ocr_output_sha256",
              role: media.role,
              public_reference: media.public_reference,
            },
            media.ocr_output_sha256,
            context,
            issues,
            gate,
            "evidence.product.media-ocr-artifact",
          );
          const ocrRecord = readPrivateJsonArtifact(
            ocrArtifact,
            context,
            issues,
            gate,
            "evidence.product.ocr-record-artifact",
          );
          const ocrValidation = ocrRecord
            ? validatePrivateOcrRecord(
              ocrRecord,
              {
                handle: product.handle,
                role: media.role,
                public_reference: media.public_reference,
                source_image_sha256: media.artifact_sha256,
                semantic_comparisons: expectedPrivateOcrComparisons(sourceProduct, media.role),
                approved_comparables: expectedPrivateOcrComparables(sourceProduct),
                mandatory_name_exceptions: context.sourceContracts?.mandatoryNames,
              },
              imageArtifact,
              envelopeCapture,
              issues,
              now,
            )
            : null;
          ocrArtifacts.set(mediaIdentity, {
            sha256: ocrArtifact?.sha256 ?? null,
            capturedAt: ocrValidation?.capturedAt ?? Number.NaN,
            semanticObservedShaByField:
              ocrValidation?.semanticObservedShaByField ?? new Map(),
          });
        } else {
          exactValue(media.ocr_output_sha256, null, issues, gate, "evidence.product.media-ocr-not-applicable");
        }
      }
      const expectedMediaKeys = expectedMedia.map((media) =>
        `${media.role}\u0000${media.public_reference}\u0000${media.alt_text}`);
      if (!sameSet(actualMediaKeys, expectedMediaKeys) || actualMedia.length < 3) {
        add(issues, gate, "evidence.product.media-source-parity");
      }
      if (new Set(mediaArtifactHashes).size !== mediaArtifactHashes.length) add(issues, gate, "evidence.product.media-artifact-duplicate");
      const labelReviewArtifact = requirePrivateArtifactBinding(
        context.artifactIndex,
        {
          scope: "product",
          handle: product.handle,
          field: "label_media_review_record_sha256",
          role: null,
          public_reference: null,
        },
        product.label_media_review_record_sha256,
        context,
        issues,
        gate,
        "evidence.product.label_media_review_record_sha256-artifact",
      );
      const labelReviewRecord = readPrivateJsonArtifact(
        labelReviewArtifact,
        context,
        issues,
        gate,
        "evidence.product.label-media-review-artifact",
      );
      const labelReviewValidation = labelReviewRecord
        ? validatePrivateLabelReviewRecord(
          labelReviewRecord,
          product,
          sourceProduct,
          imageArtifacts,
          ocrArtifacts,
          formulaValidation?.capturedAt ?? Number.NaN,
          reviewerReviewedAt,
          issues,
        )
        : null;
      if (sourceProduct?.facts && typeof sourceProduct.facts === "object" && !Array.isArray(sourceProduct.facts)) {
        try {
          validateShopifyProductReadback(
            product.shopify_readback,
            expectedShopifyProjection(sourceProduct, productIdByHandle),
            publicRecord,
            captureMilliseconds(record.validatedDocument.captured_at),
            issues,
            now,
          );
        } catch {
          add(issues, gate, "evidence.product.shopify-projection");
        }
      }
      requireOrderedTimestamp(
        product.reviewed_at,
        labelReviewValidation?.reviewedAt ?? Number.NaN,
        reviewerReviewedAt,
        issues,
        gate,
        "evidence.product.reviewed-at",
      );
    }
    if (!sameSet(evidenceHandles, EXPECTED_PRODUCT_HANDLES)) add(issues, gate, "evidence.products.identity-set");
  }
  return { productIdentities };
}

function validatePrivateCatalogSnapshot(ledger, context, issues) {
  const gate = "private-price";
  const catalog = ledger?.catalog_readback;
  if (!catalog || !evidencePathIsSafe(catalog.snapshot_artifact)) {
    add(issues, gate, "catalog-snapshot.path");
    return;
  }
  const absolute = path.resolve(context.repositoryRoot, ...catalog.snapshot_artifact.split("/"));
  try {
    if (!lstatSync(absolute).isFile() || containsSymbolicLink(context.repositoryRoot, absolute)) {
      add(issues, gate, "catalog-snapshot.boundary");
      return;
    }
    const realSnapshot = realpathSync(absolute);
    if (!lstatSync(realSnapshot).isFile() || !isInside(realSnapshot, context.boundary.realAllowedRoot) ||
        realSnapshot === context.boundary.realBundle) {
      add(issues, gate, "catalog-snapshot.boundary");
      return;
    }
    validatePrivatePathGitStatus(catalog.snapshot_artifact, context, issues, gate, "catalog-snapshot");
    const snapshot = JSON.parse(readFileSync(realSnapshot, "utf8"));
    if (!exactKeys(snapshot, [
      "schema_version",
      "captured_at",
      "provider",
      "market",
      "currency",
      "readback_source",
      "authentication_evidence_sha256",
      "connected_account_plan_record_sha256",
      "record_hash_scope",
      "records",
    ], issues, gate, "catalog-snapshot.contract")) return;
    exactValue(snapshot.schema_version, 1, issues, gate, "catalog-snapshot.schema-version");
    for (const field of [
      "captured_at",
      "provider",
      "market",
      "currency",
      "readback_source",
      "authentication_evidence_sha256",
      "connected_account_plan_record_sha256",
      "record_hash_scope",
    ]) {
      exactValue(snapshot[field], catalog[field], issues, gate, `catalog-snapshot.${field}`);
    }
    if (JSON.stringify(canonicalJson(snapshot.records)) !== JSON.stringify(canonicalJson(catalog.records))) {
      add(issues, gate, "catalog-snapshot.records-parity");
    }
    exactValue(contractDigest(snapshot), catalog.snapshot_sha256, issues, gate, "catalog-snapshot.sha");
  } catch {
    add(issues, gate, "catalog-snapshot.missing-or-invalid");
  }
}

function validatePrivatePrice(price, productIdentities, evidence, referencedIds, issues, now, context) {
  const gate = "private-price";
  const keys = [
    "catalog_readback_captured_at",
    "ledger_captured_at",
    "shopify_readback_captured_at",
    "status",
    "rule",
    "active_variant_count",
    "ledger_evidence_ref",
    "shopify_readback_evidence_ref",
    "report_evidence_ref",
  ];
  if (!exactKeys(price, keys, issues, gate, "contract")) return;
  requireFreshCapture(price.catalog_readback_captured_at, issues, gate, "catalog-readback-capture", now);
  requireFreshCapture(price.ledger_captured_at, issues, gate, "ledger-capture", now);
  requireFreshCapture(price.shopify_readback_captured_at, issues, gate, "shopify-readback-capture", now);
  exactValue(price.status, "pass", issues, gate, "status");
  exactValue(price.rule, "exact-2.20x-round-half-up", issues, gate, "rule");
  exactValue(price.active_variant_count, 20, issues, gate, "active-variant-count");
  const ledgerRecord = requireEvidenceReference(
    price.ledger_evidence_ref,
    "private-price-ledger",
    evidence,
    referencedIds,
    issues,
    gate,
    "ledger-evidence",
  );
  const reportRecord = requireEvidenceReference(
    price.report_evidence_ref,
    "private-price-report",
    evidence,
    referencedIds,
    issues,
    gate,
    "report-evidence",
  );
  const shopifyReadbackRecord = requireEvidenceReference(
    price.shopify_readback_evidence_ref,
    "private-price-shopify-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "shopify-readback-evidence",
  );
  const ledgerClaim = evidenceClaim(ledgerRecord, "private-price-ledger", issues, gate, "ledger-evidence");
  const readbackClaim = evidenceClaim(
    shopifyReadbackRecord,
    "private-price-shopify-readback",
    issues,
    gate,
    "shopify-readback-evidence",
  );
  const reportClaim = evidenceClaim(reportRecord, "private-price-report", issues, gate, "report-evidence");
  const ledger = ledgerClaim && exactKeys(ledgerClaim, ["ledger"], issues, gate, "ledger-evidence.claim")
    ? ledgerClaim.ledger : null;
  const shopifyReadback = readbackClaim &&
      exactKeys(readbackClaim, ["shopify_readback"], issues, gate, "shopify-readback-evidence.claim")
    ? readbackClaim.shopify_readback : null;
  const report = reportClaim && exactKeys(reportClaim, ["report"], issues, gate, "report-evidence.claim")
    ? reportClaim.report : null;
  if (!ledger || !shopifyReadback || !report) return;
  let result;
  try {
    result = verifyPrivatePriceLedger(ledger, shopifyReadback, {
      now: new Date(now),
      expectedProducts: EXPECTED_PRODUCT_HANDLES.map((handle) => ({ handle, title: handle })),
    });
  } catch {
    add(issues, gate, "ledger.validation");
    return;
  }
  if (!result.ok) add(issues, gate, "ledger.failed");
  validatePrivateCatalogSnapshot(ledger, context, issues);
  for (const [field, expectedSha256] of [
    ["authentication_evidence_sha256", ledger.catalog_readback?.authentication_evidence_sha256],
    ["connected_account_plan_record_sha256", ledger.catalog_readback?.connected_account_plan_record_sha256],
    ["snapshot_sha256", ledger.catalog_readback?.snapshot_sha256],
  ]) {
    requirePrivateArtifactBinding(
      context.artifactIndex,
      {
        scope: "pricing",
        handle: null,
        field,
        role: null,
        public_reference: null,
      },
      expectedSha256,
      context,
      issues,
      gate,
      `artifact.${field}`,
    );
  }
  const expectedReport = redactedPriceVerification(result);
  if (JSON.stringify(report) !== JSON.stringify(expectedReport)) add(issues, gate, "report.parity");
  if (report.status !== "pass" || report.active_variant_count !== 20 ||
      !Array.isArray(report.failures) || report.failures.length !== 0) {
    add(issues, gate, "report.failed");
  }
  if (price.catalog_readback_captured_at !== ledger.catalog_readback?.captured_at ||
      price.catalog_readback_captured_at !== report.catalog_readback_captured_at ||
      price.ledger_captured_at !== ledger.captured_at ||
      price.ledger_captured_at !== report.ledger_captured_at ||
      price.shopify_readback_captured_at !== shopifyReadback.captured_at ||
      price.shopify_readback_captured_at !== report.shopify_readback_captured_at) {
    add(issues, gate, "capture-linkage");
  }
  if (ledgerRecord.validatedDocument.captured_at !== price.ledger_captured_at ||
      shopifyReadbackRecord.validatedDocument.captured_at !== price.shopify_readback_captured_at ||
      reportRecord.validatedDocument.captured_at !== report.shopify_readback_captured_at) {
    add(issues, gate, "evidence-capture-linkage");
  }
  const identityKey = (item) => `${item?.handle}\u0000${item?.product_id}\u0000${item?.variant_id}`;
  const ledgerIdentities = Array.isArray(ledger.variants) ? ledger.variants.map(identityKey) : [];
  if (!sameSet(ledgerIdentities, productIdentities.map(identityKey))) add(issues, gate, "variant-identity-linkage");
  const expectedFormulaByHandle = new Map(productIdentities.map((item) => [item.handle, item.formula_identity_sha256]));
  const expectedSourceByHandle = new Map(productIdentities.map((item) => [item.handle, item.source_catalog_record_sha256]));
  for (const variant of Array.isArray(ledger.variants) ? ledger.variants : []) {
    exactValue(
      variant.formula_identity_sha256,
      expectedFormulaByHandle.get(variant.handle),
      issues,
      gate,
      "formula-identity-linkage",
    );
    exactValue(
      variant.source_catalog_record_sha256,
      expectedSourceByHandle.get(variant.handle),
      issues,
      gate,
      "source-catalog-record-linkage",
    );
  }
}

function validateLaunchPages(launchPages, evidence, referencedIds, issues, now, context) {
  const gate = "launch-pages";
  const sourceContract = context.sourceContracts?.launchPages;
  const keys = [
    "captured_at",
    "status",
    "content_revision",
    "content_contract_sha256",
    "applied_page_handles",
    "readback_pass",
    "provider_write_authority",
    "evidence_ref",
  ];
  if (!exactKeys(launchPages, keys, issues, gate, "contract")) return;
  requireFreshCapture(launchPages.captured_at, issues, gate, "capture", now);
  exactValue(launchPages.status, "pass", issues, gate, "status");
  exactValue(launchPages.content_revision, sourceContract?.revision, issues, gate, "content-revision");
  exactValue(launchPages.content_contract_sha256, contractDigest(sourceContract), issues, gate, "content-contract-sha");
  const sourcePages = Array.isArray(sourceContract?.pages) ? sourceContract.pages : [];
  if (!sameSet(launchPages.applied_page_handles, sourcePages.map((page) => page.handle))) {
    add(issues, gate, "page-identity-set");
  }
  exactBoolean(launchPages.readback_pass, true, issues, gate, "readback");
  exactBoolean(launchPages.provider_write_authority, false, issues, gate, "provider-write-authority");
  const record = requireEvidenceReference(
    launchPages.evidence_ref,
    "launch-pages-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "launch-pages-readback", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "content_revision",
    "content_contract_sha256",
    "pages",
    "provider_write_authority",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, launchPages.captured_at, issues, gate, "evidence.capture-linkage");
  exactValue(claim.content_revision, launchPages.content_revision, issues, gate, "evidence.content-revision");
  exactValue(claim.content_contract_sha256, launchPages.content_contract_sha256, issues, gate, "evidence.content-contract-sha");
  exactBoolean(claim.provider_write_authority, false, issues, gate, "evidence.provider-write-authority");
  if (!Array.isArray(claim.pages) || claim.pages.length !== 3) add(issues, gate, "evidence.pages.exact-count");
  const pageHandles = [];
  const sourceByHandle = new Map(sourcePages.map((page) => [page.handle, page]));
  const expectedRoutes = new Map(sourcePages.map((page) => [page.handle, `/pages/${page.handle}`]));
  for (const page of Array.isArray(claim.pages) ? claim.pages : []) {
    if (!exactKeys(page, [
      "handle",
      "route",
      "title",
      "body_html",
      "seo_title",
      "seo_description",
      "content_sha256",
      "http_status",
      "readback_at",
    ], issues, gate, "evidence.page")) continue;
    pageHandles.push(page.handle);
    exactValue(page.route, expectedRoutes.get(page.handle), issues, gate, "evidence.page-route");
    exactValue(page.http_status, 200, issues, gate, "evidence.page-http-status");
    const sourcePage = sourceByHandle.get(page.handle);
    for (const field of ["title", "body_html", "seo_title", "seo_description"]) {
      exactValue(page[field], sourcePage?.[field], issues, gate, `evidence.page-${field}`);
    }
    exactValue(page.content_sha256, contractDigest(sourcePage), issues, gate, "evidence.page-content-sha");
    requireFreshObservation(
      page.readback_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.page-readback-at",
      now,
    );
  }
  if (!sameSet(pageHandles, [...expectedRoutes.keys()])) add(issues, gate, "evidence.page-identity-set");
}

function validateProviderSurfaces(section, candidate, evidence, referencedIds, issues, now, context) {
  const gate = "provider-surfaces";
  const sourceContract = context.sourceContracts?.providerSurfaces;
  const keys = [
    "captured_at",
    "status",
    "schema_version",
    "revision",
    "source_contract_sha256",
    "readback_sha256",
    "readback_pass",
    "evidence_ref",
  ];
  if (!exactKeys(section, keys, issues, gate, "contract")) return;
  requireFreshCapture(section.captured_at, issues, gate, "capture", now);
  exactValue(section.status, "pass", issues, gate, "status");
  if (!sourceContract || typeof sourceContract !== "object" || Array.isArray(sourceContract)) {
    add(issues, gate, "source.missing-or-invalid");
    return;
  }
  exactValue(section.schema_version, sourceContract.schema_version, issues, gate, "source.schema-version");
  exactValue(section.revision, sourceContract?.revision, issues, gate, "source.revision");
  exactValue(
    section.source_contract_sha256,
    providerSurfaceContractSha256(sourceContract),
    issues,
    gate,
    "source.sha256",
  );
  if (!validSha256(section.readback_sha256)) add(issues, gate, "readback.sha256");
  exactBoolean(section.readback_pass, true, issues, gate, "readback-pass");
  for (const issue of validateProviderSurfacesContract(sourceContract).issues) {
    add(issues, gate, `source.${issue.surface}.${issue.category}`);
  }
  const sourceProducts = context.sourceContracts?.productFacts?.products;
  if (!Array.isArray(sourceProducts) || sourceProducts.length !== EXPECTED_PRODUCT_HANDLES.length) {
    add(issues, gate, "source.product-facts-set");
  } else {
    const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right));
    for (const collection of sourceContract.collections?.items ?? []) {
      if (collection.membership_approval_status !== "approved") continue;
      const expectedHandles = collection.handle === "mochirii-cosmetics"
        ? sourceProducts.map((product) => product.handle)
        : sourceProducts
          .filter((product) => product.facts?.collection_handles?.includes(collection.handle))
          .map((product) => product.handle);
      if (JSON.stringify(sorted(collection.approved_product_handles ?? [])) !==
          JSON.stringify(sorted(expectedHandles))) {
        add(issues, gate, "source.collection-membership-product-facts-parity");
      }
    }
    if (sourceContract.homepage?.expected?.featured_products_approval_status === "approved") {
      const completeHandles = new Set(sourceProducts
        .filter((product) => product.review_status === "complete")
        .map((product) => product.handle));
      if (sourceContract.homepage.expected.approved_featured_product_handles
        .some((handle) => !completeHandles.has(handle))) {
        add(issues, gate, "source.featured-product-review-status");
      }
    }
  }
  const record = requireEvidenceReference(
    section.evidence_ref,
    "provider-surface-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "provider-surface-readback", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "source_contract_schema_version",
    "source_contract_revision",
    "source_contract_sha256",
    "readback_sha256",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, section.captured_at, issues, gate, "evidence.capture-linkage");
  exactValue(claim.source_contract_schema_version, section.schema_version, issues, gate, "evidence.source-schema");
  exactValue(claim.source_contract_revision, section.revision, issues, gate, "evidence.source-revision");
  exactValue(claim.source_contract_sha256, section.source_contract_sha256, issues, gate, "evidence.source-sha256");
  exactValue(claim.readback_sha256, section.readback_sha256, issues, gate, "evidence.readback-sha256");
  const artifact = requirePrivateArtifactBinding(
    context.artifactIndex,
    {
      scope: "provider-surface",
      handle: null,
      field: "readback_sha256",
      role: null,
      public_reference: null,
    },
    section.readback_sha256,
    context,
    issues,
    gate,
    "artifact",
  );
  const privateReadback = readPrivateJsonArtifact(artifact, context, issues, gate, "artifact");
  if (!privateReadback) return;
  exactValue(privateReadback.captured_at, section.captured_at, issues, gate, "readback.capture-linkage");
  const result = validateProviderSurfaceReadback(sourceContract, privateReadback, {
    now: new Date(now),
    expectedCandidateThemeId: candidate?.theme_id,
    expectedPackageSha256: candidate?.package_sha256,
    mandatoryNameExceptions: context.sourceContracts?.mandatoryNames,
  });
  for (const issue of result.issues) add(issues, gate, `readback.${issue.surface}.${issue.category}`);
  const renderedTargets = [...evidence.values()]
    .find((item) => item.kind === "rendered-route-readback")?.validatedDocument?.claim?.targets;
  const renderedByIdentity = new Map((Array.isArray(renderedTargets) ? renderedTargets : [])
    .map((target) => [`${target.category}\u0000${target.identity}`, target]));
  for (const policy of privateReadback.policies?.items ?? []) {
    exactValue(
      policy.content_sha256,
      renderedByIdentity.get(`policies-and-privacy\u0000${policy.identity}`)?.content_sha256,
      issues,
      gate,
      "readback.policy-rendered-content-linkage",
    );
  }
  for (const notification of privateReadback.notifications?.items ?? []) {
    exactValue(
      notification.body_sha256,
      renderedByIdentity.get(`notifications\u0000${notification.identity}`)?.content_sha256,
      issues,
      gate,
      "readback.notification-rendered-content-linkage",
    );
  }
}

function reviewedRenderedBodyExceptionCount(contract, category, route, body, company, latestTimestamp) {
  const review = contract?.rendered_review;
  const reviewTimestamp = reviewDateMilliseconds(review?.review_date);
  if (contract?.status !== "reviewed" || review?.status !== "reviewed" ||
      !Array.isArray(review.reviewed_route_categories) || !review.reviewed_route_categories.includes(category) ||
      !Number.isFinite(reviewTimestamp) || reviewTimestamp > latestTimestamp || !Array.isArray(contract.entries)) {
    return 0;
  }
  const normalizedBody = normalizeCustomerLanguageForPolicy(body, { joinInternalSeparators: true });
  const normalizedCompany = normalizeCustomerLanguageForPolicy(company, { joinInternalSeparators: true });
  return contract.entries.filter((entry) => {
    const entryTimestamp = reviewDateMilliseconds(entry?.review_date);
    const normalizedWording = normalizeCustomerLanguageForPolicy(
      entry?.exact_approved_wording,
      { joinInternalSeparators: true },
    );
    const normalizedName = normalizeCustomerLanguageForPolicy(entry?.exact_name, { joinInternalSeparators: true });
    const canonicalCompany = exactCustomerLanguageCompanyName(company);
    const exactNameValid = entry?.exact_name === company && (
      canonicalCompany === null
        ? exactCustomerLanguageCompanyName(entry.exact_name) === null
        : exactCustomerLanguageCompanyName(entry.exact_name) === canonicalCompany
    );
    return entry?.surface === `rendered-body:${category}` && entry?.route === route && exactNameValid &&
      typeof entry.reviewer === "string" && entry.reviewer.trim().length > 0 &&
      Number.isFinite(entryTimestamp) && entryTimestamp <= reviewTimestamp && entryTimestamp <= latestTimestamp &&
      typeof entry.legal_or_contractual_reason === "string" &&
      /\b(?:legal|law|required|regulation|contract|contractual|agreement|carrier|certification|privacy|label)\b/iu
        .test(entry.legal_or_contractual_reason) &&
      normalizedWording.length > 0 && normalizedBody.includes(normalizedWording) &&
      normalizedName.length > 0 && normalizedCompany.length > 0 &&
      ` ${normalizedWording} `.includes(` ${normalizedName} `) &&
      ` ${normalizedBody} `.includes(` ${normalizedCompany} `);
  }).length;
}

function potentialThirdPartyNames(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.match(/\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*)+\b/gu) ?? [])]
    .filter((name) => name !== PREPAYMENT_GATE_POLICY.wordmark &&
      /\b(?:LLC|Inc[.]?|Labs?|Laboratories|Corp[.]?|Corporation|Foundation|Association)$/u.test(name));
}

function validateMandatoryNameReview(review, evidence, referencedIds, issues, now, context) {
  const gate = "mandatory-name-review";
  const sourceContract = context.sourceContracts?.mandatoryNames;
  const keys = [
    "captured_at",
    "status",
    "reviewed_route_categories",
    "exception_register_revision",
    "exception_register_sha256",
    "exception_register_reviewed",
    "rendered_review_pass",
    "unreviewed_name_count",
    "evidence_ref",
  ];
  if (!exactKeys(review, keys, issues, gate, "contract")) return;
  requireFreshCapture(review.captured_at, issues, gate, "capture", now);
  exactValue(review.status, "pass", issues, gate, "status");
  if (!sameSet(review.reviewed_route_categories, REQUIRED_RENDERED_ROUTE_CATEGORIES)) {
    add(issues, gate, "route-category-set");
  }
  exactValue(review.exception_register_revision, sourceContract?.revision, issues, gate, "exception-register-revision");
  exactValue(review.exception_register_sha256, contractDigest(sourceContract), issues, gate, "exception-register-sha");
  exactValue(sourceContract?.status, "reviewed", issues, gate, "source.exception-register-status");
  exactValue(sourceContract?.rendered_review?.status, "reviewed", issues, gate, "source.rendered-review-status");
  accountableIdentifier(
    sourceContract?.rendered_review?.reviewer,
    issues,
    gate,
    "source.rendered-reviewer",
  );
  if (!sameSet(
    sourceContract?.rendered_review?.reviewed_route_categories,
    REQUIRED_RENDERED_ROUTE_CATEGORIES,
  )) add(issues, gate, "source.rendered-review-category-set");
  const sourceReviewDate = reviewDateMilliseconds(sourceContract?.rendered_review?.review_date);
  if (!Number.isFinite(sourceReviewDate) || sourceReviewDate > captureMilliseconds(review.captured_at)) {
    add(issues, gate, "source.rendered-review-date");
  }
  exactBoolean(review.exception_register_reviewed, true, issues, gate, "exception-register");
  exactBoolean(review.rendered_review_pass, true, issues, gate, "rendered-review");
  exactValue(review.unreviewed_name_count, 0, issues, gate, "unreviewed-name-count");
  const record = requireEvidenceReference(
    review.evidence_ref,
    "mandatory-name-review",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "mandatory-name-review", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "route_reviews",
    "exception_register_revision",
    "exception_register_sha256",
    "exceptions",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, review.captured_at, issues, gate, "evidence.capture-linkage");
  exactValue(claim.exception_register_revision, review.exception_register_revision, issues, gate, "evidence.exception-register-revision");
  exactValue(claim.exception_register_sha256, review.exception_register_sha256, issues, gate, "evidence.exception-register-sha");
  if (!Array.isArray(claim.route_reviews) ||
      claim.route_reviews.length !== REQUIRED_RENDERED_ROUTE_CATEGORIES.length) {
    add(issues, gate, "evidence.route-reviews.exact-count");
  }
  const categories = [];
  let unreviewedCount = 0;
  const renderedRouteRecord = [...evidence.values()].find((item) => item.kind === "rendered-route-readback");
  const renderedTargets = renderedRouteRecord?.validatedDocument?.claim?.targets;
  for (const routeReview of Array.isArray(claim.route_reviews) ? claim.route_reviews : []) {
    if (!exactKeys(routeReview, [
      "category",
      "target_count",
      "unreviewed_name_count",
      "scan_sha256",
      "reviewed_at",
    ], issues, gate, "evidence.route-review")) continue;
    categories.push(routeReview.category);
    exactValue(routeReview.target_count, ROUTE_COUNT_REQUIREMENTS.get(routeReview.category), issues, gate, "evidence.route-target-count");
    if (!Number.isSafeInteger(routeReview.unreviewed_name_count) || routeReview.unreviewed_name_count < 0) {
      add(issues, gate, "evidence.route-unreviewed-count");
    }
    if (!validSha256(routeReview.scan_sha256)) add(issues, gate, "evidence.route-scan-sha");
    const reviewedAt = requireOrderedTimestamp(
      routeReview.reviewed_at,
      Number.NaN,
      captureMilliseconds(record.validatedDocument.reviewer.reviewed_at),
      issues,
      gate,
      "evidence.route-reviewed-at",
    );
    const scanArtifact = requirePrivateArtifactBinding(
      context.artifactIndex,
      {
        scope: "mandatory-name",
        handle: routeReview.category,
        field: "scan_sha256",
        role: null,
        public_reference: null,
      },
      routeReview.scan_sha256,
      context,
      issues,
      gate,
      "evidence.route-scan-artifact",
    );
    const scan = readPrivateJsonArtifact(
      scanArtifact,
      context,
      issues,
      gate,
      "evidence.route-scan-artifact",
    );
    if (!scan || !exactKeys(scan, [
      "schema_version",
      "record_type",
      "category",
      "captured_at",
      "reviewer_id",
      "targets",
      "unreviewed_name_count",
    ], issues, gate, "evidence.route-scan-record")) continue;
    exactValue(scan.schema_version, 1, issues, gate, "evidence.route-scan-schema");
    exactValue(scan.record_type, "mochirii-private-rendered-body-scan", issues, gate, "evidence.route-scan-type");
    exactValue(scan.category, routeReview.category, issues, gate, "evidence.route-scan-category");
    exactValue(scan.captured_at, routeReview.reviewed_at, issues, gate, "evidence.route-scan-capture");
    exactValue(
      scan.reviewer_id,
      record.validatedDocument.reviewer.reviewer_id,
      issues,
      gate,
      "evidence.route-scan-reviewer",
    );
    const expectedTargets = Array.isArray(renderedTargets)
      ? renderedTargets.filter((target) => target.category === routeReview.category)
      : [];
    if (!Array.isArray(scan.targets) || scan.targets.length !== expectedTargets.length) {
      add(issues, gate, "evidence.route-scan-targets.exact-count");
    }
    let computedUnreviewed = 0;
    for (const [index, expectedTarget] of expectedTargets.entries()) {
      const target = scan.targets?.[index];
      if (!exactKeys(target, [
        "order",
        "identity",
        "target",
        "content_sha256",
        "normalized_body",
        "detected_third_party_names",
      ], issues, gate, "evidence.route-scan-target")) continue;
      exactValue(target.order, index + 1, issues, gate, "evidence.route-scan-order");
      exactValue(target.identity, expectedTarget.identity, issues, gate, "evidence.route-scan-identity");
      exactValue(target.target, expectedTarget.target, issues, gate, "evidence.route-scan-target-location");
      exactValue(
        target.content_sha256,
        expectedTarget.content_sha256,
        issues,
        gate,
        "evidence.route-scan-content-linkage",
      );
      if (typeof target.normalized_body !== "string" || target.normalized_body.trim() !== target.normalized_body ||
          target.normalized_body.length === 0 || digest(Buffer.from(target.normalized_body, "utf8")) !== target.content_sha256) {
        add(issues, gate, "evidence.route-scan-body-hash");
        continue;
      }
      const languageCategories = customerLanguageIssueCategories(target.normalized_body);
      for (const languageCategory of languageCategories.filter((item) => item !== "third-party-name")) {
        add(issues, gate, `evidence.route-body.${languageCategory}`);
        computedUnreviewed += 1;
      }
      const detectedNames = target.detected_third_party_names;
      if (!Array.isArray(detectedNames) || new Set(detectedNames).size !== detectedNames.length ||
          detectedNames.some((name) => typeof name !== "string" || name.trim() !== name ||
            name.length === 0 || !/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}&.' -]*$/u.test(name))) {
        add(issues, gate, "evidence.route-scan-third-party-attestation");
        computedUnreviewed += 1;
      }
      const knownNames = customerLanguageCompanyMatches(target.normalized_body);
      const heuristicNames = potentialThirdPartyNames(target.normalized_body);
      const requiredDetectedNames = [...new Set([...knownNames, ...heuristicNames])];
      for (const name of requiredDetectedNames) {
        if (!detectedNames?.includes(name)) {
          add(issues, gate, "evidence.route-scan-third-party-omission");
          add(issues, gate, "evidence.route-body.third-party-name");
          computedUnreviewed += 1;
        }
      }
      const registeredNames = (sourceContract?.entries ?? [])
        .filter((entry) => entry?.surface === `rendered-body:${routeReview.category}` && entry?.route === target.target)
        .map((entry) => entry.exact_name);
      if (!sameSet(detectedNames ?? [], registeredNames)) {
        if ((detectedNames?.length ?? 0) > 0 || registeredNames.length > 0) {
          add(issues, gate, "evidence.route-scan-exception-name-set");
          computedUnreviewed += 1;
        }
      }
      for (const company of detectedNames ?? []) {
        const exceptionCount = reviewedRenderedBodyExceptionCount(
          sourceContract,
          routeReview.category,
          target.target,
          target.normalized_body,
          company,
          Math.min(reviewedAt, now),
        );
        if (exceptionCount !== 1) {
          add(issues, gate, "evidence.route-body.third-party-name");
          computedUnreviewed += 1;
        }
      }
    }
    exactValue(
      scan.unreviewed_name_count,
      computedUnreviewed,
      issues,
      gate,
      "evidence.route-scan-unreviewed-count",
    );
    exactValue(
      routeReview.unreviewed_name_count,
      computedUnreviewed,
      issues,
      gate,
      "evidence.route-unreviewed-count-linkage",
    );
    unreviewedCount += computedUnreviewed;
  }
  if (!sameSet(categories, REQUIRED_RENDERED_ROUTE_CATEGORIES)) add(issues, gate, "evidence.route-category-set");
  exactValue(unreviewedCount, review.unreviewed_name_count, issues, gate, "evidence.unreviewed-name-count");
  if (!Array.isArray(claim.exceptions)) add(issues, gate, "evidence.exceptions.type");
  if (JSON.stringify(canonicalJson(claim.exceptions)) !== JSON.stringify(canonicalJson(sourceContract?.entries))) {
    add(issues, gate, "evidence.exception-register-parity");
  }
}

function validateRateTierSchedule(value, issues, gate, category) {
  const tiers = [];
  const tierIds = [];
  for (const tier of Array.isArray(value) ? value : []) {
    if (!exactKeys(tier, [
      "tier_id",
      "minimum_weight_grams",
      "maximum_weight_grams",
      "rate_usd",
      "source_record_sha256",
    ], issues, gate, `${category}-tier`)) continue;
    tierIds.push(tier.tier_id);
    const validMinimum = Number.isSafeInteger(tier.minimum_weight_grams) && tier.minimum_weight_grams >= 0;
    const validMaximum = tier.maximum_weight_grams === null ||
      (Number.isSafeInteger(tier.maximum_weight_grams) && tier.maximum_weight_grams > tier.minimum_weight_grams);
    if (!SLUG_PATTERN.test(tier.tier_id ?? "") || !validMinimum || !validMaximum ||
        !positiveUsdAmount(tier.rate_usd) || !validSha256(tier.source_record_sha256)) {
      add(issues, gate, `${category}-tier-contract`);
    }
    tiers.push(tier);
  }
  if (!Array.isArray(value) || tiers.length === 0 || tiers.length !== value.length) {
    add(issues, gate, `${category}-tier-set`);
  }
  if (new Set(tierIds).size !== tierIds.length) add(issues, gate, `${category}-tier-identity`);
  if (tiers[0]?.minimum_weight_grams !== 0) add(issues, gate, `${category}-first-zero`);
  if (tiers.at(-1)?.maximum_weight_grams !== null) add(issues, gate, `${category}-last-open-ended`);
  for (let index = 0; index < tiers.length - 1; index += 1) {
    const currentMaximum = tiers[index].maximum_weight_grams;
    const nextMinimum = tiers[index + 1].minimum_weight_grams;
    if (currentMaximum === null) {
      add(issues, gate, `${category}-open-ended-position`);
      continue;
    }
    if (Number.isSafeInteger(currentMaximum) && Number.isSafeInteger(nextMinimum)) {
      if (currentMaximum < nextMinimum) add(issues, gate, `${category}-schedule-gap`);
      if (currentMaximum > nextMinimum) add(issues, gate, `${category}-schedule-overlap`);
    }
  }
  return tiers;
}

function readShippingMatrixArtifact(matrix, context, envelopeCapture, issues, now) {
  const gate = "fulfillment-shipping";
  const empty = { eligibility: new Map(), recordHashes: new Map(), rateTiers: [] };
  if (!evidencePathIsSafe(matrix?.artifact_path)) {
    add(issues, gate, "evidence.supplier-matrix-path");
    return empty;
  }
  try {
    const absolute = path.resolve(context.repositoryRoot, ...matrix.artifact_path.split("/"));
    if (!lstatSync(absolute).isFile() || containsSymbolicLink(context.repositoryRoot, absolute)) {
      add(issues, gate, "evidence.supplier-matrix-boundary");
      return empty;
    }
    const realArtifact = realpathSync(absolute);
    if (!lstatSync(realArtifact).isFile() || !isInside(realArtifact, context.boundary.realAllowedRoot) ||
        realArtifact === context.boundary.realBundle) {
      add(issues, gate, "evidence.supplier-matrix-boundary");
      return { eligibility: new Map(), recordHashes: new Map() };
    }
    validatePrivatePathGitStatus(
      matrix.artifact_path,
      context,
      issues,
      gate,
      "evidence.supplier-matrix-artifact",
    );
    const artifact = JSON.parse(readFileSync(realArtifact, "utf8"));
    if (!exactKeys(artifact, [
      "schema_version",
      "captured_at",
      "authenticated_source",
      "market",
      "policy_scope",
      "rate_calculation",
      "free_shipping_threshold_usd",
      "po_box_carrier_response_sha256",
      "rate_tiers",
      "cases",
    ], issues, gate, "evidence.supplier-matrix-artifact")) {
      return empty;
    }
    exactValue(artifact.schema_version, 1, issues, gate, "evidence.supplier-matrix-artifact-schema");
    for (const field of [
      "captured_at",
      "authenticated_source",
      "market",
      "policy_scope",
      "rate_calculation",
      "free_shipping_threshold_usd",
      "po_box_carrier_response_sha256",
    ]) {
      exactValue(artifact[field], matrix[field], issues, gate, `evidence.supplier-matrix-artifact-${field}`);
    }
    exactValue(contractDigest(artifact), matrix.artifact_sha256, issues, gate, "evidence.supplier-matrix-artifact-sha");
    requireFreshObservation(artifact.captured_at, envelopeCapture, issues, gate, "evidence.supplier-matrix-artifact-time", now);
    const eligibility = new Map();
    const recordHashes = new Map();
    for (const item of Array.isArray(artifact.cases) ? artifact.cases : []) {
      if (!exactKeys(item, [
        "case_id",
        "destination_country",
        "destination_region",
        "destination_postal_code",
        "address_type",
        "cart_lines",
        "cart_weight_grams",
        "eligible",
        "supplier_rate_usd",
        "source_record_sha256",
      ], issues, gate, "evidence.supplier-matrix-case")) continue;
      const validDestination = item.destination_country === "US" &&
        US_REGION_PATTERN.test(item.destination_region ?? "") &&
        US_POSTAL_CODE_PATTERN.test(item.destination_postal_code ?? "") &&
        ["street", "po-box", "military"].includes(item.address_type);
      const validWeight = Number.isSafeInteger(item.cart_weight_grams) && item.cart_weight_grams > 0;
      const validRate = item.eligible === true
        ? positiveUsdAmount(item.supplier_rate_usd)
        : item.supplier_rate_usd === null;
      if (eligibility.has(item.case_id) || typeof item.eligible !== "boolean" || !validDestination ||
          !validWeight || !validRate || !validSha256(item.source_record_sha256)) {
        add(issues, gate, "evidence.supplier-matrix-case-contract");
        continue;
      }
      eligibility.set(item.case_id, item);
      recordHashes.set(item.case_id, item.source_record_sha256);
    }
    const rateTiers = validateRateTierSchedule(
      artifact.rate_tiers,
      issues,
      gate,
      "evidence.supplier-matrix-rate-table",
    );
    return { eligibility, recordHashes, rateTiers };
  } catch {
    add(issues, gate, "evidence.supplier-matrix-missing-or-invalid");
    return empty;
  }
}

function readShopifyRateTableArtifact(rateTable, context, envelopeCapture, issues, now) {
  const gate = "fulfillment-shipping";
  const empty = { tiers: [], artifactSha256: null };
  if (!evidencePathIsSafe(rateTable?.artifact_path)) {
    add(issues, gate, "evidence.shopify-rate-table-path");
    return empty;
  }
  try {
    const absolute = path.resolve(context.repositoryRoot, ...rateTable.artifact_path.split("/"));
    if (!lstatSync(absolute).isFile() || containsSymbolicLink(context.repositoryRoot, absolute)) {
      add(issues, gate, "evidence.shopify-rate-table-boundary");
      return empty;
    }
    const realArtifact = realpathSync(absolute);
    if (!lstatSync(realArtifact).isFile() || !isInside(realArtifact, context.boundary.realAllowedRoot) ||
        realArtifact === context.boundary.realBundle) {
      add(issues, gate, "evidence.shopify-rate-table-boundary");
      return empty;
    }
    validatePrivatePathGitStatus(
      rateTable.artifact_path,
      context,
      issues,
      gate,
      "evidence.shopify-rate-table-path",
    );
    const artifact = JSON.parse(readFileSync(realArtifact, "utf8"));
    if (!exactKeys(artifact, [
      "schema_version",
      "captured_at",
      "authenticated_source",
      "admin_api_version",
      "market",
      "currency",
      "rate_calculation",
      "tiers",
    ], issues, gate, "evidence.shopify-rate-table-artifact")) return empty;
    exactValue(artifact.schema_version, 1, issues, gate, "evidence.shopify-rate-table-artifact-schema");
    for (const field of [
      "captured_at",
      "authenticated_source",
      "admin_api_version",
      "market",
      "currency",
      "rate_calculation",
    ]) {
      exactValue(artifact[field], rateTable[field], issues, gate, `evidence.shopify-rate-table-artifact-${field}`);
    }
    const artifactSha256 = contractDigest(artifact);
    exactValue(artifactSha256, rateTable.artifact_sha256, issues, gate, "evidence.shopify-rate-table-artifact-sha");
    requireFreshObservation(
      artifact.captured_at,
      envelopeCapture,
      issues,
      gate,
      "evidence.shopify-rate-table-artifact-time",
      now,
    );

    const tiers = validateRateTierSchedule(
      artifact.tiers,
      issues,
      gate,
      "evidence.shopify-rate-table",
    );
    return { tiers, artifactSha256 };
  } catch {
    add(issues, gate, "evidence.shopify-rate-table-missing-or-invalid");
    return empty;
  }
}

function rateTierForWeight(tiers, weight) {
  return tiers.find((tier) => Number.isSafeInteger(tier.minimum_weight_grams) &&
    weight >= tier.minimum_weight_grams &&
    (tier.maximum_weight_grams === null || weight < tier.maximum_weight_grams));
}

function recomputeCartWeight(cartLines, variantWeights, issues, gate, category) {
  if (!Array.isArray(cartLines) || cartLines.length === 0) {
    add(issues, gate, `${category}.count`);
    return null;
  }
  const variantIds = [];
  let total = 0;
  let valid = true;
  for (const line of cartLines) {
    if (!exactKeys(line, ["variant_record_id", "quantity"], issues, gate, `${category}.line`)) {
      valid = false;
      continue;
    }
    variantIds.push(line.variant_record_id);
    const weight = variantWeights.get(line.variant_record_id);
    if (!GID_VARIANT_PATTERN.test(line.variant_record_id ?? "") || !Number.isSafeInteger(weight) || weight <= 0) {
      add(issues, gate, `${category}.variant`);
      valid = false;
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      add(issues, gate, `${category}.quantity`);
      valid = false;
    }
    if (Number.isSafeInteger(weight) && weight > 0 && Number.isSafeInteger(line.quantity) && line.quantity > 0) {
      const lineWeight = weight * line.quantity;
      if (!Number.isSafeInteger(lineWeight) || !Number.isSafeInteger(total + lineWeight)) {
        add(issues, gate, `${category}.overflow`);
        valid = false;
      } else {
        total += lineWeight;
      }
    }
  }
  if (new Set(variantIds).size !== variantIds.length) {
    add(issues, gate, `${category}.duplicate-variant`);
    valid = false;
  }
  return valid && total > 0 ? total : null;
}

function validatePrivateShippingMappingRecord(
  mapping,
  product,
  linkedIdentity,
  authenticationEvidenceSha256,
  envelopeCapture,
  issues,
  now,
) {
  const gate = "fulfillment-shipping";
  const category = "evidence.private-supplier-mapping";
  if (!exactKeys(mapping, PRIVATE_SHIPPING_MAPPING_RECORD_KEYS, issues, gate, category)) return;
  exactValue(mapping.schema_version, 1, issues, gate, `${category}.schema-version`);
  exactValue(
    mapping.record_type,
    "mochirii-private-supplier-product-mapping",
    issues,
    gate,
    `${category}.record-type`,
  );
  requireFreshObservation(
    mapping.captured_at,
    envelopeCapture,
    issues,
    gate,
    `${category}.captured-at`,
    now,
  );
  exactValue(
    mapping.authenticated_source,
    "authenticated-manufacturing-partner-product-mapping",
    issues,
    gate,
    `${category}.authenticated-source`,
  );
  exactValue(
    mapping.authentication_evidence_sha256,
    authenticationEvidenceSha256,
    issues,
    gate,
    `${category}.authentication_evidence_sha256`,
  );
  if (!validSha256(mapping.authentication_evidence_sha256)) {
    add(issues, gate, `${category}.authentication_evidence_sha256-format`);
  }
  exactValue(mapping.market, "US", issues, gate, `${category}.market`);
  exactValue(mapping.status, "confirmed", issues, gate, `${category}.status`);
  for (const [field, expected] of [
    ["handle", product.handle],
    ["product_record_id", product.product_record_id],
    ["variant_record_id", product.variant_record_id],
    ["formula_identity_sha256", linkedIdentity?.formula_identity_sha256],
    ["source_catalog_record_sha256", linkedIdentity?.source_catalog_record_sha256],
    ["supplier_expected_weight_grams", product.supplier_expected_weight_grams],
  ]) {
    exactValue(mapping[field], expected, issues, gate, `${category}.${field}`);
  }
  for (const field of ["formula_identity_sha256", "source_catalog_record_sha256"]) {
    if (!validSha256(mapping[field])) add(issues, gate, `${category}.${field}-format`);
  }
  if (!Number.isSafeInteger(mapping.supplier_expected_weight_grams) ||
      mapping.supplier_expected_weight_grams <= 0) {
    add(issues, gate, `${category}.supplier-expected-weight-positive`);
  }
}

function validateFulfillmentShipping(section, productIdentities, evidence, referencedIds, issues, now, context) {
  const gate = "fulfillment-shipping";
  const keys = [
    "captured_at",
    "status",
    "exact_20_mappings",
    "stock_sync_enabled",
    "shopify_inventory_tracking_disabled",
    "intended_location_only",
    "contiguous_us_only",
    "shipping_rates_verified",
    "unsupported_regions_verified",
    "po_box_behavior_verified",
    "policy_parity_verified",
    "evidence_ref",
  ];
  if (!exactKeys(section, keys, issues, gate, "contract")) return;
  requireFreshCapture(section.captured_at, issues, gate, "capture", now);
  exactValue(section.status, "pass", issues, gate, "status");
  for (const field of keys.slice(2, -1)) exactBoolean(section[field], true, issues, gate, field);
  const record = requireEvidenceReference(
    section.evidence_ref,
    "fulfillment-shipping-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "fulfillment-shipping-readback", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "products",
    "supplier_weight_readback_source",
    "shopify_weight_readback_source",
    "shopify_admin_api_version",
    "shipping_cases",
    "tier_threshold_observations",
    "policy_sha256",
    "supplier_matrix",
    "shopify_rate_table",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, section.captured_at, issues, gate, "evidence.capture-linkage");
  exactValue(
    claim.supplier_weight_readback_source,
    "authenticated-manufacturing-partner-product-mapping",
    issues,
    gate,
    "evidence.supplier-weight-source",
  );
  exactValue(
    claim.shopify_weight_readback_source,
    "authenticated-shopify-admin-product-variants",
    issues,
    gate,
    "evidence.shopify-weight-source",
  );
  exactValue(claim.shopify_admin_api_version, SHOPIFY_ADMIN_API_VERSION, issues, gate, "evidence.shopify-weight-api-version");
  if (!validSha256(claim.policy_sha256)) add(issues, gate, "evidence.policy-sha");
  if (!Array.isArray(claim.products) || claim.products.length !== EXPECTED_PRODUCT_HANDLES.length) {
    add(issues, gate, "evidence.products.exact-count");
  }
  const handles = [];
  const variantIds = [];
  const variantWeights = new Map();
  const envelopeCapture = captureMilliseconds(record.validatedDocument.captured_at);
  const authenticationArtifact = context.artifactIndex?.resolveBinding({
    scope: "pricing",
    handle: null,
    field: "authentication_evidence_sha256",
    role: null,
    public_reference: null,
  });
  for (const product of Array.isArray(claim.products) ? claim.products : []) {
    if (!exactKeys(product, [
      "handle",
      "product_record_id",
      "variant_record_id",
      "mapping_record_sha256",
      "supplier_expected_weight_grams",
      "shopify_actual_weight_grams",
      "stock_sync_status",
      "inventory_tracking",
      "location_assignment_status",
    ], issues, gate, "evidence.product")) continue;
    handles.push(product.handle);
    variantIds.push(`${product.handle}\u0000${product.product_record_id}\u0000${product.variant_record_id}`);
    if (!GID_PRODUCT_PATTERN.test(product.product_record_id ?? "")) add(issues, gate, "evidence.product-record-id");
    if (!GID_VARIANT_PATTERN.test(product.variant_record_id ?? "")) add(issues, gate, "evidence.variant-record-id");
    if (!validSha256(product.mapping_record_sha256)) add(issues, gate, "evidence.mapping-record-sha");
    const mappingArtifact = requirePrivateArtifactBinding(
      context.artifactIndex,
      {
        scope: "product",
        handle: product.handle,
        field: "shipping_mapping_record_sha256",
        role: null,
        public_reference: null,
      },
      product.mapping_record_sha256,
      context,
      issues,
      gate,
      "evidence.mapping-record-artifact",
    );
    const mappingRecord = readPrivateJsonArtifact(
      mappingArtifact,
      context,
      issues,
      gate,
      "evidence.mapping-record-artifact-json",
    );
    if (mappingRecord) {
      validatePrivateShippingMappingRecord(
        mappingRecord,
        product,
        productIdentities.find((item) => item.handle === product.handle),
        authenticationArtifact?.sha256,
        envelopeCapture,
        issues,
        now,
      );
    }
    const validSupplierWeight = Number.isSafeInteger(product.supplier_expected_weight_grams) &&
      product.supplier_expected_weight_grams > 0;
    const validShopifyWeight = Number.isSafeInteger(product.shopify_actual_weight_grams) &&
      product.shopify_actual_weight_grams > 0;
    if (!validSupplierWeight) add(issues, gate, "evidence.supplier-expected-weight");
    if (!validShopifyWeight) add(issues, gate, "evidence.shopify-actual-weight");
    exactValue(
      product.shopify_actual_weight_grams,
      product.supplier_expected_weight_grams,
      issues,
      gate,
      "evidence.variant-weight-parity",
    );
    if (validShopifyWeight && GID_VARIANT_PATTERN.test(product.variant_record_id ?? "")) {
      variantWeights.set(product.variant_record_id, product.shopify_actual_weight_grams);
    }
    exactValue(product.stock_sync_status, "enabled", issues, gate, "evidence.stock-sync-status");
    exactValue(product.inventory_tracking, "disabled", issues, gate, "evidence.inventory-tracking");
    exactValue(product.location_assignment_status, "intended-route-only", issues, gate, "evidence.location-assignment");
  }
  if (!sameSet(handles, EXPECTED_PRODUCT_HANDLES)) add(issues, gate, "evidence.product-identity-set");
  const expectedIdentityKeys = productIdentities.map((item) => `${item.handle}\u0000${item.product_id}\u0000${item.variant_id}`);
  if (!sameSet(variantIds, expectedIdentityKeys)) add(issues, gate, "evidence.variant-identity-set");
  const matrix = claim.supplier_matrix;
  if (!exactKeys(matrix, [
    "authenticated_source",
    "captured_at",
    "market",
    "policy_scope",
    "rate_calculation",
    "free_shipping_threshold_usd",
    "artifact_path",
    "artifact_sha256",
    "po_box_eligible",
    "po_box_carrier_response_sha256",
  ], issues, gate, "evidence.supplier-matrix")) return;
  exactValue(
    matrix.authenticated_source,
    "authenticated-manufacturing-partner-us-shipping-matrix",
    issues,
    gate,
    "evidence.supplier-matrix-source",
  );
  exactValue(matrix.market, "US", issues, gate, "evidence.supplier-matrix-market");
  exactValue(matrix.policy_scope, "contiguous-us-only", issues, gate, "evidence.supplier-matrix-policy");
  exactValue(
    matrix.rate_calculation,
    "weight-based-supplier-cost-pass-through",
    issues,
    gate,
    "evidence.supplier-matrix-rate-calculation",
  );
  exactValue(matrix.free_shipping_threshold_usd, null, issues, gate, "evidence.supplier-matrix-free-shipping");
  if (!validSha256(matrix.artifact_sha256)) add(issues, gate, "evidence.supplier-matrix-sha");
  if (typeof matrix.po_box_eligible !== "boolean") add(issues, gate, "evidence.supplier-matrix-po-box");
  if (!validSha256(matrix.po_box_carrier_response_sha256)) {
    add(issues, gate, "evidence.supplier-matrix-po-box-carrier-sha");
  }
  requireFreshObservation(
    matrix.captured_at,
    captureMilliseconds(record.validatedDocument.captured_at),
    issues,
    gate,
    "evidence.supplier-matrix-captured-at",
    now,
  );
  const matrixArtifact = readShippingMatrixArtifact(
    matrix,
    context,
    captureMilliseconds(record.validatedDocument.captured_at),
    issues,
    now,
  );
  const rateTable = claim.shopify_rate_table;
  if (!exactKeys(rateTable, [
    "authenticated_source",
    "captured_at",
    "admin_api_version",
    "market",
    "currency",
    "rate_calculation",
    "artifact_path",
    "artifact_sha256",
  ], issues, gate, "evidence.shopify-rate-table")) return;
  exactValue(
    rateTable.authenticated_source,
    "authenticated-shopify-admin-shipping-rate-table",
    issues,
    gate,
    "evidence.shopify-rate-table-source",
  );
  exactValue(rateTable.admin_api_version, SHOPIFY_ADMIN_API_VERSION, issues, gate, "evidence.shopify-rate-table-api-version");
  exactValue(rateTable.market, "US", issues, gate, "evidence.shopify-rate-table-market");
  exactValue(rateTable.currency, "USD", issues, gate, "evidence.shopify-rate-table-currency");
  exactValue(
    rateTable.rate_calculation,
    "weight-based-supplier-cost-pass-through",
    issues,
    gate,
    "evidence.shopify-rate-table-rate-calculation",
  );
  if (!validSha256(rateTable.artifact_sha256)) add(issues, gate, "evidence.shopify-rate-table-sha");
  requireFreshObservation(
    rateTable.captured_at,
    captureMilliseconds(record.validatedDocument.captured_at),
    issues,
    gate,
    "evidence.shopify-rate-table-captured-at",
    now,
  );
  const rateTableArtifact = readShopifyRateTableArtifact(
    rateTable,
    context,
    captureMilliseconds(record.validatedDocument.captured_at),
    issues,
    now,
  );
  if (matrixArtifact.rateTiers.length !== rateTableArtifact.tiers.length) {
    add(issues, gate, "evidence.shipping-rate-tier-count-parity");
  }
  const comparedTierCount = Math.max(matrixArtifact.rateTiers.length, rateTableArtifact.tiers.length);
  for (let index = 0; index < comparedTierCount; index += 1) {
    const supplierTier = matrixArtifact.rateTiers[index];
    const shopifyTier = rateTableArtifact.tiers[index];
    for (const field of ["minimum_weight_grams", "maximum_weight_grams"]) {
      exactValue(
        shopifyTier?.[field],
        supplierTier?.[field],
        issues,
        gate,
        "evidence.shipping-rate-tier-bounds-parity",
      );
    }
    exactValue(
      shopifyTier?.rate_usd,
      supplierTier?.rate_usd,
      issues,
      gate,
      "evidence.shipping-rate-tier-rate-parity",
    );
    if (supplierTier && shopifyTier &&
        supplierTier.source_record_sha256 === shopifyTier.source_record_sha256) {
      add(issues, gate, "evidence.shipping-rate-tier-source-independence");
    }
  }
  const expectedShippingCases = [...REQUIRED_SHIPPING_CASES];
  if (!Array.isArray(claim.shipping_cases) || claim.shipping_cases.length !== expectedShippingCases.length) {
    add(issues, gate, "evidence.shipping-cases.exact-count");
  }
  const caseIds = [];
  const policyEligibility = new Map([
    ["contiguous-us-light", true],
    ["contiguous-us-standard", true],
    ["contiguous-us-heavy", true],
    ["alaska", false],
    ["hawaii", false],
    ["us-territories", false],
    ["military-address", false],
    ["po-box", matrix.po_box_eligible],
  ]);
  if (!sameSet([...matrixArtifact.eligibility.keys()], expectedShippingCases)) {
    add(issues, gate, "evidence.supplier-matrix-case-set");
  }
  for (const [caseId, expectedEligibility] of policyEligibility) {
    if (!matrixArtifact.eligibility.has(caseId)) add(issues, gate, "evidence.supplier-matrix-case-missing");
    exactValue(
      matrixArtifact.eligibility.get(caseId)?.eligible,
      expectedEligibility,
      issues,
      gate,
      "evidence.supplier-matrix-policy-parity",
    );
  }
  const contiguousWeights = CONTIGUOUS_RATE_CASES.map((caseId) =>
    matrixArtifact.eligibility.get(caseId)?.cart_weight_grams);
  if (!contiguousWeights.every((weight) => Number.isSafeInteger(weight)) ||
      !(contiguousWeights[0] < contiguousWeights[1] && contiguousWeights[1] < contiguousWeights[2])) {
    add(issues, gate, "evidence.supplier-matrix-weight-tiers");
  }
  for (const caseId of CONTIGUOUS_RATE_CASES) {
    const matrixCase = matrixArtifact.eligibility.get(caseId);
    if (!matrixCase || matrixCase.address_type !== "street" ||
        ["AK", "HI", "AA", "AE", "AP", "AS", "GU", "MP", "PR", "VI"].includes(matrixCase.destination_region)) {
      add(issues, gate, "evidence.supplier-matrix-contiguous-destination");
    }
  }
  const destinationRules = new Map([
    ["alaska", { regions: ["AK"], addressType: "street" }],
    ["hawaii", { regions: ["HI"], addressType: "street" }],
    ["us-territories", { regions: ["AS", "GU", "MP", "PR", "VI"], addressType: "street" }],
    ["military-address", { regions: ["AA", "AE", "AP"], addressType: "military" }],
    ["po-box", { regions: null, addressType: "po-box" }],
  ]);
  for (const [caseId, rule] of destinationRules) {
    const matrixCase = matrixArtifact.eligibility.get(caseId);
    if (!matrixCase || matrixCase.address_type !== rule.addressType ||
        (rule.regions && !rule.regions.includes(matrixCase.destination_region))) {
      add(issues, gate, "evidence.supplier-matrix-destination-class");
    }
  }
  for (const shippingCase of Array.isArray(claim.shipping_cases) ? claim.shipping_cases : []) {
    if (!exactKeys(shippingCase, [
      "case_id",
      "destination_country",
      "destination_region",
      "destination_postal_code",
      "address_type",
      "cart_lines",
      "cart_weight_grams",
      "expected_eligible",
      "actual_eligible",
      "expected_currency",
      "actual_currency",
      "expected_rate_usd",
      "actual_rate_usd",
      "rate_calculation",
      "configuration_sha256",
      "supplier_matrix_case_sha256",
      "observed_at",
    ], issues, gate, "evidence.shipping-case")) continue;
    caseIds.push(shippingCase.case_id);
    const matrixCase = matrixArtifact.eligibility.get(shippingCase.case_id);
    for (const field of [
      "destination_country",
      "destination_region",
      "destination_postal_code",
      "address_type",
      "cart_weight_grams",
    ]) {
      exactValue(shippingCase[field], matrixCase?.[field], issues, gate, `evidence.shipping-${field}-parity`);
    }
    if (JSON.stringify(canonicalJson(shippingCase.cart_lines)) !==
        JSON.stringify(canonicalJson(matrixCase?.cart_lines))) {
      add(issues, gate, "evidence.shipping-cart-lines-parity");
    }
    exactValue(
      shippingCase.cart_weight_grams,
      recomputeCartWeight(
        shippingCase.cart_lines,
        variantWeights,
        issues,
        gate,
        "evidence.shipping-cart-lines",
      ),
      issues,
      gate,
      "evidence.shipping-cart-weight-recomputed",
    );
    if (typeof shippingCase.expected_eligible !== "boolean" || typeof shippingCase.actual_eligible !== "boolean") {
      add(issues, gate, "evidence.shipping-eligibility-type");
    }
    exactValue(
      shippingCase.expected_eligible,
      matrixCase?.eligible,
      issues,
      gate,
      "evidence.shipping-normative-eligibility",
    );
    exactValue(shippingCase.actual_eligible, shippingCase.expected_eligible, issues, gate, "evidence.shipping-eligibility-parity");
    const expectedCurrency = shippingCase.expected_eligible ? "USD" : null;
    exactValue(shippingCase.expected_currency, expectedCurrency, issues, gate, "evidence.shipping-expected-currency");
    exactValue(shippingCase.actual_currency, expectedCurrency, issues, gate, "evidence.shipping-actual-currency");
    exactValue(shippingCase.expected_rate_usd, matrixCase?.supplier_rate_usd, issues, gate, "evidence.shipping-expected-rate");
    exactValue(shippingCase.actual_rate_usd, shippingCase.expected_rate_usd, issues, gate, "evidence.shipping-rate-parity");
    if (shippingCase.expected_eligible) {
      if (!positiveUsdAmount(shippingCase.expected_rate_usd) || !positiveUsdAmount(shippingCase.actual_rate_usd)) {
        add(issues, gate, "evidence.shipping-positive-rate");
      }
      exactValue(
        shippingCase.expected_rate_usd,
        rateTierForWeight(rateTableArtifact.tiers, shippingCase.cart_weight_grams)?.rate_usd,
        issues,
        gate,
        "evidence.shipping-shopify-rate-table-parity",
      );
    } else if (shippingCase.expected_rate_usd !== null || shippingCase.actual_rate_usd !== null) {
      add(issues, gate, "evidence.shipping-unsupported-rate");
    }
    exactValue(
      shippingCase.rate_calculation,
      "weight-based-supplier-cost-pass-through",
      issues,
      gate,
      "evidence.shipping-rate-calculation",
    );
    if (!validSha256(shippingCase.configuration_sha256)) {
      add(issues, gate, "evidence.shipping-configuration-sha");
    }
    exactValue(
      shippingCase.configuration_sha256,
      rateTableArtifact.artifactSha256,
      issues,
      gate,
      "evidence.shipping-configuration-linkage",
    );
    exactValue(
      shippingCase.supplier_matrix_case_sha256,
      matrixArtifact.recordHashes.get(shippingCase.case_id),
      issues,
      gate,
      "evidence.shipping-matrix-linkage",
    );
    requireFreshObservation(
      shippingCase.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.shipping-observed-at",
      now,
    );
  }
  if (!sameSet(caseIds, expectedShippingCases)) add(issues, gate, "evidence.shipping-case-set");

  const thresholdRelations = Object.freeze([
    ["just-below", -1],
    ["at", 0],
    ["just-above", 1],
  ]);
  const positiveThresholds = rateTableArtifact.tiers.slice(1).map((tier) => tier.minimum_weight_grams);
  const expectedObservationKeys = positiveThresholds.flatMap((threshold) =>
    thresholdRelations.map(([relation]) => `${threshold}\u0000${relation}`));
  const observationKeys = [];
  if (!Array.isArray(claim.tier_threshold_observations) ||
      claim.tier_threshold_observations.length !== expectedObservationKeys.length) {
    add(issues, gate, "evidence.shipping-threshold-observations.exact-count");
  }
  for (const observation of Array.isArray(claim.tier_threshold_observations)
    ? claim.tier_threshold_observations
    : []) {
    if (!exactKeys(observation, [
      "threshold_grams",
      "relation",
      "cart_lines",
      "cart_weight_grams",
      "expected_currency",
      "actual_currency",
      "expected_rate_usd",
      "actual_rate_usd",
      "configuration_sha256",
      "observed_at",
    ], issues, gate, "evidence.shipping-threshold-observation")) continue;
    const relation = thresholdRelations.find(([name]) => name === observation.relation);
    observationKeys.push(`${observation.threshold_grams}\u0000${observation.relation}`);
    exactValue(
      observation.cart_weight_grams,
      recomputeCartWeight(
        observation.cart_lines,
        variantWeights,
        issues,
        gate,
        "evidence.shipping-threshold-cart-lines",
      ),
      issues,
      gate,
      "evidence.shipping-threshold-cart-weight-recomputed",
    );
    if (!positiveThresholds.includes(observation.threshold_grams) || !relation) {
      add(issues, gate, "evidence.shipping-threshold-identity");
      continue;
    }
    exactValue(
      observation.cart_weight_grams,
      observation.threshold_grams + relation[1],
      issues,
      gate,
      "evidence.shipping-threshold-weight",
    );
    exactValue(observation.expected_currency, "USD", issues, gate, "evidence.shipping-threshold-expected-currency");
    exactValue(observation.actual_currency, "USD", issues, gate, "evidence.shipping-threshold-actual-currency");
    const expectedRate = rateTierForWeight(rateTableArtifact.tiers, observation.cart_weight_grams)?.rate_usd;
    exactValue(observation.expected_rate_usd, expectedRate, issues, gate, "evidence.shipping-threshold-expected-rate");
    exactValue(observation.actual_rate_usd, expectedRate, issues, gate, "evidence.shipping-threshold-rate-parity");
    exactValue(
      observation.configuration_sha256,
      rateTableArtifact.artifactSha256,
      issues,
      gate,
      "evidence.shipping-threshold-configuration-linkage",
    );
    requireFreshObservation(
      observation.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.shipping-threshold-observed-at",
      now,
    );
  }
  if (!sameSet(observationKeys, expectedObservationKeys)) {
    add(issues, gate, "evidence.shipping-threshold-observation-set");
  }
}

const OPERATIONAL_GATE_CONTRACTS = Object.freeze({
  product_compliance: [
    "responsible_person_contacts_confirmed",
    "safety_substantiation_records_confirmed",
    "mocra_facility_registration_or_exemption_reviewed",
    "mocra_product_listings_or_exemptions_reviewed",
    "claims_classification_reviewed",
    "claims_counsel_or_compliance_review_complete",
  ],
  tax: ["nexus_review_complete", "configuration_readback_pass"],
  privacy: [
    "policy_review_complete",
    "consent_review_complete",
    "marketing_consent_review_complete",
    "network_intelligence_disclosure_review_complete",
    "privacy_choices_verified",
  ],
  apps: ["permissions_review_complete", "pixel_inventory_review_complete", "unapproved_apps_absent"],
  email: ["sender_domain_authenticated", "customer_notifications_reviewed", "notification_language_reviewed"],
  domains: ["canonical_domain_verified", "legacy_domain_disposition_complete"],
  account_security: [
    "owner_2fa_verified",
    "staff_2fa_verified",
    "access_review_complete",
    "customer_accounts_configuration_reviewed",
  ],
  safety_operations: [
    "complaint_intake_runbook_approved",
    "product_quality_runbook_approved",
    "adverse_event_runbook_approved",
    "recall_runbook_approved",
    "retention_escalation_reporting_approved",
    "incident_notification_language_approved",
    "accountable_owners_assigned",
    "staff_training_complete",
  ],
  gift_cards: [
    "gift_cards_disabled",
    "gift_cards_unlisted",
    "gift_card_route_absent",
    "gift_card_provider_listing_absent",
  ],
});

const STRUCTURED_OPERATIONAL_SECTIONS = Object.freeze(new Set([
  "product_compliance",
  "safety_operations",
  "gift_cards",
]));

const CLAIM_SURFACE_CATEGORIES = Object.freeze([
  "storefront",
  "packaging",
  "reviews",
  "social",
  "promotional",
]);

const SAFETY_RUNBOOK_IDS = Object.freeze([
  "complaint-intake",
  "product-quality",
  "serious-adverse-event",
  "recall",
  "retention",
  "escalation",
  "reporting",
]);

const INCIDENT_LANGUAGE_CATEGORIES = Object.freeze(["safety", "fulfillment", "privacy", "payment"]);

function validateProductComplianceRecords(records, evidenceRecord, issues) {
  const gate = "operational-gates";
  if (!Array.isArray(records) || records.length !== EXPECTED_PRODUCT_HANDLES.length) {
    add(issues, gate, "evidence.product-compliance.exact-count");
  }
  const handles = [];
  for (const item of Array.isArray(records) ? records : []) {
    if (!exactKeys(item, [
      "handle",
      "responsible_person_record_sha256",
      "safety_substantiation_record_sha256",
      "facility_disposition",
      "facility_registration_or_exemption_record_sha256",
      "product_listing_disposition",
      "product_listing_or_exemption_record_sha256",
      "renewal_disposition",
      "change_reporting_disposition",
      "claim_surface_categories",
      "claim_inventory_sha256",
      "classification",
      "reviewed_at",
    ], issues, gate, "evidence.product-compliance-record")) continue;
    handles.push(item.handle);
    for (const field of [
      "responsible_person_record_sha256",
      "safety_substantiation_record_sha256",
      "facility_registration_or_exemption_record_sha256",
      "product_listing_or_exemption_record_sha256",
      "claim_inventory_sha256",
    ]) {
      if (!validSha256(item[field])) add(issues, gate, `evidence.product-compliance.${field}`);
    }
    if (!["registered", "reviewed-exemption"].includes(item.facility_disposition)) {
      add(issues, gate, "evidence.product-compliance.facility-disposition");
    }
    if (!["listed", "reviewed-exemption"].includes(item.product_listing_disposition)) {
      add(issues, gate, "evidence.product-compliance.listing-disposition");
    }
    if (!["current", "not-applicable-reviewed"].includes(item.renewal_disposition)) {
      add(issues, gate, "evidence.product-compliance.renewal-disposition");
    }
    exactValue(item.change_reporting_disposition, "reviewed", issues, gate, "evidence.product-compliance.change-reporting");
    if (!sameSet(item.claim_surface_categories, CLAIM_SURFACE_CATEGORIES)) {
      add(issues, gate, "evidence.product-compliance.claim-surfaces");
    }
    exactValue(item.classification, "cosmetic", issues, gate, "evidence.product-compliance.classification");
    requireOrderedTimestamp(
      item.reviewed_at,
      Number.NaN,
      captureMilliseconds(evidenceRecord.validatedDocument.reviewer.reviewed_at),
      issues,
      gate,
      "evidence.product-compliance.reviewed-at",
    );
  }
  if (!sameSet(handles, EXPECTED_PRODUCT_HANDLES)) add(issues, gate, "evidence.product-compliance.identity-set");
}

function validateSafetyOperationsRecord(section, evidenceRecord, issues) {
  const gate = "operational-gates";
  if (!exactKeys(section, [
    "runbooks",
    "notification_language",
    "trained_owner_ids",
    "training_record_sha256",
  ], issues, gate, "evidence.safety-operations")) return;
  if (!validSha256(section.training_record_sha256)) add(issues, gate, "evidence.safety-training-sha");
  if (!Array.isArray(section.runbooks) || section.runbooks.length !== SAFETY_RUNBOOK_IDS.length) {
    add(issues, gate, "evidence.safety-runbooks.exact-count");
  }
  const runbookIds = [];
  const ownerIds = [];
  for (const runbook of Array.isArray(section.runbooks) ? section.runbooks : []) {
    if (!exactKeys(runbook, [
      "id",
      "status",
      "owner_id",
      "reviewer_id",
      "reviewed_at",
      "record_sha256",
    ], issues, gate, "evidence.safety-runbook")) continue;
    runbookIds.push(runbook.id);
    ownerIds.push(runbook.owner_id);
    exactValue(runbook.status, "approved", issues, gate, "evidence.safety-runbook-status");
    accountableIdentifier(runbook.owner_id, issues, gate, "evidence.safety-runbook-owner");
    accountableIdentifier(runbook.reviewer_id, issues, gate, "evidence.safety-runbook-reviewer");
    if (!validSha256(runbook.record_sha256)) add(issues, gate, "evidence.safety-runbook-sha");
    requireOrderedTimestamp(
      runbook.reviewed_at,
      Number.NaN,
      captureMilliseconds(evidenceRecord.validatedDocument.reviewer.reviewed_at),
      issues,
      gate,
      "evidence.safety-runbook-reviewed-at",
    );
  }
  if (!sameSet(runbookIds, SAFETY_RUNBOOK_IDS)) add(issues, gate, "evidence.safety-runbook-id-set");
  if (!Array.isArray(section.notification_language) ||
      section.notification_language.length !== INCIDENT_LANGUAGE_CATEGORIES.length) {
    add(issues, gate, "evidence.incident-language.exact-count");
  }
  const languageCategories = [];
  for (const language of Array.isArray(section.notification_language) ? section.notification_language : []) {
    if (!exactKeys(language, [
      "category",
      "status",
      "owner_id",
      "reviewer_id",
      "approved_at",
      "content_sha256",
    ], issues, gate, "evidence.incident-language")) continue;
    languageCategories.push(language.category);
    ownerIds.push(language.owner_id);
    exactValue(language.status, "approved", issues, gate, "evidence.incident-language-status");
    accountableIdentifier(language.owner_id, issues, gate, "evidence.incident-language-owner");
    accountableIdentifier(language.reviewer_id, issues, gate, "evidence.incident-language-reviewer");
    if (!validSha256(language.content_sha256)) add(issues, gate, "evidence.incident-language-sha");
    requireOrderedTimestamp(
      language.approved_at,
      Number.NaN,
      captureMilliseconds(evidenceRecord.validatedDocument.reviewer.reviewed_at),
      issues,
      gate,
      "evidence.incident-language-approved-at",
    );
  }
  if (!sameSet(languageCategories, INCIDENT_LANGUAGE_CATEGORIES)) add(issues, gate, "evidence.incident-language-set");
  const uniqueOwners = [...new Set(ownerIds)];
  if (!sameSet(section.trained_owner_ids, uniqueOwners)) add(issues, gate, "evidence.safety-trained-owner-set");
}

function validateGiftCardReadback(readback, evidenceRecord, issues, now) {
  const gate = "operational-gates";
  if (!exactKeys(readback, [
    "authenticated_source",
    "captured_at",
    "theme_id",
    "settings",
    "provider_listing",
    "route",
  ], issues, gate, "evidence.gift-card-readback")) return;
  exactValue(readback.authenticated_source, "authenticated-shopify-admin", issues, gate, "evidence.gift-card-source");
  exactValue(readback.captured_at, evidenceRecord.validatedDocument.captured_at, issues, gate, "evidence.gift-card-capture");
  exactValue(readback.theme_id, PREPAYMENT_GATE_POLICY.candidate_theme_id, issues, gate, "evidence.gift-card-theme");
  if (exactKeys(readback.settings, ["enabled", "readback_sha256"], issues, gate, "evidence.gift-card-settings")) {
    exactBoolean(readback.settings.enabled, false, issues, gate, "evidence.gift-card-enabled");
    if (!validSha256(readback.settings.readback_sha256)) add(issues, gate, "evidence.gift-card-settings-sha");
  }
  if (exactKeys(readback.provider_listing, [
    "expected_count",
    "actual_count",
    "listed",
    "readback_sha256",
  ], issues, gate, "evidence.gift-card-provider-listing")) {
    exactValue(readback.provider_listing.expected_count, 0, issues, gate, "evidence.gift-card-expected-count");
    exactValue(readback.provider_listing.actual_count, 0, issues, gate, "evidence.gift-card-actual-count");
    exactBoolean(readback.provider_listing.listed, false, issues, gate, "evidence.gift-card-listed");
    if (!validSha256(readback.provider_listing.readback_sha256)) add(issues, gate, "evidence.gift-card-listing-sha");
  }
  if (exactKeys(readback.route, [
    "path",
    "expected_http_status",
    "actual_http_status",
    "observed_at",
    "content_sha256",
  ], issues, gate, "evidence.gift-card-route")) {
    exactValue(readback.route.path, "/products/gift-card", issues, gate, "evidence.gift-card-route-path");
    exactValue(readback.route.expected_http_status, 404, issues, gate, "evidence.gift-card-route-expected-status");
    exactValue(readback.route.actual_http_status, 404, issues, gate, "evidence.gift-card-route-actual-status");
    if (!validSha256(readback.route.content_sha256)) add(issues, gate, "evidence.gift-card-route-sha");
    requireFreshObservation(
      readback.route.observed_at,
      captureMilliseconds(evidenceRecord.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.gift-card-route-observed-at",
      now,
    );
  }
}

function validateOperationalGates(gates, evidence, referencedIds, issues, now) {
  const rootGate = "operational-gates";
  if (!exactKeys(gates, Object.keys(OPERATIONAL_GATE_CONTRACTS), issues, rootGate, "contract")) return;
  const evidenceRefs = [];
  const captureTimes = [];
  for (const [name, assertions] of Object.entries(OPERATIONAL_GATE_CONTRACTS)) {
    const gate = `operations-${name}`;
    const section = gates[name];
    const keys = ["captured_at", "status", ...assertions, "evidence_ref"];
    if (!exactKeys(section, keys, issues, gate, "contract")) continue;
    requireFreshCapture(section.captured_at, issues, gate, "capture", now);
    exactValue(section.status, "pass", issues, gate, "status");
    for (const assertion of assertions) exactBoolean(section[assertion], true, issues, gate, assertion);
    requireEvidenceReference(section.evidence_ref, "operations-readback", evidence, referencedIds, issues, gate, "evidence");
    evidenceRefs.push(section.evidence_ref);
    captureTimes.push(section.captured_at);
  }
  if (new Set(evidenceRefs).size !== 1 || new Set(captureTimes).size !== 1) {
    add(issues, rootGate, "shared-evidence-linkage");
    return;
  }
  const record = evidence.get(evidenceRefs[0]);
  const claim = evidenceClaim(record, "operations-readback", issues, rootGate, "evidence");
  if (!claim || !exactKeys(claim, [
    "controls",
    "product_compliance_records",
    "safety_operations_record",
    "gift_card_readback",
    "privacy_choices_readback",
  ], issues, rootGate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, captureTimes[0], issues, rootGate, "evidence.capture-linkage");
  const expectedControlIds = Object.entries(OPERATIONAL_GATE_CONTRACTS)
    .filter(([section]) => !STRUCTURED_OPERATIONAL_SECTIONS.has(section))
    .flatMap(([section, assertions]) => assertions.map((assertion) => `${section}.${assertion}`));
  if (!Array.isArray(claim.controls) || claim.controls.length !== expectedControlIds.length) {
    add(issues, rootGate, "evidence.controls.exact-count");
  }
  const controlIds = [];
  for (const control of Array.isArray(claim.controls) ? claim.controls : []) {
    if (!exactKeys(control, [
      "id",
      "status",
      "owner_id",
      "reviewer_id",
      "reviewed_at",
      "record_sha256",
      "product_handles",
    ], issues, rootGate, "evidence.control")) continue;
    controlIds.push(control.id);
    exactValue(control.status, "pass", issues, rootGate, "evidence.control-status");
    accountableIdentifier(control.owner_id, issues, rootGate, "evidence.control-owner");
    accountableIdentifier(control.reviewer_id, issues, rootGate, "evidence.control-reviewer");
    requireOrderedTimestamp(
      control.reviewed_at,
      Number.NaN,
      captureMilliseconds(record.validatedDocument.reviewer.reviewed_at),
      issues,
      rootGate,
      "evidence.control-reviewed-at",
    );
    if (!validSha256(control.record_sha256)) add(issues, rootGate, "evidence.control-record-sha");
    if (!sameSet(control.product_handles, [])) add(issues, rootGate, "evidence.control-product-identities");
  }
  if (!sameSet(controlIds, expectedControlIds)) add(issues, rootGate, "evidence.control-id-set");
  validateProductComplianceRecords(claim.product_compliance_records, record, issues);
  validateSafetyOperationsRecord(claim.safety_operations_record, record, issues);
  validateGiftCardReadback(claim.gift_card_readback, record, issues, now);
}

function validateQualityAssurance(quality, evidence, referencedIds, issues, now) {
  const gate = "quality-assurance";
  const keys = [
    "captured_at",
    "status",
    "keyboard_pass",
    "focus_pass",
    "escape_pass",
    "touch_pass",
    "zoom_reflow_200_pass",
    "nvda_chrome_pass",
    "voiceover_safari_pass",
    "automated_accessibility_critical",
    "automated_accessibility_serious",
    "responsive_viewports",
    "lighthouse",
    "evidence_ref",
  ];
  if (!exactKeys(quality, keys, issues, gate, "contract")) return;
  requireFreshCapture(quality.captured_at, issues, gate, "capture", now);
  exactValue(quality.status, "pass", issues, gate, "status");
  for (const field of [
    "keyboard_pass",
    "focus_pass",
    "escape_pass",
    "touch_pass",
    "zoom_reflow_200_pass",
    "nvda_chrome_pass",
    "voiceover_safari_pass",
  ]) {
    exactBoolean(quality[field], true, issues, gate, field);
  }
  exactValue(quality.automated_accessibility_critical, 0, issues, gate, "automated-critical");
  exactValue(quality.automated_accessibility_serious, 0, issues, gate, "automated-serious");
  if (!sameSet(quality.responsive_viewports, ["360x800", "390x844", "768x1024", "1440x900"])) {
    add(issues, gate, "responsive-viewport-set");
  }
  if (!Array.isArray(quality.lighthouse) || quality.lighthouse.length !== 4) {
    add(issues, gate, "lighthouse.exact-count");
  }
  const routeTypes = [];
  for (const result of Array.isArray(quality.lighthouse) ? quality.lighthouse : []) {
    if (!exactKeys(result, [
      "route_type",
      "accessibility",
      "best_practices",
      "seo",
      "mobile_performance",
    ], issues, gate, "lighthouse.result")) continue;
    routeTypes.push(result.route_type);
    if (!validLighthouseScore(result.accessibility, 90)) add(issues, gate, "lighthouse.accessibility");
    if (!validLighthouseScore(result.best_practices, 90)) add(issues, gate, "lighthouse.best-practices");
    if (!validLighthouseScore(result.seo, 90)) add(issues, gate, "lighthouse.seo");
    if (!validLighthouseScore(result.mobile_performance, 80)) {
      add(issues, gate, "lighthouse.mobile-performance");
    }
  }
  if (!sameSet(routeTypes, ["home", "collection", "product", "cart"])) {
    add(issues, gate, "lighthouse.route-set");
  }
  const record = requireEvidenceReference(
    quality.evidence_ref,
    "accessibility-performance-readback",
    evidence,
    referencedIds,
    issues,
    gate,
    "evidence",
  );
  const claim = evidenceClaim(record, "accessibility-performance-readback", issues, gate, "evidence");
  if (!claim || !exactKeys(claim, [
    "manual_tests",
    "automated_accessibility",
    "responsive_viewports",
    "lighthouse",
  ], issues, gate, "evidence.claim")) return;
  exactValue(record.validatedDocument.captured_at, quality.captured_at, issues, gate, "evidence.capture-linkage");
  const manualIds = ["keyboard", "focus", "escape", "touch", "zoom-reflow-200", "nvda-chrome", "voiceover-safari"];
  if (!Array.isArray(claim.manual_tests) || claim.manual_tests.length !== manualIds.length) {
    add(issues, gate, "evidence.manual-tests.exact-count");
  }
  const actualManualIds = [];
  for (const item of Array.isArray(claim.manual_tests) ? claim.manual_tests : []) {
    if (!exactKeys(item, ["id", "status", "observed_at", "artifact_sha256"], issues, gate, "evidence.manual-test")) continue;
    actualManualIds.push(item.id);
    exactValue(item.status, "pass", issues, gate, "evidence.manual-test-status");
    if (!validSha256(item.artifact_sha256)) add(issues, gate, "evidence.manual-test-sha");
    requireFreshObservation(
      item.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.manual-test-time",
      now,
    );
  }
  if (!sameSet(actualManualIds, manualIds)) add(issues, gate, "evidence.manual-test-set");

  if (!Array.isArray(claim.automated_accessibility) || claim.automated_accessibility.length !== 4) {
    add(issues, gate, "evidence.automated-accessibility.exact-count");
  }
  const automatedRoutes = [];
  for (const item of Array.isArray(claim.automated_accessibility) ? claim.automated_accessibility : []) {
    if (!exactKeys(item, [
      "route_type",
      "critical",
      "serious",
      "observed_at",
      "report_sha256",
    ], issues, gate, "evidence.automated-result")) continue;
    automatedRoutes.push(item.route_type);
    exactValue(item.critical, 0, issues, gate, "evidence.automated-critical");
    exactValue(item.serious, 0, issues, gate, "evidence.automated-serious");
    if (!validSha256(item.report_sha256)) add(issues, gate, "evidence.automated-report-sha");
    requireFreshObservation(
      item.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.automated-observed-at",
      now,
    );
  }
  if (!sameSet(automatedRoutes, ["home", "collection", "product", "cart"])) {
    add(issues, gate, "evidence.automated-route-set");
  }

  if (!Array.isArray(claim.responsive_viewports) || claim.responsive_viewports.length !== 4) {
    add(issues, gate, "evidence.viewports.exact-count");
  }
  const viewportIds = [];
  for (const item of Array.isArray(claim.responsive_viewports) ? claim.responsive_viewports : []) {
    if (!exactKeys(item, ["viewport", "status", "observed_at", "screenshot_sha256"], issues, gate, "evidence.viewport")) continue;
    viewportIds.push(item.viewport);
    exactValue(item.status, "pass", issues, gate, "evidence.viewport-status");
    if (!validSha256(item.screenshot_sha256)) add(issues, gate, "evidence.viewport-sha");
    requireFreshObservation(
      item.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.viewport-observed-at",
      now,
    );
  }
  if (!sameSet(viewportIds, quality.responsive_viewports)) add(issues, gate, "evidence.viewport-set");

  if (!Array.isArray(claim.lighthouse) || claim.lighthouse.length !== quality.lighthouse?.length) {
    add(issues, gate, "evidence.lighthouse.exact-count");
  }
  const publicLighthouse = new Map((Array.isArray(quality.lighthouse) ? quality.lighthouse : [])
    .map((item) => [item.route_type, item]));
  const evidenceLighthouseRoutes = [];
  for (const item of Array.isArray(claim.lighthouse) ? claim.lighthouse : []) {
    if (!exactKeys(item, [
      "route_type",
      "accessibility",
      "best_practices",
      "seo",
      "mobile_performance",
      "observed_at",
      "report_sha256",
    ], issues, gate, "evidence.lighthouse-result")) continue;
    evidenceLighthouseRoutes.push(item.route_type);
    const publicResult = publicLighthouse.get(item.route_type);
    for (const metric of ["accessibility", "best_practices", "seo", "mobile_performance"]) {
      if (!validLighthouseScore(item[metric])) add(issues, gate, `evidence.lighthouse-${metric}-range`);
      if (item[metric] !== publicResult?.[metric]) add(issues, gate, `evidence.lighthouse-${metric}`);
    }
    if (!validSha256(item.report_sha256)) add(issues, gate, "evidence.lighthouse-report-sha");
    requireFreshObservation(
      item.observed_at,
      captureMilliseconds(record.validatedDocument.captured_at),
      issues,
      gate,
      "evidence.lighthouse-observed-at",
      now,
    );
  }
  if (!sameSet(evidenceLighthouseRoutes, ["home", "collection", "product", "cart"])) {
    add(issues, gate, "evidence.lighthouse-route-set");
  }
}

function validateFinalPhaseExclusions(exclusions, issues) {
  const gate = "final-phase-exclusions";
  const keys = [
    "payment_setup_completed",
    "checkout_activated",
    "theme_published",
    "password_removed",
    "orders_created",
  ];
  if (!exactKeys(exclusions, keys, issues, gate, "contract")) return;
  for (const field of keys) exactBoolean(exclusions[field], false, issues, gate, field);
}

export function validatePrepaymentEvidenceBundle(bundle, options = {}) {
  const issues = [];
  const repositoryRoot = path.resolve(options.repositoryRoot ?? ".");
  const bundlePath = typeof options.bundlePath === "string" ? path.resolve(options.bundlePath) : null;
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  if (!Number.isFinite(now)) throw new TypeError("now must be a valid Date");
  const gitStatusCache = new Map();
  const privatePathGitStatus = options.artifactGitPathStatus ??
    ((candidate) => defaultPrivatePathGitStatus(repositoryRoot, candidate));
  const artifactGitPathStatus = (candidate) => {
    if (gitStatusCache.has(candidate)) return gitStatusCache.get(candidate);
    const status = privatePathGitStatus(candidate);
    gitStatusCache.set(candidate, status);
    return status;
  };
  const boundary = validateEvidenceBoundary(bundlePath, { repositoryRoot, artifactGitPathStatus }, issues);

  if (!exactKeys(bundle, ROOT_KEYS, issues, "prepayment", "root")) return { ok: false, issues };
  exactValue(bundle.schema_version, PREPAYMENT_GATE_POLICY.schema_version, issues, "prepayment", "schema-version");
  exactValue(bundle.gate, PREPAYMENT_GATE_POLICY.gate, issues, "prepayment", "gate-name");
  requireFreshCapture(bundle.captured_at, issues, "prepayment", "capture", now);
  if (exactKeys(bundle.market, ["country", "currency"], issues, "prepayment", "market")) {
    exactValue(bundle.market.country, PREPAYMENT_GATE_POLICY.market_country, issues, "prepayment", "market.country");
    exactValue(bundle.market.currency, PREPAYMENT_GATE_POLICY.market_currency, issues, "prepayment", "market.currency");
  }

  if (options.enforceRepositorySource !== false) validateRepositorySource(bundle.source, repositoryRoot, issues);
  const sourceContracts = options.sourceContracts ?? loadSourceContracts(repositoryRoot, issues);

  if (!boundary) return { ok: false, issues };
  const context = {
    repositoryRoot,
    boundary,
    sourceContracts,
    artifactIndex: null,
    artifactGitPathStatus,
    artifactImageInspector: options.artifactImageInspector,
    usedArtifactBindings: new Set(),
  };
  const evidence = validateEvidenceFiles(bundle.evidence_files, context, issues);
  validateEvidenceDocuments(evidence, bundle, context, issues, now);
  const referencedIds = new Set();
  context.artifactIndex = validateArtifactIndexReference(bundle, evidence, referencedIds, issues, context);
  validateSource(bundle.source, evidence, referencedIds, issues, now);
  validateCandidate(bundle.candidate_theme, bundle.source, evidence, referencedIds, issues, now);
  validateProviderSurfaces(
    bundle.provider_surfaces,
    bundle.candidate_theme,
    evidence,
    referencedIds,
    issues,
    now,
    context,
  );
  validateRenderedRoutes(bundle.rendered_routes, bundle.candidate_theme, evidence, referencedIds, issues, now, context);
  const { productIdentities } = validateProductReview(
    bundle.product_review,
    evidence,
    referencedIds,
    issues,
    now,
    context,
  );
  validatePrivatePrice(bundle.private_price, productIdentities, evidence, referencedIds, issues, now, context);
  validateLaunchPages(bundle.launch_pages, evidence, referencedIds, issues, now, context);
  validateMandatoryNameReview(bundle.mandatory_name_review, evidence, referencedIds, issues, now, context);
  validateFulfillmentShipping(
    bundle.fulfillment_shipping,
    productIdentities,
    evidence,
    referencedIds,
    issues,
    now,
    context,
  );
  validateOperationalGates(bundle.operational_gates, evidence, referencedIds, issues, now);
  validateQualityAssurance(bundle.quality_assurance, evidence, referencedIds, issues, now);
  validateFinalPhaseExclusions(bundle.final_phase_exclusions, issues);

  if (context.artifactIndex?.ok &&
      context.usedArtifactBindings.size !== context.artifactIndex.binding_count) {
    add(issues, "artifact-index", "binding.exact-derived-set");
  }

  const evidenceIds = new Set((Array.isArray(bundle.evidence_files) ? bundle.evidence_files : []).map((entry) => entry?.id));
  if (!sameSet([...referencedIds], [...evidenceIds])) add(issues, "evidence", "references.exact-set");
  return { ok: issues.length === 0, issues };
}

export function summarizePrepaymentGateIssues(issues) {
  const counts = new Map();
  for (const issue of issues ?? []) {
    const gate = typeof issue?.gate === "string" ? issue.gate : "prepayment";
    const category = typeof issue?.category === "string" ? issue.category : "invalid";
    const key = `${gate}\u0000${category}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [gate, category] = key.split("\u0000");
      return { gate, category, count };
    })
    .sort((left, right) => left.gate.localeCompare(right.gate) || left.category.localeCompare(right.category));
}
