import { readFileSync } from "node:fs";

const failures = [];

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertIncludes(label, text, snippet) {
  assert(text.includes(snippet), `${label}: expected snippet not found: ${snippet}`);
}

function assertNotIncludes(label, text, snippet) {
  assert(!text.includes(snippet), `${label}: retired or unsafe snippet found: ${snippet}`);
}

function assertMatches(label, text, pattern, message) {
  assert(pattern.test(text), `${label}: ${message}`);
}

const packageJson = read("package.json");
const checkAll = read("scripts/check-all.mjs");
const edgeTypeCheck = read("scripts/check-supabase-edge-types.mjs");
const supabaseConfig = read("supabase/config.toml");
const galleryRoute = read("apps/web/app/gallery/page.tsx");
const galleryRouteComponent = read("apps/web/components/public-pages/route-pages/GalleryPage.tsx");
const galleryBrowser = read("apps/web/components/public-pages/GalleryBrowser.tsx");
const responsiveGalleryMedia = read("apps/web/components/ResponsiveGalleryMedia.tsx");
const galleryBrowserState = read("apps/web/lib/gallery/browser-state.ts");
const galleryBrowserStateTests = read("apps/web/lib/gallery/browser-state_test.ts");
const leaderDashboard = read("apps/web/components/member-workflow/LeaderDashboard.tsx");
const leaderDashboardParts = read("apps/web/components/member-workflow/LeaderDashboardParts.tsx");
const browserThumbnail = read("apps/web/lib/gallery-thumbnail.ts");
const moderationPreviewClient = read("apps/web/lib/gallery/moderation-preview-client.ts");
const moderationPreviewRoute = read("apps/web/lib/gallery/moderation-preview-route.ts");
const moderationPreviewServer = read("apps/web/lib/gallery/moderation-preview-server.ts");
const moderationPreviewServerCore = read("apps/web/lib/gallery/moderation-preview-server-core.ts");
const previewAttestation = read("supabase/functions/_shared/gallery-preview-attestation.ts");
const previewAttestationTests = read("supabase/functions/_shared/gallery-preview-attestation_test.ts");
const protectedCors = read("supabase/functions/_shared/cors.ts");
const galleryModerationShared = read("supabase/functions/_shared/gallery-moderation.ts");
const approvedFeedClient = read("apps/web/lib/gallery/approved-feed.ts");
const approvedFeedClientTests = read("apps/web/lib/gallery/approved-feed_test.ts");
const safePreview = read("apps/web/lib/gallery/safe-preview.ts");
const safePreviewTests = read("apps/web/lib/gallery/safe-preview_test.ts");
const approvedFeedFunction = read("supabase/functions/list-approved-gallery-submissions/index.ts");
const publicFeedHelper = read("supabase/functions/_shared/gallery-public-feed.ts");
const publicFeedHelperTests = read("supabase/functions/_shared/gallery-public-feed_test.ts");
const reviewQueue = read("supabase/functions/list-gallery-review-queue/index.ts");
const moderation = read("supabase/functions/moderate-gallery-submission/index.ts");
const thumbnailParser = read("supabase/functions/_shared/gallery-thumbnail.ts");
const thumbnailTests = read("supabase/functions/_shared/gallery-thumbnail_test.ts");
const sourceImageParser = read("supabase/functions/_shared/gallery-source-image.ts");
const sourceImageTests = read("supabase/functions/_shared/gallery-source-image_test.ts");
const sourceDecode = read("supabase/functions/_shared/gallery-source-decode.ts");
const sourceDecodeTests = read("supabase/functions/_shared/gallery-source-decode_test.ts");
const thumbnailMigration = read("supabase/migrations/20260727145241_add_gallery_submission_thumbnails.sql");
const publicFeedMigration = read("supabase/migrations/20260728130000_add_gallery_public_feed_v2.sql");
const publicationMigration = read("supabase/migrations/20260728132000_add_gallery_publication_revisions.sql");
const thumbnailDatabaseTests = read("supabase/tests/gallery_submission_thumbnails_test.sql");
const publicFeedDatabaseTests = read("supabase/tests/gallery_public_feed_v2_test.sql");
const galleryGuide = read("docs/gallery-guide.md");
const moderationRunbook = read("docs/member-gallery-moderation-runbook.md");
const deliveryContract = read("docs/integrations/gallery-public-media-delivery.md");

const rollbackCompatibilityMatch = publicationMigration.match(
  /create or replace function public\.gallery_publishable_submissions\([\s\S]*?comment on function public\.gallery_publishable_submissions\(integer, integer\) is[\s\S]*?;\r?\n/,
);
const rollbackCompatibility = rollbackCompatibilityMatch?.[0] || "";
const atomicMediaReservationMatch = publicationMigration.match(
  /create function public\.gallery_reserve_public_media_v2\([\s\S]*?revoke all on function public\.gallery_reserve_public_media_v2/,
);
const atomicMediaReservation = atomicMediaReservationMatch?.[0] || "";

const functionBlocks = [...supabaseConfig.matchAll(/\[functions\.([^\]]+)\]([\s\S]*?)(?=\n\[functions\.|\s*$)/g)];
const verifyJwtFalse = functionBlocks.filter(([, , body]) => /verify_jwt\s*=\s*false/.test(body));
const verifyJwtTrue = functionBlocks.filter(([, , body]) => /verify_jwt\s*=\s*true/.test(body));
assert(functionBlocks.length === 33, `Supabase function inventory: expected 33, found ${functionBlocks.length}.`);
assert(verifyJwtTrue.length === 20, `Supabase function inventory: expected 20 verify_jwt=true, found ${verifyJwtTrue.length}.`);
assert(verifyJwtFalse.length === 13, `Supabase function inventory: expected 13 verify_jwt=false, found ${verifyJwtFalse.length}.`);
const approvedFeedConfig = functionBlocks.find(([, name]) => name === "list-approved-gallery-submissions");
assert(Boolean(approvedFeedConfig), "Supabase function inventory: list-approved-gallery-submissions is not configured.");
assert(
  Boolean(approvedFeedConfig && /verify_jwt\s*=\s*false/.test(approvedFeedConfig[2])),
  "Supabase function inventory: the credential-free public Gallery feed must retain its reviewed verify_jwt=false classification.",
);

[
  '"test:gallery-approved-feed-client"',
  '"test:gallery-browser-state"',
  '"test:gallery-safe-preview"',
  '"test:gallery-public-feed"',
  '"test:gallery-public-feed-db"',
  '"test:gallery-source-image"',
  '"test:gallery-source-decode"',
  '"test:gallery-moderation-preview"',
  '"test:gallery-preview-attestation"',
  '"check:gallery-approved-feed"',
].forEach((snippet) => assertIncludes("package scripts", packageJson, snippet));

[
  '"test:gallery-approved-feed-client"',
  '"test:gallery-browser-state"',
  '"test:gallery-safe-preview"',
  '"test:gallery-source-decode"',
  '"test:gallery-moderation-preview"',
  '"test:gallery-preview-attestation"',
  '"test:gallery-public-feed"',
].forEach((snippet) => assertIncludes("full repository check", checkAll, snippet));

[
  '"list-approved-gallery-submissions"',
  '"list-gallery-review-queue"',
  '"moderate-gallery-submission"',
  '"reaper-spinner-dispatch"',
  '"spinner-live-session"',
  '"submit-discord-gallery-image"',
  "Committed Supabase Edge Function lock inventory does not match the reviewed list.",
  "--frozen=true",
  "committed dependency audit",
].forEach((snippet) => assertIncludes("function-local dependency lock validation", edgeTypeCheck, snippet));

const committedLockMatch = edgeTypeCheck.match(/const committedLockFunctions = \[([\s\S]*?)\];/);
const committedLockFunctions = committedLockMatch
  ? [...committedLockMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort()
  : [];
const expectedCommittedLockFunctions = [
  "list-approved-gallery-submissions",
  "list-gallery-review-queue",
  "moderate-gallery-submission",
  "reaper-spinner-dispatch",
  "spinner-live-session",
  "submit-discord-gallery-image",
].sort();
assert(
  JSON.stringify(committedLockFunctions) === JSON.stringify(expectedCommittedLockFunctions),
  `Function-local dependency lock validation: exact committed lock set drifted (${committedLockFunctions.join(", ")}).`,
);
for (const functionName of expectedCommittedLockFunctions) {
  const manifest = JSON.parse(read(`supabase/functions/${functionName}/deno.json`));
  const lock = JSON.parse(read(`supabase/functions/${functionName}/deno.lock`));
  assert(lock.version === "5", `${functionName}: committed Deno lock must use version 5.`);
  assert(
    manifest.imports?.["@supabase/functions-js/edge-runtime.d.ts"]
      === "jsr:@supabase/functions-js@2.110.8/edge-runtime.d.ts",
    `${functionName}: Edge Runtime types must remain pinned to 2.110.8.`,
  );
  assert(
    manifest.imports?.["@supabase/supabase-js"] === "npm:@supabase/supabase-js@2.110.8",
    `${functionName}: Supabase client must remain pinned to 2.110.8.`,
  );
  assert(
    lock.specifiers?.["jsr:@supabase/functions-js@2.110.8"] === "2.110.8"
      && lock.specifiers?.["npm:@supabase/supabase-js@2.110.8"] === "2.110.8",
    `${functionName}: committed Deno lock does not bind both approved direct dependency pins.`,
  );
}

[
  'from "@/lib/gallery/approved-feed";',
  "GALLERY_MEMBER_SUBMISSIONS_CATEGORY",
  'type ApprovedFeedState = "loading" | "ready" | "empty" | "error";',
  "gallery-feed-state",
  'className="gallery-feed-retry"',
  "Member-submitted images are temporarily unavailable. The rest of the gallery is still available.",
  "const galleryRenderBatchSize = APPROVED_GALLERY_PAGE_SIZE;",
  'id="galleryLoadMore"',
  "submission.thumbnail_url",
  "submission.categories",
  "nextCursor",
  "hasMore",
  "initialState: GalleryRouteState",
  "orderGalleryPresentation({",
  "onSourceRefresh={item.approvedSubmissionId",
  "updateApprovedThumbnail",
  "chronologicalOrderPending",
  "data-order-pending={chronologicalOrderPending}",
].forEach((snippet) => assertIncludes("GalleryBrowser v2 approved feed", galleryBrowser, snippet));

[
  "submission.full_signed_url",
  "submission.storage_path",
  "submission.storage_bucket",
  "submission.uploader_display_name",
  "Shared by",
  "result.statusText",
].forEach((snippet) => assertNotIncludes("GalleryBrowser public boundary", galleryBrowser, snippet));

if (galleryBrowser.includes("setRandomSeed") || galleryBrowser.includes("createRandomSeed")) {
  failures.push("GalleryBrowser: random order must stay stable before first paint.");
}

[
  "normalizeGalleryRouteState(await searchParams)",
  "<GalleryPage initialState={initialState}",
].forEach((snippet) => assertIncludes("Gallery server route normalization", galleryRoute, snippet));
[
  "initialState: GalleryRouteState",
  "<GalleryBrowser categories={categories} initialState={initialState}",
].forEach((snippet) => assertIncludes("Gallery normalized initial state", galleryRouteComponent, snippet));
[
  "normalizeGalleryRouteState",
  "stableGalleryMixSeed",
  "orderGalleryPresentation",
  "replaceGalleryThumbnail",
  "return [...stableGalleryMixOrder(staticItems, randomSeed), ...runtimeItems]",
  "runtimeBoundary",
  "item.sortTimestamp >= runtimeBoundary.sortTimestamp",
  "item.sortTimestamp <= runtimeBoundary.sortTimestamp",
].forEach((snippet) => assertIncludes("Gallery browser presentation model", galleryBrowserState, snippet));
[
  "default mix appends runtime cards without moving painted static cards",
  "chronological views expose only the prefix proven safe by the runtime cursor",
  "route state is normalized identically for server records and browser parameters",
  "a refreshed thumbnail updates the shared item used by the grid and viewer",
].forEach((snippet) => assertIncludes("Gallery browser presentation tests", galleryBrowserStateTests, snippet));
[
  "onSourceRefresh?: (src: string) => void;",
  "onSourceRefresh?.(refreshedSrc);",
].forEach((snippet) => assertIncludes("Gallery refreshed thumbnail propagation", responsiveGalleryMedia, snippet));

[
  "function approvedGalleryFeedUrl",
  "publicUrls.supabaseProjectRef",
  "list-approved-gallery-submissions",
  'method: "POST"',
  'action: "list"',
  'action: "full" | "thumbnail"',
  'function resolveApprovedGalleryAsset',
  'return resolveApprovedGalleryAsset("full", id, signal);',
  'return resolveApprovedGalleryAsset("thumbnail", id, signal);',
  "refreshApprovedGalleryThumbnail",
  "schemaVersion",
  "pageSize",
  "cursor",
  "nextCursor",
  "totalEligible",
  "facets",
  "thumbnail_width",
  "thumbnail_height",
  "Member-submitted images are temporarily unavailable.",
  'cache: "no-store"',
  'credentials: "omit"',
].forEach((snippet) => assertIncludes("SDK-free approved Gallery client", approvedFeedClient, snippet));

[
  "@supabase/supabase-js",
  "@/lib/supabase/",
  "requireBrowserSupabaseClient",
  "storage_path",
  "storage_bucket",
].forEach((snippet) => assertNotIncludes("SDK-free approved Gallery client", approvedFeedClient, snippet));

[
  "only list requests use POST while media uses deterministic GET URLs",
  'assert.equal(request.method, "POST")',
  '"Content-Type": "application/json"',
  'assert.equal(request.cache, "no-store")',
  'assert.equal(request.credentials, "omit")',
  'assert.equal("authorization" in request.headers, false)',
  'assert.equal("apikey" in request.headers, false)',
  "thumbnail_url",
  "uploader_display_name",
].forEach((snippet) => assertIncludes("approved Gallery client executable contract", approvedFeedClientTests, snippet));

[
  '"Access-Control-Allow-Origin": "*"',
  '"Access-Control-Allow-Methods": "GET, POST, OPTIONS"',
  "MAX_BODY_BYTES = 2048",
  "const publicFeedEvidenceCache = new GalleryIsolateEvidenceCache()",
  "const publicFeedCircuitBreaker = new GalleryIsolateCircuitBreaker()",
  "galleryPublicListCacheKey(request)",
  "publicFeedEvidenceCache.getOrLoad(",
  "publicFeedCircuitBreaker.tryAcquire()",
  '"Retry-After": String(permit.retryAfterSeconds)',
  "permit.release()",
  'contentType !== "application/json"',
  'await reader.cancel("request_too_large")',
  "if (!body) return null",
  '!Array.isArray(parsed)',
  "isLegacyGalleryListRequest(payload)",
  "parseGalleryPublicRequest(payload)",
  'request.action === "full" || request.action === "thumbnail"',
  'if (req.method !== "GET")',
  'keys === "asset,id"',
  'asset === "full" || asset === "thumbnail"',
  '"gallery_public_feed_page_v2"',
  '"gallery_reserve_public_media_v2"',
  '"gallery_reserve_public_delivery"',
  "p_publication_id: request.id",
  'p_delivery_kind: request.action',
  "parseGalleryMediaReservation(mediaData, request.id, request.action)",
  ".download(storagePath)",
  "mediaBlob.size !== mediaSize",
  "await sha256Hex(mediaBytes) !== mediaSha256",
  '"Cache-Control": "private, max-age=300, stale-while-revalidate=60"',
  '"Content-Length": String(mediaBytes.byteLength)',
  '"X-Content-Type-Options": "nosniff"',
  "toPublicGalleryItem",
  "toLegacyGalleryItem",
  "encodeGalleryCursor",
  'p_delivery_kind: "list"',
  "p_reserved_bytes: 65536",
  "deliveryFailures",
  "partial: false",
  "deliveryFailures: 0",
  'delivery: "bounded-edge-media"',
  "cacheSeconds: 15",
].forEach((snippet) => assertIncludes("approved Gallery v2 Edge contract", approvedFeedFunction, snippet));

[
  '"gallery_publishable_submissions"',
  "SIGNING_PATH_BATCH",
  "fullSignedUrls",
  "createSignedUrl(",
  "createSignedUrls(",
  "thumbnail_signed_url",
  "full_signed_url",
  "signedUrlSeconds",
  "uploader_display_name",
  "continue;",
].forEach((snippet) => assertNotIncludes("approved Gallery v2 Edge contract", approvedFeedFunction, snippet));

assertMatches(
  "approved Gallery atomic bounded media delivery",
  approvedFeedFunction,
  /gallery_reserve_public_media_v2[\s\S]*?parseGalleryMediaReservation[\s\S]*?\.download\(storagePath\)[\s\S]*?mediaBlob\.size !== mediaSize[\s\S]*?sha256Hex\(mediaBytes\) !== mediaSha256[\s\S]*?new Response\(mediaBytes/,
  "atomic lookup/reservation, exact-size validation, digest validation, and binary delivery must remain ordered.",
);
assertNotIncludes(
  "approved Gallery media resolver",
  approvedFeedFunction,
  '[isThumbnail ? "thumbnail_url" : "full_url"]: assetUrl',
);
assertMatches(
  "approved Gallery item conversion",
  approvedFeedFunction,
  /if \(!publicItem\)[\s\S]*?approved_thumbnail_delivery_failed[\s\S]*?}, 503\);/,
  "one invalid delivered item must fail the entire page with 503.",
);

assertMatches(
  "approved Gallery list response",
  approvedFeedFunction,
  /data:\s*\{[\s\S]*?schemaVersion:\s*GALLERY_PUBLIC_SCHEMA_VERSION,[\s\S]*?items,[\s\S]*?nextCursor,[\s\S]*?partial:\s*false,[\s\S]*?deliveryFailures:\s*0/,
  "list response must expose only the versioned thumbnail page contract.",
);

assertMatches(
  "approved Gallery legacy browser response",
  approvedFeedFunction,
  /if \(legacyListRequest\)[\s\S]*?toLegacyGalleryItem\([\s\S]*?publicMediaUrl\(supabaseUrl, "full", id\)[\s\S]*?data:\s*\{[\s\S]*?submissions,[\s\S]*?count: submissions\.length/,
  "the exact legacy request must receive only mapped, quota-enforced Edge media URLs.",
);

const finalListResponseStart = approvedFeedFunction.lastIndexOf("return jsonResponse({\n    ok: true,");
const finalListResponse = finalListResponseStart >= 0
  ? approvedFeedFunction.slice(finalListResponseStart)
  : "";
assert(finalListResponseStart >= 0, "Approved Gallery list response: final response block was not found.");
[
  "items,",
  "nextCursor,",
  'delivery: "bounded-edge-media"',
  "cacheSeconds: 15",
].forEach((snippet) => assertIncludes("approved Gallery final list response", finalListResponse, snippet));
[
  "full_url",
  "thumbnailStoragePath",
  "storagePath",
  "uploader",
  "signed",
].forEach((snippet) => assertNotIncludes("approved Gallery final list response", finalListResponse, snippet));

[
  "GALLERY_PUBLIC_SCHEMA_VERSION = 2",
  "GALLERY_PUBLIC_PAGE_SIZE = 24",
  "GALLERY_PUBLIC_MAX_QUERY_LENGTH = 80",
  "GALLERY_PUBLIC_EVIDENCE_CACHE_TTL_MS = 15 * 1000",
  "GALLERY_PUBLIC_EVIDENCE_CACHE_MAX_ENTRIES = 32",
  "GALLERY_PUBLIC_CIRCUIT_BURST = 48",
  "GALLERY_PUBLIC_CIRCUIT_REFILL_PER_SECOND = 2",
  "GALLERY_PUBLIC_CIRCUIT_MAX_CONCURRENT = 12",
  "class GalleryIsolateEvidenceCache",
  "class GalleryIsolateCircuitBreaker",
  "isUnsignedGalleryPageEvidence",
  "containsBearerCapability",
  "parseGalleryDatabasePage",
  "parseGalleryDeliveryReservation",
  "isLegacyGalleryListRequest",
  "toLegacyGalleryItem",
  'action: "list"',
  'action: "full"',
  'action: "thumbnail"',
  '"portraits"',
  '"gatherings"',
  '"action"',
  '"scenery"',
  '"companions"',
  '"member-submissions"',
  'normalize("NFKC")',
  "snapshotAt",
  "reviewedAt",
  "createdAt",
  "thumbnailWidth",
  "thumbnailHeight",
].forEach((snippet) => assertIncludes("Gallery public helper", publicFeedHelper, snippet));

[
  "rejects malformed cursors, categories, searches, and opaque ids",
  "strict database page evidence rejects malformed empty and aggregate envelopes",
  "delivery reservations distinguish allowed, denied, and malformed evidence",
  "atomic media reservations require exact bounded media evidence",
  "recognizes only the exact legacy empty-object request shape",
  "public Gallery items omit service-only references and originals",
  "legacy Gallery items use metered Edge URLs without identity or paths",
  'assert(!serialized.includes("StoragePath"), "raw Storage path leaked")',
  'serialized.includes("private-original")',
  '"full original leaked into the list response"',
  "invalid thumbnail geometry fails closed",
  "evidence cache coalesces identical loads and expires deterministically",
  "failures and signed capabilities never enter the evidence cache",
  "isolate circuit breaker enforces burst and deterministic refill",
  "isolate circuit breaker caps concurrency and release is idempotent",
  "isolate circuit breaker does not mint tokens when the clock moves backward",
].forEach((snippet) => assertIncludes("Gallery public helper tests", publicFeedHelperTests, snippet));

[
  "public.gallery_reserve_public_delivery('unknown', 1)",
  "public.gallery_reserve_public_delivery('thumbnail', 0)",
  "for index_value in 1..31 loop",
  "public.gallery_reserve_public_delivery('thumbnail', 2097152)",
  "public.gallery_reserve_public_delivery('full', 2097152)",
  "67108864::bigint",
  "a denied delivery does not increment the shared byte ledger",
  "uploader_display_name",
].forEach((snippet) => assertIncludes("Gallery public database regression", publicFeedDatabaseTests, snippet));

[
  "const requestedPage = boundedInteger(",
  "const requestedPageSize = boundedInteger(",
  'bodyResult.body.action === "prepare_preview"',
  "galleryPreviewSanitizerIsAttested(req",
  '"gallery_source_validation_candidate"',
  '"gallery_commit_source_validation"',
  '"gallery_source_validation_states"',
  "validateGallerySourceBytes(",
  "decodeGallerySourceImage(",
  "gallerySourcePreviewResponse(sourceBytes",
  '"gallery_reserve_moderation_preview"',
  "p_reserved_bytes: sourceSizeBytes",
  "safeString(commit.validated_at, 80)",
  'thumbnailState === "missing"',
  'thumbnailState === "ready"',
  "sourceValidationState: sourceValidation ? \"validated\" : \"required\"",
  "thumbnail_width",
  "thumbnail_height",
].forEach((snippet) => assertIncludes("moderation pagination and thumbnail evidence", reviewQueue, snippet));
assert(
  reviewQueue.indexOf("galleryPreviewSanitizerIsAttested(req") <
    reviewQueue.indexOf('"gallery_source_validation_candidate"'),
  "private Gallery preview must attest the sanitizer before reading source evidence.",
);
assertMatches(
  "metered private Gallery preview",
  reviewQueue,
  /gallery_reserve_moderation_preview[\s\S]*?p_reserved_bytes: sourceSizeBytes[\s\S]*?\.download\(storagePath\)/,
  "the exact source bytes must be reserved before the private Storage download.",
);
assertNotIncludes("private Gallery queue", reviewQueue, "createSignedUrl");
assertNotIncludes("private Gallery queue", reviewQueue, "signedPreviewUrl");
assertNotIncludes("durable Gallery validation timestamp", reviewQueue, "validatedAt: new Date()");

[
  '["missing", "Needs thumbnail"]',
  "queue?.pagination?.hasPrevious",
  "queue?.pagination?.hasNext",
].forEach((snippet) => assertIncludes("Leader Dashboard thumbnail backfill", leaderDashboard, snippet));
assertIncludes("Leader Dashboard thumbnail backfill", leaderDashboardParts, "Prepare gallery thumbnail");

[
  'import "server-only"',
  'export * from "./moderation-preview-server-core"',
].forEach((snippet) => assertIncludes("Gallery sanitizer server boundary", moderationPreviewServer, snippet));
[
  '@napi-rs/canvas',
  'GALLERY_MODERATOR_PREVIEW_MAX_BYTES',
  'loadImage(',
  'canvas.encode("webp"',
  'sourceDecodeVersion !== GALLERY_SOURCE_DECODE_VERSION',
  'redirect: "error"',
].forEach((snippet) => assertIncludes("Gallery server sanitizer", moderationPreviewServerCore, snippet));
[
  "GALLERY_SANITIZER_ATTESTATION_HEADER",
  "sanitizerAttestation",
].forEach((snippet) => assertIncludes("Gallery server attestation forwarding", moderationPreviewServerCore, snippet));
[
  '"https://oidc.vercel.com/mochirii/.well-known/jwks"',
  'payload.aud !== VERCEL_AUDIENCE',
  'payload.project !== VERCEL_PROJECT',
  'payload.owner_id !== VERCEL_OWNER_ID',
  'payload.project_id !== VERCEL_PROJECT_ID',
  'ALLOWED_ENVIRONMENTS.has(environment)',
  'crypto.subtle.verify(',
  'exactLocalDevelopmentRequest(request, supabaseUrl)',
].forEach((snippet) => assertIncludes("Gallery sanitizer workload attestation", previewAttestation, snippet));
[
  "a moderator bearer alone cannot attest the source-byte request",
  "signed Vercel preview and production project identities are accepted",
  "wrong claims, algorithms, signatures, and time windows fail closed",
  "the local marker is confined to the exact loopback Supabase origin",
].forEach((snippet) => assertIncludes("Gallery sanitizer attestation tests", previewAttestationTests, snippet));
assertNotIncludes(
  "protected Edge CORS allowlist",
  protectedCors,
  "x-gallery-sanitizer-attestation",
);
assertNotIncludes(
  "Gallery moderation CORS allowlist",
  galleryModerationShared,
  "x-gallery-sanitizer-attestation",
);
[
  'const PREVIEW_ROUTE = "/api/gallery/moderation-preview"',
  'credentials: "same-origin"',
  'redirect: "error"',
  'hasWebpContainerSignature(bytes)',
].forEach((snippet) => assertIncludes("same-origin Gallery preview client", moderationPreviewClient, snippet));
assertNotIncludes("same-origin Gallery preview client", moderationPreviewClient, "x-vercel-oidc-token");
assertNotIncludes("same-origin Gallery preview client", moderationPreviewClient, "x-gallery-sanitizer-attestation");
[
  'galleryPreviewRequestIsSameOrigin(request)',
  'GALLERY_PREVIEW_PRIVATE_HEADERS',
  'opaqueGalleryPreviewDenied()',
].forEach((snippet) => assertIncludes("same-origin Gallery preview route", moderationPreviewRoute, snippet));
[
  "createGalleryMedia(sourceBlob, true)",
  "createGalleryMedia(sourceBlob, false)",
  "sourceMimeType !== galleryThumbnailMimeType",
].forEach((snippet) => assertIncludes("sanitized Gallery browser media", browserThumbnail, snippet));
assertNotIncludes("sanitized Gallery browser media", browserThumbnail, "fetch(");
assertNotIncludes("sanitized Gallery browser media", browserThumbnail, "sourceUrl");

[
  "setGalleryPreview(null);",
  "galleryPreview?.submissionId === submissionId",
  "preparedBlob: preview.blob",
  "createGalleryThumbnail(previewBlob)",
  "createGalleryPublicationMedia(previewBlob)",
  "onPreviewBlobChange={retainGalleryPreviewBlob}",
].forEach((snippet) => assertIncludes("Leader Dashboard retained preview Blob", leaderDashboard, snippet));

[
  "startGalleryPreviewRequest(async () => previewBlob)",
  "request.dispose()",
  "preview.release()",
  "onBlobChange(submissionId, previewKey, null)",
  "disabled={busy || !previewReady}",
].forEach((snippet) => assertIncludes("Leader Dashboard preview lifecycle", leaderDashboardParts, snippet));

[
  "const controller = new AbortController();",
  "const ready = loadSource(controller.signal)",
  "objectUrlApi.createObjectURL(blob)",
  "objectUrlApi.revokeObjectURL(objectUrl)",
  "controller.abort();",
  "activeLease?.release();",
].forEach((snippet) => assertIncludes("safe Gallery preview lifecycle", safePreview, snippet));

[
  "a safe preview downloads once and revokes its object URL exactly once",
  "disposing an in-flight preview aborts it and prevents an object URL",
  "disposing a ready preview revokes its object URL without an explicit release",
  "assert.equal(loads, 1)",
  "assert.deepEqual(revoked, [\"blob:gallery-safe-preview\"])",
  "assert.equal(created, 0)",
].forEach((snippet) => assertIncludes("safe Gallery preview executable regression", safePreviewTests, snippet));

[
  "createGalleryThumbnail(previewUrl)",
  "createGalleryPublicationMedia(previewUrl)",
].forEach((snippet) => assertNotIncludes("Leader Dashboard duplicate source download", leaderDashboard, snippet));
assertNotIncludes("Leader Dashboard selected-source boundary", leaderDashboardParts, "item.signedPreviewUrl");
assertNotIncludes("Leader Dashboard selected-source boundary", leaderDashboard, "signedPreviewUrl");

[
  'GALLERY_SOURCE_IMAGE_DECODE_VERSION = "gallery-source-decode-v1"',
  "globalThis.createImageBitmap",
  "gallerySourcePreviewResponse(",
  '"X-Content-Type-Options": "nosniff"',
].forEach((snippet) => assertIncludes("Edge full-decode boundary", sourceDecode, snippet));
[
  "fully decodes every accepted source format in the Edge runtime",
  "rejects structurally plausible PNG bytes that fail full decoding",
].forEach((snippet) => assertIncludes("Edge full-decode regression", sourceDecodeTests, snippet));

[
  "await isDecodableGalleryWebp(",
  'error: "thumbnail_decode_failed"',
  'error: "display_decode_failed"',
  "publicationId ||= crypto.randomUUID();",
  "galleryPublicationDisplayStoragePath(publicationId)",
  "galleryThumbnailStoragePath(",
  "publicationId,",
  "thumbnailRevisionId,",
  "p_publication_id: publicationId",
  "p_public_original_size_bytes: displayResult?.ok",
  "? displayResult.display.sizeBytes",
  "const displaySha256 = displayResult?.ok",
  "p_public_original_sha256: displaySha256",
  "p_thumbnail_width: thumbnailResult?.ok",
  "? thumbnailResult.thumbnail.width",
  "p_thumbnail_height: thumbnailResult?.ok",
  "? thumbnailResult.thumbnail.height",
  "const thumbnailSha256 = thumbnailResult?.ok",
  "p_thumbnail_sha256: thumbnailSha256",
  "p_expected_updated_at: expectedUpdatedAt",
  'error: "stale_submission_revision"',
  '"gallery_commit_moderation"',
  "const provisionalPaths = [thumbnailPath, publicOriginalPath]",
].forEach((snippet) => assertIncludes("atomic gallery moderation", moderation, snippet));

if (/\.from\(["']gallery_submissions["']\)\s*\n?\s*\.update\(/.test(moderation)) {
  failures.push("Atomic Gallery moderation: row updates must stay inside gallery_commit_moderation.");
}
if (/\.from\(["']gallery_moderation_events["']\)\s*\n?\s*\.insert\(/.test(moderation)) {
  failures.push("Atomic Gallery moderation: audit inserts must stay inside gallery_commit_moderation.");
}
if (/\.from\(["']gallery_instagram_publish_(?:jobs|events)["']\)\s*\n?\s*\.(?:insert|upsert)\(/.test(moderation)) {
  failures.push("Atomic Gallery moderation: Instagram outbox writes must stay inside gallery_commit_moderation.");
}

[
  "GALLERY_THUMBNAIL_MAX_BYTES = 80 * 1024",
  "GALLERY_THUMBNAIL_MAX_EDGE = 720",
  "GALLERY_DISPLAY_MAX_BYTES = 2 * 1024 * 1024",
  "GALLERY_DISPLAY_MAX_EDGE = 2560",
  'return `_approved/publications/${publicationId}/display.webp`;',
  'return `_approved/publications/${publicationId}/revisions/${revisionId}/thumbnail.webp`;',
].forEach((snippet) => assertIncludes("Gallery thumbnail parser", thumbnailParser, snippet));

[
  "uses the pinned libwebp decoder and fully decodes valid pixels",
  "rejects corrupt VP8 and VP8L payloads after structural parsing",
  "corrupt WebP payload must fail full decode",
  "derives immutable service-only publication paths",
].forEach((snippet) => assertIncludes("Gallery thumbnail decoder tests", thumbnailTests, snippet));

[
  "enforce_gallery_original_immutability",
  "private.member_gallery_original_mutation_allowed",
  'Members delete own pending or orphaned gallery originals',
  "gallery_commit_moderation",
  "insert into public.gallery_moderation_events",
].forEach((snippet) => assertIncludes("original immutability migration", thumbnailMigration, snippet));

[
  'drop policy if exists "Members update own pending gallery originals"',
  "stale_submission_revision",
  "p_expected_updated_at timestamptz",
].forEach((snippet) => assertIncludes("publication immutability migration", publicationMigration, snippet));

if (/create policy "Members update own pending gallery originals"/.test(publicationMigration)) {
  failures.push("Publication immutability migration: referenced source objects must not retain a member update policy.");
}

[
  "add column if not exists thumbnail_width integer",
  "add column if not exists thumbnail_height integer",
  "gallery_submissions_thumbnail_dimensions_check",
  "drop constraint if exists gallery_submissions_thumbnail_complete_check",
  "drop constraint if exists gallery_submissions_approved_thumbnail_check",
  "drop constraint if exists gallery_submissions_public_category_check",
  "separately reviewed backfill closeout migration",
].forEach((snippet) => assertIncludes("Gallery v2 compatibility migration", publicFeedMigration, snippet));

[
  "create table private.gallery_publication_revisions",
  "create table private.gallery_public_delivery_windows",
  "create table private.gallery_source_validations",
  "gallery_source_validation_candidate",
  "gallery_commit_source_validation",
  "gallery_source_validation_states",
  "source_not_validated",
  "source_validation_conflict",
  "gallery-source-v1",
  "source_size_bytes between 1 and 8388608",
  "source_width between 1 and 4096",
  "source_height between 1 and 4096",
  "source_width::bigint * source_height::bigint <= 12600000",
  "revoke all on table private.gallery_publication_revisions",
  "revoke all on table private.gallery_public_delivery_windows",
  "revoke all on table private.gallery_source_validations",
  "gallery_publication_one_active_per_submission_idx",
  "gallery_publication_submission_fk_idx",
  "enforce_gallery_publication_immutability",
  "retire_gallery_publication_on_status_change",
  "p_publication_id uuid",
  "A complete bounded Gallery publication is required.",
  "Gallery publication paths are invalid.",
  "'_approved/publications/' || p_publication_id::text || '/display.webp'",
  "'/revisions/' || p_thumbnail_revision_id::text || '/thumbnail.webp'",
  "insert into private.gallery_publication_revisions",
  "original_storage_object_id",
  "original_storage_object_version",
  "original_storage_object_updated_at",
  "original_sha256",
  "thumbnail_storage_object_id",
  "thumbnail_storage_object_version",
  "thumbnail_storage_object_updated_at",
  "thumbnail_sha256",
  "gallery_reserve_public_delivery",
  "gallery_reserve_moderation_preview",
  "private.gallery_moderation_preview_windows",
  "mochirii.gallery-moderation-preview",
  "daily_byte_limit constant bigint := 67108864",
  "pg_catalog.pg_advisory_xact_lock",
  "insert into public.gallery_instagram_publish_jobs",
  "insert into public.gallery_instagram_publish_events",
  "'instagramJob'",
  "gallery_public_feed_page_v2",
  "gallery_reserve_public_media_v2",
  "requested_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24)",
  "from private.gallery_publication_revisions as publication",
  "join storage.objects as original_object",
  "join storage.objects as thumbnail_object",
  "publication.visible_from <= requested_snapshot_at",
  "publication.visible_until > requested_snapshot_at",
  "Gallery snapshot expired.",
  "lower(normalize(nullif(btrim(p_query), ''), NFKC))",
  "array['member-submissions', eligible.public_category]",
  "publication.visible_until > statement_timestamp() - interval '1 hour'",
  "p_publication_id uuid",
  "grant execute on function public.gallery_public_feed_page_v2",
  "grant execute on function public.gallery_reserve_public_media_v2",
  "to service_role;",
  "'validated_at', existing_validation.validated_at",
  "returning * into existing_validation",
].forEach((snippet) => assertIncludes("immutable Gallery publication database contract", publicationMigration, snippet));

[
  "selected_revision_id uuid",
  "selected_size_bytes bigint",
  "into selected_revision_id, selected_size_bytes",
  "gallery_reserve_public_delivery(",
  "requested_kind,",
  "selected_size_bytes",
  "return delivery_reservation;",
  "join storage.objects as original_object",
  "join storage.objects as thumbnail_object",
  "publication.id = selected_revision_id",
].forEach((snippet) => assertIncludes("quota-first atomic Gallery media reservation", atomicMediaReservation, snippet));

const mediaQuotaReservationIndex = atomicMediaReservation.indexOf("delivery_reservation :=");
const mediaQuotaDenialIndex = atomicMediaReservation.indexOf("return delivery_reservation;");
const mediaStorageJoinIndex = atomicMediaReservation.indexOf("join storage.objects as original_object");
assert(
  mediaQuotaReservationIndex >= 0 &&
    mediaQuotaDenialIndex > mediaQuotaReservationIndex &&
    mediaStorageJoinIndex > mediaQuotaDenialIndex,
  "quota-first atomic Gallery media reservation: exact reservation and denial must precede every Storage evidence join.",
);

assertNotIncludes(
  "Gallery v1 rollback compatibility",
  publicationMigration,
  "drop function if exists public.gallery_publishable_submissions",
);

[
  "create or replace function public.gallery_publishable_submissions",
  "returns setof public.gallery_submissions",
  "public.gallery_reserve_public_delivery('list', 65536)",
  "return;",
  "revoke all on function public.gallery_publishable_submissions(integer, integer)",
  "grant execute on function public.gallery_publishable_submissions(integer, integer)",
  "Temporary service-only rollback guard",
  "always returns an empty set",
].forEach((snippet) => assertIncludes("Gallery v1 rollback compatibility", rollbackCompatibility, snippet));

[
  "auth.role()",
  "from private.gallery_publication_revisions",
  "join storage.objects",
  "jsonb_populate_record",
  "storage_path",
  "thumbnail_storage_path",
].forEach((snippet) => assertNotIncludes("Gallery v1 rollback compatibility", rollbackCompatibility, snippet));

[
  "legacy rollback compatibility is callable only through the service role",
  "retired Edge compatibility always returns an empty Gallery feed",
  "retired Edge compatibility calls remain list-budgeted even though no media is returned",
  "repeated retired Edge compatibility calls cannot recover media paths",
  "each repeated retired Edge compatibility call consumes the shared list budget",
  "moderation preview reserves its exact maximum source bytes once",
  "moderation preview rejects sources over eight mebibytes",
  "moderation preview minute saturation fails closed at twelve requests",
  "moderation preview daily saturation fails closed at one hundred requests",
  "anonymous public saturation cannot consume isolated moderator-preview capacity",
  "moderator-preview saturation cannot consume anonymous public capacity",
  "exhausted quota returns path-free denial before mismatched Storage evidence is joined",
].forEach((snippet) => assertIncludes("Gallery v1 rollback database regression", publicFeedDatabaseTests, snippet));

assertIncludes(
  "Gallery publication foreign-key index regression",
  thumbnailDatabaseTests,
  "gallery_publication_submission_fk_idx",
);
assertIncludes(
  "durable source-validation timestamp regression",
  thumbnailDatabaseTests,
  "repeat validation returns the exact durable evidence timestamp",
);

[
  "GALLERY_SOURCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024",
  "GALLERY_SOURCE_IMAGE_MAX_EDGE = 4096",
  "GALLERY_SOURCE_IMAGE_MAX_PIXELS = 12_600_000",
  'GALLERY_SOURCE_IMAGE_VALIDATOR_VERSION = "gallery-source-v1"',
  "validateGallerySourceBytes",
  "source_image_mime_mismatch",
  "source_image_png_animated",
].forEach((snippet) => assertIncludes("trusted Gallery source parser", sourceImageParser, snippet));

[
  "returns canonical JPEG evidence after strict structural validation",
  "rejects PNG duplicate headers, CRC changes, nonconsecutive data, and truncation",
  "rejects WebP metadata, animation, unknown chunks, and unsafe VP8X flags",
  "enforces encoded-byte, edge, and pixel ceilings independently",
  "rejects unsupported bytes and MIME confusion",
].forEach((snippet) => assertIncludes("trusted Gallery source parser tests", sourceImageTests, snippet));

[
  "from public, anon, authenticated;",
  "gallery_public_feed_page_v2(",
  "integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text",
  "gallery_reserve_public_media_v2(uuid, text)",
  "gallery_reserve_moderation_preview(bigint)",
].forEach((snippet) => assertIncludes("Gallery service-only database contract", publicationMigration, snippet));

[
  "schema version 2",
  "opaque cursor",
  "Member Submissions",
  "on demand",
  "private",
].forEach((snippet) => assertIncludes("Gallery guide v2 contract", galleryGuide, snippet));

[
  "decoded width and height",
  "canonical Gallery category",
  "historical approved rows",
  "separate authorized operation",
  "Prepare private preview",
].forEach((snippet) => assertIncludes("Gallery moderation runbook v2 contract", moderationRunbook, snippet));

[
  "Decision",
  "immutable, service-owned Gallery revisions",
  "opaque publication UUID",
  "opaque revision UUID",
  "metadata-stripped WebP derivatives",
  "_approved/publications/{publication-id}/display.webp",
  "_approved/publications/{publication-id}/revisions/{revision-id}/thumbnail.webp",
  "all-or-nothing",
  "customer-safe `503`",
  "failures never advance traversal",
  "all six facets",
  "keyset",
  "snapshot",
  "33",
  "20/13",
  "not a global rate limit",
  "CORS is also",
  "not authorization or abuse prevention",
  "No provider write",
  "Private preview",
  "same-origin server",
].forEach((snippet) => assertIncludes("Gallery public media delivery contract", deliveryContract, snippet));

if (failures.length) {
  console.error("Gallery approved feed validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Gallery approved feed validation OK (schema v2; 33 functions; JWT 20/13).");
