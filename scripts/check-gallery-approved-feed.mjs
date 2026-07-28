import { readFileSync } from "node:fs";

const failures = [];

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

const galleryBrowser = read("apps/web/components/public-pages/GalleryBrowser.tsx");
const leaderDashboard = read("apps/web/components/member-workflow/LeaderDashboard.tsx");
const leaderDashboardParts = read("apps/web/components/member-workflow/LeaderDashboardParts.tsx");
const approvedFeed = read("supabase/functions/list-approved-gallery-submissions/index.ts");
const reviewQueue = read("supabase/functions/list-gallery-review-queue/index.ts");
const moderation = read("supabase/functions/moderate-gallery-submission/index.ts");
const thumbnailParser = read("supabase/functions/_shared/gallery-thumbnail.ts");
const thumbnailTests = read("supabase/functions/_shared/gallery-thumbnail_test.ts");
const thumbnailMigration = read("supabase/migrations/20260727145241_add_gallery_submission_thumbnails.sql");
const thumbnailCloseout = read("supabase/operations/validate_gallery_submission_thumbnails.sql");
const approvedGalleryFeed = read("apps/web/lib/gallery/approved-feed.ts");
const runbook = read("docs/vote-reminder-runbook.md");

[
  'from "@/lib/gallery/approved-feed";',
  'const memberSubmissionsCategory = "member-submissions";',
  "function approvedSubmissionToGalleryItem",
  'type ApprovedFeedState = "loading" | "ready" | "error";',
  "gallery-feed-state",
  'className="gallery-feed-retry"',
  "Member-submitted images are temporarily unavailable. The rest of the gallery is still available.",
  "retryApprovedFeed",
  "const galleryRenderBatchSize = 24;",
  'const [renderWindow, setRenderWindow] = useState({ key: "", limit: galleryRenderBatchSize });',
  "const renderWindowKey =",
  "const effectiveRenderLimit = renderWindow.key === renderWindowKey ? renderWindow.limit : galleryRenderBatchSize;",
  "const renderedItems = useMemo(() => visibleItems.slice(0, effectiveRenderLimit)",
  "id=\"galleryLoadMore\"",
  "submission.full_signed_url",
  "submission.thumbnail_signed_url",
  "submission.thumbnail_size_bytes",
  "fullSignedUrl === thumbnailSignedUrl",
  "function stableMixOrder(items: NormalizedGalleryItem[], seed: number)",
  "const randomSeed = useMemo(",
  "submission.preview_error",
  "galleryAddedAt: text(submission.created_at || submission.reviewed_at)",
  "listApprovedGallerySubmissions(controller.signal)",
  "setApprovedItems",
  "[...items, ...approvedItems]",
].forEach((snippet) => assertIncludes("GalleryBrowser approved feed", galleryBrowser, snippet));

[
  "result.message",
  "result.statusText",
].forEach((snippet) => {
  if (galleryBrowser.includes(snippet)) failures.push(`GalleryBrowser approved feed: public status must not expose ${snippet}.`);
});

if (galleryBrowser.includes("setRandomSeed") || galleryBrowser.includes("createRandomSeed")) {
  failures.push("GalleryBrowser approved feed: random order must be stable before first paint.");
}

[
  "function publicApprovedGalleryFeedUrl",
  "SUPABASE_PROJECT_REF",
  "list-approved-gallery-submissions",
  "method: \"POST\"",
  "Approved gallery feed could not be loaded.",
].forEach((snippet) => assertIncludes("SDK-free approved Gallery feed", approvedGalleryFeed, snippet));

[
  "@supabase/supabase-js",
  "@/lib/supabase/",
  "requireBrowserSupabaseClient",
].forEach((snippet) => {
  if (approvedGalleryFeed.includes(snippet)) failures.push(`SDK-free approved Gallery feed: forbidden dependency found: ${snippet}`);
});

[
  'adminClient.rpc(\n    "gallery_publishable_submissions"',
  "const SIGNING_PATH_BATCH = 40;",
  "await Promise.all(",
  ".createSignedUrls(paths, SIGNED_URL_SECONDS)",
  "if (!thumbnailSignedUrl || !fullSignedUrl)",
].forEach((snippet) => assertIncludes("approved feed completeness and signing", approvedFeed, snippet));

[
  "const requestedPage = boundedInteger(",
  "const requestedPageSize = boundedInteger(",
  'thumbnailState === "missing"',
  '.is("thumbnail_revision_id", null)',
  'thumbnailState === "ready"',
  ".range(pageOffset, pageOffset + requestedPageSize - 1)",
  ".createSignedUrls(previewPaths, SIGNED_URL_SECONDS)",
  "hasNext: pageOffset + queue.length < Number(filteredCount || 0)",
].forEach((snippet) => assertIncludes("moderation pagination and thumbnail backfill", reviewQueue, snippet));

[
  '["missing", "Needs thumbnail"]',
  "queue?.pagination?.hasPrevious",
  "queue?.pagination?.hasNext",
].forEach((snippet) => assertIncludes("Leader Dashboard thumbnail backfill", leaderDashboard, snippet));
assertIncludes("Leader Dashboard thumbnail backfill", leaderDashboardParts, "Prepare gallery thumbnail");

[
  "await isDecodableGalleryWebp(",
  'error: "thumbnail_decode_failed"',
  "thumbnailRevisionId = crypto.randomUUID();",
  "galleryThumbnailStoragePath(submissionId, thumbnailRevisionId)",
  "upsert: false",
  '"gallery_commit_moderation"',
  "p_expected_thumbnail_revision_id: priorThumbnailRevisionId || null",
  ".remove([thumbnailPath])",
].forEach((snippet) => assertIncludes("atomic gallery moderation", moderation, snippet));
if (/\.from\(["']gallery_submissions["']\)\s*\n?\s*\.update\(/.test(moderation)) {
  failures.push("atomic gallery moderation: submission updates must remain inside gallery_commit_moderation.");
}
if (/\.from\(["']gallery_moderation_events["']\)\s*\n?\s*\.insert\(/.test(moderation)) {
  failures.push("atomic gallery moderation: audit inserts must remain inside gallery_commit_moderation.");
}

[
  "GALLERY_THUMBNAIL_MAX_BYTES = 80 * 1024",
  "GALLERY_THUMBNAIL_MAX_EDGE = 720",
  'return `_approved/thumbs/${submissionId}/${revisionId}.webp`;',
].forEach((snippet) => assertIncludes("gallery thumbnail parser", thumbnailParser, snippet));
[
  "uses the pinned libwebp decoder and fully decodes valid pixels",
  "rejects corrupt VP8 and VP8L payloads after structural parsing",
  "corrupt WebP payload must fail full decode",
].forEach((snippet) => assertIncludes("gallery thumbnail decoder tests", thumbnailTests, snippet));

[
  "gallery_submissions_approved_thumbnail_check",
  "not valid",
  "enforce_gallery_original_immutability",
  "private.member_gallery_original_mutation_allowed",
  'Members update own pending gallery originals',
  'Members delete own pending or orphaned gallery originals',
  "for update;",
  "for key share;",
  "gallery_commit_moderation",
  "gallery_publishable_submissions",
  "insert into public.gallery_moderation_events",
  "limit least(greatest(coalesce(p_limit, 80), 1), 80)",
].forEach((snippet) => assertIncludes("gallery thumbnail database contract", thumbnailMigration, snippet));
[
  "Approved gallery thumbnail backfill is incomplete.",
  "Approved gallery Storage evidence is incomplete or mismatched.",
  "validate constraint gallery_submissions_approved_thumbnail_check",
  "constraint_record.convalidated",
].forEach((snippet) => assertIncludes("gallery thumbnail closeout", thumbnailCloseout, snippet));

[
  "RandomNumberGenerator]::Create()",
  "$Rng.GetBytes($Bytes)",
  "require('node:crypto').randomBytes",
  "DISCORD_VOTE_LINKS_JSON",
  "Do not paste real vote links into chat, PR text, screenshots, logs, or committed files.",
].forEach((snippet) => assertIncludes("vote reminder runbook", runbook, snippet));

if (failures.length) {
  console.error("Gallery approved feed validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Gallery approved feed validation OK.");
