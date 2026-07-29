import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { calculateRetailPriceUsd, redactedPriceVerification, verifyPrivatePriceLedger } from "./lib/private-price-rule.mjs";
import {
  EXPECTED_PRODUCT_HANDLES,
  PREPAYMENT_GATE_POLICY,
  REQUIRED_EVIDENCE_KINDS,
  REQUIRED_SEARCH_QUERIES,
  validatePrepaymentEvidenceBundle,
} from "./lib/prepayment-evidence-gate.mjs";
import { REQUIRED_RENDERED_ROUTE_CATEGORIES } from "./lib/launch-content-contracts.mjs";
import { expectedShopifyProjection } from "./lib/product-facts-contract.mjs";
import {
  canonicalSha256 as providerCanonicalSha256,
  providerSurfaceContractSha256,
} from "./lib/provider-surfaces-contract.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const artifactsRoot = path.join(repositoryRoot, ".artifacts", "operations", "shopify");
mkdirSync(artifactsRoot, { recursive: true });

const NOW = new Date("2026-07-19T13:00:00.000Z");
const CAPTURED_AT = "2026-07-19T12:00:00.000Z";
const COMMIT_SHA = createHash("sha1").update("merged-main-commit").digest("hex");
const TREE_SHA = createHash("sha1").update("merged-main-tree").digest("hex");
const HEAD_SHA = createHash("sha1").update("reviewed-pull-request-head").digest("hex");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function artifactSha(label) {
  return sha256(Buffer.from(`verified:${label}`, "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function contractSha(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalJson(value)), "utf8"));
}

const SYNTHETIC_IMAGE_METADATA = Object.freeze({
  format: "png",
  width: 1200,
  height: 1200,
  pages: 1,
});
const REQUIRED_OCR_MEDIA_ROLES = Object.freeze([
  "front",
  "technical-panel",
  "outer-box",
  "texture",
  "scale",
  "use",
]);
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

function privateFormulaIdentity(handle) {
  return {
    catalog_product_identifier: `private-product:${handle}`,
    catalog_variant_identifier: `private-variant:${handle}`,
    formula_or_technical_panel_identifier: `private-panel:${handle}`,
    region: "US",
  };
}

function privateLabelFactHashes(sourceProduct, role) {
  const hashes = Object.fromEntries(PRIVATE_LABEL_FACT_HASH_KEYS.map((field) => [field, null]));
  const roleFields = {
    front: ["public_title", "functional_identity"],
    "technical-panel": ["ingredients_inci", "usage_directions", "warnings", "volume"],
    "outer-box": ["country_of_origin", "certifications"],
  }[role] ?? [];
  for (const field of roleFields) {
    hashes[field] = contractSha(field === "public_title" ? sourceProduct.public_title : sourceProduct.facts[field]);
  }
  return hashes;
}

function normalizeOcrComparableText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function privateLabelComparableText(field, sourceProduct) {
  const facts = sourceProduct.facts;
  switch (field) {
    case "wordmark": return PREPAYMENT_GATE_POLICY.wordmark;
    case "public_title": return sourceProduct.public_title;
    case "functional_identity":
    case "ingredients_inci":
    case "country_of_origin": return facts[field];
    case "usage_directions": return [
      facts.usage_directions.text,
      facts.usage_directions.frequency,
      facts.usage_directions.amount,
      ...facts.usage_directions.routine_timing,
      facts.usage_directions.rinse_behavior,
    ].join(" ");
    case "warnings": return facts.warnings.review_result === "label-matched"
      ? [facts.warnings.text, ...facts.warnings.incompatibilities].filter(Boolean).join(" ")
      : null;
    case "volume": return facts.volume.display;
    case "certifications": return facts.certifications.review_result === "verified-wording"
      ? facts.certifications.items.join(" ")
      : null;
    default: return null;
  }
}

function privateOcrComparisons(sourceProduct, role) {
  const fields = {
    front: ["public_title", "functional_identity"],
    "technical-panel": ["ingredients_inci", "usage_directions", "warnings", "volume"],
    "outer-box": ["country_of_origin", "certifications"],
    texture: [],
    scale: [],
    use: [],
  }[role] ?? [];
  return ["wordmark", ...fields].flatMap((field) => {
    const text = privateLabelComparableText(field, sourceProduct);
    const normalized = normalizeOcrComparableText(text);
    return normalized.length === 0 ? [] : [{
      field,
      text,
      normalized_sha256: sha256(Buffer.from(normalized, "utf8")),
    }];
  });
}

function privateOcrRecord(sourceProduct, media) {
  const comparisons = privateOcrComparisons(sourceProduct, media.role);
  const blocks = comparisons.map((comparison, index) => ({
    index,
    text: comparison.text,
    confidence_basis_points: 9900,
    bbox: { x: 100, y: 100 + (index * 200), width: 1000, height: 100 },
  }));
  return {
    schema_version: 1,
    record_type: "mochirii-private-ocr-output",
    handle: sourceProduct.handle,
    role: media.role,
    public_reference: media.public_reference,
    source_image_sha256: media.asset_sha256,
    captured_at: CAPTURED_AT,
    engine: {
      name: "synthetic-ocr-engine",
      version: "1.0.0",
      configuration_sha256: artifactSha("synthetic-ocr-engine-configuration"),
    },
    pages: [{
      page_number: 1,
      width: SYNTHETIC_IMAGE_METADATA.width,
      height: SYNTHETIC_IMAGE_METADATA.height,
      blocks,
    }],
    normalized_text_sha256: sha256(Buffer.from(blocks.map((block) => block.text).join("\n"), "utf8")),
    semantic_fields: comparisons.map((comparison, index) => ({
      field: comparison.field,
      block_refs: [{ page_number: 1, block_index: index }],
      normalized_observed_sha256: comparison.normalized_sha256,
    })),
    reviewed_block_consumers: [],
  };
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function syntheticPng(label) {
  const color = createHash("sha256").update(label).digest().subarray(0, 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat([Buffer.from([0]), color]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function mediaArtifactSha(label) {
  return sha256(syntheticPng(label));
}

const authenticationEvidenceRecord = Object.freeze({
  schema_version: 1,
  evidence_type: "authenticated-connected-account-session",
  captured_at: CAPTURED_AT,
});
const connectedAccountPlanRecord = Object.freeze({
  schema_version: 1,
  evidence_type: "sanitized-connected-account-plan",
  captured_at: CAPTURED_AT,
  market: "US",
  currency: "USD",
});
const authenticationEvidenceSha256 = contractSha(authenticationEvidenceRecord);
const connectedAccountPlanRecordSha256 = contractSha(connectedAccountPlanRecord);

function readSourceJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, ...relativePath.split("/")), "utf8"));
}

function readyProviderSurfaceContract(productFacts) {
  const ready = readSourceJson("apps/shopify-theme/content/provider-surfaces.v1.json");
  ready.homepage.expected.hero_media_approval_status = "approved";
  ready.homepage.expected.approved_hero_image_sha256 = artifactSha("provider-homepage-hero");
  ready.homepage.expected.approved_hero_image_alt = "Mochirii Cosmetics skincare products arranged for a daily routine.";
  ready.homepage.expected.featured_products_approval_status = "approved";
  ready.homepage.expected.approved_featured_product_handles = EXPECTED_PRODUCT_HANDLES.slice(0, 6);
  ready.homepage.expected_sha256 = providerCanonicalSha256(ready.homepage.expected);
  ready.collections.items.forEach((item, index) => {
    item.rendered_html_approval_status = "approved";
    item.approved_rendered_html_sha256 = artifactSha(`provider-collection-html:${item.handle}`);
    item.media_approval_status = "approved";
    item.approved_image_sha256 = artifactSha(`provider-collection-image:${item.handle}`);
    item.approved_image_alt = `${item.title} Mochirii Cosmetics collection.`;
    item.membership_approval_status = "approved";
    item.approved_product_handles = index === 0
      ? productFacts.products.map((product) => product.handle)
      : productFacts.products
        .filter((product) => product.facts.collection_handles.includes(item.handle))
        .map((product) => product.handle);
  });
  ready.policies.items.forEach((item) => {
    item.approval_status = "approved";
    item.approved_content_sha256 = sha256(Buffer.from(
      renderedCustomerBody("policies-and-privacy", item.identity),
      "utf8",
    ));
  });
  ready.notifications.items.forEach((item) => {
    item.approval_status = "approved";
    item.approved_subject = `${item.customer_label} from Mochirii Cosmetics`;
    item.approved_subject_sha256 = sha256(Buffer.from(item.approved_subject, "utf8"));
    item.approved_body_sha256 = sha256(Buffer.from(
      renderedCustomerBody("notifications", item.identity),
      "utf8",
    ));
  });
  ready.notifications.sender_presentation.approval_status = "approved";
  ready.notifications.sender_presentation.approved_sender_address_sha256 = artifactSha("notification-sender-address");
  ready.notifications.sender_presentation.approved_sender_domain_sha256 = artifactSha("notification-sender-domain");
  return ready;
}

function providerSurfaceReadback(contract, packageSha) {
  const scope = { candidate_theme_id: PREPAYMENT_GATE_POLICY.candidate_theme_id, package_sha256: packageSha };
  const navigationObserved = {
    header: structuredClone(contract.navigation.header),
    footer_groups: structuredClone(contract.navigation.footer_groups),
  };
  const domainValues = {
    primary_customer_domain: contract.settings.expected.primary_customer_domain,
    primary_customer_url: contract.settings.expected.primary_customer_url,
    shop_url: contract.settings.expected.primary_customer_url,
    canonical_url_hosts: [contract.settings.expected.primary_customer_domain],
    json_ld_url_hosts: [contract.settings.expected.primary_customer_domain],
    customer_absolute_link_hosts: [contract.settings.expected.primary_customer_domain, "mochirii.com"],
  };
  return {
    schema_version: 1,
    record_type: "mochirii-private-provider-surface-readback",
    source_contract_sha256: providerSurfaceContractSha256(contract),
    captured_at: CAPTURED_AT,
    candidate: {
      theme_id: PREPAYMENT_GATE_POLICY.candidate_theme_id,
      admin_status: "Draft",
      published: false,
      package_sha256: packageSha,
    },
    brand_identity: {
      scope: structuredClone(scope),
      canonical_reference_sha256: contract.brand_identity.canonical_reference.sha256,
      storefront_derivative_sha256: contract.brand_identity.storefront_derivative.sha256,
      provider_logo_readbacks: contract.brand_identity.provider_logo_expectations.map((item) => ({
        order: item.order,
        surface: item.surface,
        configuration_available: true,
        status: "matched",
        selected_asset_sha256: contract.brand_identity.storefront_derivative.sha256,
        readback_sha256: artifactSha(`provider-logo:${item.surface}`),
      })),
    },
    homepage: {
      scope: structuredClone(scope),
      values: structuredClone(contract.homepage.expected),
      observed_sha256: providerCanonicalSha256(contract.homepage.expected),
      hero_image_sha256: contract.homepage.expected.approved_hero_image_sha256,
      hero_image_alt: contract.homepage.expected.approved_hero_image_alt,
      featured_product_handles: [...contract.homepage.expected.approved_featured_product_handles],
    },
    collections_index: {
      scope: structuredClone(scope),
      values: structuredClone(contract.collections_index.expected),
      observed_sha256: providerCanonicalSha256(contract.collections_index.expected),
    },
    pages: {
      items: contract.pages.items.map((item) => ({
        order: item.order,
        handle: item.handle,
        route: item.route,
        title: item.title,
        seo_title: item.seo_title,
        seo_description: item.seo_description,
        seo_sha256: item.approved_seo_sha256,
        content_sha256: item.approved_content_sha256,
      })),
    },
    collections: {
      items: contract.collections.items.map((item) => ({
        order: item.order,
        handle: item.handle,
        route: item.route,
        title: item.title,
        seo_title: item.seo_title,
        seo_description: item.seo_description,
        seo_sha256: item.approved_seo_sha256,
        description_sha256: item.approved_description_sha256,
        rendered_html_sha256: item.approved_rendered_html_sha256,
        image_sha256: item.approved_image_sha256,
        image_alt: item.approved_image_alt,
        product_handles: [...item.approved_product_handles],
      })),
    },
    navigation: {
      scope: structuredClone(scope),
      observed: navigationObserved,
      observed_sha256: providerCanonicalSha256(navigationObserved),
    },
    search_and_filters: {
      scope: structuredClone(scope),
      observed_filters: structuredClone(contract.search_and_filters.filters),
      vendor_filter_present: false,
      observed_sha256: providerCanonicalSha256({
        filters: contract.search_and_filters.filters,
        vendor_filter_present: false,
      }),
    },
    policies: {
      items: contract.policies.items.map((item) => ({
        order: item.order,
        identity: item.identity,
        route: item.route,
        title: item.expected_title,
        content_sha256: item.approved_content_sha256,
        normalized_body: renderedCustomerBody("policies-and-privacy", item.identity),
        detected_third_party_names: [],
      })),
    },
    settings: {
      scope: structuredClone(scope),
      values: structuredClone(contract.settings.expected),
      observed_sha256: providerCanonicalSha256(contract.settings.expected),
    },
    domains: {
      scope: structuredClone(scope),
      ...domainValues,
      observed_sha256: providerCanonicalSha256(domainValues),
    },
    notifications: {
      sender: (() => {
        const values = {
          display_name: contract.notifications.sender_presentation.display_name,
          sender_address_sha256: contract.notifications.sender_presentation.approved_sender_address_sha256,
          sender_domain_sha256: contract.notifications.sender_presentation.approved_sender_domain_sha256,
          authenticated: true,
          domain_ownership_status: "approved",
        };
        return { ...values, readback_sha256: providerCanonicalSha256(values) };
      })(),
      items: contract.notifications.items.map((item) => ({
        order: item.order,
        identity: item.identity,
        subject: item.approved_subject,
        subject_sha256: item.approved_subject_sha256,
        body_sha256: item.approved_body_sha256,
        normalized_body: renderedCustomerBody("notifications", item.identity),
        detected_third_party_names: [],
      })),
    },
  };
}

function fixtureSourceContracts() {
  const currentFacts = readSourceJson("apps/shopify-theme/content/product-facts.v3.json");
  const handles = currentFacts.products.map((product) => product.handle);
  const productFacts = {
    ...currentFacts,
    status: "complete",
    products: currentFacts.products.map((product, index) => ({
      ...product,
      review_status: "complete",
      review: {
        formula_mapping: "approved",
        front_label: "approved",
        technical_panel: "approved",
        outer_box: "approved",
        brand_mark: { status: "approved", emblem_matches: true, wordmark_matches: true },
        media_unit_match: "approved",
      },
      facts: {
        functional_identity: "Facial moisturizer",
        description: "A daily facial moisturizer that helps skin feel hydrated after application.",
        seo_title: `${product.public_title} | Mochirii Cosmetics`,
        seo_description: "A daily facial moisturizer from Mochirii Cosmetics for hydrated-feeling skin after application.",
        card_benefit: "Helps skin feel hydrated after application.",
        benefits: ["Helps skin feel hydrated after application."],
        product_type: "Moisturizer",
        skin_type: ["Normal"],
        appearance_concerns: ["Dry-feeling skin"],
        routine_step: "Moisturize",
        usage_directions: {
          text: "Apply to clean skin after cleansing.",
          frequency: "Daily",
          amount: "A small amount",
          routine_timing: ["AM"],
          rinse_behavior: "No rinse",
        },
        key_ingredients: ["Glycerin"],
        key_ingredient_details: [{ name: "Glycerin", cosmetic_role: "Helps bind water at the skin surface" }],
        ingredients_inci: "Aqua, Glycerin",
        warnings: { review_result: "approved-none", text: null, incompatibilities: [] },
        texture: "Cream",
        finish: "Natural finish",
        fragrance_status: "Fragrance free",
        country_of_origin: "United States",
        package_details: "Sealed retail package",
        certifications: { review_result: "approved-none", items: [] },
        volume: {
          us_customary: { value: 1, unit: "fl oz" },
          metric: { value: 30, unit: "mL" },
          display: "1 fl oz / 30 mL",
        },
        collection_handles: [
          "mochirii-cosmetics",
          ["cleanse-tone", "hydrate-barrier", "brighten-smooth", "age-support-nourish"][index % 4],
        ],
        complementary_products: [handles[(index + 1) % handles.length]],
        media: [
          {
            role: "front",
            public_reference: `/products/${product.handle}-front.png`,
            asset_sha256: mediaArtifactSha(`media:${product.handle}:front`),
            alt_text: `Front of Mochirii Cosmetics ${product.public_title} packaging`,
            brand_mark_expectation: {
              emblem: "required",
              wordmark: "required",
              other_brand_absent: "required",
            },
            approved_unit_match: true,
          },
          {
            role: "technical-panel",
            public_reference: `/products/${product.handle}-panel.png`,
            asset_sha256: mediaArtifactSha(`media:${product.handle}:technical-panel`),
            alt_text: `Technical panel on Mochirii Cosmetics ${product.public_title} packaging`,
            brand_mark_expectation: {
              emblem: "required",
              wordmark: "required",
              other_brand_absent: "required",
            },
            approved_unit_match: true,
          },
          {
            role: "outer-box",
            public_reference: `/products/${product.handle}-box.png`,
            asset_sha256: mediaArtifactSha(`media:${product.handle}:outer-box`),
            alt_text: `Outer box for Mochirii Cosmetics ${product.public_title}`,
            brand_mark_expectation: {
              emblem: "required",
              wordmark: "required",
              other_brand_absent: "required",
            },
            approved_unit_match: true,
          },
          ...(index === 0 ? [{
            role: "use",
            public_reference: `/products/${product.handle}-use.png`,
            asset_sha256: mediaArtifactSha(`media:${product.handle}:use`),
            alt_text: `Mochirii Cosmetics ${product.public_title} shown in use`,
            brand_mark_expectation: {
              emblem: "required",
              wordmark: "required",
              other_brand_absent: "required",
            },
            approved_unit_match: true,
          }] : []),
        ],
      },
    })),
  };
  const mandatoryNames = readSourceJson("apps/shopify-theme/content/mandatory-name-exceptions.v1.json");
  mandatoryNames.status = "reviewed";
  mandatoryNames.rendered_review = {
    status: "reviewed",
    reviewer: "compliance-reviewer",
    review_date: "2026-07-19",
    reviewed_route_categories: [...REQUIRED_RENDERED_ROUTE_CATEGORIES],
  };
  return {
    activeSourceManifest: readSourceJson("apps/shopify-theme/ACTIVE-SOURCE-MANIFEST.v1.json"),
    activeSourceManifestSchema: readSourceJson("apps/shopify-theme/ACTIVE-SOURCE-MANIFEST.v1.schema.json"),
    productFacts,
    launchPages: readSourceJson("apps/shopify-theme/content/launch-pages.v1.json"),
    mandatoryNames,
    providerSurfaces: readyProviderSurfaceContract(productFacts),
    searchExpectations: readSourceJson("apps/shopify-theme/content/storefront-search-expectations.v1.json"),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}

function priceLedger(snapshotArtifact, snapshotSha256, records, capturedAt = CAPTURED_AT) {
  return {
    schema_version: 2,
    captured_at: capturedAt,
    market: "US",
    currency: "USD",
    basis: {
      connected_account_plan_record_sha256: connectedAccountPlanRecordSha256,
      shipping_included: false,
      tax_included: false,
      optional_services_included: false,
      ambiguity_resolved: true,
    },
    catalog_readback: {
      schema_version: 1,
      captured_at: capturedAt,
      provider: "manufacturing-partner",
      market: "US",
      currency: "USD",
      readback_source: "authenticated-manufacturing-partner-connected-account",
      authentication_evidence_sha256: authenticationEvidenceSha256,
      connected_account_plan_record_sha256: connectedAccountPlanRecordSha256,
      snapshot_artifact: snapshotArtifact,
      snapshot_sha256: snapshotSha256,
      snapshot_format: "canonical-json",
      snapshot_record_count: 20,
      record_hash_scope: "provider-record-including-formula-plan-and-base-price",
      records,
    },
    variants: records.map((record, index) => {
      const basePrice = record.base_price_usd;
      return {
        handle: record.handle,
        product_id: `gid://shopify/Product/${1000 + index}`,
        variant_id: `gid://shopify/ProductVariant/${2000 + index}`,
        exact_mapping_confirmed: true,
        formula_identity_sha256: record.formula_identity_sha256,
        source_catalog_record_sha256: record.source_catalog_record_sha256,
        catalog_snapshot_sha256: snapshotSha256,
        base_price_usd: basePrice,
        shopify_cost_per_item_usd: basePrice,
        retail_price_usd: calculateRetailPriceUsd(basePrice),
        compare_at_price_usd: null,
      };
    }),
  };
}

function shopifyPriceReadback(ledger) {
  return {
    schema_version: 1,
    captured_at: ledger.captured_at,
    market: "US",
    currency: "USD",
    readback_source: "authenticated-shopify-admin",
    variants: ledger.variants.map((variant) => ({
      handle: variant.handle,
      product_id: variant.product_id,
      variant_id: variant.variant_id,
      status: "active",
      shopify_cost_per_item_usd: variant.shopify_cost_per_item_usd,
      retail_price_usd: variant.retail_price_usd,
      compare_at_price_usd: variant.compare_at_price_usd,
    })),
  };
}

function shopifyProductReadback(sourceProduct, publicProduct, productIndex, productIdByHandle) {
  const projection = expectedShopifyProjection(sourceProduct, productIdByHandle);
  const readback = {
    observed_at: CAPTURED_AT,
    product_id: publicProduct.product_record_id,
    status: "ACTIVE",
    variant_ids: [publicProduct.variant_record_id],
    has_only_default_variant: projection.variant_presentation.has_only_default_variant,
    default_variant: {
      id: publicProduct.variant_record_id,
      title: projection.variant_presentation.title,
      selected_options: projection.variant_presentation.selected_options,
    },
    handle: projection.handle,
    title: projection.title,
    vendor: projection.vendor,
    description_html: projection.description_html,
    seo: projection.seo,
    metafields: projection.metafields,
    collection_handles: projection.collection_handles,
    media: projection.media.map((media, mediaIndex) => ({
      media_id: `gid://shopify/MediaImage/${3000 + (productIndex * 10) + mediaIndex}`,
      position: media.position,
      media_content_type: "IMAGE",
      status: "READY",
      role: media.role,
      public_reference: media.public_reference,
      original_source_sha256: media.asset_sha256,
      alt_text: media.alt_text,
      emblem_matches: true,
      wordmark_matches: true,
      other_brand_absent: true,
    })),
  };
  return { ...readback, record_sha256: contractSha(readback) };
}

function operationalGate(assertions, evidenceRef) {
  return Object.fromEntries([
    ["captured_at", CAPTURED_AT],
    ["status", "pass"],
    ...assertions.map((field) => [field, true]),
    ["evidence_ref", evidenceRef],
  ]);
}

const OPERATIONAL_ASSERTIONS = Object.freeze({
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

const EVIDENCE_ROLES = Object.freeze({
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

function evidenceDocument(kind, claim, capturedAt = CAPTURED_AT) {
  return {
    schema_version: 1,
    evidence_kind: kind,
    captured_at: capturedAt,
    repository: PREPAYMENT_GATE_POLICY.repository,
    source_commit_sha: COMMIT_SHA,
    source_tree_sha: TREE_SHA,
    candidate_theme_id: PREPAYMENT_GATE_POLICY.candidate_theme_id,
    expected_product_handles: [...EXPECTED_PRODUCT_HANDLES],
    reviewer: {
      reviewer_id: `reviewer-${kind.replaceAll("-", "")}`,
      role: EVIDENCE_ROLES[kind],
      reviewed_at: capturedAt,
    },
    claim,
  };
}

function renderedCustomerBody(category, identity) {
  const descriptions = {
    home: "Browse Mochirii Cosmetics skincare by product type, skin needs, and routine step.",
    collections: "Browse this Mochirii Cosmetics skincare collection.",
    products: `Review ingredients, directions, size, and availability for Mochirii Cosmetics ${identity}.`,
    "search-and-filters": `Review Mochirii Cosmetics skincare search results for ${identity.slice(7)}.`,
    cart: "Review Mochirii Cosmetics products, quantities, and prices in your cart.",
    contact: "Contact Mochirii Cosmetics for product, order, shipping, or return help.",
    "policies-and-privacy": `Read the Mochirii Cosmetics ${identity} information.`,
    accounts: "Sign in to review your Mochirii Cosmetics account and orders.",
    errors: identity === "server-error"
      ? "We could not load this page. Try again or contact Mochirii Cosmetics."
      : "This page was not found. Search or browse Mochirii Cosmetics skincare.",
    password: "Enter the password to preview the Mochirii Cosmetics skincare shop.",
    notifications: `Review your Mochirii Cosmetics ${identity} details.`,
  };
  return descriptions[category];
}

function routeTargets(searchQueries, privacyChoicesPath = "/pages/data-sharing-opt-out") {
  const categoryIdentities = new Map([
    ["home", ["home"]],
    ["collections", ["mochirii-cosmetics", "cleanse-tone", "hydrate-barrier", "brighten-smooth", "age-support-nourish"]],
    ["products", [...EXPECTED_PRODUCT_HANDLES]],
    ["search-and-filters", searchQueries.map((query) => `search:${query}`)],
    ["cart", ["cart"]],
    ["contact", ["contact"]],
    ["policies-and-privacy", ["refund-policy", "shipping-policy", "privacy-policy", "terms-of-service", "privacy-choices"]],
    ["accounts", ["account-login"]],
    ["errors", ["not-found", "server-error"]],
    ["password", ["password"]],
    ["notifications", ["order-confirmation", "shipping-confirmation", "delivery-confirmation"]],
  ]);
  const policyRoutes = new Map([
    ["refund-policy", "/policies/refund-policy"],
    ["shipping-policy", "/policies/shipping-policy"],
    ["privacy-policy", "/policies/privacy-policy"],
    ["terms-of-service", "/policies/terms-of-service"],
    ["privacy-choices", privacyChoicesPath],
  ]);
  return [...categoryIdentities.entries()].flatMap(([category, identities]) => identities.map((identity) => ({
    category,
    identity,
    target: category === "home" ? "/" :
      category === "collections" ? `/collections/${identity}` :
          category === "products" ? `/products/${identity}` :
          category === "search-and-filters" ? `/search?q=${encodeURIComponent(identity.slice(7))}&type=product&options%5Bprefix%5D=last` :
            category === "cart" ? "/cart" :
              category === "contact" ? "/pages/contact" :
                category === "policies-and-privacy" ? policyRoutes.get(identity) :
                  category === "accounts" ? "/account/login" :
                    category === "errors" ? `/__mochirii-fixtures/${identity}` :
                      category === "password" ? "/password" : `notification:${identity}`,
    observed_at: CAPTURED_AT,
    http_status: category === "notifications" ? null : identity === "not-found" ? 404 : identity === "server-error" ? 500 : 200,
    content_sha256: sha256(Buffer.from(renderedCustomerBody(category, identity), "utf8")),
    review_status: "pass",
  })));
}

function buildFixture(directory) {
  const relativeDirectory = path.relative(repositoryRoot, directory).split(path.sep).join("/");
  const sourceContracts = fixtureSourceContracts();
  const packageRelativePath = `${relativeDirectory}/candidate-theme.zip`;
  const packagePath = path.join(repositoryRoot, ...packageRelativePath.split("/"));
  const packageBuffer = storedZip(sourceContracts.activeSourceManifest.files.map((entry) => [
    entry.path.slice("apps/shopify-theme/".length),
    readFileSync(path.join(repositoryRoot, ...entry.path.split("/"))),
  ]));
  writeFileSync(packagePath, packageBuffer);
  const packageSha = sha256(packageBuffer);
  const catalogRecords = EXPECTED_PRODUCT_HANDLES.map((handle, index) => ({
    handle,
    formula_identity_sha256: contractSha(privateFormulaIdentity(handle)),
    source_catalog_record_sha256: artifactSha(`catalog-source-record:${handle}`),
    base_price_usd: `${20 + index}.00`,
  }));
  const catalogSnapshot = {
    schema_version: 1,
    captured_at: CAPTURED_AT,
    provider: "manufacturing-partner",
    market: "US",
    currency: "USD",
    readback_source: "authenticated-manufacturing-partner-connected-account",
    authentication_evidence_sha256: authenticationEvidenceSha256,
    connected_account_plan_record_sha256: connectedAccountPlanRecordSha256,
    record_hash_scope: "provider-record-including-formula-plan-and-base-price",
    records: catalogRecords,
  };
  const catalogSnapshotRelativePath = `${relativeDirectory}/manufacturing-partner-usd-catalog.json`;
  writeFileSync(
    path.join(repositoryRoot, ...catalogSnapshotRelativePath.split("/")),
    `${JSON.stringify(catalogSnapshot, null, 2)}\n`,
  );
  const ledger = priceLedger(catalogSnapshotRelativePath, contractSha(catalogSnapshot), catalogRecords);
  const shopifyReadback = shopifyPriceReadback(ledger);
  const report = redactedPriceVerification(verifyPrivatePriceLedger(ledger, shopifyReadback, {
    now: NOW,
    expectedProducts: EXPECTED_PRODUCT_HANDLES.map((handle) => ({ handle, title: handle })),
  }));
  const weightFixtureVariantId = "gid://shopify/ProductVariant/2000";
  const supplierRateTiers = [
    ["supplier-light", 0, 500, "5.25"],
    ["supplier-standard", 500, 1000, "7.50"],
    ["supplier-heavy", 1000, null, "10.75"],
  ].map(([tierId, minimumWeightGrams, maximumWeightGrams, rateUsd]) => ({
    tier_id: tierId,
    minimum_weight_grams: minimumWeightGrams,
    maximum_weight_grams: maximumWeightGrams,
    rate_usd: rateUsd,
    source_record_sha256: artifactSha(`supplier-shipping-rate-tier:${tierId}`),
  }));
  const shippingMatrixArtifact = {
    schema_version: 1,
    captured_at: CAPTURED_AT,
    authenticated_source: "authenticated-manufacturing-partner-us-shipping-matrix",
    market: "US",
    policy_scope: "contiguous-us-only",
    rate_calculation: "weight-based-supplier-cost-pass-through",
    free_shipping_threshold_usd: null,
    po_box_carrier_response_sha256: artifactSha("po-box-carrier-response"),
    rate_tiers: supplierRateTiers,
    cases: [
      ["contiguous-us-light", "CA", "94105", "street", 250, true, "5.25"],
      ["contiguous-us-standard", "NY", "10001", "street", 750, true, "7.50"],
      ["contiguous-us-heavy", "TX", "78701", "street", 1500, true, "10.75"],
      ["alaska", "AK", "99501", "street", 750, false, null],
      ["hawaii", "HI", "96813", "street", 750, false, null],
      ["us-territories", "PR", "00901", "street", 750, false, null],
      ["military-address", "AE", "09012", "military", 750, false, null],
      ["po-box", "CA", "94105", "po-box", 750, true, "7.50"],
    ].map(([caseId, destinationRegion, destinationPostalCode, addressType, cartWeightGrams, eligible, supplierRateUsd]) => ({
      case_id: caseId,
      destination_country: "US",
      destination_region: destinationRegion,
      destination_postal_code: destinationPostalCode,
      address_type: addressType,
      cart_lines: [{ variant_record_id: weightFixtureVariantId, quantity: cartWeightGrams }],
      cart_weight_grams: cartWeightGrams,
      eligible,
      supplier_rate_usd: supplierRateUsd,
      source_record_sha256: artifactSha(`shipping-matrix-case:${caseId}`),
    })),
  };
  const shippingMatrixRelativePath = `${relativeDirectory}/manufacturing-partner-shipping-matrix.json`;
  writeFileSync(
    path.join(repositoryRoot, ...shippingMatrixRelativePath.split("/")),
    `${JSON.stringify(shippingMatrixArtifact, null, 2)}\n`,
  );
  const shopifyRateTableArtifact = {
    schema_version: 1,
    captured_at: CAPTURED_AT,
    authenticated_source: "authenticated-shopify-admin-shipping-rate-table",
    admin_api_version: "2026-07",
    market: "US",
    currency: "USD",
    rate_calculation: "weight-based-supplier-cost-pass-through",
    tiers: supplierRateTiers.map((tier) => ({
      tier_id: tier.tier_id.replace("supplier-", "shopify-"),
      minimum_weight_grams: tier.minimum_weight_grams,
      maximum_weight_grams: tier.maximum_weight_grams,
      rate_usd: tier.rate_usd,
      source_record_sha256: artifactSha(`shopify-shipping-rate-tier:${tier.tier_id}`),
    })),
  };
  const shopifyRateTableRelativePath = `${relativeDirectory}/shopify-shipping-rate-table.json`;
  writeFileSync(
    path.join(repositoryRoot, ...shopifyRateTableRelativePath.split("/")),
    `${JSON.stringify(shopifyRateTableArtifact, null, 2)}\n`,
  );
  const shopifyRateTableSha256 = contractSha(shopifyRateTableArtifact);
  const configuredRateForWeight = (weight) => shopifyRateTableArtifact.tiers.find((tier) =>
    weight >= tier.minimum_weight_grams &&
    (tier.maximum_weight_grams === null || weight < tier.maximum_weight_grams))?.rate_usd;
  const tierThresholdObservations = shopifyRateTableArtifact.tiers.slice(1).flatMap((tier) => [
    ["just-below", tier.minimum_weight_grams - 1],
    ["at", tier.minimum_weight_grams],
    ["just-above", tier.minimum_weight_grams + 1],
  ].map(([relation, cartWeightGrams]) => ({
    threshold_grams: tier.minimum_weight_grams,
    relation,
    cart_lines: [{ variant_record_id: weightFixtureVariantId, quantity: cartWeightGrams }],
    cart_weight_grams: cartWeightGrams,
    expected_currency: "USD",
    actual_currency: "USD",
    expected_rate_usd: configuredRateForWeight(cartWeightGrams),
    actual_rate_usd: configuredRateForWeight(cartWeightGrams),
    configuration_sha256: shopifyRateTableSha256,
    observed_at: CAPTURED_AT,
  })));

  const artifactIndex = { schema_version: 1, artifacts: [], bindings: [] };
  const productArtifactClaims = new Map();
  const writeIndexedJson = (artifactId, fileName, value) => {
    const artifactPath = `${relativeDirectory}/private-artifacts/${fileName}`;
    const absolutePath = path.join(repositoryRoot, ...artifactPath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
    const buffer = readFileSync(absolutePath);
    const artifact = {
      artifact_id: artifactId,
      artifact_path: artifactPath,
      hash_mode: "canonical-json-v1",
      sha256: contractSha(value),
      size_bytes: buffer.length,
      content_type: "application/json",
    };
    artifactIndex.artifacts.push(artifact);
    return artifact;
  };
  const writeIndexedPng = (artifactId, fileName, label) => {
    const artifactPath = `${relativeDirectory}/private-artifacts/${fileName}`;
    const absolutePath = path.join(repositoryRoot, ...artifactPath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const buffer = syntheticPng(label);
    writeFileSync(absolutePath, buffer);
    const artifact = {
      artifact_id: artifactId,
      artifact_path: artifactPath,
      hash_mode: "raw-bytes",
      sha256: sha256(buffer),
      size_bytes: buffer.length,
      content_type: "image/png",
    };
    artifactIndex.artifacts.push(artifact);
    return artifact;
  };
  const bind = (artifact, scope, handle, field, role = null, publicReference = null) => {
    artifactIndex.bindings.push({
      scope,
      handle,
      field,
      role,
      public_reference: publicReference,
      artifact_id: artifact.artifact_id,
    });
  };

  const catalogRecordByHandle = new Map(catalogRecords.map((record) => [record.handle, record]));
  for (const sourceProduct of sourceContracts.productFacts.products) {
    const claims = {
      ocr_output_sha256_by_identity: new Map(),
      image_artifact_by_identity: new Map(),
    };
    for (const media of sourceProduct.facts.media) {
      const role = media.role;
      const labelField = {
        front: "front_label_sha256",
        "technical-panel": "technical_panel_sha256",
        "outer-box": "outer_box_sha256",
      }[role];
      const artifact = writeIndexedPng(
        `${sourceProduct.handle}-${role}`,
        `${sourceProduct.handle}-${role}.png`,
        `media:${sourceProduct.handle}:${role}`,
      );
      assert.equal(artifact.sha256, media.asset_sha256);
      if (labelField) {
        claims[labelField] = artifact.sha256;
        bind(artifact, "product", sourceProduct.handle, labelField);
      }
      bind(
        artifact,
        "product",
        sourceProduct.handle,
        "media_records.artifact_sha256",
        role,
        media.public_reference,
      );
      const identity = `${role}\u0000${media.public_reference}`;
      claims.image_artifact_by_identity.set(identity, artifact);
      if (REQUIRED_OCR_MEDIA_ROLES.includes(role)) {
        const ocr = writeIndexedJson(
          `${sourceProduct.handle}-${role}-ocr`,
          `${sourceProduct.handle}-${role}-ocr.json`,
          privateOcrRecord(sourceProduct, media),
        );
        bind(
          ocr,
          "product",
          sourceProduct.handle,
          "media_records.ocr_output_sha256",
          role,
          media.public_reference,
        );
        claims.ocr_output_sha256_by_identity.set(identity, ocr.sha256);
      }
    }
    const catalogRecord = catalogRecordByHandle.get(sourceProduct.handle);
    const formula = writeIndexedJson(
      `${sourceProduct.handle}-formula-record`,
      `${sourceProduct.handle}-formula-record.json`,
      {
        schema_version: 1,
        record_type: "mochirii-private-formula-mapping",
        handle: sourceProduct.handle,
        captured_at: CAPTURED_AT,
        market: "US",
        source_catalog_record_sha256: catalogRecord.source_catalog_record_sha256,
        identity: privateFormulaIdentity(sourceProduct.handle),
        formula_identity_sha256: catalogRecord.formula_identity_sha256,
        approved_unit: {
          front_label_sha256: claims.front_label_sha256,
          technical_panel_sha256: claims.technical_panel_sha256,
          outer_box_sha256: claims.outer_box_sha256,
        },
        status: "approved",
      },
    );
    bind(formula, "product", sourceProduct.handle, "formula_record_sha256");
    claims.formula_record_sha256 = formula.sha256;
    const productIndex = EXPECTED_PRODUCT_HANDLES.indexOf(sourceProduct.handle);
    const shippingMapping = writeIndexedJson(
      `${sourceProduct.handle}-shipping-mapping`,
      `${sourceProduct.handle}-shipping-mapping.json`,
      {
        schema_version: 1,
        record_type: "mochirii-private-supplier-product-mapping",
        captured_at: CAPTURED_AT,
        authenticated_source: "authenticated-manufacturing-partner-product-mapping",
        authentication_evidence_sha256: authenticationEvidenceSha256,
        market: "US",
        handle: sourceProduct.handle,
        product_record_id: `gid://shopify/Product/${1000 + productIndex}`,
        variant_record_id: `gid://shopify/ProductVariant/${2000 + productIndex}`,
        formula_identity_sha256: catalogRecord.formula_identity_sha256,
        source_catalog_record_sha256: catalogRecord.source_catalog_record_sha256,
        supplier_expected_weight_grams: 1,
        status: "confirmed",
      },
    );
    bind(shippingMapping, "product", sourceProduct.handle, "shipping_mapping_record_sha256");
    claims.shipping_mapping_record_sha256 = shippingMapping.sha256;
    const labelMediaReview = writeIndexedJson(
      `${sourceProduct.handle}-label-media-review`,
      `${sourceProduct.handle}-label-media-review.json`,
      {
        schema_version: 1,
        record_type: "mochirii-private-label-media-review",
        handle: sourceProduct.handle,
        formula_identity_sha256: catalogRecord.formula_identity_sha256,
        reviewed_at: CAPTURED_AT,
        canonical_emblem_sha256: PREPAYMENT_GATE_POLICY.canonical_emblem_sha256,
        wordmark: PREPAYMENT_GATE_POLICY.wordmark,
        media: sourceProduct.facts.media.map((media) => {
          const identity = `${media.role}\u0000${media.public_reference}`;
          return {
            role: media.role,
            public_reference: media.public_reference,
            source_image_sha256: media.asset_sha256,
            ocr_output_sha256: claims.ocr_output_sha256_by_identity.get(identity) ?? null,
            inspection: { ...SYNTHETIC_IMAGE_METADATA },
            legible: true,
            approved_unit_match: true,
            emblem_comparison: {
              canonical_emblem_sha256: PREPAYMENT_GATE_POLICY.canonical_emblem_sha256,
              source_image_sha256: media.asset_sha256,
              match: true,
            },
            emblem_matches: true,
            wordmark_matches: true,
            other_brand_absent: true,
            fact_hashes: privateLabelFactHashes(sourceProduct, media.role),
            ocr_comparisons: privateOcrComparisons(sourceProduct, media.role).map((comparison) => ({
              field: comparison.field,
              expected_normalized_sha256: comparison.normalized_sha256,
              observed_normalized_sha256: comparison.normalized_sha256,
              match: true,
            })),
          };
        }),
      },
    );
    bind(labelMediaReview, "product", sourceProduct.handle, "label_media_review_record_sha256");
    claims.label_media_review_record_sha256 = labelMediaReview.sha256;
    productArtifactClaims.set(sourceProduct.handle, claims);
  }

  const authenticationArtifact = writeIndexedJson(
    "pricing-authentication-evidence",
    "pricing-authentication-evidence.json",
    authenticationEvidenceRecord,
  );
  const accountPlanArtifact = writeIndexedJson(
    "pricing-connected-account-plan",
    "pricing-connected-account-plan.json",
    connectedAccountPlanRecord,
  );
  const catalogSnapshotBuffer = readFileSync(
    path.join(repositoryRoot, ...catalogSnapshotRelativePath.split("/")),
  );
  const catalogSnapshotArtifact = {
    artifact_id: "pricing-catalog-snapshot",
    artifact_path: catalogSnapshotRelativePath,
    hash_mode: "canonical-json-v1",
    sha256: contractSha(catalogSnapshot),
    size_bytes: catalogSnapshotBuffer.length,
    content_type: "application/json",
  };
  artifactIndex.artifacts.push(catalogSnapshotArtifact);
  bind(authenticationArtifact, "pricing", null, "authentication_evidence_sha256");
  bind(accountPlanArtifact, "pricing", null, "connected_account_plan_record_sha256");
  bind(catalogSnapshotArtifact, "pricing", null, "snapshot_sha256");
  const providerReadback = providerSurfaceReadback(sourceContracts.providerSurfaces, packageSha);
  const providerReadbackArtifact = writeIndexedJson(
    "provider-surface-readback",
    "provider-surface-readback.json",
    providerReadback,
  );
  bind(providerReadbackArtifact, "provider-surface", null, "readback_sha256");

  const bundle = {
    schema_version: 2,
    gate: PREPAYMENT_GATE_POLICY.gate,
    captured_at: CAPTURED_AT,
    market: { country: "US", currency: "USD" },
    source: {
      captured_at: CAPTURED_AT,
      repository: PREPAYMENT_GATE_POLICY.repository,
      branch: "main",
      commit_sha: COMMIT_SHA,
      tree_sha: TREE_SHA,
      pull_request_merged: true,
      protected_main: true,
      accountable_human_review: true,
      required_checks_passed: true,
      package_sha256: packageSha,
      source_evidence_ref: "source-readback",
      package_evidence_ref: "theme-package",
    },
    candidate_theme: {
      captured_at: CAPTURED_AT,
      theme_id: "141514408011",
      status: "Draft",
      checkout_cta_enabled: false,
      password_protected: true,
      published: false,
      dedicated_hero_pass: true,
      controlled_social_image_pass: true,
      wordmark: PREPAYMENT_GATE_POLICY.wordmark,
      storefront_emblem_asset: PREPAYMENT_GATE_POLICY.storefront_emblem_asset,
      storefront_emblem_sha256: PREPAYMENT_GATE_POLICY.storefront_emblem_sha256,
      source_commit_sha: COMMIT_SHA,
      source_tree_sha: TREE_SHA,
      package_sha256: packageSha,
      evidence_ref: "candidate-theme-readback",
    },
    rendered_routes: {
      captured_at: CAPTURED_AT,
      status: "pass",
      results: REQUIRED_RENDERED_ROUTE_CATEGORIES.map((category) => ({
        category,
        checked_route_count: category === "products" ? 20 : category === "collections" ? 5 :
          category === "search-and-filters" ? 7 : category === "policies-and-privacy" ? 5 :
            category === "errors" ? 2 : category === "notifications" ? 3 : 1,
        http_pass: true,
        readback_pass: true,
      })),
      search_queries: [...REQUIRED_SEARCH_QUERIES],
      search_contract_revision: sourceContracts.searchExpectations.revision,
      search_contract_sha256: contractSha(sourceContracts.searchExpectations),
      sold_out_fixture_pass: true,
      zero_result_pass: true,
      server_error_pass: true,
      evidence_ref: "rendered-route-readback",
    },
    product_review: {
      captured_at: CAPTURED_AT,
      status: "pass",
      product_facts_schema_version: 3,
      product_facts_revision: sourceContracts.productFacts.revision,
      product_facts_sha256: contractSha(sourceContracts.productFacts),
      canonical_emblem: {
        asset_path: PREPAYMENT_GATE_POLICY.canonical_emblem_asset,
        sha256: PREPAYMENT_GATE_POLICY.canonical_emblem_sha256,
      },
      storefront_emblem: {
        asset_path: PREPAYMENT_GATE_POLICY.storefront_emblem_asset,
        sha256: PREPAYMENT_GATE_POLICY.storefront_emblem_sha256,
      },
      wordmark: "Mochirii Cosmetics",
      products: EXPECTED_PRODUCT_HANDLES.map((handle, index) => ({
        handle,
        product_record_id: `gid://shopify/Product/${1000 + index}`,
        variant_record_id: `gid://shopify/ProductVariant/${2000 + index}`,
        active: true,
        facts_pass: true,
        formula_mapping_pass: true,
        front_label_pass: true,
        technical_panel_pass: true,
        outer_box_pass: true,
        media_pass: true,
        emblem_pass: true,
        wordmark_pass: true,
        other_brand_absent_pass: true,
      })),
      evidence_ref: "product-review",
    },
    private_price: {
      catalog_readback_captured_at: CAPTURED_AT,
      ledger_captured_at: CAPTURED_AT,
      shopify_readback_captured_at: CAPTURED_AT,
      status: "pass",
      rule: "exact-2.20x-round-half-up",
      active_variant_count: 20,
      ledger_evidence_ref: "private-price-ledger",
      shopify_readback_evidence_ref: "private-price-shopify-readback",
      report_evidence_ref: "private-price-report",
    },
    launch_pages: {
      captured_at: CAPTURED_AT,
      status: "pass",
      content_revision: "2026-07-19-v1",
      content_contract_sha256: contractSha(sourceContracts.launchPages),
      applied_page_handles: ["faq", "ingredients-standards", "accessibility"],
      readback_pass: true,
      provider_write_authority: false,
      evidence_ref: "launch-pages-readback",
    },
    provider_surfaces: {
      captured_at: CAPTURED_AT,
      status: "pass",
      schema_version: sourceContracts.providerSurfaces.schema_version,
      revision: sourceContracts.providerSurfaces.revision,
      source_contract_sha256: providerSurfaceContractSha256(sourceContracts.providerSurfaces),
      readback_sha256: contractSha(providerReadback),
      readback_pass: true,
      evidence_ref: "provider-surface-readback",
    },
    mandatory_name_review: {
      captured_at: CAPTURED_AT,
      status: "pass",
      reviewed_route_categories: [...REQUIRED_RENDERED_ROUTE_CATEGORIES],
      exception_register_revision: sourceContracts.mandatoryNames.revision,
      exception_register_sha256: contractSha(sourceContracts.mandatoryNames),
      exception_register_reviewed: true,
      rendered_review_pass: true,
      unreviewed_name_count: 0,
      evidence_ref: "mandatory-name-review",
    },
    fulfillment_shipping: {
      captured_at: CAPTURED_AT,
      status: "pass",
      exact_20_mappings: true,
      stock_sync_enabled: true,
      shopify_inventory_tracking_disabled: true,
      intended_location_only: true,
      contiguous_us_only: true,
      shipping_rates_verified: true,
      unsupported_regions_verified: true,
      po_box_behavior_verified: true,
      policy_parity_verified: true,
      evidence_ref: "fulfillment-shipping-readback",
    },
    operational_gates: {
      product_compliance: operationalGate(OPERATIONAL_ASSERTIONS.product_compliance, "operations-readback"),
      tax: operationalGate(["nexus_review_complete", "configuration_readback_pass"], "operations-readback"),
      privacy: operationalGate(
        [
          "policy_review_complete",
          "consent_review_complete",
          "marketing_consent_review_complete",
          "network_intelligence_disclosure_review_complete",
          "privacy_choices_verified",
        ],
        "operations-readback",
      ),
      apps: operationalGate(
        ["permissions_review_complete", "pixel_inventory_review_complete", "unapproved_apps_absent"],
        "operations-readback",
      ),
      email: operationalGate(
        ["sender_domain_authenticated", "customer_notifications_reviewed", "notification_language_reviewed"],
        "operations-readback",
      ),
      domains: operationalGate(
        ["canonical_domain_verified", "legacy_domain_disposition_complete"],
        "operations-readback",
      ),
      account_security: operationalGate(
        [
          "owner_2fa_verified",
          "staff_2fa_verified",
          "access_review_complete",
          "customer_accounts_configuration_reviewed",
        ],
        "operations-readback",
      ),
      safety_operations: operationalGate(OPERATIONAL_ASSERTIONS.safety_operations, "operations-readback"),
      gift_cards: operationalGate(OPERATIONAL_ASSERTIONS.gift_cards, "operations-readback"),
    },
    quality_assurance: {
      captured_at: CAPTURED_AT,
      status: "pass",
      keyboard_pass: true,
      focus_pass: true,
      escape_pass: true,
      touch_pass: true,
      zoom_reflow_200_pass: true,
      nvda_chrome_pass: true,
      voiceover_safari_pass: true,
      automated_accessibility_critical: 0,
      automated_accessibility_serious: 0,
      responsive_viewports: ["360x800", "390x844", "768x1024", "1440x900"],
      lighthouse: ["home", "collection", "product", "cart"].map((routeType) => ({
        route_type: routeType,
        accessibility: 95,
        best_practices: 95,
        seo: 95,
        mobile_performance: 85,
      })),
      evidence_ref: "accessibility-performance-readback",
    },
    final_phase_exclusions: {
      payment_setup_completed: false,
      checkout_activated: false,
      theme_published: false,
      password_removed: false,
      orders_created: false,
    },
    artifact_index_evidence_ref: "artifact-index",
    evidence_files: [],
  };

  const searchResults = [
    ...sourceContracts.searchExpectations.queries.map((item) => [item.query, item.expected_handles]),
    ["mochirii-zero-result-fixture", []],
  ].map(([query, handles]) => ({
    query,
    expected_handles: handles,
    actual_handles: [...handles],
    zero_result_expected: handles.length === 0,
    observed_at: CAPTURED_AT,
    result_page_sha256: sha256(Buffer.from(renderedCustomerBody("search-and-filters", `search:${query}`), "utf8")),
  }));

  const renderedTargets = routeTargets(searchResults.map((item) => item.query));
  const mandatoryNameScanShaByCategory = new Map();
  for (const category of REQUIRED_RENDERED_ROUTE_CATEGORIES) {
    const categoryTargets = renderedTargets.filter((target) => target.category === category);
    const scan = {
      schema_version: 1,
      record_type: "mochirii-private-rendered-body-scan",
      category,
      captured_at: CAPTURED_AT,
      reviewer_id: "reviewer-mandatorynamereview",
      targets: categoryTargets.map((target, index) => ({
        order: index + 1,
        identity: target.identity,
        target: target.target,
        content_sha256: target.content_sha256,
        normalized_body: renderedCustomerBody(target.category, target.identity),
        detected_third_party_names: [],
      })),
      unreviewed_name_count: 0,
    };
    const artifact = writeIndexedJson(
      `mandatory-name-${category}`,
      `mandatory-name-${category}.json`,
      scan,
    );
    bind(artifact, "mandatory-name", category, "scan_sha256");
    mandatoryNameScanShaByCategory.set(category, artifact.sha256);
  }

  const evidenceDocuments = new Map([
    ["artifact-index", evidenceDocument("artifact-index", artifactIndex)],
    ["source-readback", evidenceDocument("source-readback", {
      repository: PREPAYMENT_GATE_POLICY.repository,
      branch: "main",
      commit_sha: COMMIT_SHA,
      tree_sha: TREE_SHA,
      pull_request_number: 481,
      pull_request_author_id: "store-owner",
      pull_request_head_sha: HEAD_SHA,
      merged_at: CAPTURED_AT,
      merge_commit_sha: COMMIT_SHA,
      branch_protected: true,
      approvals: [{ reviewer_id: "accountable-reviewer", state: "APPROVED", submitted_at: CAPTURED_AT, head_sha: HEAD_SHA }],
      required_checks: PREPAYMENT_GATE_POLICY.required_checks.map((name) => ({
        name,
        conclusion: "SUCCESS",
        completed_at: CAPTURED_AT,
        head_sha: COMMIT_SHA,
      })),
    })],
    ["theme-package", evidenceDocument("theme-package", {
      package_path: packageRelativePath,
      package_sha256: packageSha,
      size_bytes: packageBuffer.length,
      active_source_manifest_sha256: contractSha(sourceContracts.activeSourceManifest),
      runtime_file_count: sourceContracts.activeSourceManifest.files.length,
      source_commit_sha: COMMIT_SHA,
      source_tree_sha: TREE_SHA,
      candidate_theme_id: PREPAYMENT_GATE_POLICY.candidate_theme_id,
    })],
    ["candidate-theme-readback", evidenceDocument("candidate-theme-readback", {
      readback_source: "authenticated-shopify-admin",
      theme_name: "Mochirii Cosmetics 0.6.0 candidate",
      ...Object.fromEntries(Object.entries(bundle.candidate_theme).filter(([key]) => !["captured_at", "evidence_ref"].includes(key))),
    })],
    ["rendered-route-readback", evidenceDocument("rendered-route-readback", {
      theme_id: PREPAYMENT_GATE_POLICY.candidate_theme_id,
      source_commit_sha: COMMIT_SHA,
      source_tree_sha: TREE_SHA,
      package_sha256: packageSha,
      search_contract_revision: sourceContracts.searchExpectations.revision,
      search_contract_sha256: contractSha(sourceContracts.searchExpectations),
      targets: renderedTargets,
      search_results: searchResults,
      sold_out_fixture: {
        handle: "fixture-sold-out-product",
        expected_availability: "out-of-stock",
        actual_availability: "out-of-stock",
        fixture_unpublished: true,
        observed_at: CAPTURED_AT,
        content_sha256: artifactSha("sold-out-fixture"),
      },
      server_error_fixture: {
        expected_http_status: 500,
        actual_http_status: 500,
        branded_error_copy_pass: true,
        observed_at: CAPTURED_AT,
        content_sha256: sha256(Buffer.from(renderedCustomerBody("errors", "server-error"), "utf8")),
      },
    })],
    ["product-review", evidenceDocument("product-review", {
      product_facts_schema_version: bundle.product_review.product_facts_schema_version,
      product_facts_revision: bundle.product_review.product_facts_revision,
      product_facts_sha256: bundle.product_review.product_facts_sha256,
      canonical_emblem: bundle.product_review.canonical_emblem,
      storefront_emblem: bundle.product_review.storefront_emblem,
      wordmark: bundle.product_review.wordmark,
      readback_source: "authenticated-shopify-admin-graphql",
      admin_api_version: "2026-07",
      products: (() => {
        const productIdByHandle = new Map(bundle.product_review.products
          .map((product) => [product.handle, product.product_record_id]));
        return bundle.product_review.products.map((product, productIndex) => {
          const sourceProduct = sourceContracts.productFacts.products
            .find((item) => item.handle === product.handle);
          const artifactClaims = productArtifactClaims.get(product.handle);
          return {
            ...product,
            formula_identity_sha256: catalogRecordByHandle.get(product.handle).formula_identity_sha256,
            formula_record_sha256: artifactClaims.formula_record_sha256,
            facts_record_sha256: contractSha(sourceProduct),
            front_label_sha256: artifactClaims.front_label_sha256,
            technical_panel_sha256: artifactClaims.technical_panel_sha256,
            outer_box_sha256: artifactClaims.outer_box_sha256,
            label_media_review_record_sha256: artifactClaims.label_media_review_record_sha256,
            media_records: sourceProduct.facts.media.map((media) => ({
              role: media.role,
              public_reference: media.public_reference,
              alt_text: media.alt_text,
              artifact_sha256: media.asset_sha256,
              ocr_output_sha256: artifactClaims.ocr_output_sha256_by_identity
                .get(`${media.role}\u0000${media.public_reference}`) ?? null,
            })),
            shopify_readback: shopifyProductReadback(
              sourceProduct,
              product,
              productIndex,
              productIdByHandle,
            ),
            reviewed_at: CAPTURED_AT,
          };
        });
      })(),
    })],
    ["private-price-ledger", evidenceDocument("private-price-ledger", { ledger })],
    ["private-price-shopify-readback", evidenceDocument("private-price-shopify-readback", {
      shopify_readback: shopifyReadback,
    })],
    ["private-price-report", evidenceDocument("private-price-report", { report })],
    ["launch-pages-readback", evidenceDocument("launch-pages-readback", {
      content_revision: bundle.launch_pages.content_revision,
      content_contract_sha256: bundle.launch_pages.content_contract_sha256,
      pages: sourceContracts.launchPages.pages.map((page) => ({
        ...page,
        route: `/pages/${page.handle}`,
        content_sha256: contractSha(page),
        http_status: 200,
        readback_at: CAPTURED_AT,
      })),
      provider_write_authority: false,
    })],
    ["provider-surface-readback", evidenceDocument("provider-surface-readback", {
      source_contract_schema_version: bundle.provider_surfaces.schema_version,
      source_contract_revision: bundle.provider_surfaces.revision,
      source_contract_sha256: bundle.provider_surfaces.source_contract_sha256,
      readback_sha256: bundle.provider_surfaces.readback_sha256,
    })],
    ["mandatory-name-review", evidenceDocument("mandatory-name-review", {
      route_reviews: bundle.rendered_routes.results.map((result) => ({
        category: result.category,
        target_count: result.checked_route_count,
        unreviewed_name_count: 0,
        scan_sha256: mandatoryNameScanShaByCategory.get(result.category),
        reviewed_at: CAPTURED_AT,
      })),
      exception_register_revision: bundle.mandatory_name_review.exception_register_revision,
      exception_register_sha256: bundle.mandatory_name_review.exception_register_sha256,
      exceptions: structuredClone(sourceContracts.mandatoryNames.entries),
    })],
    ["fulfillment-shipping-readback", evidenceDocument("fulfillment-shipping-readback", {
      supplier_weight_readback_source: "authenticated-manufacturing-partner-product-mapping",
      shopify_weight_readback_source: "authenticated-shopify-admin-product-variants",
      shopify_admin_api_version: "2026-07",
      products: bundle.product_review.products.map((product) => ({
        handle: product.handle,
        product_record_id: product.product_record_id,
        variant_record_id: product.variant_record_id,
        mapping_record_sha256:
          productArtifactClaims.get(product.handle).shipping_mapping_record_sha256,
        supplier_expected_weight_grams: 1,
        shopify_actual_weight_grams: 1,
        stock_sync_status: "enabled",
        inventory_tracking: "disabled",
        location_assignment_status: "intended-route-only",
      })),
      shipping_cases: shippingMatrixArtifact.cases.map((matrixCase) => ({
        case_id: matrixCase.case_id,
        destination_country: matrixCase.destination_country,
        destination_region: matrixCase.destination_region,
        destination_postal_code: matrixCase.destination_postal_code,
        address_type: matrixCase.address_type,
        cart_lines: structuredClone(matrixCase.cart_lines),
        cart_weight_grams: matrixCase.cart_weight_grams,
        expected_eligible: matrixCase.eligible,
        actual_eligible: matrixCase.eligible,
        expected_currency: matrixCase.eligible ? "USD" : null,
        actual_currency: matrixCase.eligible ? "USD" : null,
        expected_rate_usd: matrixCase.supplier_rate_usd,
        actual_rate_usd: matrixCase.supplier_rate_usd,
        rate_calculation: "weight-based-supplier-cost-pass-through",
        configuration_sha256: shopifyRateTableSha256,
        supplier_matrix_case_sha256: matrixCase.source_record_sha256,
        observed_at: CAPTURED_AT,
      })),
      tier_threshold_observations: tierThresholdObservations,
      policy_sha256: artifactSha("shipping-policy"),
      supplier_matrix: {
        authenticated_source: "authenticated-manufacturing-partner-us-shipping-matrix",
        captured_at: CAPTURED_AT,
        market: "US",
        policy_scope: "contiguous-us-only",
        rate_calculation: "weight-based-supplier-cost-pass-through",
        free_shipping_threshold_usd: null,
        artifact_path: shippingMatrixRelativePath,
        artifact_sha256: contractSha(shippingMatrixArtifact),
        po_box_eligible: true,
        po_box_carrier_response_sha256: artifactSha("po-box-carrier-response"),
      },
      shopify_rate_table: {
        authenticated_source: "authenticated-shopify-admin-shipping-rate-table",
        captured_at: CAPTURED_AT,
        admin_api_version: "2026-07",
        market: "US",
        currency: "USD",
        rate_calculation: "weight-based-supplier-cost-pass-through",
        artifact_path: shopifyRateTableRelativePath,
        artifact_sha256: shopifyRateTableSha256,
      },
    })],
    ["operations-readback", evidenceDocument("operations-readback", {
      controls: Object.entries(OPERATIONAL_ASSERTIONS)
        .filter(([section]) => !["product_compliance", "safety_operations", "gift_cards"].includes(section))
        .flatMap(([section, assertions]) => assertions.map((assertion) => ({
          id: `${section}.${assertion}`,
          status: "pass",
          owner_id: `owner-${section.replaceAll("_", "")}`,
          reviewer_id: `reviewer-${section.replaceAll("_", "")}`,
          reviewed_at: CAPTURED_AT,
          record_sha256: artifactSha(`control:${section}:${assertion}`),
          product_handles: [],
        }))),
      product_compliance_records: EXPECTED_PRODUCT_HANDLES.map((handle, index) => ({
        handle,
        responsible_person_record_sha256: artifactSha(`responsible-person:${handle}`),
        safety_substantiation_record_sha256: artifactSha(`safety-substantiation:${handle}`),
        facility_disposition: index % 2 === 0 ? "registered" : "reviewed-exemption",
        facility_registration_or_exemption_record_sha256: artifactSha(`facility-disposition:${handle}`),
        product_listing_disposition: index % 2 === 0 ? "listed" : "reviewed-exemption",
        product_listing_or_exemption_record_sha256: artifactSha(`product-listing:${handle}`),
        renewal_disposition: index % 2 === 0 ? "current" : "not-applicable-reviewed",
        change_reporting_disposition: "reviewed",
        claim_surface_categories: ["storefront", "packaging", "reviews", "social", "promotional"],
        claim_inventory_sha256: artifactSha(`claim-inventory:${handle}`),
        classification: "cosmetic",
        reviewed_at: CAPTURED_AT,
      })),
      safety_operations_record: {
        runbooks: [
          "complaint-intake",
          "product-quality",
          "serious-adverse-event",
          "recall",
          "retention",
          "escalation",
          "reporting",
        ].map((id) => ({
          id,
          status: "approved",
          owner_id: `safety-owner-${id}`,
          reviewer_id: "compliance-reviewer-01",
          reviewed_at: CAPTURED_AT,
          record_sha256: artifactSha(`runbook:${id}`),
        })),
        notification_language: ["safety", "fulfillment", "privacy", "payment"].map((category) => ({
          category,
          status: "approved",
          owner_id: `incident-owner-${category}`,
          reviewer_id: "compliance-reviewer-01",
          approved_at: CAPTURED_AT,
          content_sha256: artifactSha(`incident-language:${category}`),
        })),
        trained_owner_ids: [
          "complaint-intake",
          "product-quality",
          "serious-adverse-event",
          "recall",
          "retention",
          "escalation",
          "reporting",
        ].map((id) => `safety-owner-${id}`).concat(
          ["safety", "fulfillment", "privacy", "payment"].map((category) => `incident-owner-${category}`),
        ),
        training_record_sha256: artifactSha("safety-training"),
      },
      gift_card_readback: {
        authenticated_source: "authenticated-shopify-admin",
        captured_at: CAPTURED_AT,
        theme_id: PREPAYMENT_GATE_POLICY.candidate_theme_id,
        settings: {
          enabled: false,
          readback_sha256: artifactSha("gift-card-settings"),
        },
        provider_listing: {
          expected_count: 0,
          actual_count: 0,
          listed: false,
          readback_sha256: artifactSha("gift-card-provider-listing"),
        },
        route: {
          path: "/products/gift-card",
          expected_http_status: 404,
          actual_http_status: 404,
          observed_at: CAPTURED_AT,
          content_sha256: artifactSha("gift-card-route"),
        },
      },
      privacy_choices_readback: {
        authenticated_source: "authenticated-shopify-admin",
        configured: true,
        menu_visible: true,
        path: "/pages/data-sharing-opt-out",
        observed_at: CAPTURED_AT,
        readback_sha256: artifactSha("privacy-choices-readback"),
      },
    })],
    ["accessibility-performance-readback", evidenceDocument("accessibility-performance-readback", {
      manual_tests: ["keyboard", "focus", "escape", "touch", "zoom-reflow-200", "nvda-chrome", "voiceover-safari"]
        .map((id) => ({ id, status: "pass", observed_at: CAPTURED_AT, artifact_sha256: artifactSha(`manual:${id}`) })),
      automated_accessibility: ["home", "collection", "product", "cart"].map((routeType) => ({
        route_type: routeType,
        critical: 0,
        serious: 0,
        observed_at: CAPTURED_AT,
        report_sha256: artifactSha(`accessibility:${routeType}`),
      })),
      responsive_viewports: bundle.quality_assurance.responsive_viewports.map((viewport) => ({
        viewport,
        status: "pass",
        observed_at: CAPTURED_AT,
        screenshot_sha256: artifactSha(`viewport:${viewport}`),
      })),
      lighthouse: bundle.quality_assurance.lighthouse.map((item) => ({
        ...item,
        observed_at: CAPTURED_AT,
        report_sha256: artifactSha(`lighthouse:${item.route_type}`),
      })),
    })],
  ]);

  for (const kind of REQUIRED_EVIDENCE_KINDS) {
    const relativePath = `${relativeDirectory}/${kind}.json`;
    const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
    writeFileSync(absolutePath, `${JSON.stringify(evidenceDocuments.get(kind), null, 2)}\n`);
    const buffer = readFileSync(absolutePath);
    bundle.evidence_files.push({ id: kind, kind, path: relativePath, sha256: sha256(buffer) });
  }
  const bundlePath = path.join(directory, "prepayment-evidence-bundle.json");
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return {
    bundle,
    bundlePath,
    evidenceDocuments,
    packagePath,
    shippingMatrixPath: path.join(repositoryRoot, ...shippingMatrixRelativePath.split("/")),
    shopifyRateTablePath: path.join(repositoryRoot, ...shopifyRateTableRelativePath.split("/")),
    sourceContracts,
    productArtifactClaims,
  };
}

function rewriteEvidence(fixture, kind, mutate) {
  const entry = fixture.bundle.evidence_files.find((item) => item.kind === kind);
  const absolute = path.join(repositoryRoot, ...entry.path.split("/"));
  const document = structuredClone(fixture.evidenceDocuments.get(kind));
  const updated = typeof mutate === "function" ? (mutate(document) ?? document) : mutate;
  const content = typeof updated === "string" ? updated : `${JSON.stringify(updated, null, 2)}\n`;
  writeFileSync(absolute, content);
  entry.sha256 = sha256(readFileSync(absolute));
}

function mutateIndexedJsonArtifact(fixture, artifactId, mutate) {
  const indexDocument = fixture.evidenceDocuments.get("artifact-index");
  const artifact = indexDocument.claim.artifacts.find((item) => item.artifact_id === artifactId);
  assert.ok(artifact, artifactId);
  const absolute = path.join(repositoryRoot, ...artifact.artifact_path.split("/"));
  const value = JSON.parse(readFileSync(absolute, "utf8"));
  const updated = mutate(value) ?? value;
  writeFileSync(absolute, `${JSON.stringify(updated, null, 2)}\n`);
  artifact.sha256 = contractSha(updated);
  artifact.size_bytes = readFileSync(absolute).length;
  return { artifact, value: updated };
}

function privateReviewProduct(fixture, handle) {
  const product = fixture.evidenceDocuments.get("product-review").claim.products
    .find((item) => item.handle === handle);
  assert.ok(product, handle);
  return product;
}

function persistPrivateEvidenceGraph(fixture) {
  rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
  rewriteEvidence(fixture, "product-review", fixture.evidenceDocuments.get("product-review"));
}

function mutateFormulaAndRebind(fixture, handle, mutate) {
  const result = mutateIndexedJsonArtifact(fixture, `${handle}-formula-record`, mutate);
  privateReviewProduct(fixture, handle).formula_record_sha256 = result.artifact.sha256;
  return result;
}

function mutateLabelReviewAndRebind(fixture, handle, mutate) {
  const result = mutateIndexedJsonArtifact(fixture, `${handle}-label-media-review`, mutate);
  privateReviewProduct(fixture, handle).label_media_review_record_sha256 = result.artifact.sha256;
  return result;
}

function mutateOcrAndRebind(fixture, handle, role, mutate) {
  const sourceMedia = fixture.sourceContracts.productFacts.products
    .find((product) => product.handle === handle).facts.media
    .find((media) => media.role === role);
  const ocr = mutateIndexedJsonArtifact(fixture, `${handle}-${role}-ocr`, mutate);
  const product = privateReviewProduct(fixture, handle);
  product.media_records.find((media) =>
    media.role === role && media.public_reference === sourceMedia.public_reference)
    .ocr_output_sha256 = ocr.artifact.sha256;
  mutateLabelReviewAndRebind(fixture, handle, (review) => {
    review.media.find((media) =>
      media.role === role && media.public_reference === sourceMedia.public_reference)
      .ocr_output_sha256 = ocr.artifact.sha256;
  });
  return ocr;
}

function mutateShippingMappingAndRebind(fixture, handle, mutate) {
  const result = mutateIndexedJsonArtifact(fixture, `${handle}-shipping-mapping`, mutate);
  rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
  rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
    document.claim.products.find((product) => product.handle === handle)
      .mapping_record_sha256 = result.artifact.sha256;
  });
  return result;
}

function writeRateTableAndRebindConfiguration(fixture, rateTable) {
  writeFileSync(fixture.shopifyRateTablePath, `${JSON.stringify(rateTable, null, 2)}\n`);
  const configurationSha256 = contractSha(rateTable);
  rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
    document.claim.shopify_rate_table.artifact_sha256 = configurationSha256;
    for (const shippingCase of document.claim.shipping_cases) {
      shippingCase.configuration_sha256 = configurationSha256;
    }
    for (const observation of document.claim.tier_threshold_observations) {
      observation.configuration_sha256 = configurationSha256;
    }
  });
}

function writeSupplierMatrixAndRebind(fixture, supplierMatrix) {
  writeFileSync(fixture.shippingMatrixPath, `${JSON.stringify(supplierMatrix, null, 2)}\n`);
  rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
    document.claim.supplier_matrix.artifact_sha256 = contractSha(supplierMatrix);
  });
}

function replaceCandidatePackage(fixture, packageBuffer) {
  writeFileSync(fixture.packagePath, packageBuffer);
  const packageSha256 = sha256(packageBuffer);
  fixture.bundle.source.package_sha256 = packageSha256;
  fixture.bundle.candidate_theme.package_sha256 = packageSha256;
  rewriteEvidence(fixture, "theme-package", (document) => {
    document.claim.package_sha256 = packageSha256;
    document.claim.size_bytes = packageBuffer.length;
  });
  rewriteEvidence(fixture, "candidate-theme-readback", (document) => {
    document.claim.package_sha256 = packageSha256;
  });
  rewriteEvidence(fixture, "rendered-route-readback", (document) => {
    document.claim.package_sha256 = packageSha256;
  });
}

function withFixture(callback) {
  const directory = mkdtempSync(path.join(artifactsRoot, "prepayment-gate-test-"));
  try {
    callback(buildFixture(directory), directory);
  } finally {
    const realArtifacts = path.resolve(artifactsRoot);
    const realDirectory = path.resolve(directory);
    assert.equal(realDirectory.startsWith(`${realArtifacts}${path.sep}`), true);
    rmSync(realDirectory, { recursive: true, force: true });
  }
}

function validate(bundle, bundlePath, now = NOW, sourceContracts = fixtureSourceContracts(), extraOptions = {}) {
  return validatePrepaymentEvidenceBundle(bundle, {
    repositoryRoot,
    bundlePath,
    now,
    sourceContracts,
    enforceRepositorySource: false,
    artifactGitPathStatus: () => ({ tracked: false, ignored: true }),
    artifactImageInspector: () => ({ ...SYNTHETIC_IMAGE_METADATA }),
    ...extraOptions,
  });
}

test("a fully synthetic ignored evidence bundle satisfies the aggregate prepayment gate", () => {
  withFixture(({ bundle, bundlePath, sourceContracts }) => {
    const result = validate(bundle, bundlePath, NOW, sourceContracts);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.issues, []);
  });
});

test("aggregate provider artifact binds exact navigation, logos, homepage, collections, domains, and sender state", () => {
  withFixture((fixture) => {
    const mutation = mutateIndexedJsonArtifact(fixture, "provider-surface-readback", (readback) => {
      readback.navigation.observed.header.reverse();
      readback.navigation.observed_sha256 = providerCanonicalSha256(readback.navigation.observed);
      readback.brand_identity.provider_logo_readbacks[0].selected_asset_sha256 =
        readback.brand_identity.canonical_reference_sha256;
      readback.homepage.hero_image_alt = "";
      readback.homepage.featured_product_handles.reverse();
      readback.collections.items[0].product_handles.reverse();
      readback.domains.shop_url = "https://legacy.example";
      readback.domains.observed_sha256 = providerCanonicalSha256(Object.fromEntries(
        Object.entries(readback.domains).filter(([key]) => !["scope", "observed_sha256"].includes(key)),
      ));
      readback.notifications.sender.authenticated = false;
      readback.notifications.sender.readback_sha256 = providerCanonicalSha256(Object.fromEntries(
        Object.entries(readback.notifications.sender).filter(([key]) => key !== "readback_sha256"),
      ));
    });
    fixture.bundle.provider_surfaces.readback_sha256 = mutation.artifact.sha256;
    rewriteEvidence(fixture, "provider-surface-readback", (document) => {
      document.claim.readback_sha256 = mutation.artifact.sha256;
    });
    rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "readback.navigation.readback.exact-parity",
      "readback.brand-identity.provider-logo.configurable-parity",
      "readback.homepage.readback.hero-image-alt",
      "readback.homepage.readback.featured-products",
      "readback.collections.readback.membership-parity",
      "readback.domains.readback.exact-parity",
      "readback.notifications.readback.sender-parity",
    ]) assert.equal(result.issues.some((issue) => issue.gate === "provider-surfaces" && issue.category === category), true, category);
  });
});

test("provider source and private binding fail closed when missing or malformed", () => {
  withFixture((fixture) => {
    const missingSource = structuredClone(fixture.sourceContracts);
    delete missingSource.providerSurfaces;
    assert.doesNotThrow(() => validate(fixture.bundle, fixture.bundlePath, NOW, missingSource));
    const missingSourceResult = validate(fixture.bundle, fixture.bundlePath, NOW, missingSource);
    assert.equal(missingSourceResult.issues.some((issue) =>
      issue.gate === "provider-surfaces" && issue.category === "source.missing-or-invalid"), true);

    const index = fixture.evidenceDocuments.get("artifact-index").claim;
    index.bindings = index.bindings.filter((binding) => binding.scope !== "provider-surface");
    index.artifacts = index.artifacts.filter((artifact) => artifact.artifact_id !== "provider-surface-readback");
    rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
    const missingBindingResult = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(missingBindingResult.issues.some((issue) =>
      issue.gate === "provider-surfaces" && issue.category === "artifact.missing"), true);
  });
});

test("provider collection membership is the exact product-facts transpose", () => {
  withFixture((fixture) => {
    const sourceContracts = structuredClone(fixture.sourceContracts);
    const first = sourceContracts.providerSurfaces.collections.items[1];
    const second = sourceContracts.providerSurfaces.collections.items[2];
    const moved = first.approved_product_handles.pop();
    second.approved_product_handles.push(moved);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, sourceContracts);
    assert.equal(result.issues.some((issue) => issue.gate === "provider-surfaces" &&
      issue.category === "source.collection-membership-product-facts-parity"), true);
  });
});

test("indexed rendered bodies bind target hashes and reject prohibited private copy without echoing it", () => {
  withFixture((fixture) => {
    const marker = "PrivateRenderedBody941";
    const body = `${marker} back&#101;nd pro&#118;ider Shop&#105;fy cal&#109; healing skin. &concealedcopy;`;
    const bodySha = sha256(Buffer.from(body, "utf8"));
    const mutation = mutateIndexedJsonArtifact(fixture, "mandatory-name-accounts", (scan) => {
      scan.targets[0].normalized_body = body;
      scan.targets[0].content_sha256 = bodySha;
    });
    rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
    rewriteEvidence(fixture, "mandatory-name-review", (document) => {
      document.claim.route_reviews.find((review) => review.category === "accounts").scan_sha256 = mutation.artifact.sha256;
    });
    rewriteEvidence(fixture, "rendered-route-readback", (document) => {
      document.claim.targets.find((target) => target.category === "accounts").content_sha256 = bodySha;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "evidence.route-body.system-language",
      "evidence.route-body.mood-only-language",
      "evidence.route-body.unsupported-claim",
      "evidence.route-body.third-party-name",
      "evidence.route-body.unresolved-html-entity",
    ]) assert.equal(result.issues.some((issue) => issue.gate === "mandatory-name-review" && issue.category === category), true, category);
    assert.equal(JSON.stringify(result.issues).includes(marker), false);
  });
});

test("unknown third-party names cannot be omitted or left without an exact reviewed exception", () => {
  for (const detectedNames of [[], ["Acme Labs"]]) {
    withFixture((fixture) => {
      const body = "Product information supplied by Acme Labs.";
      const bodySha = sha256(Buffer.from(body, "utf8"));
      const mutation = mutateIndexedJsonArtifact(fixture, "mandatory-name-accounts", (scan) => {
        scan.targets[0].normalized_body = body;
        scan.targets[0].content_sha256 = bodySha;
        scan.targets[0].detected_third_party_names = detectedNames;
      });
      rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
      rewriteEvidence(fixture, "mandatory-name-review", (document) => {
        document.claim.route_reviews.find((review) => review.category === "accounts").scan_sha256 = mutation.artifact.sha256;
      });
      rewriteEvidence(fixture, "rendered-route-readback", (document) => {
        document.claim.targets.find((target) => target.category === "accounts").content_sha256 = bodySha;
      });
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      if (detectedNames.length === 0) {
        assert.equal(result.issues.some((issue) => issue.gate === "mandatory-name-review" &&
          issue.category === "evidence.route-scan-third-party-omission"), true);
      } else {
        assert.equal(result.issues.some((issue) => issue.gate === "mandatory-name-review" &&
          issue.category === "evidence.route-scan-exception-name-set"), true);
      }
      assert.equal(result.issues.some((issue) => issue.gate === "mandatory-name-review" &&
        issue.category === "evidence.route-body.third-party-name"), true);
    });
  }
});

test("mandatory-name scans reject missing bindings and ordered target drift", () => {
  withFixture((fixture) => {
    const mutation = mutateIndexedJsonArtifact(fixture, "mandatory-name-collections", (scan) => {
      scan.targets.reverse();
    });
    rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
    rewriteEvidence(fixture, "mandatory-name-review", (document) => {
      document.claim.route_reviews.find((review) => review.category === "collections").scan_sha256 = mutation.artifact.sha256;
    });
    let result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.issues.some((issue) => issue.gate === "mandatory-name-review" &&
      ["evidence.route-scan-order", "evidence.route-scan-identity"].includes(issue.category)), true);

    const index = fixture.evidenceDocuments.get("artifact-index").claim;
    index.bindings = index.bindings.filter((binding) =>
      !(binding.scope === "mandatory-name" && binding.handle === "home"));
    index.artifacts = index.artifacts.filter((artifact) => artifact.artifact_id !== "mandatory-name-home");
    rewriteEvidence(fixture, "artifact-index", fixture.evidenceDocuments.get("artifact-index"));
    result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.issues.some((issue) => issue.gate === "mandatory-name-review" &&
      issue.category === "evidence.route-scan-artifact.missing"), true);
  });
});

test("every private bundle, envelope, package, snapshot, shipping file, and indexed artifact is Git-contained", () => {
  withFixture((fixture) => {
    const checkedPaths = [];
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts, {
      artifactGitPathStatus: (candidate) => {
        checkedPaths.push(candidate);
        return { tracked: false, ignored: true };
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    const expectedPaths = new Set([
      path.relative(repositoryRoot, fixture.bundlePath).split(path.sep).join("/"),
      ...fixture.bundle.evidence_files.map((entry) => entry.path),
      fixture.evidenceDocuments.get("theme-package").claim.package_path,
      fixture.evidenceDocuments.get("private-price-ledger").claim.ledger.catalog_readback.snapshot_artifact,
      fixture.evidenceDocuments.get("fulfillment-shipping-readback").claim.supplier_matrix.artifact_path,
      fixture.evidenceDocuments.get("fulfillment-shipping-readback").claim.shopify_rate_table.artifact_path,
      ...fixture.evidenceDocuments.get("artifact-index").claim.artifacts.map((entry) => entry.artifact_path),
    ]);
    assert.deepEqual([...checkedPaths].sort(), [...expectedPaths].sort());
    assert.equal(new Set(checkedPaths).size, checkedPaths.length);
    assert.equal(checkedPaths.every((candidate) => candidate.startsWith(".artifacts/operations/") &&
      !candidate.includes("\\")), true);
  });
});

test("the real Git boundary helper accepts the ignored, untracked synthetic evidence tree", () => {
  withFixture((fixture) => {
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts, {
      artifactGitPathStatus: undefined,
    });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  });
});

test("every standalone private file class rejects tracked, unignored, and indeterminate Git state", () => {
  const targets = [
    {
      name: "bundle",
      gate: "evidence",
      category: "bundle",
      pathFor: (fixture) => path.relative(repositoryRoot, fixture.bundlePath).split(path.sep).join("/"),
    },
    {
      name: "evidence envelope",
      gate: "evidence",
      category: "file",
      pathFor: (fixture) => fixture.bundle.evidence_files.find((entry) => entry.kind === "private-price-ledger").path,
    },
    {
      name: "theme package",
      gate: "theme-package",
      category: "artifact",
      pathFor: (fixture) => fixture.evidenceDocuments.get("theme-package").claim.package_path,
    },
    {
      name: "catalog snapshot",
      gate: "private-price",
      category: "catalog-snapshot",
      pathFor: (fixture) => fixture.evidenceDocuments.get("private-price-ledger").claim.ledger.catalog_readback.snapshot_artifact,
    },
    {
      name: "supplier matrix",
      gate: "fulfillment-shipping",
      category: "evidence.supplier-matrix-artifact",
      pathFor: (fixture) => fixture.evidenceDocuments.get("fulfillment-shipping-readback").claim.supplier_matrix.artifact_path,
    },
    {
      name: "Shopify rate table",
      gate: "fulfillment-shipping",
      category: "evidence.shopify-rate-table-path",
      pathFor: (fixture) => fixture.evidenceDocuments.get("fulfillment-shipping-readback").claim.shopify_rate_table.artifact_path,
    },
  ];
  const failures = [
    { suffix: "tracked", status: { tracked: true, ignored: true } },
    { suffix: "not-ignored", status: { tracked: false, ignored: false } },
    { suffix: "git-status", status: null },
    { suffix: "git-status", throws: true },
  ];
  for (const target of targets) {
    for (const failure of failures) {
      withFixture((fixture) => {
        const targetPath = target.pathFor(fixture);
        const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts, {
          artifactGitPathStatus: (candidate) => {
            if (candidate !== targetPath) return { tracked: false, ignored: true };
            if (failure.throws) throw new Error("simulated-git-status-failure");
            return failure.status;
          },
        });
        assert.equal(result.ok, false, `${target.name}:${failure.suffix}`);
        assert.equal(result.issues.some((issue) => issue.gate === target.gate &&
          issue.category === `${target.category}.${failure.suffix}`), true, `${target.name}:${failure.suffix}`);
      });
    }
  }
});

test("private evidence declarations reject Git pathspec and Windows filesystem edge paths", () => {
  for (const unsafePath of [
    ".artifacts/operations/shopify/evidence-[copy].json",
    ".artifacts/operations/shopify/evidence.json:private-stream",
    ".artifacts/operations/shopify/NUL.json",
    ".artifacts/operations/shopify/evidence.json ",
  ]) {
    withFixture((fixture) => {
      fixture.bundle.evidence_files[0].path = unsafePath;
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, unsafePath);
      assert.equal(result.issues.some((issue) => issue.gate === "evidence" && issue.category === "file.path"), true);
    });
  }
});

test("hashed placeholder text cannot masquerade as parsed evidence", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "source-readback", "source-readback evidence placeholder\n");
    const result = validate(fixture.bundle, fixture.bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.gate === "evidence" && issue.category === "file.parse"), true);
    assert.equal(result.issues.some((issue) => issue.gate === "source" && issue.category === "source-evidence.record"), true);
  });
});

test("opaque evidence hashes reject repeated-character placeholders across gates", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "rendered-route-readback", (document) => {
      document.claim.targets[0].content_sha256 = "0".repeat(64);
    });
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.policy_sha256 = "a".repeat(64);
    });
    rewriteEvidence(fixture, "operations-readback", (document) => {
      document.claim.controls[0].record_sha256 = "f".repeat(64);
    });
    rewriteEvidence(fixture, "accessibility-performance-readback", (document) => {
      document.claim.manual_tests[0].artifact_sha256 = "1".repeat(64);
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const [gate, category] of [
      ["rendered-routes", "evidence.target-content-sha"],
      ["fulfillment-shipping", "evidence.policy-sha"],
      ["operational-gates", "evidence.control-record-sha"],
      ["quality-assurance", "evidence.manual-test-sha"],
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === gate && issue.category === category), true, `${gate}:${category}`);
    }
    assert.equal(["0", "a", "f", "1"].some((character) =>
      JSON.stringify(result.issues).includes(character.repeat(64))), false);
  });
});

test("evidence envelopes must remain tied to the candidate source and accountable reviewer", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "candidate-theme-readback", (document) => {
      document.source_commit_sha = "d".repeat(40);
      document.reviewer.reviewer_id = "placeholder";
    });
    const result = validate(fixture.bundle, fixture.bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "evidence-record" && issue.category === "candidate-theme-readback.source-commit-linkage"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "evidence-record" && issue.category === "candidate-theme-readback.reviewer.identity"), true);
  });
});

test("Git object identifiers reject repeated-character SHA-1 placeholders", () => {
  withFixture((fixture) => {
    fixture.bundle.source.commit_sha = "a".repeat(40);
    fixture.bundle.source.tree_sha = "b".repeat(40);
    rewriteEvidence(fixture, "source-readback", (document) => {
      document.claim.pull_request_head_sha = "c".repeat(40);
      document.claim.approvals[0].head_sha = "c".repeat(40);
      document.claim.required_checks[0].head_sha = "d".repeat(40);
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "commit-sha",
      "tree-sha",
      "source-evidence.head-sha",
      "source-evidence.approval-head-sha",
      "source-evidence.check-head-sha",
    ]) assert.equal(result.issues.some((issue) => issue.gate === "source" && issue.category === category), true, category);
  });
});

test("search evidence requires exact expected and actual handle sets plus an explicit zero-result fixture", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "rendered-route-readback", (document) => {
      document.claim.search_results.find((item) => item.query === "retinol").actual_handles.pop();
      const pairedDrift = document.claim.search_results.find((item) => item.query === "moisturizer");
      pairedDrift.expected_handles = [];
      pairedDrift.actual_handles = [];
      const zero = document.claim.search_results.find((item) => item.query.startsWith("mochirii-zero-result-"));
      zero.query = "unreviewed-zero-query";
      document.claim.targets.find((target) => target.identity === "home").target = "/cart";
      const cleanserResult = document.claim.search_results.find((item) => item.query === "cleanser");
      cleanserResult.result_page_sha256 = artifactSha("unrelated-search-page");
      cleanserResult.observed_at = "2026-07-19T12:01:00.000Z";
      const cleanserTarget = document.claim.targets.find((target) => target.identity === "search:cleanser");
      cleanserTarget.target = "/search?q=cleanser";
    });
    const result = validate(fixture.bundle, fixture.bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "rendered-routes" && issue.category === "evidence.search-result-parity"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "rendered-routes" && issue.category === "evidence.search-zero-fixture"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "rendered-routes" && issue.category === "evidence.search-policy-expectation"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "rendered-routes" && issue.category === "evidence.target-location-linkage"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "rendered-routes" && issue.category === "evidence.search-target.content-sha256"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "rendered-routes" && issue.category === "evidence.search-target.observed-at"), true);
  });
});

test("server-error fixture hash and capture must match the rendered server-error target", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "rendered-route-readback", (document) => {
      document.claim.server_error_fixture.content_sha256 = artifactSha("unrelated-server-error");
      document.claim.server_error_fixture.observed_at = "2026-07-19T12:01:00.000Z";
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "evidence.server-error-target.content-sha256",
      "evidence.server-error-target.observed-at",
    ]) assert.equal(result.issues.some((issue) => issue.gate === "rendered-routes" && issue.category === category), true, category);
  });
});

test("PC-03 through PC-05 and PS-04 through PS-05 require parsed control records", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "operations-readback", (document) => {
      document.claim.product_compliance_records.shift();
      document.claim.product_compliance_records[0].claim_surface_categories = ["storefront"];
      document.claim.safety_operations_record.runbooks = document.claim.safety_operations_record.runbooks
        .filter((runbook) => runbook.id !== "serious-adverse-event");
      document.claim.safety_operations_record.notification_language = document.claim.safety_operations_record
        .notification_language.filter((language) => language.category !== "payment");
    });
    const result = validate(fixture.bundle, fixture.bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "operational-gates" && issue.category === "evidence.product-compliance.exact-count"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "operational-gates" && issue.category === "evidence.product-compliance.claim-surfaces"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "operational-gates" && issue.category === "evidence.safety-runbook-id-set"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "operational-gates" && issue.category === "evidence.incident-language-set"), true);
  });
});

test("gift-card disabled, unlisted, route-absent, and provider-absent states fail independently", () => {
  const scenarios = [
    ["gift_cards_disabled", "evidence.gift-card-enabled", (readback) => { readback.settings.enabled = true; }],
    ["gift_cards_unlisted", "evidence.gift-card-listed", (readback) => { readback.provider_listing.listed = true; }],
    ["gift_card_route_absent", "evidence.gift-card-route-actual-status", (readback) => {
      readback.route.actual_http_status = 200;
    }],
    ["gift_card_provider_listing_absent", "evidence.gift-card-actual-count", (readback) => {
      readback.provider_listing.actual_count = 1;
    }],
  ];
  for (const [bundleField, evidenceCategory, mutate] of scenarios) {
    withFixture((fixture) => {
      fixture.bundle.operational_gates.gift_cards[bundleField] = false;
      rewriteEvidence(fixture, "operations-readback", (document) => mutate(document.claim.gift_card_readback));
      const result = validate(fixture.bundle, fixture.bundlePath);
      assert.equal(result.ok, false);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "operations-gift_cards" && issue.category === bundleField), true);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "operational-gates" && issue.category === evidenceCategory), true);
    });
  }
});

test("missing and stale evidence fail closed", () => {
  withFixture(({ bundle, bundlePath }) => {
    const missing = structuredClone(bundle);
    missing.evidence_files.find((entry) => entry.kind === "product-review").path += ".missing";
    let result = validate(missing, bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.category === "file.missing"), true);

    const stale = structuredClone(bundle);
    stale.candidate_theme.captured_at = "2026-07-17T12:00:00.000Z";
    result = validate(stale, bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.gate === "candidate-theme" && issue.category === "capture.freshness"), true);
  });
});

test("public self-attestation without an ignored bundle cannot satisfy the gate", () => {
  withFixture(({ bundle }) => {
    const publicPath = path.join(appRoot, "scripts", "prepayment-public-self-attestation.tmp.json");
    try {
      writeFileSync(publicPath, `${JSON.stringify(bundle)}\n`);
      const result = validate(bundle, publicPath);
      assert.equal(result.ok, false);
      assert.equal(result.issues.some((issue) => issue.gate === "evidence" && issue.category === "bundle.boundary"), true);
    } finally {
      rmSync(publicPath, { force: true });
    }
  });
});

test("missing or hash-mismatched evidence and price identity drift fail closed", () => {
  withFixture(({ bundle, bundlePath }) => {
    const mismatched = structuredClone(bundle);
    mismatched.evidence_files.find((entry) => entry.kind === "rendered-route-readback").sha256 = "f".repeat(64);
    let result = validate(mismatched, bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.category === "file.hash-mismatch"), true);

    const identityDrift = structuredClone(bundle);
    identityDrift.product_review.products[0].variant_record_id = "different-variant";
    result = validate(identityDrift, bundlePath);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.category === "variant-identity-linkage"), true);
  });
});

test("candidate, source, product, operational, and final-payment assertions are fail closed", () => {
  withFixture(({ bundle, bundlePath }) => {
    const changed = structuredClone(bundle);
    changed.candidate_theme.theme_id = "141422395467";
    changed.source.accountable_human_review = false;
    changed.product_review.products[0].emblem_pass = false;
    changed.product_review.products[0].other_brand_absent_pass = false;
    changed.operational_gates.email.sender_domain_authenticated = false;
    changed.final_phase_exclusions.payment_setup_completed = true;
    const result = validate(changed, bundlePath);
    assert.equal(result.ok, false);
    for (const expected of [
      ["candidate-theme", "theme-id"],
      ["source", "accountable_human_review"],
      ["product-review", "product.emblem_pass"],
      ["product-review", "product.other_brand_absent_pass"],
      ["operations-email", "sender_domain_authenticated"],
      ["final-phase-exclusions", "payment_setup_completed"],
    ]) {
      assert.equal(result.issues.some((issue) => issue.gate === expected[0] && issue.category === expected[1]), true);
    }
  });
});

test("source verification requires the exact clean main commit and tree", () => {
  withFixture(({ bundle, bundlePath, sourceContracts }) => {
    const result = validatePrepaymentEvidenceBundle(bundle, {
      repositoryRoot,
      bundlePath,
      now: NOW,
      sourceContracts,
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.gate === "source-worktree"), true);
  });
});

test("merge-commit checks are required while a skipped Supabase preview remains valid", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "source-readback", (document) => {
      document.claim.required_checks.find((check) => check.name === "Supabase Preview").conclusion = "SKIPPED";
    });
    let result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, true, JSON.stringify(result.issues));

    rewriteEvidence(fixture, "source-readback", (document) => {
      document.claim.required_checks[0].head_sha = HEAD_SHA;
    });
    result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "source" && issue.category === "source-evidence.check-head"), true);
  });
});

test("a self-consistently rehashed but source-divergent candidate ZIP fails", () => {
  withFixture((fixture) => {
    const entries = fixture.sourceContracts.activeSourceManifest.files.map((entry, index) => [
      entry.path.slice("apps/shopify-theme/".length),
      index === 0
        ? Buffer.from("altered runtime bytes", "utf8")
        : readFileSync(path.join(repositoryRoot, ...entry.path.split("/"))),
    ]);
    replaceCandidatePackage(fixture, storedZip(entries));
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "theme-package" && issue.category === "artifact.runtime-content"), true);
  });
});

test("a self-consistent package cannot omit runtime through an incomplete active-source manifest", () => {
  withFixture((fixture) => {
    const contracts = structuredClone(fixture.sourceContracts);
    contracts.activeSourceManifest.files = contracts.activeSourceManifest.files.slice(1);
    const entries = contracts.activeSourceManifest.files.map((entry) => [
      entry.path.slice("apps/shopify-theme/".length),
      readFileSync(path.join(repositoryRoot, ...entry.path.split("/"))),
    ]);
    const packageBuffer = storedZip(entries);
    const packageSha256 = sha256(packageBuffer);
    replaceCandidatePackage(fixture, packageBuffer);
    rewriteEvidence(fixture, "theme-package", (document) => {
      document.claim.package_sha256 = packageSha256;
      document.claim.size_bytes = packageBuffer.length;
      document.claim.active_source_manifest_sha256 = contractSha(contracts.activeSourceManifest);
      document.claim.runtime_file_count = contracts.activeSourceManifest.files.length;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, contracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "theme-package" && issue.category === "artifact.active-source-manifest"), true);
  });
});

test("package inventory and ZIP integrity fail for missing or duplicate entries", () => {
  for (const scenario of ["missing", "duplicate"]) {
    withFixture((fixture) => {
      const entries = fixture.sourceContracts.activeSourceManifest.files.map((entry) => [
        entry.path.slice("apps/shopify-theme/".length),
        readFileSync(path.join(repositoryRoot, ...entry.path.split("/"))),
      ]);
      const changed = scenario === "missing" ? entries.slice(1) : [...entries, entries[0]];
      replaceCandidatePackage(fixture, storedZip(changed));
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "theme-package" && ["artifact.runtime-file-set", "artifact.zip-structure"].includes(issue.category)), true);
    });
  }
});

test("product facts, launch pages, and exception evidence stay bound to source contracts", () => {
  withFixture((fixture) => {
    const contracts = structuredClone(fixture.sourceContracts);
    contracts.productFacts.products[0].facts.media[0].public_reference = "/products/source-drift.webp";
    contracts.launchPages.pages[0].body_html = contracts.launchPages.pages[0].body_html.replace("Product information", "Changed source");
    contracts.mandatoryNames.entries.push({
      surface: "privacy",
      route: "/policies/privacy-policy",
      exact_name: "Required Privacy Authority",
      legal_or_contractual_reason: "Privacy law required disclosure",
      exact_approved_wording: "Required Privacy Authority",
      reviewer: "compliance-reviewer-01",
      review_date: "2026-07-19",
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, contracts);
    assert.equal(result.ok, false);
    for (const expected of [
      ["product-review", "facts-sha"],
      ["launch-pages", "content-contract-sha"],
      ["mandatory-name-review", "exception-register-sha"],
    ]) {
      assert.equal(result.issues.some((issue) => issue.gate === expected[0] && issue.category === expected[1]), true);
    }
  });
});

test("authenticated Shopify product readback must exactly match every controlled source surface", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "product-review", (document) => {
      document.claim.admin_api_version = "2026-04";
      const readback = document.claim.products[0].shopify_readback;
      readback.title = "Wrong customer-facing title";
      readback.vendor = "Unapproved supplier name";
      readback.has_only_default_variant = false;
      readback.default_variant.id = "gid://shopify/ProductVariant/999999";
      readback.default_variant.title = "Unapproved provider formula";
      readback.default_variant.selected_options = [
        { name: "Formula", value: "Unapproved provider formula" },
      ];
      readback.description_html = `<div>${readback.description_html}</div>`;
      readback.seo.description = "Wrong SEO description";
      readback.metafields[0].json_value = "Wrong controlled metafield";
      readback.collection_handles.push("unapproved-collection");
      readback.media[0].alt_text = "Wrong product image description";
      readback.media[0].original_source_sha256 = artifactSha("wrong-provider-media");
      readback.media[0].emblem_matches = false;
      readback.media[0].other_brand_absent = false;
      readback.media[1].status = "PROCESSING";
      readback.record_sha256 = contractSha(Object.fromEntries(
        Object.entries(readback).filter(([key]) => key !== "record_sha256"),
      ));
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.shopify-admin-api-version",
      "evidence.product.shopify-title",
      "evidence.product.shopify-vendor",
      "evidence.product.shopify-has-only-default-variant",
      "evidence.product.shopify-default-variant-id",
      "evidence.product.shopify-default-variant-title",
      "evidence.product.shopify-default-variant-selected-options",
      "evidence.product.shopify-description_html",
      "evidence.product.shopify-seo",
      "evidence.product.shopify-metafields",
      "evidence.product.shopify-collections",
      "evidence.product.shopify-media-alt_text",
      "evidence.product.shopify-media-original_source_sha256",
      "evidence.product.shopify-media-emblem_matches",
      "evidence.product.shopify-media-other_brand_absent",
      "evidence.product.shopify-media-status",
    ]) {
      assert.equal(result.issues.some((issue) => issue.gate === "product-review" && issue.category === category), true, category);
    }
  });
});

test("aggregate product and pricing hashes require exact real private-artifact bindings", () => {
  withFixture((fixture) => {
    const indexDocument = fixture.evidenceDocuments.get("artifact-index");
    const frontArtifact = indexDocument.claim.artifacts.find((item) =>
      item.artifact_id === `${EXPECTED_PRODUCT_HANDLES[0]}-front`);
    const frontPath = path.join(repositoryRoot, ...frontArtifact.artifact_path.split("/"));
    writeFileSync(frontPath, syntheticPng("mutated-after-index-capture"));
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "artifact-index" && issue.category === "artifact.hash-mismatch"), true);
  });
  withFixture((fixture) => {
    rewriteEvidence(fixture, "product-review", (document) => {
      document.claim.products[1].front_label_sha256 = artifactSha("unbound-front-label");
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.front_label_sha256-artifact.sha256"), true);
  });
});

test("private formula, OCR, and label-review artifacts require their exact schemas", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  for (const [name, mutate, expectedCategory] of [
    [
      "formula",
      (fixture) => mutateFormulaAndRebind(fixture, handle, (record) => {
        record.unexpected_private_value = "not-allowed";
      }),
      "evidence.product.formula-record.keys",
    ],
    [
      "ocr",
      (fixture) => mutateOcrAndRebind(fixture, handle, "front", (record) => {
        record.unexpected_private_value = "not-allowed";
      }),
      "evidence.product.ocr-record.keys",
    ],
    [
      "label-review",
      (fixture) => mutateLabelReviewAndRebind(fixture, handle, (record) => {
        record.unexpected_private_value = "not-allowed";
      }),
      "evidence.product.label-media-review.keys",
    ],
  ]) {
    withFixture((fixture) => {
      mutate(fixture);
      persistPrivateEvidenceGraph(fixture);
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, name);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" && issue.category === expectedCategory), true, name);
    });
  }
});

test("formula evidence cannot drift from its derived identity, authenticated catalog source, or approved unit", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  withFixture((fixture) => {
    const changedIdentity = {
      ...privateFormulaIdentity(handle),
      catalog_product_identifier: "private-product:identity-drift",
    };
    const changedIdentitySha256 = contractSha(changedIdentity);
    mutateFormulaAndRebind(fixture, handle, (record) => {
      record.identity = changedIdentity;
      record.formula_identity_sha256 = changedIdentitySha256;
    });
    privateReviewProduct(fixture, handle).formula_identity_sha256 = changedIdentitySha256;
    mutateLabelReviewAndRebind(fixture, handle, (record) => {
      record.formula_identity_sha256 = changedIdentitySha256;
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "private-price" && issue.category === "formula-identity-linkage"), true);
  });
  withFixture((fixture) => {
    mutateFormulaAndRebind(fixture, handle, (record) => {
      record.source_catalog_record_sha256 = artifactSha("wrong-private-catalog-record");
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "private-price" && issue.category === "source-catalog-record-linkage"), true);
  });
  withFixture((fixture) => {
    mutateFormulaAndRebind(fixture, handle, (record) => {
      record.approved_unit.front_label_sha256 = artifactSha("wrong-approved-front-label");
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.formula-record.approved-unit-product-parity"), true);
  });
});

test("front, technical-panel, and outer-box OCR must match source images, dimensions, and text digests", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  for (const [role, mutate, expectedCategory] of [
    [
      "front",
      (record) => { record.source_image_sha256 = artifactSha("wrong-ocr-source-image"); },
      "evidence.product.ocr-record.source_image_sha256",
    ],
    [
      "technical-panel",
      (record) => { record.pages[0].width = SYNTHETIC_IMAGE_METADATA.width - 1; },
      "evidence.product.ocr-record.page-width",
    ],
    [
      "outer-box",
      (record) => { record.normalized_text_sha256 = artifactSha("wrong-normalized-ocr-text"); },
      "evidence.product.ocr-record.normalized-text-sha256",
    ],
  ]) {
    withFixture((fixture) => {
      mutateOcrAndRebind(fixture, handle, role, mutate);
      persistPrivateEvidenceGraph(fixture);
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, role);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" && issue.category === expectedCategory), true, role);
    });
  }
});

test("copied fact hashes and true review booleans cannot hide wrong wordmark or INCI OCR", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  for (const [role, field, wrongText, expectedCategory] of [
    [
      "front",
      "wordmark",
      "mochirii cosmetics",
      "evidence.product.ocr-record.semantic-exact-text",
    ],
    [
      "technical-panel",
      "ingredients_inci",
      "Aqua, Unapproved Ingredient",
      "evidence.product.label-media-review.media-ocr-comparison-parity",
    ],
  ]) {
    withFixture((fixture) => {
      let wrongObservedSha;
      mutateOcrAndRebind(fixture, handle, role, (record) => {
        const semantic = record.semantic_fields.find((item) => item.field === field);
        const blockRef = semantic.block_refs[0];
        const block = record.pages[blockRef.page_number - 1].blocks[blockRef.block_index];
        block.text = wrongText;
        wrongObservedSha = sha256(Buffer.from(normalizeOcrComparableText(wrongText), "utf8"));
        semantic.normalized_observed_sha256 = wrongObservedSha;
        record.normalized_text_sha256 = sha256(Buffer.from(
          record.pages.flatMap((page) => page.blocks.map((item) => item.text)).join("\n"),
          "utf8",
        ));
      });
      mutateLabelReviewAndRebind(fixture, handle, (record) => {
        const media = record.media.find((item) => item.role === role);
        const comparison = media.ocr_comparisons.find((item) => item.field === field);
        comparison.observed_normalized_sha256 = wrongObservedSha;
        comparison.match = true;
        media.emblem_matches = true;
        media.wordmark_matches = true;
        media.other_brand_absent = true;
      });
      persistPrivateEvidenceGraph(fixture);
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, `${role}:${field}`);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" &&
        issue.category === expectedCategory), true);
    });
  }
});

test("all OCR block companies require an exact reviewed product-media exception", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  const role = "front";
  const companyName = ["Self", "named"].join("");
  const approvedWording = `Distributed by ${companyName}`;
  const appendCompanyBlock = (text) => (record) => {
    const blocks = record.pages[0].blocks;
    blocks.push({
      index: blocks.length,
      text,
      confidence_basis_points: 9900,
      bbox: { x: 100, y: 900, width: 1000, height: 100 },
    });
    record.normalized_text_sha256 = sha256(Buffer.from(
      record.pages.flatMap((page) => page.blocks.map((item) => item.text)).join("\n"),
      "utf8",
    ));
  };
  const authorizeCompany = (fixture, {
    reviewDate = "2026-07-19",
    registerReviewDate = "2026-07-19",
    exactName = companyName,
  } = {}) => {
    const register = fixture.sourceContracts.mandatoryNames;
    register.status = "reviewed";
    register.rendered_review = {
      status: "reviewed",
      reviewer: "compliance-reviewer-01",
      review_date: registerReviewDate,
      reviewed_route_categories: [...REQUIRED_RENDERED_ROUTE_CATEGORIES],
    };
    register.entries.push({
      surface: `product-media:${role}`,
      route: `/products/${handle}`,
      exact_name: exactName,
      legal_or_contractual_reason: "Label law requires this distributor disclosure",
      exact_approved_wording: approvedWording,
      reviewer: "compliance-reviewer-01",
      review_date: reviewDate,
    });
    const registerSha = contractSha(register);
    fixture.bundle.mandatory_name_review.exception_register_sha256 = registerSha;
    rewriteEvidence(fixture, "mandatory-name-review", (document) => {
      document.claim.exception_register_sha256 = registerSha;
      document.claim.exceptions = structuredClone(register.entries);
    });
  };

  withFixture((fixture) => {
    mutateOcrAndRebind(fixture, handle, role, appendCompanyBlock(approvedWording));
    persistPrivateEvidenceGraph(fixture);
    const reviewedMedia = JSON.parse(readFileSync(
      path.join(
        repositoryRoot,
        ...fixture.evidenceDocuments.get("artifact-index").claim.artifacts
          .find((artifact) => artifact.artifact_id === `${handle}-label-media-review`)
          .artifact_path.split("/"),
      ),
      "utf8",
    )).media.find((media) => media.role === role);
    assert.equal(reviewedMedia.emblem_matches, true);
    assert.equal(reviewedMedia.wordmark_matches, true);
    assert.equal(reviewedMedia.other_brand_absent, true);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.ocr-record.unapproved-company"), true);
    assert.equal(JSON.stringify(result.issues).includes(companyName), false);
  });

  withFixture((fixture) => {
    authorizeCompany(fixture);
    mutateOcrAndRebind(fixture, handle, role, appendCompanyBlock(approvedWording));
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.deepEqual(result.issues.filter((issue) => issue.gate === "product-review"), []);
  });

  for (const [label, wording, authorization] of [
    ["wrong wording", `Manufactured for ${companyName}`, {}],
    ["approved wording plus extra text", `${approvedWording} Preferred laboratory partner`, {}],
    ["future entry review", approvedWording, { reviewDate: "2026-07-20" }],
    ["future register review", approvedWording, { registerReviewDate: "2026-07-20" }],
    ["invalid calendar review", approvedWording, { reviewDate: "2026-02-31" }],
    ["noncanonical company name", approvedWording, { exactName: companyName.toLocaleLowerCase("en-US") }],
  ]) {
    withFixture((fixture) => {
      authorizeCompany(fixture, authorization);
      mutateOcrAndRebind(fixture, handle, role, appendCompanyBlock(wording));
      persistPrivateEvidenceGraph(fixture);
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, label);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" &&
        issue.category === "evidence.product.ocr-record.unapproved-company"), true, label);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" &&
        issue.category === "evidence.product.ocr-record.block-unconsumed"), true, label);
    });
  }
});

test("unknown unassigned OCR text fails unless one exact whole-block exception consumes it", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  const role = "front";
  const unknownCompany = ["Acme", " Laboratories"].join("");
  const approvedWording = `Distributed by ${unknownCompany}`;
  const appendBlock = (text) => (record) => {
    const blocks = record.pages[0].blocks;
    blocks.push({
      index: blocks.length,
      text,
      confidence_basis_points: 9900,
      bbox: { x: 100, y: 900, width: 1000, height: 100 },
    });
    record.normalized_text_sha256 = sha256(Buffer.from(
      record.pages.flatMap((page) => page.blocks.map((item) => item.text)).join("\n"),
      "utf8",
    ));
  };
  const authorizeUnknownCompany = (fixture) => {
    const register = fixture.sourceContracts.mandatoryNames;
    register.status = "reviewed";
    register.rendered_review = {
      status: "reviewed",
      reviewer: "compliance-reviewer-01",
      review_date: "2026-07-19",
      reviewed_route_categories: [...REQUIRED_RENDERED_ROUTE_CATEGORIES],
    };
    register.entries.push({
      surface: `product-media:${role}`,
      route: `/products/${handle}`,
      exact_name: unknownCompany,
      legal_or_contractual_reason: "Label law requires this distributor disclosure",
      exact_approved_wording: approvedWording,
      reviewer: "compliance-reviewer-01",
      review_date: "2026-07-19",
    });
    const registerSha = contractSha(register);
    fixture.bundle.mandatory_name_review.exception_register_sha256 = registerSha;
    rewriteEvidence(fixture, "mandatory-name-review", (document) => {
      document.claim.exception_register_sha256 = registerSha;
      document.claim.exceptions = structuredClone(register.entries);
    });
  };

  withFixture((fixture) => {
    mutateOcrAndRebind(fixture, handle, role, appendBlock(approvedWording));
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.ocr-record.block-unconsumed"), true);
    assert.equal(JSON.stringify(result.issues).includes(unknownCompany), false);
  });

  withFixture((fixture) => {
    mutateOcrAndRebind(fixture, handle, role, (record) => {
      record.semantic_fields[1].block_refs = structuredClone(record.semantic_fields[0].block_refs);
      record.semantic_fields[1].normalized_observed_sha256 =
        record.semantic_fields[0].normalized_observed_sha256;
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.ocr-record.block-multiple-consumers"), true);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.ocr-record.block-unconsumed"), true);
  });

  withFixture((fixture) => {
    authorizeUnknownCompany(fixture);
    mutateOcrAndRebind(fixture, handle, role, appendBlock(approvedWording));
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.deepEqual(result.issues.filter((issue) => issue.gate === "product-review"), []);
  });

  withFixture((fixture) => {
    authorizeUnknownCompany(fixture);
    mutateOcrAndRebind(
      fixture,
      handle,
      role,
      appendBlock(`${approvedWording} Preferred laboratory partner`),
    );
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "product-review" &&
      issue.category === "evidence.product.ocr-record.block-unconsumed"), true);
  });
});

test("reviewed use-media blocks allow exact approved facts and strict technical codes only", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  const role = "use";
  const addReviewedBlock = (record, media, text, classification) => {
    const blocks = record.pages[0].blocks;
    const blockIndex = blocks.length;
    blocks.push({
      index: blockIndex,
      text,
      confidence_basis_points: 9900,
      bbox: { x: 100, y: 150 + (blockIndex * 120), width: 1000, height: 80 },
    });
    record.reviewed_block_consumers.push({
      page_number: 1,
      block_index: blockIndex,
      consumer_kind: classification.consumer_kind,
      approved_fact_field: classification.approved_fact_field ?? null,
      technical_code_kind: classification.technical_code_kind ?? null,
      approved_artwork_sha256: media.asset_sha256,
      text_sha256: sha256(Buffer.from(text.normalize("NFC"), "utf8")),
      reviewer: "product-evidence-reviewer-01",
      reviewed_at: CAPTURED_AT,
    });
  };
  const finishOcrDigest = (record) => {
    record.normalized_text_sha256 = sha256(Buffer.from(
      record.pages.flatMap((page) => page.blocks.map((item) => item.text.normalize("NFC"))).join("\n"),
      "utf8",
    ));
  };

  withFixture((fixture) => {
    const sourceProduct = fixture.sourceContracts.productFacts.products.find((item) => item.handle === handle);
    const media = sourceProduct.facts.media.find((item) => item.role === role);
    mutateOcrAndRebind(fixture, handle, role, (record) => {
      for (const [text, classification] of [
        [sourceProduct.public_title, {
          consumer_kind: "approved-fact-duplicate",
          approved_fact_field: "public_title",
        }],
        [sourceProduct.facts.volume.display, {
          consumer_kind: "approved-fact-duplicate",
          approved_fact_field: "volume",
        }],
        ["BATCH: ABC-123", { consumer_kind: "technical-code", technical_code_kind: "batch" }],
        ["LOT NO. L240719", { consumer_kind: "technical-code", technical_code_kind: "lot" }],
        ["12M", { consumer_kind: "technical-code", technical_code_kind: "pao" }],
        ["4006381333931", { consumer_kind: "technical-code", technical_code_kind: "barcode" }],
        ["PAP 21", { consumer_kind: "technical-code", technical_code_kind: "recycling" }],
      ]) {
        addReviewedBlock(record, media, text, classification);
      }
      finishOcrDigest(record);
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.deepEqual(result.issues.filter((issue) => issue.gate === "product-review"), []);
  });

  withFixture((fixture) => {
    const sourceProduct = fixture.sourceContracts.productFacts.products.find((item) => item.handle === handle);
    const media = sourceProduct.facts.media.find((item) => item.role === role);
    const promoText = "Limited edition laboratory promotion";
    mutateOcrAndRebind(fixture, handle, role, (record) => {
      addReviewedBlock(record, media, promoText, {
        consumer_kind: "technical-code",
        technical_code_kind: "batch",
      });
      finishOcrDigest(record);
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "evidence.product.ocr-record.reviewed-block-consumer.technical-code-text",
      "evidence.product.ocr-record.block-unconsumed",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" && issue.category === category), true, category);
    }
    assert.equal(JSON.stringify(result.issues).includes(promoText), false);
  });

  withFixture((fixture) => {
    const sourceProduct = fixture.sourceContracts.productFacts.products.find((item) => item.handle === handle);
    const media = sourceProduct.facts.media.find((item) => item.role === role);
    mutateOcrAndRebind(fixture, handle, role, (record) => {
      addReviewedBlock(record, media, sourceProduct.public_title, {
        consumer_kind: "approved-fact-duplicate",
        approved_fact_field: "public_title",
      });
      const consumer = record.reviewed_block_consumers.at(-1);
      consumer.approved_artwork_sha256 = artifactSha("wrong-reviewed-artwork");
      consumer.reviewed_at = "2026-07-19T14:00:00.000Z";
      finishOcrDigest(record);
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "evidence.product.ocr-record.reviewed-block-consumer.approved-artwork-sha256",
      "evidence.product.ocr-record.reviewed-block-consumer.reviewed-at.order",
      "evidence.product.ocr-record.block-unconsumed",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" && issue.category === category), true, category);
    }
  });
});

test("every OCR block enforces the exact Mochirii Cosmetics wordmark", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  const role = "front";
  const appendBlock = (text) => (record) => {
    const blocks = record.pages[0].blocks;
    blocks.push({
      index: blocks.length,
      text,
      confidence_basis_points: 9900,
      bbox: { x: 100, y: 900, width: 1000, height: 100 },
    });
    record.normalized_text_sha256 = sha256(Buffer.from(
      record.pages.flatMap((page) => page.blocks.map((item) => item.text.normalize("NFC"))).join("\n"),
      "utf8",
    ));
  };

  withFixture((fixture) => {
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.deepEqual(result.issues.filter((issue) => issue.gate === "product-review"), []);
  });

  for (const candidate of [
    "mochirii cosmetics",
    "Mo\u0304chirii Cosmetics",
    "Mochirii-Cosmetics",
    "Mochirii Cosmetics and mochirii cosmetics",
  ]) {
    withFixture((fixture) => {
      mutateOcrAndRebind(fixture, handle, role, appendBlock(candidate));
      persistPrivateEvidenceGraph(fixture);
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, candidate);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" &&
        issue.category === "evidence.product.ocr-record.inconsistent-brand"), true, candidate);
      assert.equal(JSON.stringify(result.issues).includes(candidate), false, candidate);
    });
  }
});

test("label/media review must exactly match media, fact, inspection, emblem, and wordmark evidence", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  withFixture((fixture) => {
    mutateLabelReviewAndRebind(fixture, handle, (record) => {
      record.canonical_emblem_sha256 = artifactSha("wrong-canonical-emblem");
      const front = record.media.find((media) => media.role === "front");
      front.source_image_sha256 = artifactSha("wrong-reviewed-front-image");
      front.emblem_comparison.source_image_sha256 = artifactSha("wrong-emblem-comparison-image");
      front.emblem_matches = false;
      const panel = record.media.find((media) => media.role === "technical-panel");
      panel.inspection.width = SYNTHETIC_IMAGE_METADATA.width - 1;
      panel.fact_hashes.ingredients_inci = artifactSha("wrong-reviewed-inci");
      const box = record.media.find((media) => media.role === "outer-box");
      box.wordmark_matches = false;
      box.other_brand_absent = false;
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.product.label-media-review.canonical-emblem",
      "evidence.product.label-media-review.media-source-image",
      "evidence.product.label-media-review.media-emblem-comparison-source",
      "evidence.product.label-media-review.media-emblem",
      "evidence.product.label-media-review.media-inspection-width",
      "evidence.product.label-media-review.media-fact-ingredients_inci",
      "evidence.product.label-media-review.media-wordmark",
      "evidence.product.label-media-review.media-other-brand-absent",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "product-review" && issue.category === category), true, category);
    }
  });
});

test("private formula and OCR values are never copied into aggregate issue output", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  const sentinel = "PRIVATE-RAW-VALUE-MUST-NOT-LEAK-7f0d9b8e";
  withFixture((fixture) => {
    mutateFormulaAndRebind(fixture, handle, (record) => {
      record.identity.catalog_product_identifier = sentinel;
    });
    mutateOcrAndRebind(fixture, handle, "front", (record) => {
      record.pages[0].blocks[0].text = sentinel;
    });
    persistPrivateEvidenceGraph(fixture);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result.issues).includes(sentinel), false);
    assert.equal(result.issues.every((issue) =>
      JSON.stringify(Object.keys(issue).sort()) === JSON.stringify(["category", "gate"])), true);
  });
});

test("provider readback copy cannot drift from the source launch-page packet", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "launch-pages-readback", (document) => {
      const page = document.claim.pages[0];
      page.body_html = page.body_html.replace("Product information", "Different provider copy");
      page.content_sha256 = contractSha(Object.fromEntries(Object.entries(page)
        .filter(([key]) => !["route", "content_sha256", "http_status", "readback_at"].includes(key))));
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "launch-pages" && issue.category === "evidence.page-body_html"), true);
  });
});

test("privacy, shipping, and nested observation evidence fail closed", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "rendered-route-readback", (document) => {
      document.claim.targets.find((target) => target.identity === "privacy-choices").target = "/pages/privacy-choices";
      document.claim.search_results[0].observed_at = "2026-07-17T12:00:00.000Z";
      document.claim.sold_out_fixture.observed_at = "2026-07-17T12:00:00.000Z";
    });
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      const alaska = document.claim.shipping_cases.find((item) => item.case_id === "alaska");
      alaska.expected_eligible = true;
      alaska.actual_eligible = true;
      alaska.expected_currency = "USD";
      alaska.actual_currency = "USD";
      const supported = document.claim.shipping_cases.find((item) => item.case_id === "contiguous-us-light");
      supported.actual_rate_usd = "99.99";
      supported.rate_calculation = "flat-rate";
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const expected of [
      ["rendered-routes", "evidence.target-location-linkage"],
      ["rendered-routes", "evidence.search-observed-at.order"],
      ["rendered-routes", "evidence.sold-out-observed-at.order"],
      ["fulfillment-shipping", "evidence.shipping-normative-eligibility"],
      ["fulfillment-shipping", "evidence.shipping-rate-parity"],
      ["fulfillment-shipping", "evidence.shipping-rate-calculation"],
    ]) {
      assert.equal(result.issues.some((issue) => issue.gate === expected[0] && issue.category === expected[1]), true);
    }
  });
});

test("authenticated shipping artifacts require ascending weight tiers and exact source rates", () => {
  withFixture((fixture) => {
    const matrix = JSON.parse(readFileSync(fixture.shippingMatrixPath, "utf8"));
    matrix.cases.find((item) => item.case_id === "contiguous-us-standard").cart_weight_grams = 100;
    writeFileSync(fixture.shippingMatrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.supplier_matrix.artifact_sha256 = contractSha(matrix);
      const readback = document.claim.shipping_cases.find((item) => item.case_id === "contiguous-us-standard");
      readback.cart_weight_grams = 100;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" && issue.category === "evidence.supplier-matrix-weight-tiers"), true);
  });
});

test("authenticated Shopify rate tiers reject both schedule gaps and overlaps", () => {
  for (const [scenario, maximumWeightGrams, expectedCategory] of [
    ["gap", 499, "evidence.shopify-rate-table-schedule-gap"],
    ["overlap", 501, "evidence.shopify-rate-table-schedule-overlap"],
  ]) {
    withFixture((fixture) => {
      const rateTable = JSON.parse(readFileSync(fixture.shopifyRateTablePath, "utf8"));
      rateTable.tiers[0].maximum_weight_grams = maximumWeightGrams;
      writeRateTableAndRebindConfiguration(fixture, rateTable);
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, scenario);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === expectedCategory), true, scenario);
    });
  }
});

test("every positive Shopify tier threshold requires just-below, at, and just-above exact-rate observations", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.tier_threshold_observations = document.claim.tier_threshold_observations
        .filter((item) => !(item.threshold_grams === 500 && item.relation === "just-above"));
      const atBoundary = document.claim.tier_threshold_observations
        .find((item) => item.threshold_grams === 1000 && item.relation === "at");
      atBoundary.expected_rate_usd = "7.50";
      atBoundary.actual_rate_usd = "7.50";
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.shipping-threshold-observations.exact-count",
      "evidence.shipping-threshold-observation-set",
      "evidence.shipping-threshold-expected-rate",
      "evidence.shipping-threshold-rate-parity",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === category), true, category);
    }
  });
});

test("shipping configuration hashes and artifact paths must bind to the authenticated Shopify rate table", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.shipping_cases[0].configuration_sha256 = artifactSha("wrong-shipping-configuration");
      document.claim.tier_threshold_observations[0].configuration_sha256 = artifactSha("wrong-threshold-configuration");
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.shipping-configuration-linkage",
      "evidence.shipping-threshold-configuration-linkage",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === category), true, category);
    }
  });
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.shopify_rate_table.artifact_path = "apps/shopify-theme/rate-table.json";
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" && issue.category === "evidence.shopify-rate-table-path"), true);
  });
  withFixture((fixture) => {
    const rateTableRelativePath = path.relative(repositoryRoot, fixture.shopifyRateTablePath)
      .split(path.sep)
      .join("/");
    const result = validatePrepaymentEvidenceBundle(fixture.bundle, {
      repositoryRoot,
      bundlePath: fixture.bundlePath,
      now: NOW,
      sourceContracts: fixture.sourceContracts,
      enforceRepositorySource: false,
      artifactGitPathStatus: (candidate) => candidate === rateTableRelativePath
        ? { tracked: true, ignored: false }
        : { tracked: false, ignored: true },
      artifactImageInspector: () => true,
    });
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.shopify-rate-table-path.tracked",
      "evidence.shopify-rate-table-path.not-ignored",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === category), true, category);
    }
  });
});

test("supplier-expected and authenticated Shopify variant weights must be positive and current", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.products[0].supplier_expected_weight_grams = 0;
      document.claim.products[0].shopify_actual_weight_grams = 0;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of ["evidence.supplier-expected-weight", "evidence.shopify-actual-weight"]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === category), true, category);
    }
  });
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.products[0].supplier_expected_weight_grams = 2;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" && issue.category === "evidence.variant-weight-parity"), true);
  });
});

test("supplier weight claims require a fresh exact private mapping artifact", () => {
  const handle = EXPECTED_PRODUCT_HANDLES[0];
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.products[0].mapping_record_sha256 = artifactSha("invented-unbound-mapping");
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" &&
      issue.category === "evidence.mapping-record-artifact.sha256"), true);
  });
  withFixture((fixture) => {
    mutateShippingMappingAndRebind(fixture, handle, (record) => {
      record.captured_at = "2026-07-17T12:00:00.000Z";
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" &&
      issue.category === "evidence.private-supplier-mapping.captured-at.order"), true);
  });
  for (const [field, value] of [
    ["authentication_evidence_sha256", artifactSha("wrong-shipping-authentication")],
    ["variant_record_id", "gid://shopify/ProductVariant/999999"],
    ["formula_identity_sha256", artifactSha("wrong-shipping-formula")],
    ["source_catalog_record_sha256", artifactSha("wrong-shipping-catalog-source")],
  ]) {
    withFixture((fixture) => {
      mutateShippingMappingAndRebind(fixture, handle, (record) => {
        record[field] = value;
      });
      const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
      assert.equal(result.ok, false, field);
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" &&
        issue.category === `evidence.private-supplier-mapping.${field}`), true, field);
    });
  }
  withFixture((fixture) => {
    mutateShippingMappingAndRebind(fixture, handle, (record) => {
      record.supplier_expected_weight_grams = 999;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" &&
      issue.category === "evidence.private-supplier-mapping.supplier_expected_weight_grams"), true);
  });
});

test("fixed cases and threshold observations recompute cart weight from exact variant compositions", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "fulfillment-shipping-readback", (document) => {
      document.claim.shipping_cases
        .find((item) => item.case_id === "contiguous-us-light")
        .cart_lines[0].quantity = 249;
      document.claim.tier_threshold_observations
        .find((item) => item.threshold_grams === 500 && item.relation === "at")
        .cart_lines[0].quantity = 499;
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.shipping-cart-weight-recomputed",
      "evidence.shipping-threshold-cart-weight-recomputed",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === category), true, category);
    }
  });
});

test("the complete supplier tier schedule cannot be missing or permuted against Shopify", () => {
  withFixture((fixture) => {
    const matrix = JSON.parse(readFileSync(fixture.shippingMatrixPath, "utf8"));
    matrix.rate_tiers.pop();
    writeSupplierMatrixAndRebind(fixture, matrix);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" && issue.category === "evidence.shipping-rate-tier-count-parity"), true);
  });
  withFixture((fixture) => {
    const matrix = JSON.parse(readFileSync(fixture.shippingMatrixPath, "utf8"));
    [matrix.rate_tiers[0], matrix.rate_tiers[1]] = [matrix.rate_tiers[1], matrix.rate_tiers[0]];
    writeSupplierMatrixAndRebind(fixture, matrix);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    for (const category of [
      "evidence.shipping-rate-tier-bounds-parity",
      "evidence.shipping-rate-tier-rate-parity",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "fulfillment-shipping" && issue.category === category), true, category);
    }
  });
});

test("a wrong supplier tier rate cannot pass a self-consistent Shopify configuration", () => {
  withFixture((fixture) => {
    const matrix = JSON.parse(readFileSync(fixture.shippingMatrixPath, "utf8"));
    matrix.rate_tiers[1].rate_usd = "7.51";
    writeSupplierMatrixAndRebind(fixture, matrix);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "fulfillment-shipping" && issue.category === "evidence.shipping-rate-tier-rate-parity"), true);
  });
});

test("handle-to-product-and-variant tuples cannot be permuted", () => {
  withFixture((fixture) => {
    const swap = (products) => {
      [products[0].variant_record_id, products[1].variant_record_id] =
        [products[1].variant_record_id, products[0].variant_record_id];
    };
    swap(fixture.bundle.product_review.products);
    rewriteEvidence(fixture, "product-review", (document) => swap(document.claim.products));
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "private-price" && issue.category === "variant-identity-linkage"), true);
  });
});

test("product-review and authenticated catalog formula identities must match per SKU", () => {
  withFixture((fixture) => {
    rewriteEvidence(fixture, "product-review", (document) => {
      [document.claim.products[0].formula_identity_sha256, document.claim.products[1].formula_identity_sha256] =
        [document.claim.products[1].formula_identity_sha256, document.claim.products[0].formula_identity_sha256];
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "private-price" && issue.category === "formula-identity-linkage"), true);
  });
});

test("the authenticated private catalog snapshot must exist and match ledger records", () => {
  withFixture((fixture) => {
    const ledgerDocument = fixture.evidenceDocuments.get("private-price-ledger");
    const snapshotPath = path.join(
      repositoryRoot,
      ...ledgerDocument.claim.ledger.catalog_readback.snapshot_artifact.split("/"),
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.records[0].base_price_usd = "99.99";
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.gate === "private-price" && issue.category === "catalog-snapshot.records-parity"), true);
  });
});

test("Lighthouse summary and evidence scores stay finite and within 0 through 100", () => {
  withFixture((fixture) => {
    const invalidScores = {
      accessibility: 101,
      best_practices: -1,
      seo: Number.POSITIVE_INFINITY,
      mobile_performance: Number.NaN,
    };
    Object.assign(fixture.bundle.quality_assurance.lighthouse[0], invalidScores);
    rewriteEvidence(fixture, "accessibility-performance-readback", (document) => {
      Object.assign(document.claim.lighthouse[0], invalidScores);
    });
    const result = validate(fixture.bundle, fixture.bundlePath, NOW, fixture.sourceContracts);
    for (const category of [
      "lighthouse.accessibility",
      "lighthouse.best-practices",
      "lighthouse.seo",
      "lighthouse.mobile-performance",
      "evidence.lighthouse-accessibility-range",
      "evidence.lighthouse-best_practices-range",
      "evidence.lighthouse-seo-range",
      "evidence.lighthouse-mobile_performance-range",
    ]) {
      assert.equal(result.issues.some((issue) =>
        issue.gate === "quality-assurance" && issue.category === category), true, category);
    }
  });
});
