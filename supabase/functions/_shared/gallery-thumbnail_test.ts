import {
  GALLERY_DISPLAY_MAX_BYTES,
  GALLERY_THUMBNAIL_MAX_BYTES,
  galleryPublicationDisplayStoragePath,
  galleryThumbnailStoragePath,
  parseGalleryDisplayPayload,
  parseGalleryThumbnailPayload,
} from "./gallery-thumbnail.ts";
import {
  galleryWebpDecoderVersion,
  isDecodableGalleryWebp,
} from "./gallery-webp-decoder.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(
    atob(value),
    (character) => character.charCodeAt(0),
  );
}

function appendRiffChunk(
  bytes: Uint8Array,
  fourcc: string,
  data: Uint8Array,
): Uint8Array {
  assert(fourcc.length === 4, "RIFF chunk names must contain four characters");
  const padding = data.length % 2;
  const result = new Uint8Array(bytes.length + 8 + data.length + padding);
  result.set(bytes);
  result.set(new TextEncoder().encode(fourcc), bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(bytes.length + 4, data.length, true);
  result.set(data, bytes.length + 8);
  view.setUint32(4, result.length - 8, true);
  return result;
}

function withVp8x(bytes: Uint8Array, flags: number): Uint8Array {
  const vp8x = new Uint8Array(18);
  vp8x.set(new TextEncoder().encode("VP8X"), 0);
  new DataView(vp8x.buffer).setUint32(4, 10, true);
  vp8x[8] = flags;
  vp8x[12] = 1;
  vp8x[15] = 1;

  const result = new Uint8Array(bytes.length + vp8x.length);
  result.set(bytes.subarray(0, 12));
  result.set(vp8x, 12);
  result.set(bytes.subarray(12), 12 + vp8x.length);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

function incompleteVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[24] = widthMinusOne & 0xff;
  bytes[25] = (widthMinusOne >> 8) & 0xff;
  bytes[26] = (widthMinusOne >> 16) & 0xff;
  bytes[27] = heightMinusOne & 0xff;
  bytes[28] = (heightMinusOne >> 8) & 0xff;
  bytes[29] = (heightMinusOne >> 16) & 0xff;
  return bytes;
}

const boundedStaticWebp =
  "UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAIAAUAmJYgCdLoAA5gA/vmo7+1Niqnnd+hRsol8wAAA";

Deno.test("accepts a bounded static WebP thumbnail", () => {
  const bytes = fromBase64(boundedStaticWebp);
  const result = parseGalleryThumbnailPayload({
    base64: base64(bytes),
    mime_type: "image/webp",
    size_bytes: bytes.length,
    width: 2,
    height: 2,
  });

  assert(result.ok, "expected bounded WebP payload to pass");
  assert(result.thumbnail.sizeBytes === bytes.length, "size was not preserved");
});

Deno.test("uses the pinned libwebp decoder and fully decodes valid pixels", async () => {
  const bytes = fromBase64(boundedStaticWebp);

  assert(
    await galleryWebpDecoderVersion() === 0x010600,
    "expected the vendored libwebp 1.6.0 decoder",
  );
  assert(
    await isDecodableGalleryWebp(bytes, 2, 2),
    "expected a complete static WebP to decode",
  );
  assert(
    !await isDecodableGalleryWebp(bytes, 1, 2),
    "expected decoded dimensions to match the structural parser",
  );
});

Deno.test("accepts bounded display derivatives and enforces their byte ceiling", () => {
  const bytes = fromBase64(boundedStaticWebp);
  const accepted = parseGalleryDisplayPayload({
    base64: base64(bytes),
    mime_type: "image/webp",
    size_bytes: bytes.length,
    width: 2,
    height: 2,
  });
  assert(accepted.ok, "expected bounded display WebP to pass");
  assert(
    accepted.display.sizeBytes === bytes.length,
    "display size was not preserved",
  );

  const tooLarge = new Uint8Array(GALLERY_DISPLAY_MAX_BYTES + 1);
  assert(
    !parseGalleryDisplayPayload({
      base64: base64(tooLarge),
      mime_type: "image/webp",
      size_bytes: tooLarge.length,
      width: 2,
      height: 2,
    }).ok,
    "display bytes beyond the ceiling should fail",
  );
});

Deno.test("enforces the display derivative dimension ceiling", () => {
  const oversizedDimensions = incompleteVp8x(2561, 1441);
  assert(
    !parseGalleryDisplayPayload({
      base64: base64(oversizedDimensions),
      mime_type: "image/webp",
      size_bytes: oversizedDimensions.length,
      width: 2561,
      height: 1441,
    }).ok,
    "display dimensions beyond the ceiling should fail",
  );
});

Deno.test("rejects corrupt VP8 and VP8L payloads after structural parsing", async () => {
  const corruptSamples = [
    "UklGRhYAAABXRUJQVlA4IAoAAAAAAACdASoCAAIA",
    "UklGRhYAAABXRUJQVlA4TAkAAAAvAUAAAAAAAAAA",
  ];

  for (const encoded of corruptSamples) {
    const bytes = Uint8Array.from(
      atob(encoded),
      (character) => character.charCodeAt(0),
    );
    const parsed = parseGalleryThumbnailPayload({
      base64: encoded,
      mime_type: "image/webp",
      size_bytes: bytes.length,
      width: 2,
      height: 2,
    });

    assert(
      parsed.ok,
      "corrupt regression fixture must reach the trusted decoder",
    );
    assert(
      !await isDecodableGalleryWebp(bytes, 2, 2),
      "corrupt WebP payload must fail full decode",
    );
  }
});

Deno.test("rejects metadata and unknown chunks at the static WebP boundary", () => {
  const valid = fromBase64(boundedStaticWebp);
  const forbiddenChunks = ["ICCP", "EXIF", "XMP ", "ANIM", "ANMF", "JUNK"];

  for (const chunk of forbiddenChunks) {
    const bytes = appendRiffChunk(valid, chunk, new Uint8Array([1, 2]));
    assert(
      !parseGalleryThumbnailPayload({
        base64: base64(bytes),
        mime_type: "image/webp",
        size_bytes: bytes.length,
        width: 2,
        height: 2,
      }).ok,
      `${chunk} chunks must fail the static WebP boundary`,
    );
  }
});

Deno.test("rejects every non-alpha VP8X capability flag", () => {
  const valid = fromBase64(boundedStaticWebp);
  const metadataFreeExtended = withVp8x(valid, 0);
  assert(
    parseGalleryThumbnailPayload({
      base64: base64(metadataFreeExtended),
      mime_type: "image/webp",
      size_bytes: metadataFreeExtended.length,
      width: 2,
      height: 2,
    }).ok,
    "metadata-free extended WebP should pass",
  );

  for (const flags of [0x20, 0x08, 0x04, 0x02, 0x01, 0x40, 0x80]) {
    const bytes = withVp8x(valid, flags);
    assert(
      !parseGalleryThumbnailPayload({
        base64: base64(bytes),
        mime_type: "image/webp",
        size_bytes: bytes.length,
        width: 2,
        height: 2,
      }).ok,
      `VP8X flags 0x${flags.toString(16)} must fail`,
    );
  }
});

Deno.test("rejects oversized, animated, mismatched, and non-WebP payloads", () => {
  const oversizedDimensions = incompleteVp8x(721, 405);
  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(oversizedDimensions),
      mime_type: "image/webp",
      size_bytes: oversizedDimensions.length,
      width: 721,
      height: 405,
    }).ok,
    "oversized dimensions should fail",
  );

  const valid = fromBase64(boundedStaticWebp);
  const animated = withVp8x(valid, 0x02);
  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(animated),
      mime_type: "image/webp",
      size_bytes: animated.length,
      width: 2,
      height: 2,
    }).ok,
    "animated WebP should fail",
  );

  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(valid),
      mime_type: "image/webp",
      size_bytes: valid.length + 1,
      width: 2,
      height: 2,
    }).ok,
    "size mismatch should fail",
  );
  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(valid),
      mime_type: "image/png",
      size_bytes: valid.length,
      width: 2,
      height: 2,
    }).ok,
    "non-WebP payload should fail",
  );

  const trailingBytes = new Uint8Array(valid.length + 2);
  trailingBytes.set(valid);
  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(trailingBytes),
      mime_type: "image/webp",
      size_bytes: trailingBytes.length,
      width: 2,
      height: 2,
    }).ok,
    "trailing bytes outside the RIFF envelope should fail",
  );

  const tooLarge = new Uint8Array(GALLERY_THUMBNAIL_MAX_BYTES + 1);
  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(tooLarge),
      mime_type: "image/webp",
      size_bytes: tooLarge.length,
      width: 2,
      height: 2,
    }).ok,
    "oversized bytes should fail",
  );

  const incomplete = incompleteVp8x(320, 180);
  assert(
    !parseGalleryThumbnailPayload({
      base64: base64(incomplete),
      mime_type: "image/webp",
      size_bytes: incomplete.length,
      width: 320,
      height: 180,
    }).ok,
    "a WebP container without an image chunk should fail",
  );
});

Deno.test("derives immutable service-only publication paths", () => {
  const publicationId = "33333333-3333-4333-8333-333333333333";
  const revisionId = "44444444-4444-4444-8444-444444444444";
  assert(
    galleryPublicationDisplayStoragePath(publicationId) ===
      `_approved/publications/${publicationId}/display.webp`,
    "display path was not deterministic",
  );
  assert(
    galleryThumbnailStoragePath(publicationId, revisionId) ===
      `_approved/publications/${publicationId}/revisions/${revisionId}/thumbnail.webp`,
    "thumbnail path was not deterministic",
  );
});
