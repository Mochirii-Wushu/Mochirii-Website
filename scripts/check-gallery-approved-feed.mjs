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
const thumbnailMigration = read("supabase/migrations/20260727145241_add_gallery_submission_thumbnails.sql");
const publicFeedMigration = read("supabase/migrations/20260728130000_add_gallery_public_feed_v2.sql");
const publicationMigration = read("supabase/migrations/20260728132000_add_gallery_publication_revisions.sql");
const thumbnailDatabaseTests = read("supabase/tests/gallery_submission_thumbnails_test.sql");
const publicFeedDatabaseTests = read("supabase/tests/gallery_public_feed_v2_test.sql");
const galleryGuide = read("docs/gallery-guide.md");
const moderationRunbook = read("docs/member-gallery-moderation-runbook.md");
const deliveryContract = read("docs/integrations/gallery-public-media-delivery.md");

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
  '"check:gallery-approved-feed"',
].forEach((snippet) => assertIncludes("package scripts", packageJson, snippet));

[
  '"test:gallery-approved-feed-client"',
  '"test:gallery-browser-state"',
  '"test:gallery-safe-preview"',
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
  "list, full-image, and thumbnail requests use the credential-free versioned envelope",
  'assert.equal(request.method, "POST")',
  '"Content-Type": "application/json"',
  'assert.equal(request.cache, "no-store")',
  'assert.equal(request.credentials, "omit")',
  'assert.equal("authorization" in request.headers, false)',
  'assert.equal("apikey" in request.headers, false)',
  "full_url",
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
  "parseGalleryPublicRequest(payload)",
  'request.action === "full" || request.action === "thumbnail"',
  'keys === "asset,id"',
  'asset === "full" || asset === "thumbnail"',
  '"gallery_public_feed_page_v2"',
  '"gallery_public_original_v2"',
  '"gallery_reserve_public_delivery"',
  "p_publication_id: request.id",
  "publicMediaUrl(supabaseUrl, request.action, request.id)",
  'p_delivery_kind: request.action',
  "p_reserved_bytes: mediaSize",
  ".download(storagePath)",
  "mediaBlob.size !== mediaSize",
  "await sha256Hex(mediaBytes) !== mediaSha256",
  '"Cache-Control": "private, max-age=300, stale-while-revalidate=60"',
  '"Content-Length": String(mediaBytes.byteLength)',
  '"X-Content-Type-Options": "nosniff"',
  '[isThumbnail ? "thumbnail_url" : "full_url"]: assetUrl',
  "toPublicGalleryItem",
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
  "approved Gallery bounded media delivery",
  approvedFeedFunction,
  /reserveDelivery\([\s\S]*?gallery_reserve_public_delivery[\s\S]*?\.download\(storagePath\)[\s\S]*?mediaBlob\.size !== mediaSize[\s\S]*?sha256Hex\(mediaBytes\) !== mediaSha256[\s\S]*?new Response\(mediaBytes/,
  "quota reservation, exact-size validation, digest validation, and binary delivery must remain ordered.",
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
  "public Gallery items omit service-only references and originals",
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
  '"gallery_source_validation_candidate"',
  '"gallery_commit_source_validation"',
  '"gallery_source_validation_states"',
  "validateGallerySourceBytes(",
  'thumbnailState === "missing"',
  'thumbnailState === "ready"',
  ".createSignedUrls(previewPaths, SIGNED_URL_SECONDS)",
  "sourceValidationState: sourceValidation ? \"validated\" : \"required\"",
  "thumbnail_width",
  "thumbnail_height",
].forEach((snippet) => assertIncludes("moderation pagination and thumbnail evidence", reviewQueue, snippet));

assertMatches(
  "validated moderation preview signing",
  reviewQueue,
  /filter\(\(submission\) => \{[\s\S]*?sourceValidationsBySubmissionId\.has\(submissionId\)[\s\S]*?\.createSignedUrls\(previewPaths, SIGNED_URL_SECONDS\)/,
  "normal queue previews must be signed only for sources with current trusted validation evidence.",
);

[
  '["missing", "Needs thumbnail"]',
  "queue?.pagination?.hasPrevious",
  "queue?.pagination?.hasNext",
].forEach((snippet) => assertIncludes("Leader Dashboard thumbnail backfill", leaderDashboard, snippet));
assertIncludes("Leader Dashboard thumbnail backfill", leaderDashboardParts, "Prepare gallery thumbnail");

[
  "fetchBoundedGallerySource(",
  "response.body.getReader()",
  "totalBytes > gallerySourceMaximumBytes",
  "totalBytes > expected.sizeBytes",
  "createGalleryMedia(sourceBlob, true)",
  "createGalleryMedia(sourceBlob, false)",
].forEach((snippet) => assertIncludes("bounded single-download Gallery source", browserThumbnail, snippet));
assert(
  (browserThumbnail.match(/\bfetch\(/g) || []).length === 1,
  "bounded single-download Gallery source: exactly one source fetch boundary is required.",
);

[
  "setGalleryPreview(null);",
  "galleryPreview?.submissionId === submissionId",
  "createGalleryThumbnail(previewBlob)",
  "createGalleryPublicationMedia(previewBlob)",
  "onPreviewBlobChange={retainGalleryPreviewBlob}",
].forEach((snippet) => assertIncludes("Leader Dashboard retained preview Blob", leaderDashboard, snippet));

[
  "startGalleryPreviewRequest((signal)",
  "request.dispose()",
  "preview.release()",
  "onBlobChange(submissionId, sourceUrl, null)",
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
  "drop function if exists public.gallery_publishable_submissions",
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
  "daily_byte_limit constant bigint := 67108864",
  "pg_catalog.pg_advisory_xact_lock",
  "insert into public.gallery_instagram_publish_jobs",
  "insert into public.gallery_instagram_publish_events",
  "'instagramJob'",
  "gallery_public_feed_page_v2",
  "gallery_public_original_v2",
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
  "grant execute on function public.gallery_public_original_v2",
  "to service_role;",
].forEach((snippet) => assertIncludes("immutable Gallery publication database contract", publicationMigration, snippet));

assertIncludes(
  "Gallery publication foreign-key index regression",
  thumbnailDatabaseTests,
  "gallery_publication_submission_fk_idx",
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
  "gallery_public_original_v2(uuid)",
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
].forEach((snippet) => assertIncludes("Gallery public media delivery contract", deliveryContract, snippet));

if (failures.length) {
  console.error("Gallery approved feed validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Gallery approved feed validation OK (schema v2; 33 functions; JWT 20/13).");
