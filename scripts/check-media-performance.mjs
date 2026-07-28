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
const homeGalleryLightbox = read("apps/web/components/HomeGalleryLightbox.tsx");
const homeGalleryLightboxModal = read("apps/web/components/HomeGalleryLightboxModal.tsx");
const approvedGalleryFeed = read("apps/web/lib/gallery/approved-feed.ts");
const approvedFunction = read("supabase/functions/list-approved-gallery-submissions/index.ts");
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
  "const galleryRenderBatchSize = 24;",
  "const renderedItems = useMemo(() => visibleItems.slice(0, effectiveRenderLimit)",
  'id="galleryLoadMore"',
  "src={openItem.full}",
  "const fullSignedUrl = text(submission.full_signed_url);",
  "const thumbnailSignedUrl = text(submission.thumbnail_signed_url);",
  "full: fullSignedUrl,",
  "thumb: thumbnailSignedUrl,",
  "fullSignedUrl === thumbnailSignedUrl",
  "thumbnailSizeBytes > 80 * 1024",
  "function stableMixOrder(items: NormalizedGalleryItem[], seed: number)",
  "const randomSeed = useMemo(",
  "stableMixSeed(",
  "submission.preview_error",
].forEach((snippet) => assertIncludes("GalleryBrowser media contract", galleryBrowser, snippet));

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

const approvedTypeMatch = approvedGalleryFeed.match(/export type ApprovedGallerySubmission = \{[\s\S]*?\n\};/);
assert(Boolean(approvedTypeMatch), "ApprovedGallerySubmission type was not found.");
if (approvedTypeMatch) {
  const approvedType = approvedTypeMatch[0];
  assertIncludes("ApprovedGallerySubmission", approvedType, "full_signed_url?: string | null;");
  assertIncludes("ApprovedGallerySubmission", approvedType, "thumbnail_signed_url?: string | null;");
  assertIncludes("ApprovedGallerySubmission", approvedType, "thumbnail_size_bytes?: number | null;");
  assert(!approvedType.includes("storage_path"), "ApprovedGallerySubmission must not expose storage_path.");
  assert(!approvedType.includes("storage_bucket"), "ApprovedGallerySubmission must not expose storage_bucket.");
}

const responseItemMatch = approvedFunction.match(/const item: JsonRecord = \{[\s\S]*?\n    \};/);
assert(Boolean(responseItemMatch), "list-approved-gallery-submissions response item was not found.");
if (responseItemMatch) {
  const responseItem = responseItemMatch[0];
  assertIncludes("approved gallery response item", responseItem, "thumbnail_signed_url: thumbnailSignedUrl,");
  assertIncludes("approved gallery response item", responseItem, "full_signed_url: fullSignedUrl,");
  assertIncludes("approved gallery response item", responseItem, "thumbnail_size_bytes: thumbnailSizeBytes,");
  assert(!responseItem.includes("storage_path"), "Approved gallery response item must not expose storage_path.");
  assert(!responseItem.includes("storage_bucket"), "Approved gallery response item must not expose storage_bucket.");
}

[
  'adminClient.rpc(\n    "gallery_publishable_submissions"',
  "const SIGNING_PATH_BATCH = 40;",
  "Promise.all(",
  ".createSignedUrls(paths, SIGNED_URL_SECONDS)",
  "thumbnailSizeBytes > 80 * 1024",
  'thumbnailMimeType !== "image/webp"',
  "if (!thumbnailSignedUrl || !fullSignedUrl)",
].forEach((snippet) => assertIncludes("approved gallery derivative contract", approvedFunction, snippet));

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
  'return `_approved/thumbs/${submissionId}/${revisionId}.webp`;',
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
