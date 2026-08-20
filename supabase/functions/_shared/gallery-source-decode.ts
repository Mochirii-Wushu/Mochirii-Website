import {
  GALLERY_SOURCE_IMAGE_MAX_BYTES,
  GALLERY_SOURCE_IMAGE_MAX_EDGE,
  GALLERY_SOURCE_IMAGE_MAX_PIXELS,
  GALLERY_SOURCE_WEBP_MAX_EDGE,
  type GallerySourceImageMimeType,
} from "./gallery-source-image.ts";
import {
  galleryWebpDecoderVersion,
  isDecodableGalleryWebp,
} from "./gallery-webp-decoder.ts";

export const GALLERY_SOURCE_IMAGE_DECODE_VERSION = "gallery-source-decode-v2";
export const GALLERY_SOURCE_WEBP_DECODER_VERSION = 0x010600;

export type GallerySourceImageDecodeError =
  | "source_image_decode_contract_invalid"
  | "source_image_decode_unavailable"
  | "source_image_decode_failed"
  | "source_image_decode_dimensions_mismatch"
  | "source_image_webp_decode_unsupported";

export type GallerySourceImageDecodeResult =
  | {
    ok: true;
    decode: {
      width: number;
      height: number;
      decoderVersion: typeof GALLERY_SOURCE_IMAGE_DECODE_VERSION;
    };
  }
  | { ok: false; error: GallerySourceImageDecodeError };

type DecodedGalleryImage = {
  readonly width: number;
  readonly height: number;
  close(): void;
};

export type GallerySourceBitmapDecoder = (
  source: Blob,
) => Promise<DecodedGalleryImage>;

function validExpectedDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width >= 1 && height >= 1 &&
    width <= GALLERY_SOURCE_IMAGE_MAX_EDGE &&
    height <= GALLERY_SOURCE_IMAGE_MAX_EDGE &&
    width <= Math.floor(GALLERY_SOURCE_IMAGE_MAX_PIXELS / height);
}

function runtimeBitmapDecoder(): GallerySourceBitmapDecoder | null {
  if (typeof globalThis.createImageBitmap !== "function") return null;
  return (source: Blob) => globalThis.createImageBitmap(source);
}

/**
 * Fully decodes structurally validated source bytes before storage.
 *
 * Deno 2.1 does not provide createImageBitmap WebP decoding. WebP therefore
 * stays on the existing immutable libwebp 1.6.0 boundary, whose reviewed
 * build proves sources through 720px. JPEG and PNG use feature-detected
 * createImageBitmap and fail closed when that runtime capability is absent.
 */
export async function decodeGallerySourceImage(
  bytes: Uint8Array,
  mimeType: GallerySourceImageMimeType,
  expectedWidth: number,
  expectedHeight: number,
  bitmapDecoder?: GallerySourceBitmapDecoder,
): Promise<GallerySourceImageDecodeResult> {
  if (
    !(bytes instanceof Uint8Array) || bytes.length < 1 ||
    bytes.length > GALLERY_SOURCE_IMAGE_MAX_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(mimeType) ||
    !validExpectedDimensions(expectedWidth, expectedHeight)
  ) {
    return { ok: false, error: "source_image_decode_contract_invalid" };
  }

  if (mimeType === "image/webp") {
    if (
      expectedWidth > GALLERY_SOURCE_WEBP_MAX_EDGE ||
      expectedHeight > GALLERY_SOURCE_WEBP_MAX_EDGE
    ) {
      return { ok: false, error: "source_image_webp_decode_unsupported" };
    }
    try {
      if (
        await galleryWebpDecoderVersion() !==
          GALLERY_SOURCE_WEBP_DECODER_VERSION
      ) {
        return { ok: false, error: "source_image_decode_unavailable" };
      }
      if (!await isDecodableGalleryWebp(bytes, expectedWidth, expectedHeight)) {
        return { ok: false, error: "source_image_decode_failed" };
      }
    } catch {
      return { ok: false, error: "source_image_decode_unavailable" };
    }
    return {
      ok: true,
      decode: {
        width: expectedWidth,
        height: expectedHeight,
        decoderVersion: GALLERY_SOURCE_IMAGE_DECODE_VERSION,
      },
    };
  }

  const selectedDecoder = bitmapDecoder ?? runtimeBitmapDecoder();
  if (!selectedDecoder) {
    return { ok: false, error: "source_image_decode_unavailable" };
  }

  let decoded: DecodedGalleryImage;
  try {
    decoded = await selectedDecoder(
      new Blob([Uint8Array.from(bytes)], { type: mimeType }),
    );
  } catch {
    return { ok: false, error: "source_image_decode_failed" };
  }

  try {
    const dimensionsMatch = decoded.width === expectedWidth &&
      decoded.height === expectedHeight;
    const jpegOrientationSwapped = mimeType === "image/jpeg" &&
      decoded.width === expectedHeight && decoded.height === expectedWidth;
    if (
      !validExpectedDimensions(decoded.width, decoded.height) ||
      (!dimensionsMatch && !jpegOrientationSwapped)
    ) {
      return { ok: false, error: "source_image_decode_dimensions_mismatch" };
    }

    return {
      ok: true,
      decode: {
        width: decoded.width,
        height: decoded.height,
        decoderVersion: GALLERY_SOURCE_IMAGE_DECODE_VERSION,
      },
    };
  } finally {
    try {
      decoded.close();
    } catch {
      // Decoded pixels are already unreachable. Keep runtime details out of
      // this untrusted-media boundary.
    }
  }
}
