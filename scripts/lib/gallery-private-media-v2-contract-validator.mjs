import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

export const GALLERY_RUNTIME_SOURCE_ROOTS = Object.freeze([
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "supabase/functions",
]);

export const GALLERY_RUNTIME_SOURCE_EXCLUDED_DIRECTORY_NAMES = Object.freeze([
  ".deno",
  ".git",
  ".next",
  "node_modules",
  "vendor",
]);

export const GALLERY_RUNTIME_SOURCE_LIMITS = Object.freeze({
  maxDepth: 32,
  maxVisitedDirectories: 4096,
  maxVisitedEntries: 50000,
  maxSourceFiles: 8192,
  maxSourceFileBytes: 4 * 1024 * 1024,
  maxSourceBytes: 64 * 1024 * 1024,
});

const galleryRuntimeSourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const galleryRuntimeExcludedDirectoryNames = new Set(GALLERY_RUNTIME_SOURCE_EXCLUDED_DIRECTORY_NAMES);

function boundedRuntimeSourceLimits(overrides = {}) {
  const limits = {};
  for (const [name, ceiling] of Object.entries(GALLERY_RUNTIME_SOURCE_LIMITS)) {
    const value = overrides[name] ?? ceiling;
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw new Error(`GALLERY_RUNTIME_SOURCE_LIMIT_CONFIGURATION: ${name}`);
    }
    limits[name] = value;
  }
  for (const name of Object.keys(overrides)) {
    if (!(name in GALLERY_RUNTIME_SOURCE_LIMITS)) {
      throw new Error(`GALLERY_RUNTIME_SOURCE_LIMIT_CONFIGURATION: ${name}`);
    }
  }
  return limits;
}

function runtimeSourceLimitError(code) {
  return new Error(`GALLERY_RUNTIME_SOURCE_LIMIT: ${code}`);
}

export function collectGalleryPrivateMediaV2RuntimeSources(root, { limits: limitOverrides } = {}) {
  const resolvedRoot = resolve(root);
  const limits = boundedRuntimeSourceLimits(limitOverrides);
  const sources = {};
  const stats = {
    skippedGeneratedDirectories: 0,
    skippedNonRegularEntries: 0,
    sourceBytes: 0,
    sourceFiles: 0,
    visitedDirectories: 0,
    visitedEntries: 0,
  };

  function visit(absolutePath, depth) {
    if (depth > limits.maxDepth) throw runtimeSourceLimitError("MAX_DEPTH");
    stats.visitedDirectories += 1;
    if (stats.visitedDirectories > limits.maxVisitedDirectories) {
      throw runtimeSourceLimitError("DIRECTORY_COUNT");
    }

    const entries = readdirSync(absolutePath, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    stats.visitedEntries += entries.length;
    if (stats.visitedEntries > limits.maxVisitedEntries) {
      throw runtimeSourceLimitError("ENTRY_COUNT");
    }

    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();
      if (galleryRuntimeExcludedDirectoryNames.has(lowerName)) {
        stats.skippedGeneratedDirectories += 1;
        continue;
      }

      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(child, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        stats.skippedNonRegularEntries += 1;
        continue;
      }
      if (!galleryRuntimeSourceExtensions.has(extname(entry.name).toLowerCase())) continue;

      stats.sourceFiles += 1;
      if (stats.sourceFiles > limits.maxSourceFiles) {
        throw runtimeSourceLimitError("SOURCE_FILE_COUNT");
      }
      const fileSize = lstatSync(child).size;
      if (fileSize > limits.maxSourceFileBytes) {
        throw runtimeSourceLimitError("SOURCE_FILE_BYTES");
      }
      if (stats.sourceBytes + fileSize > limits.maxSourceBytes) {
        throw runtimeSourceLimitError("SOURCE_TOTAL_BYTES");
      }

      const bytes = readFileSync(child);
      if (bytes.length > limits.maxSourceFileBytes) {
        throw runtimeSourceLimitError("SOURCE_FILE_BYTES");
      }
      stats.sourceBytes += bytes.length;
      if (stats.sourceBytes > limits.maxSourceBytes) {
        throw runtimeSourceLimitError("SOURCE_TOTAL_BYTES");
      }
      sources[relative(resolvedRoot, child).replaceAll("\\", "/")] = bytes.toString("utf8");
    }
  }

  for (const sourceRoot of GALLERY_RUNTIME_SOURCE_ROOTS) {
    const absolutePath = resolve(resolvedRoot, sourceRoot);
    if (existsSync(absolutePath)) visit(absolutePath, 0);
  }
  return { sources, stats };
}

const EXPECTED = Object.freeze({
  identity: {
    schemaVersion: 1,
    contractId: "gallery-private-media",
    contractVersion: "2.0.0",
    dtoVersion: "gallery-private-media.v2",
  },
  lifecycle: {
    status: "DORMANT_SOURCE_ONLY",
    activation: false,
    runtimeRoutesRegistered: false,
    runtimeMutationIncluded: false,
    providerMutationAuthorized: false,
    publicMutationIncluded: false,
  },
  v1Compatibility: {
    mode: "PRESERVE_UNCHANGED",
    routeOwner: "list-approved-gallery-submissions",
    consumerOptInRequired: true,
    automaticFallbackFromV2: false,
    cutoverRequiresApproval: true,
  },
  identifiers: {
    publicItemId: {
      source: "SERVER_GENERATED_PUBLIC_ALIAS",
      wirePrefix: "gpm2i.",
      alphabet: "BASE64URL_NO_PADDING",
      minOpaqueCharacters: 22,
      maxOpaqueCharacters: 43,
      stableAcrossPages: true,
      databaseIdAllowed: false,
      submissionIdAllowed: false,
      userIdAllowed: false,
      storageIdAllowed: false,
      embeddedMaterialAllowed: [],
    },
  },
  list: {
    method: "POST",
    path: "/api/gallery/private-media/v2/list",
    request: {
      contentType: "application/json",
      allowedFields: ["cursor", "pageSize"],
      bodyBytesMax: 1024,
      timeoutMs: 3000,
    },
    response: {
      contentType: "application/json",
      versionLiteral: "gallery-private-media.v2",
      allowedFields: ["version", "items", "nextCursor", "hasMore"],
      itemAllowedFields: [
        "publicItemId",
        "thumbnailUrl",
        "thumbnailWidth",
        "thumbnailHeight",
        "caption",
        "category",
        "publishedAt",
      ],
      itemForbiddenFields: [
        "id",
        "submissionId",
        "uploaderId",
        "profileId",
        "storagePath",
        "bucket",
        "originalUrl",
        "fullUrl",
        "fullSignedUrl",
        "full_signed_url",
        "mediaUrl",
        "mediaCapability",
        "providerUrl",
        "providerPath",
      ],
      bodyBytesMax: 262144,
      timeoutMs: 4000,
    },
    thumbnail: {
      urlPolicy: "SAME_ORIGIN_RELATIVE",
      pathPrefix: "/api/gallery/private-media/v2/thumb/",
      providerRedirectAllowed: false,
      maxBytes: 81920,
      decodedMaxEdgePixels: 720,
      decodedMaxPixels: 518400,
      outputMaxEdgePixels: 720,
      outputMaxPixels: 518400,
      metadataPolicy: "SANITIZED_REENCODE_ONLY",
    },
    pagination: {
      pageSize: { min: 1, default: 24, max: 24 },
      cursor: {
        wirePrefix: "gpm2c.",
        opaque: true,
        versioned: true,
        authenticated: true,
        confidentiality: "AEAD_REQUIRED",
        clientDecodingRequired: false,
        stableSnapshot: true,
        filterBound: true,
        forwardOnly: true,
        expiresSeconds: 900,
        safePayloadFields: [
          "version",
          "snapshotPublicationSequence",
          "afterPublishedAt",
          "afterPublicItemId",
          "filterDigest",
          "expiresAt",
        ],
        forbiddenPayloadMaterial: [
          "databaseId",
          "submissionId",
          "userId",
          "storagePath",
          "providerData",
          "capability",
        ],
      },
      snapshot: {
        mode: "VERSIONED_VISIBILITY_SEQUENCE",
        cursorField: "snapshotPublicationSequence",
        sequenceClassification: "NON_SECRET_SNAPSHOT_MATERIAL",
        sequenceAssignment: "SERVER_ASSIGNED_GLOBAL_STRICT_MONOTONIC",
        sequenceAtomicWithVisibilityChange: true,
        sequenceImmutable: true,
        firstPageCapture: "ATOMIC_COMMITTED_HIGH_WATER_AT_REQUEST_START",
        everyPagePredicate: "visibleFromPublicationSequence <= snapshotPublicationSequence AND (visibleUntilPublicationSequence IS NULL OR visibleUntilPublicationSequence > snapshotPublicationSequence)",
        versionedFields: [
          "publishedAt",
          "publicItemId",
          "filterMembership",
          "visibility",
        ],
        coveredChanges: [
          "INSERT",
          "PUBLISH",
          "UNPUBLISH",
          "REPUBLISH",
          "PUBLISHED_AT_CHANGE",
          "PUBLIC_ITEM_ID_CHANGE",
          "FILTER_MEMBERSHIP_CHANGE",
        ],
        laterSameTimestampInsertExcluded: true,
        laterNullTimestampInsertExcluded: true,
        laterVisibilityMutationExcluded: true,
      },
      stableOrder: [
        { field: "publishedAt", direction: "DESC", nulls: "LAST" },
        { field: "publicItemId", direction: "DESC", nulls: "FORBIDDEN" },
      ],
      continuationPredicate: {
        nonNullPublishedAt: "publishedAt < afterPublishedAt OR (publishedAt = afterPublishedAt AND publicItemId < afterPublicItemId) OR publishedAt IS NULL",
        nullPublishedAt: "publishedAt IS NULL AND publicItemId < afterPublicItemId",
      },
    },
    rateLimit: {
      atomic: true,
      windowSeconds: 60,
      maxRequests: 30,
      subject: {
        mode: "SERVER_KEYED_WINDOW_DIGEST",
        digestBytes: 32,
        windowBound: true,
        keyRotationRequired: true,
        rawIpPersisted: false,
        rawAccountPersisted: false,
        rawCookiePersisted: false,
        browserFingerprintAllowed: false,
        subjectRetentionSecondsMax: 120,
      },
      failMode: "CLOSED",
    },
  },
  intent: {
    method: "POST",
    path: "/api/gallery/private-media/v2/intent",
    request: {
      contentType: "application/json",
      allowedFields: ["publicItemId", "intent"],
      bodyBytesMax: 512,
      timeoutMs: 3000,
      intentLiteral: "OPEN_MEDIA",
    },
    validation: {
      orderedSteps: [
        "PARSE_BOUNDED_BODY",
        "REQUIRE_EXACT_FIELDS",
        "REQUIRE_PUBLIC_ITEM_ID",
        "REQUIRE_INTENT_LITERAL",
        "RESOLVE_APPROVED_CURRENT_REVISION",
        "ENFORCE_ATOMIC_RATE_LIMIT",
        "ISSUE_CAPABILITY",
      ],
      unknownItemResponse: "NOT_FOUND",
      invalidIntentResponse: "INVALID_REQUEST",
    },
    response: {
      contentType: "application/json",
      versionLiteral: "gallery-private-media.v2",
      allowedFields: ["version", "publicItemId", "capabilityUrl", "expiresAt"],
      bodyBytesMax: 2048,
      timeoutMs: 4000,
      capabilityCount: 1,
    },
    capability: {
      urlPolicy: "SAME_ORIGIN_RELATIVE",
      pathPrefix: "/api/gallery/private-media/v2/content/",
      allowedSchemes: [],
      providerRedirectAllowed: false,
      ttlSeconds: { min: 15, default: 45, max: 60 },
      singleUse: true,
      itemBound: true,
      intentBound: true,
      revisionBound: true,
      metadataPolicy: "SANITIZED_REENCODE_ONLY",
      rawUploadedOriginalAllowed: false,
      absoluteBytesCeiling: 52428800,
      decodedOutputBoundsGate: "viewerDerivativeBounds",
      firstByteTimeoutMs: 5000,
      totalTimeoutMs: 30000,
      delivery: {
        allowedMethods: ["GET"],
        requestBodyAllowed: false,
        successStatus: 200,
        requiredResponseHeaders: {
          "Content-Type": "image/webp",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      },
      observability: {
        redactionRequiredBeforeEmission: true,
        capabilityTokenLogged: false,
        capabilityPathLogged: false,
        capabilityUrlLogged: false,
        logsIncludeCapabilityMaterial: false,
        errorsIncludeCapabilityMaterial: false,
        tracesIncludeCapabilityMaterial: false,
        diagnosticsIncludeCapabilityMaterial: false,
      },
    },
    rateLimit: {
      atomic: true,
      windowSeconds: 60,
      maxRequests: 12,
      subject: {
        mode: "SERVER_KEYED_WINDOW_DIGEST",
        digestBytes: 32,
        windowBound: true,
        keyRotationRequired: true,
        rawIpPersisted: false,
        rawAccountPersisted: false,
        rawCookiePersisted: false,
        browserFingerprintAllowed: false,
        subjectRetentionSecondsMax: 120,
      },
      failMode: "CLOSED",
    },
  },
  errors: {
    allowedFields: ["code", "message"],
    allowedCodes: ["INVALID_REQUEST", "INVALID_CURSOR", "NOT_FOUND", "RATE_LIMITED", "UNAVAILABLE"],
    providerErrorIncluded: false,
    stackIncluded: false,
    causeIncluded: false,
    filesystemPathIncluded: false,
    storagePathIncluded: false,
  },
  privacy: {
    sampleIdentifiersIncluded: false,
    sampleCapabilitiesIncluded: false,
    providerIdentifiersIncluded: false,
    secretMaterialIncluded: false,
  },
  cost: {
    currentPacket: {
      classification: "SOURCE_ONLY_NO_RUNTIME_COST_MUTATION",
      runtimeCostMutation: false,
    },
    futureActivation: {
      classification: "COST_UNKNOWN",
      activationBlocking: true,
      currentQuotaBillingPreflightRequired: true,
      dimensions: ["EGRESS", "COMPUTE", "STORAGE"],
    },
  },
  decisionGate: {
    status: "UNRESOLVED",
    activationBlocking: true,
    runtimeClaimAllowed: false,
  },
});

const originalDisclosurePattern = /(?:original|full|media|storage|bucket|provider|submission|uploader|profile|signed)/iu;
const sensitiveValuePatterns = [
  { label: "JWT-like value", pattern: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/u },
  { label: "UUID/private identifier", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu },
  { label: "provider project URL", pattern: /https:\/\/[a-z0-9]{16,}\.supabase\.co\b/iu },
  { label: "signed storage URL", pattern: /\/storage\/v1\/object\/sign\//iu },
  { label: "private storage prefix", pattern: /(?:^|[\s"'`])_approved\//iu },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
];

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function add(failures, code, path, message) {
  failures.push({ code, path, message });
}

function requireExact(failures, code, path, actual, expected) {
  if (!sameJson(actual, expected)) add(failures, code, path, `${path} drifted from the frozen v2 design.`);
}

function requireExactKeys(failures, code, path, actual, expectedKeys) {
  const actualKeys = actual && typeof actual === "object" && !Array.isArray(actual)
    ? Object.keys(actual).sort()
    : [];
  const sortedExpected = [...expectedKeys].sort();
  if (!sameJson(actualKeys, sortedExpected)) add(failures, code, path, `${path} contains missing or unsupported fields.`);
}

function visitStrings(value, path, visitor) {
  if (typeof value === "string") {
    visitor(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStrings(entry, `${path}[${index}]`, visitor));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => visitStrings(entry, `${path}.${key}`, visitor));
  }
}

function validateSensitiveValues(contract, failures) {
  visitStrings(contract, "contract", (value, path) => {
    for (const { label, pattern } of sensitiveValuePatterns) {
      if (pattern.test(value)) add(failures, "SENSITIVE_VALUE", path, `${path} contains a ${label}.`);
    }
  });
}

function validateUrlPolicies(contract, failures) {
  for (const [path, value] of [
    ["routes.list.thumbnail", contract?.routes?.list?.thumbnail],
    ["routes.intent.capability", contract?.routes?.intent?.capability],
  ]) {
    if (value?.urlPolicy !== "SAME_ORIGIN_RELATIVE" ||
        value?.providerRedirectAllowed !== false ||
        typeof value?.pathPrefix !== "string" ||
        !value.pathPrefix.startsWith("/api/gallery/private-media/v2/") ||
        value.pathPrefix.includes("://") ||
        /^(?:data|javascript|file):/iu.test(value.pathPrefix)) {
      add(failures, "URL_POLICY_DRIFT", path, `${path} must remain a non-redirecting same-origin relative path.`);
    }
  }
  if (!Array.isArray(contract?.routes?.intent?.capability?.allowedSchemes) ||
      contract.routes.intent.capability.allowedSchemes.length !== 0) {
    add(failures, "URL_POLICY_DRIFT", "routes.intent.capability.allowedSchemes", "Capability schemes must remain empty.");
  }
}

function validateListDisclosure(contract, failures) {
  const fields = contract?.routes?.list?.response?.itemAllowedFields;
  if (!Array.isArray(fields)) return;
  const forbidden = new Set(contract?.routes?.list?.response?.itemForbiddenFields || []);
  for (const field of fields) {
    if (field !== "publicItemId" && (forbidden.has(field) || originalDisclosurePattern.test(field))) {
      add(failures, "LIST_DTO_ORIGINAL_DISCLOSURE", `routes.list.response.itemAllowedFields.${field}`, `List DTO exposes forbidden field ${field}.`);
    }
  }
  for (const required of EXPECTED.list.response.itemForbiddenFields) {
    if (!forbidden.has(required)) {
      add(failures, "LIST_DTO_ORIGINAL_DISCLOSURE", "routes.list.response.itemForbiddenFields", `List DTO no longer forbids ${required}.`);
    }
  }
}

function validateSnapshotSemantics(contract, failures) {
  const pagination = contract?.routes?.list?.pagination;
  const cursor = pagination?.cursor;
  const snapshot = pagination?.snapshot;
  const safeFields = new Set(cursor?.safePayloadFields || []);
  const forbiddenFields = new Set(cursor?.forbiddenPayloadMaterial || []);

  if (!snapshot || !safeFields.has(snapshot.cursorField) || snapshot.cursorField !== "snapshotPublicationSequence") {
    add(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.snapshot.cursorField", "Snapshot ceiling must be carried by the authenticated confidential cursor.");
  }
  for (const field of safeFields) {
    if (forbiddenFields.has(field)) {
      add(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.cursor", `Cursor field ${field} cannot be both safe and forbidden.`);
    }
  }
  for (const field of ["publishedAt", "publicItemId", "filterMembership", "visibility"]) {
    if (!snapshot?.versionedFields?.includes(field)) {
      add(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.snapshot.versionedFields", `Snapshot does not version ${field}.`);
    }
  }
  for (const change of ["INSERT", "PUBLISH", "UNPUBLISH", "REPUBLISH", "PUBLISHED_AT_CHANGE", "PUBLIC_ITEM_ID_CHANGE", "FILTER_MEMBERSHIP_CHANGE"]) {
    if (!snapshot?.coveredChanges?.includes(change)) {
      add(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.snapshot.coveredChanges", `Snapshot does not cover ${change}.`);
    }
  }
  if (snapshot?.sequenceAtomicWithVisibilityChange !== true ||
      snapshot?.sequenceImmutable !== true ||
      snapshot?.laterSameTimestampInsertExcluded !== true ||
      snapshot?.laterNullTimestampInsertExcluded !== true ||
      snapshot?.laterVisibilityMutationExcluded !== true) {
    add(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.snapshot", "Snapshot sequencing must atomically exclude every later visibility change.");
  }
  if (!safeFields.has("afterPublishedAt") || !safeFields.has("afterPublicItemId") ||
      typeof pagination?.continuationPredicate?.nonNullPublishedAt !== "string" ||
      !pagination.continuationPredicate.nonNullPublishedAt.includes("publishedAt IS NULL") ||
      pagination?.continuationPredicate?.nullPublishedAt !== "publishedAt IS NULL AND publicItemId < afterPublicItemId") {
    add(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.continuationPredicate", "Continuation must cover the complete public sort tuple and null cohort.");
  }
}

function validateCapabilityDelivery(contract, failures) {
  const capability = contract?.routes?.intent?.capability;
  const delivery = capability?.delivery;
  const headers = delivery?.requiredResponseHeaders;
  if (!sameJson(delivery?.allowedMethods, ["GET"]) || delivery?.requestBodyAllowed !== false || delivery?.successStatus !== 200) {
    add(failures, "CAPABILITY_DELIVERY_DRIFT", "routes.intent.capability.delivery", "Capability delivery must accept only bodyless GET and return the frozen success status.");
  }
  if (!sameJson(headers, {
    "Content-Type": "image/webp",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  })) {
    add(failures, "CAPABILITY_DELIVERY_DRIFT", "routes.intent.capability.delivery.requiredResponseHeaders", "Capability delivery headers drifted from the exact media/privacy boundary.");
  }

  const observability = capability?.observability;
  const forbiddenTrueFields = [
    "capabilityTokenLogged",
    "capabilityPathLogged",
    "capabilityUrlLogged",
    "logsIncludeCapabilityMaterial",
    "errorsIncludeCapabilityMaterial",
    "tracesIncludeCapabilityMaterial",
    "diagnosticsIncludeCapabilityMaterial",
  ];
  if (observability?.redactionRequiredBeforeEmission !== true ||
      forbiddenTrueFields.some((field) => observability?.[field] !== false)) {
    add(failures, "CAPABILITY_REDACTION_DRIFT", "routes.intent.capability.observability", "Capability token, path, and URL material must be redacted before logs, errors, traces, or diagnostics are emitted.");
  }
}

function validateDecisionGates(contract, failures) {
  for (const name of ["attribution", "retention", "accountDeletion", "viewerDerivativeBounds"]) {
    if (!sameJson(contract?.decisionGates?.[name], EXPECTED.decisionGate)) {
      add(failures, "DECISION_GATE_CLAIM", `decisionGates.${name}`, `${name} must remain unresolved and activation-blocking.`);
    }
  }
}

function validateRuntimeSources(runtimeSources, failures) {
  for (const [sourcePath, source] of Object.entries(runtimeSources || {})) {
    const normalized = sourcePath.replaceAll("\\", "/").toLowerCase();
    const routePathActivated = normalized.startsWith("apps/web/app/api/gallery/private-media/v2/") ||
      normalized.startsWith("supabase/functions/gallery-private-media-v2/") ||
      (normalized.startsWith("supabase/functions/") && /gallery.*v2|v2.*gallery/u.test(normalized));
    const compactSource = source.replace(/[\s"'`+]/gu, "").toLowerCase();
    const runtimeReference = compactSource.includes("/api/gallery/private-media/v2/") ||
      compactSource.includes("gallery-private-media.v2");
    if (routePathActivated || runtimeReference) {
      add(failures, "ROUTE_ACTIVATION", sourcePath, `${sourcePath} activates or consumes the dormant v2 contract.`);
    }
  }
}

export function validateGalleryPrivateMediaV2Contract(contract, { runtimeSources = {} } = {}) {
  const failures = [];
  requireExactKeys(failures, "CONTRACT_SHAPE_DRIFT", "contract", contract, [
    "schemaVersion",
    "contractId",
    "contractVersion",
    "dtoVersion",
    "lifecycle",
    "v1Compatibility",
    "identifiers",
    "routes",
    "errors",
    "privacy",
    "cost",
    "decisionGates",
  ]);
  requireExactKeys(failures, "CONTRACT_SHAPE_DRIFT", "routes", contract?.routes, ["list", "intent"]);
  requireExactKeys(failures, "CONTRACT_SHAPE_DRIFT", "routes.list", contract?.routes?.list, [
    "method", "path", "request", "response", "thumbnail", "pagination", "rateLimit",
  ]);
  requireExactKeys(failures, "CONTRACT_SHAPE_DRIFT", "routes.intent", contract?.routes?.intent, [
    "method", "path", "request", "validation", "response", "capability", "rateLimit",
  ]);
  requireExactKeys(failures, "CONTRACT_SHAPE_DRIFT", "decisionGates", contract?.decisionGates, [
    "attribution", "retention", "accountDeletion", "viewerDerivativeBounds",
  ]);
  requireExact(failures, "CONTRACT_IDENTITY_DRIFT", "identity", {
    schemaVersion: contract?.schemaVersion,
    contractId: contract?.contractId,
    contractVersion: contract?.contractVersion,
    dtoVersion: contract?.dtoVersion,
  }, EXPECTED.identity);
  requireExact(failures, "LIFECYCLE_ACTIVE", "lifecycle", contract?.lifecycle, EXPECTED.lifecycle);
  requireExact(failures, "V1_COMPATIBILITY_DRIFT", "v1Compatibility", contract?.v1Compatibility, EXPECTED.v1Compatibility);
  requireExact(failures, "PUBLIC_IDENTIFIER_DRIFT", "identifiers", contract?.identifiers, EXPECTED.identifiers);

  const list = contract?.routes?.list;
  requireExact(failures, "LIST_ROUTE_DRIFT", "routes.list.method", list?.method, EXPECTED.list.method);
  requireExact(failures, "LIST_ROUTE_DRIFT", "routes.list.path", list?.path, EXPECTED.list.path);
  requireExact(failures, "BOUND_DRIFT", "routes.list.request", list?.request, EXPECTED.list.request);
  requireExact(failures, "LIST_DTO_DRIFT", "routes.list.response", list?.response, EXPECTED.list.response);
  requireExact(failures, "REENCODE_BOUND_DRIFT", "routes.list.thumbnail", list?.thumbnail, EXPECTED.list.thumbnail);
  requireExact(failures, "PAGE_BOUNDS_DRIFT", "routes.list.pagination.pageSize", list?.pagination?.pageSize, EXPECTED.list.pagination.pageSize);
  requireExact(failures, "CURSOR_DRIFT", "routes.list.pagination.cursor", list?.pagination?.cursor, EXPECTED.list.pagination.cursor);
  requireExact(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.snapshot", list?.pagination?.snapshot, EXPECTED.list.pagination.snapshot);
  requireExact(failures, "ORDER_DRIFT", "routes.list.pagination.stableOrder", list?.pagination?.stableOrder, EXPECTED.list.pagination.stableOrder);
  requireExact(failures, "SNAPSHOT_DRIFT", "routes.list.pagination.continuationPredicate", list?.pagination?.continuationPredicate, EXPECTED.list.pagination.continuationPredicate);
  requireExact(failures, "RATE_LIMIT_DRIFT", "routes.list.rateLimit", list?.rateLimit, EXPECTED.list.rateLimit);

  const intent = contract?.routes?.intent;
  requireExact(failures, "INTENT_ROUTE_DRIFT", "routes.intent.method", intent?.method, EXPECTED.intent.method);
  requireExact(failures, "INTENT_ROUTE_DRIFT", "routes.intent.path", intent?.path, EXPECTED.intent.path);
  requireExact(failures, "BOUND_DRIFT", "routes.intent.request", intent?.request, EXPECTED.intent.request);
  requireExact(failures, "INTENT_VALIDATION_DRIFT", "routes.intent.validation", intent?.validation, EXPECTED.intent.validation);
  requireExact(failures, "CAPABILITY_DRIFT", "routes.intent.response", intent?.response, EXPECTED.intent.response);
  requireExact(failures, "CAPABILITY_DRIFT", "routes.intent.capability", intent?.capability, EXPECTED.intent.capability);
  requireExact(failures, "CAPABILITY_DELIVERY_DRIFT", "routes.intent.capability.delivery", intent?.capability?.delivery, EXPECTED.intent.capability.delivery);
  requireExact(failures, "CAPABILITY_REDACTION_DRIFT", "routes.intent.capability.observability", intent?.capability?.observability, EXPECTED.intent.capability.observability);
  requireExact(failures, "RATE_LIMIT_DRIFT", "routes.intent.rateLimit", intent?.rateLimit, EXPECTED.intent.rateLimit);
  requireExact(failures, "ERROR_LEAKAGE", "errors", contract?.errors, EXPECTED.errors);
  requireExact(failures, "PRIVACY_DRIFT", "privacy", contract?.privacy, EXPECTED.privacy);
  requireExact(failures, "COST_CLAIM_DRIFT", "cost", contract?.cost, EXPECTED.cost);

  validateListDisclosure(contract, failures);
  validateSnapshotSemantics(contract, failures);
  validateUrlPolicies(contract, failures);
  validateCapabilityDelivery(contract, failures);
  validateDecisionGates(contract, failures);
  validateSensitiveValues(contract, failures);
  validateRuntimeSources(runtimeSources, failures);
  return failures;
}

export function summarizeGalleryPrivateMediaV2Failures(failures) {
  return failures.map(({ code, path, message }) => `[${code}] ${path}: ${message}`);
}
