import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  collectGalleryPrivateMediaV2RuntimeSources,
  GALLERY_RUNTIME_SOURCE_EXCLUDED_DIRECTORY_NAMES,
  GALLERY_RUNTIME_SOURCE_LIMITS,
  GALLERY_RUNTIME_SOURCE_ROOTS,
  validateGalleryPrivateMediaV2Contract,
} from "./gallery-private-media-v2-contract-validator.mjs";

const frozenContract = JSON.parse(readFileSync(
  new URL("../../docs/integrations/gallery-private-media.v2.contract.json", import.meta.url),
  "utf8",
));

function mutate(change) {
  const candidate = structuredClone(frozenContract);
  change(candidate);
  return candidate;
}

function codesFor(candidate, runtimeSources = {}) {
  return new Set(validateGalleryPrivateMediaV2Contract(candidate, { runtimeSources }).map(({ code }) => code));
}

function rejects(code, change, runtimeSources = {}) {
  const codes = codesFor(mutate(change), runtimeSources);
  assert.equal(codes.has(code), true, `expected ${code}; received ${[...codes].join(", ")}`);
}

function writeFixture(root, path, contents) {
  const absolutePath = join(root, ...path.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function runtimeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gallery-v2-runtime-sources-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

test("runtime-source inventory freezes roots, generated-directory exclusions, and hard ceilings", () => {
  assert.deepEqual(GALLERY_RUNTIME_SOURCE_ROOTS, [
    "apps/web/app",
    "apps/web/components",
    "apps/web/lib",
    "supabase/functions",
  ]);
  assert.deepEqual(GALLERY_RUNTIME_SOURCE_EXCLUDED_DIRECTORY_NAMES, [
    ".deno",
    ".git",
    ".next",
    "node_modules",
    "vendor",
  ]);
  assert.deepEqual(GALLERY_RUNTIME_SOURCE_LIMITS, {
    maxDepth: 32,
    maxVisitedDirectories: 4096,
    maxVisitedEntries: 50000,
    maxSourceFiles: 8192,
    maxSourceFileBytes: 4 * 1024 * 1024,
    maxSourceBytes: 64 * 1024 * 1024,
  });
});

test("runtime-source traversal skips generated roots at every depth while preserving source detection", (t) => {
  const root = runtimeFixture(t);
  const visibleSources = [
    "apps/web/app/page.tsx",
    "apps/web/components/deep/Gallery.tsx",
    "apps/web/lib/gallery/feed.ts",
    "supabase/functions/list-gallery/index.ts",
  ];
  visibleSources.forEach((path, index) => writeFixture(root, path, `export const visible${index} = true;\n`));

  const generatedSources = [
    "apps/web/app/node_modules/pkg/hidden.ts",
    "apps/web/components/deep/.deno/gen/hidden.ts",
    "apps/web/lib/gallery/vendor/pkg/hidden.ts",
    "supabase/functions/list-gallery/internal/.git/hooks/hidden.ts",
    "supabase/functions/list-gallery/internal/deeper/.next/server/hidden.ts",
  ];
  generatedSources.forEach((path) => writeFixture(
    root,
    path,
    "fetch('/api/gallery/private-media/v2/list');\n",
  ));

  const firstInventory = collectGalleryPrivateMediaV2RuntimeSources(root);
  assert.deepEqual(Object.keys(firstInventory.sources), visibleSources);
  assert.equal(firstInventory.stats.sourceFiles, visibleSources.length);
  assert.equal(firstInventory.stats.skippedGeneratedDirectories, generatedSources.length);
  assert.equal(
    validateGalleryPrivateMediaV2Contract(frozenContract, { runtimeSources: firstInventory.sources })
      .some(({ code }) => code === "ROUTE_ACTIVATION"),
    false,
  );

  const routePath = "apps/web/app/api/gallery/private-media/v2/list/route.ts";
  writeFixture(root, routePath, "export function POST() {}\n");
  const secondInventory = collectGalleryPrivateMediaV2RuntimeSources(root);
  assert.deepEqual(Object.keys(secondInventory.sources), [routePath, ...visibleSources]);
  assert.equal(
    validateGalleryPrivateMediaV2Contract(frozenContract, { runtimeSources: secondInventory.sources })
      .some(({ code }) => code === "ROUTE_ACTIVATION"),
    true,
  );
});

test("runtime-source traversal fails closed at bounded directory, entry, file, and byte ceilings", (t) => {
  const root = runtimeFixture(t);
  writeFixture(root, "apps/web/lib/a.ts", "export const a = true;\n");
  writeFixture(root, "apps/web/lib/nested/b.ts", "export const b = true;\n");
  writeFixture(root, "apps/web/lib/nested/deeper/c.ts", "export const c = true;\n");

  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, { limits: { maxVisitedDirectories: 1 } }),
    /GALLERY_RUNTIME_SOURCE_LIMIT: DIRECTORY_COUNT/u,
  );
  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, { limits: { maxVisitedEntries: 1 } }),
    /GALLERY_RUNTIME_SOURCE_LIMIT: ENTRY_COUNT/u,
  );
  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, { limits: { maxSourceFiles: 2 } }),
    /GALLERY_RUNTIME_SOURCE_LIMIT: SOURCE_FILE_COUNT/u,
  );
  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, { limits: { maxSourceFileBytes: 8 } }),
    /GALLERY_RUNTIME_SOURCE_LIMIT: SOURCE_FILE_BYTES/u,
  );
  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, { limits: { maxSourceBytes: 32 } }),
    /GALLERY_RUNTIME_SOURCE_LIMIT: SOURCE_TOTAL_BYTES/u,
  );
  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, { limits: { maxDepth: 1 } }),
    /GALLERY_RUNTIME_SOURCE_LIMIT: MAX_DEPTH/u,
  );
  assert.throws(
    () => collectGalleryPrivateMediaV2RuntimeSources(root, {
      limits: { maxSourceFiles: GALLERY_RUNTIME_SOURCE_LIMITS.maxSourceFiles + 1 },
    }),
    /GALLERY_RUNTIME_SOURCE_LIMIT_CONFIGURATION: maxSourceFiles/u,
  );
});

test("accepts the frozen dormant contract with no runtime consumer", () => {
  assert.deepEqual(validateGalleryPrivateMediaV2Contract(frozenContract), []);
});

test("rejects original, private-identifier, and provider capability disclosure in the list DTO", () => {
  for (const field of ["id", "submissionId", "originalUrl", "full_signed_url", "storagePath", "providerUrl", "providerProjectId", "mediaCapability"]) {
    rejects("LIST_DTO_ORIGINAL_DISCLOSURE", (candidate) => candidate.routes.list.response.itemAllowedFields.push(field));
  }
  rejects("LIST_DTO_ORIGINAL_DISCLOSURE", (candidate) => {
    candidate.routes.list.response.itemForbiddenFields = candidate.routes.list.response.itemForbiddenFields.filter((field) => field !== "full_signed_url");
  });
});

test("rejects cursor version, opacity, authentication, snapshot, filter, direction, and expiry drift", () => {
  for (const [key, value] of [
    ["wirePrefix", "cursor."],
    ["opaque", false],
    ["versioned", false],
    ["authenticated", false],
    ["confidentiality", "NONE"],
    ["stableSnapshot", false],
    ["filterBound", false],
    ["forwardOnly", false],
    ["expiresSeconds", 3600],
  ]) rejects("CURSOR_DRIFT", (candidate) => { candidate.routes.list.pagination.cursor[key] = value; });
  rejects("CURSOR_DRIFT", (candidate) => { candidate.routes.list.pagination.cursor.safePayloadFields.push("databaseId"); });
  rejects("CURSOR_DRIFT", (candidate) => {
    candidate.routes.list.pagination.cursor.forbiddenPayloadMaterial = candidate.routes.list.pagination.cursor.forbiddenPayloadMaterial.filter((field) => field !== "storagePath");
  });
});

test("rejects incomplete or non-atomic snapshot sequencing", () => {
  rejects("SNAPSHOT_DRIFT", (candidate) => { delete candidate.routes.list.pagination.snapshot; });
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.cursor.safePayloadFields = candidate.routes.list.pagination.cursor.safePayloadFields.filter((field) => field !== "snapshotPublicationSequence");
  });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.sequenceAssignment = "SERVER_TIMESTAMP"; });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.sequenceAtomicWithVisibilityChange = false; });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.sequenceImmutable = false; });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.firstPageCapture = "MAX_AFTER_QUERY"; });
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.snapshot.everyPagePredicate = "visibleFromPublicationSequence <= snapshotPublicationSequence";
  });
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.snapshot.versionedFields = candidate.routes.list.pagination.snapshot.versionedFields.filter((field) => field !== "publishedAt");
  });
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.snapshot.coveredChanges = candidate.routes.list.pagination.snapshot.coveredChanges.filter((change) => change !== "INSERT");
  });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.laterSameTimestampInsertExcluded = false; });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.laterNullTimestampInsertExcluded = false; });
  rejects("SNAPSHOT_DRIFT", (candidate) => { candidate.routes.list.pagination.snapshot.laterVisibilityMutationExcluded = false; });
});

test("rejects incomplete public sort-tuple continuation including the null cohort", () => {
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.cursor.safePayloadFields = candidate.routes.list.pagination.cursor.safePayloadFields.filter((field) => field !== "afterPublicItemId");
  });
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.continuationPredicate.nonNullPublishedAt = "publishedAt < afterPublishedAt OR (publishedAt = afterPublishedAt AND publicItemId < afterPublicItemId)";
  });
  rejects("SNAPSHOT_DRIFT", (candidate) => {
    candidate.routes.list.pagination.continuationPredicate.nullPublishedAt = "publicItemId < afterPublicItemId";
  });
});

test("rejects raw UUID and internal-identifier acceptance for public item aliases", () => {
  rejects("PUBLIC_IDENTIFIER_DRIFT", (candidate) => { candidate.identifiers.publicItemId.source = "DATABASE_UUID"; });
  rejects("PUBLIC_IDENTIFIER_DRIFT", (candidate) => { candidate.identifiers.publicItemId.databaseIdAllowed = true; });
  rejects("PUBLIC_IDENTIFIER_DRIFT", (candidate) => { candidate.identifiers.publicItemId.submissionIdAllowed = true; });
  rejects("PUBLIC_IDENTIFIER_DRIFT", (candidate) => { candidate.identifiers.publicItemId.userIdAllowed = true; });
  rejects("PUBLIC_IDENTIFIER_DRIFT", (candidate) => { candidate.identifiers.publicItemId.storageIdAllowed = true; });
  rejects("PUBLIC_IDENTIFIER_DRIFT", (candidate) => { candidate.identifiers.publicItemId.embeddedMaterialAllowed.push("providerData"); });
});

test("rejects unstable ordering and missing unique tie-breaker", () => {
  rejects("ORDER_DRIFT", (candidate) => { candidate.routes.list.pagination.stableOrder.reverse(); });
  rejects("ORDER_DRIFT", (candidate) => { candidate.routes.list.pagination.stableOrder.pop(); });
  rejects("ORDER_DRIFT", (candidate) => { candidate.routes.list.pagination.stableOrder[0].direction = "ASC"; });
});

test("rejects page-size drift and inverted bounds", () => {
  rejects("PAGE_BOUNDS_DRIFT", (candidate) => { candidate.routes.list.pagination.pageSize.max = 80; });
  rejects("PAGE_BOUNDS_DRIFT", (candidate) => { candidate.routes.list.pagination.pageSize.default = 25; });
  rejects("PAGE_BOUNDS_DRIFT", (candidate) => { candidate.routes.list.pagination.pageSize.min = 0; });
});

test("rejects request, response, media-size, and timeout relaxation", () => {
  rejects("BOUND_DRIFT", (candidate) => { candidate.routes.list.request.bodyBytesMax = 1048576; });
  rejects("LIST_DTO_DRIFT", (candidate) => { candidate.routes.list.response.bodyBytesMax = 10485760; });
  rejects("BOUND_DRIFT", (candidate) => { candidate.routes.intent.request.timeoutMs = 30000; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.response.bodyBytesMax = 65536; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.totalTimeoutMs = 120000; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.absoluteBytesCeiling = 104857600; });
});

test("rejects thumbnail decoded/output dimension, pixel, byte, and metadata drift", () => {
  for (const [field, value] of [
    ["maxBytes", 1048576],
    ["decodedMaxEdgePixels", 4096],
    ["decodedMaxPixels", 12600000],
    ["outputMaxEdgePixels", 4096],
    ["outputMaxPixels", 12600000],
    ["metadataPolicy", "PASSTHROUGH"],
  ]) rejects("REENCODE_BOUND_DRIFT", (candidate) => { candidate.routes.list.thumbnail[field] = value; });
});

test("rejects arbitrary origins, schemes, and provider redirects", () => {
  for (const pathPrefix of ["https://media.example.invalid/content/", "data:image/webp;base64,AAAA", "javascript:alert(1)"]) {
    rejects("URL_POLICY_DRIFT", (candidate) => { candidate.routes.intent.capability.pathPrefix = pathPrefix; });
  }
  rejects("URL_POLICY_DRIFT", (candidate) => { candidate.routes.intent.capability.allowedSchemes = ["https:"]; });
  rejects("URL_POLICY_DRIFT", (candidate) => { candidate.routes.list.thumbnail.providerRedirectAllowed = true; });
});

test("rejects intent issuance before exact item, literal intent, approval, and rate checks", () => {
  rejects("INTENT_VALIDATION_DRIFT", (candidate) => { candidate.routes.intent.validation.orderedSteps.reverse(); });
  rejects("INTENT_VALIDATION_DRIFT", (candidate) => {
    candidate.routes.intent.validation.orderedSteps = candidate.routes.intent.validation.orderedSteps.filter((step) => step !== "REQUIRE_INTENT_LITERAL");
  });
  rejects("INTENT_VALIDATION_DRIFT", (candidate) => {
    candidate.routes.intent.validation.orderedSteps = candidate.routes.intent.validation.orderedSteps.filter((step) => step !== "RESOLVE_APPROVED_CURRENT_REVISION");
  });
});

test("rejects multiple, reusable, unbound, long-lived, or raw-original capabilities", () => {
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.response.capabilityCount = 2; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.singleUse = false; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.itemBound = false; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.intentBound = false; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.revisionBound = false; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.ttlSeconds.max = 3600; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.rawUploadedOriginalAllowed = true; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.metadataPolicy = "PASSTHROUGH"; });
});

test("rejects capability delivery method, media type, cache, sniffing, and referrer drift", () => {
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { delete candidate.routes.intent.capability.delivery; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { candidate.routes.intent.capability.delivery.allowedMethods = ["GET", "HEAD"]; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { candidate.routes.intent.capability.delivery.requestBodyAllowed = true; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { candidate.routes.intent.capability.delivery.successStatus = 302; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { candidate.routes.intent.capability.delivery.requiredResponseHeaders["Content-Type"] = "image/*"; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { candidate.routes.intent.capability.delivery.requiredResponseHeaders["Cache-Control"] = "private, max-age=60"; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { delete candidate.routes.intent.capability.delivery.requiredResponseHeaders["X-Content-Type-Options"]; });
  rejects("CAPABILITY_DELIVERY_DRIFT", (candidate) => { candidate.routes.intent.capability.delivery.requiredResponseHeaders["Referrer-Policy"] = "same-origin"; });
});

test("rejects capability token, path, or URL exposure through observability", () => {
  rejects("CAPABILITY_REDACTION_DRIFT", (candidate) => { delete candidate.routes.intent.capability.observability; });
  rejects("CAPABILITY_REDACTION_DRIFT", (candidate) => { candidate.routes.intent.capability.observability.redactionRequiredBeforeEmission = false; });
  for (const field of [
    "capabilityTokenLogged",
    "capabilityPathLogged",
    "capabilityUrlLogged",
    "logsIncludeCapabilityMaterial",
    "errorsIncludeCapabilityMaterial",
    "tracesIncludeCapabilityMaterial",
    "diagnosticsIncludeCapabilityMaterial",
  ]) rejects("CAPABILITY_REDACTION_DRIFT", (candidate) => { candidate.routes.intent.capability.observability[field] = true; });
});

test("rejects non-atomic, relaxed, or fail-open rate limits", () => {
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.list.rateLimit.atomic = false; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.maxRequests = 120; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.failMode = "OPEN"; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.subject.mode = "RAW_IP"; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.subject.rawIpPersisted = true; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.subject.rawAccountPersisted = true; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.subject.rawCookiePersisted = true; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.subject.browserFingerprintAllowed = true; });
  rejects("RATE_LIMIT_DRIFT", (candidate) => { candidate.routes.intent.rateLimit.subject.subjectRetentionSecondsMax = 86400; });
});

test("rejects raw diagnostics and expanded error envelopes", () => {
  rejects("ERROR_LEAKAGE", (candidate) => { candidate.errors.allowedFields.push("stack"); });
  rejects("ERROR_LEAKAGE", (candidate) => { candidate.errors.providerErrorIncluded = true; });
  rejects("ERROR_LEAKAGE", (candidate) => { candidate.errors.filesystemPathIncluded = true; });
  rejects("ERROR_LEAKAGE", (candidate) => { candidate.errors.storagePathIncluded = true; });
});

test("rejects activation and v1 compatibility drift", () => {
  rejects("LIFECYCLE_ACTIVE", (candidate) => { candidate.lifecycle.status = "ACTIVE"; });
  rejects("LIFECYCLE_ACTIVE", (candidate) => { candidate.lifecycle.activation = true; });
  rejects("LIFECYCLE_ACTIVE", (candidate) => { candidate.lifecycle.runtimeRoutesRegistered = true; });
  rejects("LIFECYCLE_ACTIVE", (candidate) => { candidate.lifecycle.runtimeMutationIncluded = true; });
  rejects("LIFECYCLE_ACTIVE", (candidate) => { candidate.lifecycle.providerMutationAuthorized = true; });
  rejects("LIFECYCLE_ACTIVE", (candidate) => { candidate.lifecycle.publicMutationIncluded = true; });
  rejects("V1_COMPATIBILITY_DRIFT", (candidate) => { candidate.v1Compatibility.mode = "REPLACE"; });
  rejects("V1_COMPATIBILITY_DRIFT", (candidate) => { candidate.v1Compatibility.automaticFallbackFromV2 = true; });
});

test("rejects dormant runtime route registration and consumption", () => {
  const pathActivation = codesFor(frozenContract, {
    "apps/web/app/api/gallery/private-media/v2/list/route.ts": "export function POST() {}",
  });
  assert.equal(pathActivation.has("ROUTE_ACTIVATION"), true);

  const consumerActivation = codesFor(frozenContract, {
    "apps/web/components/public-pages/GalleryBrowser.tsx": "fetch('/api/gallery/private-media/v2/list')",
  });
  assert.equal(consumerActivation.has("ROUTE_ACTIVATION"), true);

  const computedConsumerActivation = codesFor(frozenContract, {
    "apps/web/lib/gallery/approved-feed.ts": "fetch('/api/gallery/private-media/' + 'v2/list')",
  });
  assert.equal(computedConsumerActivation.has("ROUTE_ACTIVATION"), true);
});

test("rejects unsupported attribution, retention, and account-deletion claims", () => {
  for (const gate of ["attribution", "retention", "accountDeletion"]) {
    rejects("DECISION_GATE_CLAIM", (candidate) => { candidate.decisionGates[gate].status = "RESOLVED"; });
    rejects("DECISION_GATE_CLAIM", (candidate) => { candidate.decisionGates[gate].runtimeClaimAllowed = true; });
    rejects("DECISION_GATE_CLAIM", (candidate) => { candidate.decisionGates[gate].activationBlocking = false; });
  }
});

test("rejects invented viewer derivative bounds and resolved-gate claims", () => {
  rejects("DECISION_GATE_CLAIM", (candidate) => { candidate.decisionGates.viewerDerivativeBounds.status = "RESOLVED"; });
  rejects("DECISION_GATE_CLAIM", (candidate) => { candidate.decisionGates.viewerDerivativeBounds.activationBlocking = false; });
  rejects("CAPABILITY_DRIFT", (candidate) => { candidate.routes.intent.capability.decodedMaxPixels = 12600000; });
});

test("rejects cost-neutral and preflight-free activation claims", () => {
  rejects("COST_CLAIM_DRIFT", (candidate) => { candidate.cost.futureActivation.classification = "COST_NEUTRAL"; });
  rejects("COST_CLAIM_DRIFT", (candidate) => { candidate.cost.futureActivation.activationBlocking = false; });
  rejects("COST_CLAIM_DRIFT", (candidate) => { candidate.cost.futureActivation.currentQuotaBillingPreflightRequired = false; });
  rejects("COST_CLAIM_DRIFT", (candidate) => { candidate.cost.currentPacket.runtimeCostMutation = true; });
});

test("rejects secret material, private identifiers, provider URLs, and private paths", () => {
  for (const value of [
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signaturevalue",
    "123e4567-e89b-42d3-a456-426614174000",
    "https://abcdefghijklmnopqrst.supabase.co",
    "/storage/v1/object/sign/private/file.webp",
    "_approved/originals/private.webp",
    "AKIAIOSFODNN7EXAMPLE",
  ]) {
    rejects("SENSITIVE_VALUE", (candidate) => { candidate.privacy.note = value; });
  }
});

test("rejects unsupported contract and route fields", () => {
  rejects("CONTRACT_SHAPE_DRIFT", (candidate) => { candidate.runtimeEnabled = true; });
  rejects("CONTRACT_SHAPE_DRIFT", (candidate) => { candidate.routes.preview = { activation: true }; });
  rejects("CONTRACT_SHAPE_DRIFT", (candidate) => { candidate.routes.intent.unsafeFallback = true; });
});
