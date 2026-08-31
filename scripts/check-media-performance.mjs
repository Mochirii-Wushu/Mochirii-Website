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

function galleryStaticPairKey(thumbnail, full) {
  return JSON.stringify([thumbnail, full]);
}

const galleryAllowedWebpChunks = new Set(["VP8X", "ALPH", "VP8 ", "VP8L"]);

function galleryWebpError(message) {
  throw new Error(`WebP: ${message}`);
}

function galleryWebpUint24(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function validateGalleryStaticWebp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 26) galleryWebpError("container is too short");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    galleryWebpError("RIFF/WEBP signature is missing");
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) galleryWebpError("RIFF length does not match the file length");

  let offset = 12;
  let chunkCount = 0;
  let imageChunks = 0;
  let extendedHeader = false;
  let extendedFlags = 0;
  let sawAlpha = false;
  let width = 0;
  let height = 0;

  while (offset < buffer.length) {
    if (chunkCount >= 100_000) galleryWebpError("chunk count exceeds the validation bound");
    if (offset + 8 > buffer.length) galleryWebpError("truncated chunk header");
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + size;
    const paddedEnd = end + (size & 1);
    if (end < payload || paddedEnd > buffer.length) galleryWebpError(`${type || "unknown"} chunk exceeds the container`);
    if (!galleryAllowedWebpChunks.has(type)) galleryWebpError(`unapproved ${JSON.stringify(type)} chunk`);
    if ((size & 1) !== 0 && buffer[end] !== 0) galleryWebpError(`${type} chunk has a nonzero padding byte`);

    if (type === "VP8X") {
      if (extendedHeader || offset !== 12 || size !== 10) galleryWebpError("invalid or duplicate VP8X header");
      if (buffer[payload + 1] !== 0 || buffer[payload + 2] !== 0 || buffer[payload + 3] !== 0) {
        galleryWebpError("VP8X reserved bytes are nonzero");
      }
      extendedFlags = buffer[payload];
      if ((extendedFlags & ~0x10) !== 0) galleryWebpError("VP8X advertises metadata, animation, or reserved features");
      extendedHeader = true;
      width = galleryWebpUint24(buffer, payload + 4) + 1;
      height = galleryWebpUint24(buffer, payload + 7) + 1;
    } else if (type === "ALPH") {
      if (!extendedHeader || sawAlpha || imageChunks > 0 || (extendedFlags & 0x10) === 0 || size < 1) {
        galleryWebpError("ALPH is duplicate, out of order, empty, or not declared by VP8X");
      }
      const alphaHeader = buffer[payload];
      const compression = alphaHeader & 0x03;
      const preprocessing = (alphaHeader >>> 4) & 0x03;
      if ((alphaHeader & 0xc0) !== 0 || compression > 1 || preprocessing > 1) {
        galleryWebpError("ALPH header contains a reserved or unsupported value");
      }
      if (compression === 0 && size !== width * height + 1) {
        galleryWebpError("uncompressed ALPH payload length does not match the canvas");
      }
      if (compression === 1 && size < 2) galleryWebpError("compressed ALPH payload is empty");
      sawAlpha = true;
    } else if (type === "VP8 ") {
      if (imageChunks > 0 || size < 10 || (buffer[payload] & 1) !== 0) galleryWebpError("invalid or duplicate VP8 key frame");
      if (buffer[payload + 3] !== 0x9d || buffer[payload + 4] !== 0x01 || buffer[payload + 5] !== 0x2a) {
        galleryWebpError("VP8 frame sync code is missing");
      }
      const frameWidth = buffer.readUInt16LE(payload + 6) & 0x3fff;
      const frameHeight = buffer.readUInt16LE(payload + 8) & 0x3fff;
      if (extendedHeader && Boolean(extendedFlags & 0x10) !== sawAlpha) galleryWebpError("VP8X alpha declaration disagrees with ALPH");
      if (extendedHeader && (frameWidth !== width || frameHeight !== height)) galleryWebpError("VP8 frame dimensions disagree with VP8X");
      if (!extendedHeader) [width, height] = [frameWidth, frameHeight];
      imageChunks += 1;
    } else if (type === "VP8L") {
      if (imageChunks > 0 || sawAlpha || size < 5 || buffer[payload] !== 0x2f) galleryWebpError("invalid or duplicate VP8L frame");
      const bits = buffer.readUInt32LE(payload + 1);
      if ((bits >>> 29) !== 0) galleryWebpError("VP8L version bits are nonzero");
      const frameWidth = (bits & 0x3fff) + 1;
      const frameHeight = ((bits >>> 14) & 0x3fff) + 1;
      const hasAlpha = (bits & 0x10000000) !== 0;
      if (extendedHeader && Boolean(extendedFlags & 0x10) !== hasAlpha) galleryWebpError("VP8X alpha declaration disagrees with VP8L");
      if (extendedHeader && (frameWidth !== width || frameHeight !== height)) galleryWebpError("VP8L frame dimensions disagree with VP8X");
      if (!extendedHeader) [width, height] = [frameWidth, frameHeight];
      imageChunks += 1;
    }

    offset = paddedEnd;
    chunkCount += 1;
  }

  if (offset !== buffer.length) galleryWebpError("container ends between chunks");
  if (imageChunks !== 1) galleryWebpError("container must contain exactly one static image");
  if (width === 0 || height === 0) galleryWebpError("image has zero dimensions");
  return { width, height };
}

function assertGalleryStaticWebpCanaries(validWebp) {
  const expectReject = (label, candidate) => {
    try {
      validateGalleryStaticWebp(candidate);
    } catch {
      return;
    }
    galleryWebpError(`validator canary accepted ${label}`);
  };

  const badLength = Buffer.from(validWebp);
  badLength.writeUInt32LE(17, 4);
  expectReject("a mismatched RIFF length", badLength);

  const metadataPayload = Buffer.from("validator-canary", "ascii");
  const metadataChunk = Buffer.alloc(8 + metadataPayload.length + (metadataPayload.length & 1));
  metadataChunk.write("EXIF", 0, 4, "ascii");
  metadataChunk.writeUInt32LE(metadataPayload.length, 4);
  metadataPayload.copy(metadataChunk, 8);
  const metadataWebp = Buffer.concat([validWebp.subarray(0, 12), metadataChunk, validWebp.subarray(12)]);
  metadataWebp.writeUInt32LE(metadataWebp.length - 8, 4);
  expectReject("an unapproved metadata chunk", metadataWebp);
  expectReject("a truncated container", validWebp.subarray(0, validWebp.length - 1));
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
const galleryStaticFullMaximumBytes = 2 * 1024 * 1024;
const galleryStaticFullMaximumEdge = 2560;
const galleryMemberThumbnailMaximumBytes = 80 * 1024;
const galleryInitialTransferMaximumBytes = 2 * 1024 * 1024;
const galleryRenderBatchSize = 24;
const galleryThumbnailSizes = [];
let galleryWebpCanariesChecked = false;
const galleryStaticPairs = new Set(
  galleryItems.map((item) => galleryStaticPairKey(
    publicAssetPath(item.thumb),
    publicAssetPath(item.full || item.src),
  )),
);

for (const item of galleryItems) {
  const id = String(item.id || item.full || item.src || "gallery item");
  const thumb = publicAssetPath(item.thumb);
  const full = publicAssetPath(item.full || item.src);

  assert(thumb.includes("assets/img/gallery/thumbs/"), `${id}: grid thumbnail must use assets/img/gallery/thumbs/.`);
  assert(Boolean(full), `${id}: full/lightbox image path is required.`);
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
    const fullPath = path.join("apps/web/public", full).split(path.sep).join("/");
    assert(full.toLowerCase().endsWith(".webp"), `${id}: full image must use a .webp path.`);
    assertFileExists(`${id} full image`, fullPath);
    if (existsSync(path.join(root, fullPath))) {
      try {
        const fullBuffer = readFileSync(path.join(root, fullPath));
        assert(
          fullBuffer.length <= galleryStaticFullMaximumBytes,
          `${id}: full image is ${fullBuffer.length} bytes; maximum is ${galleryStaticFullMaximumBytes}.`,
        );
        const { width, height } = validateGalleryStaticWebp(fullBuffer);
        if (!galleryWebpCanariesChecked) {
          assertGalleryStaticWebpCanaries(fullBuffer);
          galleryWebpCanariesChecked = true;
        }
        assert(
          width <= galleryStaticFullMaximumEdge && height <= galleryStaticFullMaximumEdge,
          `${id}: full image is ${width}x${height}; maximum edge is ${galleryStaticFullMaximumEdge}.`,
        );
      } catch (error) {
        fail(`${id}: full-image validation failed: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }
  }
}

assert(galleryWebpCanariesChecked, "Gallery static WebP validator canaries did not run.");

const homeData = JSON.parse(read("apps/web/public/data/home.json"));
const homeGalleryFallbacks = Array.isArray(homeData.gallery) ? homeData.gallery : [];
for (const [index, item] of homeGalleryFallbacks.entries()) {
  const homeThumbnail = publicAssetPath(item.image);
  const homeFull = publicAssetPath(item.full || item.image);
  assert(
    galleryStaticPairs.has(galleryStaticPairKey(homeThumbnail, homeFull)),
    `Home Guild Gallery fallback ${index + 1}: thumbnail/full pair must belong to the validated static Gallery inventory.`,
  );
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
  'className="responsive-gallery-media__fallback" aria-hidden="true"',
].forEach((snippet) => assertIncludes("shared Gallery media component", responsiveGalleryMedia, snippet));
assert(
  !responsiveGalleryMedia.includes("Image unavailable"),
  "shared Gallery media fallback must not introduce unapproved visible copy.",
);
assert(
  !responsiveGalleryMedia.includes("aria-busy"),
  "shared Gallery thumbnail media must not depend on hydration to clear server-rendered busy semantics.",
);
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
