import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function publicAssetPath(value) {
  const clean = String(value || "").trim().replace(/^\.?\//, "");
  return clean.startsWith("/") ? clean.slice(1) : clean;
}

function assertFileExists(label, relativePath) {
  assert(existsSync(path.join(root, relativePath)), `${label}: missing ${relativePath}`);
}

function assertIncludes(label, text, snippet) {
  assert(text.includes(snippet), `${label}: expected snippet not found: ${snippet}`);
}

function extractStaticImageBlock(source, id) {
  const idIndex = source.indexOf(`id="${id}"`);
  if (idIndex < 0) return "";
  const start = source.lastIndexOf("<StaticImage", idIndex);
  const end = source.indexOf("/>", idIndex);
  if (start < 0 || end < 0) return "";
  return source.slice(start, end + 2);
}

const galleryData = JSON.parse(read("apps/web/public/data/gallery.json"));
const galleryItems = (Array.isArray(galleryData.albums) ? galleryData.albums : []).flatMap((album) =>
  Array.isArray(album.items) ? album.items : [],
);

assert(galleryItems.length > 0, "apps/web/public/data/gallery.json: expected at least one gallery item.");

const galleryStaticThumbnailMaximumBytes = 300 * 1024;
const galleryMemberThumbnailMaximumBytes = 80 * 1024;
const galleryInitialTransferMaximumBytes = 2 * 1024 * 1024;
const galleryRenderBatchSize = 24;
const galleryThumbnailSizes = [];

for (const item of galleryItems) {
  const id = String(item.id || item.full || item.src || "gallery item");
  const thumb = publicAssetPath(item.thumb);
  const full = publicAssetPath(item.full || item.src);

  assert(thumb.includes("assets/img/gallery/thumbs/"), `${id}: grid thumbnail must use assets/img/gallery/thumbs/.`);
  assert(!full.includes("/thumbs/"), `${id}: full/lightbox image must not use a thumbnail path.`);
  assert(thumb !== full, `${id}: thumbnail and full image paths must be different.`);

  if (thumb) {
    const thumbnailPath = path.join("apps/web/public", thumb).split(path.sep).join("/");
    assertFileExists(`${id} thumbnail`, thumbnailPath);
    if (existsSync(path.join(root, thumbnailPath))) {
      const thumbnailBytes = statSync(path.join(root, thumbnailPath)).size;
      galleryThumbnailSizes.push(thumbnailBytes);
      assert(
        thumbnailBytes <= galleryStaticThumbnailMaximumBytes,
        `${id}: thumbnail is ${thumbnailBytes} bytes; maximum is ${galleryStaticThumbnailMaximumBytes}.`,
      );
    }
  }

  if (full) {
    assertFileExists(`${id} full image`, path.join("apps/web/public", full).split(path.sep).join("/"));
  }
}

const worstCaseStaticBatchBytes = galleryThumbnailSizes
  .sort((a, b) => b - a)
  .slice(0, galleryRenderBatchSize)
  .reduce((total, size) => total + size, 0);
const worstCaseMemberBatchBytes = galleryRenderBatchSize * galleryMemberThumbnailMaximumBytes;
assert(
  worstCaseStaticBatchBytes < galleryInitialTransferMaximumBytes,
  `Gallery static initial image transfer could reach ${worstCaseStaticBatchBytes} bytes; maximum is ${galleryInitialTransferMaximumBytes - 1}.`,
);
assert(
  worstCaseMemberBatchBytes < galleryInitialTransferMaximumBytes,
  `Gallery 24-member-thumbnail transfer could reach ${worstCaseMemberBatchBytes} bytes; maximum is ${galleryInitialTransferMaximumBytes - 1}.`,
);

const galleryBrowser = read("apps/web/components/public-pages/GalleryBrowser.tsx");
const galleryBrowserState = read("apps/web/lib/gallery/browser-state.ts");
const universalImageLightbox = read("apps/web/components/UniversalImageLightbox.tsx");
const responsiveGalleryMediaPath = "apps/web/components/ResponsiveGalleryMedia.tsx";
const sharedGalleryMediaStylesPath = "apps/web/app/styles/shell-gallery-media.css";
const responsiveGalleryMedia = read(responsiveGalleryMediaPath);
const sharedGalleryMediaStyles = read(sharedGalleryMediaStylesPath);
const homeGalleryLightbox = read("apps/web/components/HomeGalleryLightbox.tsx");
const homeGalleryLightboxModal = read("apps/web/components/HomeGalleryLightboxModal.tsx");
const approvedGalleryFeed = read("apps/web/lib/gallery/approved-feed.ts");
const approvedFunction = read("supabase/functions/list-approved-gallery-submissions/index.ts");
const publicFeedShared = read("supabase/functions/_shared/gallery-public-feed.ts");
const galleryPublicationRevisionsMigration = read(
  "supabase/migrations/20260728132000_add_gallery_publication_revisions.sql",
);
const thumbnailParser = read("supabase/functions/_shared/gallery-thumbnail.ts");
const thumbnailDecoder = read("supabase/functions/_shared/gallery-webp-decoder.ts");
const thumbnailValidatorSource = read("supabase/functions/_shared/gallery-webp-validator.c");
const thumbnailValidatorBuild = read("scripts/build-gallery-webp-validator.sh");
const thumbnailValidatorModulePath = "supabase/functions/_shared/vendor/libwebp/validator.generated.js";
const thumbnailValidatorModule = read(thumbnailValidatorModulePath);
const thumbnailValidatorDigest = read(`${thumbnailValidatorModulePath}.sha256`).trim().split(/\s+/)[0];
const homePage = read("apps/web/app/page.tsx");
const routeShell = read("apps/web/components/SiteRouteShell.tsx");
const sharedPublicComponents = read("apps/web/components/public-pages/common.tsx");
const siteHeader = read("apps/web/components/SiteHeader.tsx");
const siteFooter = read("apps/web/components/SiteFooter.tsx");
const spotifyBrowser = read("apps/web/components/public-pages/SpotifyBrowser.tsx");
const tokenStyles = read("apps/web/app/styles/tokens-base.css");
const sidePagesGuide = read("docs/side-pages-guide.md");

[
  "lazy(() =>",
  'import("@/components/HomeGalleryLightboxModal")',
  "<HomeGalleryLightboxFallback",
  "{openItem && portalRoot ? (",
  "useBodyScrollLock(openItem !== null && portalRoot !== null);",
].forEach((snippet) => assertIncludes("Home gallery deferred lightbox", homeGalleryLightbox, snippet));
assertIncludes("Home gallery immediate loading portal", homeGalleryLightbox, "return createPortal(");
assert(!homeGalleryLightbox.includes("<Suspense fallback={null}>"), "Home gallery first-open loading state must not be blank.");
[
  'import { createPortal } from "react-dom";',
  'role="dialog"',
  'aria-modal="true"',
  'src={item.full}',
].forEach((snippet) => assertIncludes("Home gallery deferred modal", homeGalleryLightboxModal, snippet));
assert(!homeGalleryLightboxModal.includes("useBodyScrollLock("), "Home gallery lazy modal must not replace the parent-owned scroll lock.");

[
  "const galleryRenderBatchSize = APPROVED_GALLERY_PAGE_SIZE;",
  "const renderedItems = useMemo(() => visibleItems.slice(0, effectiveRenderLimit)",
  'id="galleryLoadMore"',
  "src: submission.thumbnail_url,",
  "thumb: submission.thumbnail_url,",
  "thumbnailWidth: submission.thumbnail_width,",
  "thumbnailHeight: submission.thumbnail_height,",
  "submission.categories",
  "nextCursor",
  "hasMore",
  "const randomSeed = useMemo(() => stableGalleryMixSeed(staticItems)",
  "orderGalleryPresentation({",
  'import { UniversalImageLightbox } from "@/components/UniversalImageLightbox";',
  "<UniversalImageLightbox",
].forEach((snippet) => assertIncludes("GalleryBrowser media contract", galleryBrowser, snippet));

[
  "stableGalleryMixOrder",
  "stableGalleryMixSeed",
  "return [...stableGalleryMixOrder(staticItems, randomSeed), ...runtimeItems]",
].forEach((snippet) => assertIncludes("Gallery stable presentation contract", galleryBrowserState, snippet));
[
  'import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";',
  "<ResponsiveGalleryMedia",
  "src={item.thumb}",
  "intrinsicWidth={item.thumbnailWidth}",
  "intrinsicHeight={item.thumbnailHeight}",
].forEach((snippet) => assertIncludes("Gallery shared thumbnail media", galleryBrowser, snippet));
[
  "responsive-gallery-media__image",
  'loading={loading}',
  'decoding="async"',
  'status: "loading"',
  'status: "ready"',
  'status: "error"',
  "Image unavailable",
  "intrinsicWidth?: number;",
  "intrinsicHeight?: number;",
  "width={imageWidth}",
  "height={imageHeight}",
].forEach((snippet) => assertIncludes("shared Gallery media component", responsiveGalleryMedia, snippet));
[
  ".responsive-gallery-frame{",
  "aspect-ratio:16 / 10;",
  ".responsive-gallery-media{",
  "width:100%;",
  "height:100%;",
  ".responsive-gallery-media__image{",
  "object-fit:cover;",
  "object-position:center;",
].forEach((snippet) => assertIncludes("shared Gallery media geometry", sharedGalleryMediaStyles, snippet));
[
  'import { createPortal } from "react-dom";',
  'role="dialog"',
  'aria-modal="true"',
  "<LightboxImage",
  "src={item.fullSrc}",
  "previewSrc={item.previewSrc}",
].forEach((snippet) => assertIncludes("universal Gallery lightbox", universalImageLightbox, snippet));

assert(!galleryBrowser.includes("setRandomSeed"), "GalleryBrowser must not reshuffle after first paint.");
assert(!galleryBrowser.includes("createRandomSeed"), "GalleryBrowser must not use a per-render random seed.");
assert(!galleryBrowser.includes("shuffleWithSeed"), "GalleryBrowser must preserve existing item order when approved items arrive.");

assert(!galleryBrowser.includes("storage_path"), "GalleryBrowser must not read raw Supabase storage paths.");
assert(!galleryBrowser.includes("storage_bucket"), "GalleryBrowser must not read raw Supabase storage buckets.");
assertIncludes("approved gallery client", approvedGalleryFeed, "list-approved-gallery-submissions");
assertIncludes("approved gallery client", approvedGalleryFeed, "method: \"POST\"");

const approvedTypeMatch = approvedGalleryFeed.match(/export type ApprovedGallerySubmission = \{[\s\S]*?\n\};/);
assert(Boolean(approvedTypeMatch), "ApprovedGallerySubmission type was not found.");
if (approvedTypeMatch) {
  const approvedType = approvedTypeMatch[0];
  assertIncludes("ApprovedGallerySubmission", approvedType, "thumbnail_url: string;");
  assertIncludes("ApprovedGallerySubmission", approvedType, "thumbnail_size_bytes: number;");
  assertIncludes("ApprovedGallerySubmission", approvedType, "thumbnail_width: number;");
  assertIncludes("ApprovedGallerySubmission", approvedType, "thumbnail_height: number;");
  assert(!approvedType.includes("full_url"), "ApprovedGallerySubmission list DTO must not expose an original URL.");
  assert(!approvedType.includes("uploader"), "ApprovedGallerySubmission must not expose member identity attribution.");
  assert(!approvedType.includes("storage_path"), "ApprovedGallerySubmission must not expose storage_path.");
  assert(!approvedType.includes("storage_bucket"), "ApprovedGallerySubmission must not expose storage_bucket.");
}

const publicResponseItemMatch = publicFeedShared.match(
  /export function toPublicGalleryItem\([\s\S]*?^\}/m,
);
assert(Boolean(publicResponseItemMatch), "Gallery feed v2 public item serializer was not found.");
if (publicResponseItemMatch) {
  const responseItem = publicResponseItemMatch[0];
  assertIncludes("Gallery feed v2 public item", responseItem, "thumbnail_url: thumbnailUrl,");
  assertIncludes("Gallery feed v2 public item", responseItem, "thumbnail_size_bytes: thumbnailSizeBytes,");
  assertIncludes("Gallery feed v2 public item", responseItem, "thumbnail_width: thumbnailWidth,");
  assertIncludes("Gallery feed v2 public item", responseItem, "thumbnail_height: thumbnailHeight,");
  assert(!responseItem.includes("storagePath"), "Gallery feed v2 item must not expose storagePath.");
  assert(!responseItem.includes("storageBucket"), "Gallery feed v2 item must not expose storageBucket.");
  assert(!responseItem.includes("userId"), "Gallery feed v2 item must not expose userId.");
  assert(!responseItem.includes("signed_url"), "Gallery feed v2 item must not expose bearer-style signed URL fields.");
}

const legacyResponseItemMatch = publicFeedShared.match(
  /export function toLegacyGalleryItem\([\s\S]*?^\}/m,
);
assert(Boolean(legacyResponseItemMatch), "Deferred Website Gallery compatibility serializer was not found.");
if (legacyResponseItemMatch) {
  const responseItem = legacyResponseItemMatch[0];
  assertIncludes("deferred Website Gallery compatibility item", responseItem, "full_signed_url: safeFullUrl,");
  assertIncludes("deferred Website Gallery compatibility item", responseItem, "thumbnail_signed_url: thumbnailUrl,");
  assertIncludes("deferred Website Gallery compatibility item", responseItem, "thumbnail_size_bytes: thumbnailSizeBytes,");
  assert(!responseItem.includes("storagePath"), "Website compatibility DTO must not expose storagePath.");
  assert(!responseItem.includes("storageBucket"), "Website compatibility DTO must not expose storageBucket.");
  assert(!responseItem.includes("userId"), "Website compatibility DTO must not expose userId.");
}

[
  '"gallery_reserve_public_media_v2"',
  ".download(storagePath)",
  "await sha256Hex(mediaBytes) !== mediaSha256",
  'adminClient.rpc("gallery_reserve_public_delivery"',
  "p_reserved_bytes: 65536",
  '"gallery_public_feed_page_v2"',
  "parseGalleryDatabasePage",
  "publicFeedEvidenceCache.getOrLoad",
  'publicMediaUrl(supabaseUrl, "thumbnail", id)',
  'publicMediaUrl(supabaseUrl, "full", id)',
  'delivery: "bounded-edge-media"',
].forEach((snippet) => assertIncludes("approved gallery derivative contract", approvedFunction, snippet));
assert(
  !approvedFunction.includes("createSignedUrls"),
  "Approved Gallery delivery must not mint replayable Storage signed URLs.",
);
assert(
  !approvedFunction.includes("/storage/v1/object/sign/"),
  "Approved Gallery delivery must not embed a Storage signing path.",
);

[
  "export const GALLERY_PUBLIC_PAGE_SIZE = 24;",
  "export const GALLERY_PUBLIC_EVIDENCE_CACHE_TTL_MS = 15 * 1000;",
  "export const GALLERY_PUBLIC_EVIDENCE_CACHE_MAX_ENTRIES = 32;",
  "export const GALLERY_PUBLIC_CIRCUIT_MAX_CONCURRENT = 12;",
  "containsBearerCapability(page)",
  'const maximumBytes = kind === "thumbnail" ? 80 * 1024 : 2 * 1024 * 1024;',
  'const maximumDimension = kind === "thumbnail" ? 720 : 2560;',
].forEach((snippet) => assertIncludes("Gallery feed v2 bounded helper", publicFeedShared, snippet));

[
  "create or replace function public.gallery_reserve_public_delivery(",
  "minute_request_limit := case requested_kind",
  "day_request_limit := case requested_kind",
  "daily_byte_limit constant bigint := 67108864;",
  "pg_catalog.pg_advisory_xact_lock(",
  "on conflict (window_started_at, delivery_kind) do update",
  "create or replace function public.gallery_public_feed_page_v2(",
  "interval '10 minutes'",
  "create function public.gallery_reserve_public_media_v2(",
  "interval '1 hour'",
].forEach((snippet) =>
  assertIncludes("Gallery feed v2 reservation windows", galleryPublicationRevisionsMigration, snippet)
);

const generatedValidatorDigest = createHash("sha256").update(thumbnailValidatorModule).digest("hex");
assert(
  thumbnailValidatorDigest === generatedValidatorDigest,
  `Vendored libwebp validator digest mismatch: expected ${thumbnailValidatorDigest}, generated ${generatedValidatorDigest}.`,
);
assert(
  statSync(path.join(root, thumbnailValidatorModulePath)).size <= 256 * 1024,
  "Vendored libwebp validator must remain at or below 256 KiB.",
);
[
  "await isDecodableGalleryWebp(",
  'error: "thumbnail_decode_failed"',
].forEach((snippet) => assertIncludes("trusted gallery thumbnail decode", read("supabase/functions/moderate-gallery-submission/index.ts"), snippet));
[
  "WebPDecodeRGBAInto",
  "WebPGetFeatures",
  "WebPGetDecoderVersion",
].forEach((snippet) => assertIncludes("gallery libwebp validator", thumbnailValidatorSource, snippet));
[
  "validator.generated.js",
  "gallery_validate_webp",
  "gallery_webp_decoder_version",
].forEach((snippet) => assertIncludes("gallery libwebp decoder", thumbnailDecoder, snippet));
[
  'GALLERY_THUMBNAIL_MAX_BYTES = 80 * 1024',
  'GALLERY_THUMBNAIL_MAX_EDGE = 720',
  'return `_approved/publications/${publicationId}/revisions/${revisionId}/thumbnail.webp`;',
].forEach((snippet) => assertIncludes("gallery thumbnail parser", thumbnailParser, snippet));
[
  'LIBWEBP_VERSION="1.6.0"',
  'LIBWEBP_ARCHIVE_SHA256="e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564"',
  'EMSDK_IMAGE="emscripten/emsdk:4.0.12@sha256:744fb6a68941970951bacf9d6632041a0398260492232691ef22bbf54b0585c6"',
  "--platform linux/amd64",
  "EXPORTED_RUNTIME_METHODS='[\"HEAPU8\"]'",
].forEach((snippet) => assertIncludes("reproducible gallery libwebp build", thumbnailValidatorBuild, snippet));

const heroBlock = extractStaticImageBlock(homePage, "heroImage");
const sealBlock = extractStaticImageBlock(homePage, "sealImage");
assertIncludes("Home hero image", heroBlock, "priority");
assert(sealBlock && !sealBlock.includes("priority"), "Home guild seal must not use priority preload.");

const homePriorityCount = [...homePage.matchAll(/\bpriority\b/g)].length;
assert(homePriorityCount === 1, `Home page should have exactly one priority image, found ${homePriorityCount}.`);

[
  'import Image from "next/image";',
  'src="/assets/bg/wuxia-bg.webp"',
  'className="bg-photo__image"',
  "fill",
  'sizes="100vw"',
  'loading="eager"',
].forEach((snippet) => assertIncludes("responsive global background", routeShell, snippet));
assertIncludes("responsive global background styles", tokenStyles, ".bg-photo__image{");
assertIncludes("responsive global background styles", tokenStyles, "object-fit:cover;");
assert(!tokenStyles.includes('background:url("/assets/bg/wuxia-bg.webp")'), "Next background must not retain the full-size CSS request.");

assertIncludes("shared PageHero", sharedPublicComponents, "className=\"page-hero__img\"");
assertIncludes("shared PageHero", sharedPublicComponents, "priority");
assertIncludes("shared image LCP hint", sharedPublicComponents, "resolvedFetchPriority");
assertIncludes("shared image LCP hint", sharedPublicComponents, "fetchPriority={resolvedFetchPriority}");

[
  'import Image from "next/image";',
  'src="/assets/img/brand/emblem.webp"',
  'sizes="56px"',
  'fetchPriority="low"',
].forEach((snippet) => assertIncludes("optimized header emblem", siteHeader, snippet));

[
  'import Image from "next/image";',
  'src="/assets/img/brand/emblem.webp"',
  'sizes="56px"',
].forEach((snippet) => assertIncludes("optimized footer emblem", siteFooter, snippet));

[
  "function SpotifyEmbed",
  "IntersectionObserver",
  'data-deferred-spotify-embed="true"',
  'rootMargin: "640px 0px"',
  'loading="lazy"',
  "title={`Spotify embed: ${title}`}",
  'allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"',
  'url.hostname !== "open.spotify.com"',
  "const allowedKinds = new Set",
  "function spotifyEmbedHeight",
  "spotify-embed--compact",
  "spotify-embed--standard",
  "<SpotifyEmbed",
].forEach((snippet) => assertIncludes("Spotify deferred embed contract", spotifyBrowser, snippet));

[
  "Spotify iframe embeds are deferred",
  "IntersectionObserver",
  "loading=\"lazy\"",
  "open.spotify.com",
].forEach((snippet) => assertIncludes("Spotify performance docs", sidePagesGuide, snippet));

if (failures.length) {
  console.error("Media performance validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Media performance validation OK (${galleryItems.length} gallery items checked).`);
