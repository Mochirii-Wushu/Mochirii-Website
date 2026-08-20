import {
  decodeGallerySourceImage,
  GALLERY_SOURCE_WEBP_DECODER_VERSION,
  type GallerySourceBitmapDecoder,
} from "./gallery-source-decode.ts";
import { validateGallerySourceBytes } from "./gallery-source-image.ts";
import { galleryWebpDecoderVersion } from "./gallery-webp-decoder.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

const REAL_PNG = bytesFromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAARSURBVAiZY/zPsOo/AwMDAwARAQKqH5iVvgAAAABJRU5ErkJggg==",
);
const REAL_JPEG = bytesFromBase64(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgG" +
    "BgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMD" +
    "AwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ" +
    "EBAQEBAQEBAQEBAQEBD/wAARCAABAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAA" +
    "AAAAAAAABv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAA" +
    "AAAICf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AARwKOv/2Q==",
);
const WEBP_VARIANTS = [
  [
    "lossy",
    "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
  ],
  ["lossless", "UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAAAfQ/4j+ByKi/wEA"],
  ["lossless alpha", "UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAEAcQ0f8CBiKi/wEA"],
] as const;

Deno.test("fully decodes valid lossy, lossless, and alpha WebP with pinned libwebp", async () => {
  assert(
    await galleryWebpDecoderVersion() === GALLERY_SOURCE_WEBP_DECODER_VERSION,
    "expected the immutable libwebp 1.6.0 decoder",
  );
  for (const [label, encoded] of WEBP_VARIANTS) {
    const bytes = bytesFromBase64(encoded);
    const structural = await validateGallerySourceBytes(bytes, "image/webp");
    assert(structural.ok, `${label} WebP must pass structural validation`);
    const decoded = await decodeGallerySourceImage(
      bytes,
      structural.source.mimeType,
      structural.source.width,
      structural.source.height,
      () => {
        throw new Error("createImageBitmap must not decode WebP");
      },
    );
    assert(decoded.ok, `${label} WebP must pass full libwebp decode`);
  }
});

Deno.test("rejects structurally plausible corrupt WebP pixels", async () => {
  for (const [, encoded] of WEBP_VARIANTS.slice(0, 2)) {
    const bytes = bytesFromBase64(encoded);
    bytes[26] ^= 0xff;
    const structural = await validateGallerySourceBytes(bytes, "image/webp");
    assert(
      structural.ok,
      `corrupt fixture must reach the full decoder: ${
        JSON.stringify(structural)
      }`,
    );
    const decoded = await decodeGallerySourceImage(
      bytes,
      structural.source.mimeType,
      structural.source.width,
      structural.source.height,
    );
    assert(
      !decoded.ok && decoded.error === "source_image_decode_failed",
      "corrupt compressed WebP pixels must fail closed",
    );
  }
});

Deno.test("uses createImageBitmap only for JPEG and PNG and closes decoded pixels", async () => {
  for (
    const [mimeType, bytes] of [
      ["image/jpeg", REAL_JPEG],
      ["image/png", REAL_PNG],
    ] as const
  ) {
    const structural = await validateGallerySourceBytes(bytes, mimeType);
    assert(
      structural.ok,
      `${mimeType} fixture must pass structural validation: ${
        JSON.stringify(structural)
      }`,
    );
    let closeCount = 0;
    const decoder: GallerySourceBitmapDecoder = async (blob) => {
      assert(blob.type === mimeType, "decoder Blob must use canonical MIME");
      assert(
        blob.size === bytes.length,
        "decoder Blob must own every source byte",
      );
      return {
        width: structural.source.width,
        height: structural.source.height,
        close: () => {
          closeCount += 1;
        },
      };
    };
    const decoded = await decodeGallerySourceImage(
      bytes,
      mimeType,
      structural.source.width,
      structural.source.height,
      decoder,
    );
    assert(decoded.ok, `${mimeType} full decode must pass`);
    assert(closeCount === 1, "decoded pixels must be closed exactly once");
  }
});

Deno.test("fails closed for unavailable, corrupt, or dimension-mismatched bitmap decoders", async () => {
  const unavailable = await decodeGallerySourceImage(
    REAL_PNG,
    "image/png",
    2,
    1,
    undefined,
  );
  if (typeof globalThis.createImageBitmap !== "function") {
    assert(
      !unavailable.ok &&
        unavailable.error === "source_image_decode_unavailable",
      "missing runtime decoder must fail closed",
    );
  }

  const failed = await decodeGallerySourceImage(
    REAL_PNG,
    "image/png",
    2,
    1,
    () => Promise.reject(new Error("attacker-controlled decoder detail")),
  );
  assert(
    !failed.ok && failed.error === "source_image_decode_failed",
    "decoder exceptions must map to a fixed failure",
  );
  assert(
    !JSON.stringify(failed).includes("attacker-controlled"),
    "decoder details must not cross the boundary",
  );

  let closeCount = 0;
  const mismatched = await decodeGallerySourceImage(
    REAL_PNG,
    "image/png",
    2,
    1,
    () =>
      Promise.resolve({
        width: 3,
        height: 1,
        close: () => {
          closeCount += 1;
        },
      }),
  );
  assert(
    !mismatched.ok &&
      mismatched.error === "source_image_decode_dimensions_mismatch",
    "decoded dimensions must equal structural evidence",
  );
  assert(closeCount === 1, "rejected decoded pixels must still be closed");
});

Deno.test("reports WebP above the immutable 720px decode bound as unsupported", async () => {
  const result = await decodeGallerySourceImage(
    new Uint8Array([1]),
    "image/webp",
    721,
    1,
  );
  assert(
    !result.ok && result.error === "source_image_webp_decode_unsupported",
    "WebP beyond the reviewed libwebp bound must be unsupported, not corrupt",
  );
});
