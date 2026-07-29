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

function cssRuleBody(source, selector) {
  const start = source.indexOf(`${selector}{`);
  if (start < 0) return "";
  const bodyStart = start + selector.length + 1;
  const end = source.indexOf("}", bodyStart);
  return end < 0 ? "" : source.slice(bodyStart, end);
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
const homeGalleryLightbox = read("apps/web/components/HomeGalleryLightbox.tsx");
const universalImageLightbox = read("apps/web/components/UniversalImageLightbox.tsx");
const approvedGalleryFeed = read("apps/web/lib/gallery/approved-feed.ts");
const approvedFunction = read("supabase/functions/list-approved-gallery-submissions/index.ts");
const approvedPublicHelper = read("supabase/functions/_shared/gallery-public-feed.ts");
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
const responsiveGalleryMediaPath = "apps/web/components/ResponsiveGalleryMedia.tsx";
const sharedGalleryMediaStylesPath = "apps/web/app/styles/shell-gallery-media.css";
const responsiveGalleryMedia = existsSync(path.join(root, responsiveGalleryMediaPath))
  ? read(responsiveGalleryMediaPath)
  : "";
const sharedGalleryMediaStyles = existsSync(path.join(root, sharedGalleryMediaStylesPath))
  ? read(sharedGalleryMediaStylesPath)
  : "";
const homeDoorsStyles = read("apps/web/app/styles/public-home-doors.css");
const publicGalleryStyles = read("apps/web/app/styles/public-gallery.css");

[
  'import { UniversalImageLightbox } from "@/components/UniversalImageLightbox";',
  "<UniversalImageLightbox",
  "previewSrc: openItem.image",
  "fullSrc: openItem.full",
  "{openItem && portalRoot ? (",
  "useBodyScrollLock(openItem !== null && portalRoot !== null);",
].forEach((snippet) => assertIncludes("Home gallery shared lightbox", homeGalleryLightbox, snippet));
[
  "function getStableGallerySpotlightItems(",
  ".slice(0, gallerySpotlightLimit);",
  "<HomeGalleryLightbox items={gallerySpotlightItems} />",
].forEach((snippet) => assertIncludes("Home stable Gallery Spotlight", homePage, snippet));
assert(!homeGalleryLightbox.includes("lazy("), "Home Gallery must not defer the shared viewer behind a weaker fallback.");
assert(!homeGalleryLightbox.includes("HomeGalleryLightboxFallback"), "Home Gallery must not maintain a second modal implementation.");
[
  'import { createPortal } from "react-dom";',
  'role="dialog"',
  'aria-modal="true"',
  "<LightboxImage",
  "src={item.fullSrc}",
  "previewSrc={item.previewSrc}",
].forEach((snippet) => assertIncludes("universal deferred lightbox", universalImageLightbox, snippet));

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
].forEach((snippet) => assertIncludes("GalleryBrowser media contract", galleryBrowser, snippet));
[
  "stableGalleryMixOrder",
  "stableGalleryMixSeed",
  "return [...stableGalleryMixOrder(staticItems, randomSeed), ...runtimeItems]",
].forEach((snippet) => assertIncludes("Gallery stable presentation contract", galleryBrowserState, snippet));
assert(!galleryBrowser.includes("submission.full_url"), "GalleryBrowser list conversion must not receive an original URL.");
assert(!galleryBrowser.includes("submission.uploader_display_name"), "GalleryBrowser must not receive member identity attribution.");

assertFileExists("shared Gallery media component", responsiveGalleryMediaPath);
assertFileExists("shared Gallery media styles", sharedGalleryMediaStylesPath);
[
  'import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";',
  "<ResponsiveGalleryMedia",
  "src={item.thumb}",
].forEach((snippet) => assertIncludes("Gallery shared thumbnail media", galleryBrowser, snippet));
[
  'import { ResponsiveGalleryMedia } from "@/components/ResponsiveGalleryMedia";',
  "<ResponsiveGalleryMedia",
  "src={item.image}",
].forEach((snippet) => assertIncludes("Home shared thumbnail media", homeGalleryLightbox, snippet));
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
  "intrinsicWidth={item.thumbnailWidth}",
  "intrinsicHeight={item.thumbnailHeight}",
].forEach((snippet) => assertIncludes("Gallery intrinsic thumbnail geometry", galleryBrowser, snippet));
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
assertIncludes("Gallery shared frame", galleryBrowser, 'className="gallery-thumb responsive-gallery-frame"');
assertIncludes("Home shared frame", homeGalleryLightbox, 'className="home-thumb responsive-gallery-frame"');
for (const [label, rule] of [
  ["Gallery page frame", cssRuleBody(publicGalleryStyles, ".gallery-thumb")],
  ["Home page frame", cssRuleBody(homeDoorsStyles, ".home-thumb")],
]) {
  assert(rule, `${label}: rule not found.`);
  for (const property of ["position:", "display:", "width:", "aspect-ratio:", "overflow:", "padding:"]) {
    assert(!rule.includes(property), `${label}: ${property} must remain owned by the shared frame contract.`);
  }
}
assert(
  !homeGalleryLightbox.includes('className="home-thumb__img"'),
  "Home Gallery must not bypass the shared responsive media component.",
);
assert(
  !galleryBrowser.includes('<img src={item.thumb}'),
  "Gallery must not render the thumbnail outside the shared responsive media component.",
);

assert(!galleryBrowser.includes("setRandomSeed"), "GalleryBrowser must not reshuffle after first paint.");
assert(!galleryBrowser.includes("createRandomSeed"), "GalleryBrowser must not use a per-render random seed.");
assert(!galleryBrowser.includes("shuffleWithSeed"), "GalleryBrowser must preserve existing item order when approved items arrive.");

assert(!galleryBrowser.includes("storage_path"), "GalleryBrowser must not read raw Supabase storage paths.");
assert(!galleryBrowser.includes("storage_bucket"), "GalleryBrowser must not read raw Supabase storage buckets.");
assertIncludes("approved gallery client", approvedGalleryFeed, "list-approved-gallery-submissions");
assertIncludes("approved gallery client", approvedGalleryFeed, "method: \"POST\"");
assertIncludes("approved gallery client", approvedGalleryFeed, 'action: "list"');
assertIncludes("approved gallery client", approvedGalleryFeed, 'action: "full" | "thumbnail"');
assertIncludes("approved gallery client", approvedGalleryFeed, 'url.searchParams.set("asset", kind)');
assertIncludes("approved gallery client", approvedGalleryFeed, 'url.searchParams.set("id", id)');
assertIncludes("approved gallery client", approvedGalleryFeed, "refreshApprovedGalleryThumbnail");
assertIncludes("approved gallery full-image loader", approvedGalleryFeed, "loadApprovedGalleryOriginal");
assertIncludes("approved gallery client", approvedGalleryFeed, "nextCursor");

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

[
  '"gallery_public_feed_page_v2"',
  '"gallery_reserve_public_media_v2"',
  'request.action === "full" || request.action === "thumbnail"',
  'if (req.method !== "GET")',
  "parseGalleryMediaReservation(mediaData, request.id, request.action)",
  ".download(storagePath)",
  "mediaBlob.size !== mediaSize",
  "await sha256Hex(mediaBytes) !== mediaSha256",
  '"Cache-Control": "private, max-age=300, stale-while-revalidate=60"',
].forEach((snippet) => assertIncludes("approved Gallery derivative contract", approvedFunction, snippet));
[
  "createSignedUrl(",
  "createSignedUrls(",
  "thumbnail_signed_url",
  "full_signed_url",
  "uploader_display_name",
].forEach((snippet) => assert(!approvedFunction.includes(snippet), `Approved Gallery endpoint retained retired capability ${snippet}.`));
[
  "thumbnail_width: thumbnailWidth",
  "thumbnail_height: thumbnailHeight",
].forEach((snippet) => assertIncludes("approved Gallery public thumbnail DTO", approvedPublicHelper, snippet));
assert(
  !approvedFunction.includes('"gallery_publishable_submissions"'),
  "Approved Gallery endpoint must not retain the fixed-limit v1 database function.",
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
  'GALLERY_DISPLAY_MAX_BYTES = 2 * 1024 * 1024',
  'GALLERY_DISPLAY_MAX_EDGE = 2560',
  'return `_approved/publications/${publicationId}/display.webp`;',
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
