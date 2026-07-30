import {
  GALLERY_SOURCE_IMAGE_MAX_BYTES,
  GALLERY_SOURCE_IMAGE_MAX_EDGE,
  GALLERY_SOURCE_IMAGE_MAX_PIXELS,
  type GallerySourceImageMimeType,
} from "./gallery-source-image.ts";

export const GALLERY_SOURCE_IMAGE_DECODE_VERSION = "gallery-source-decode-v1";

export type GallerySourceImageDecodeError =
  | "source_image_decode_contract_invalid"
  | "source_image_decode_unavailable"
  | "source_image_decode_failed"
  | "source_image_decode_dimensions_mismatch";

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

export type GallerySourceImageDecoder = (
  source: Blob,
) => Promise<DecodedGalleryImage>;

const SUPPORTED_SOURCE_MIME_TYPES = new Set<GallerySourceImageMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function validExpectedDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width >= 1 && height >= 1 &&
    width <= GALLERY_SOURCE_IMAGE_MAX_EDGE &&
    height <= GALLERY_SOURCE_IMAGE_MAX_EDGE &&
    width * height <= GALLERY_SOURCE_IMAGE_MAX_PIXELS;
}

function runtimeDecoder(): GallerySourceImageDecoder | null {
  if (typeof globalThis.createImageBitmap !== "function") return null;

  return (source: Blob) => globalThis.createImageBitmap(source);
}

/**
 * Fully decodes a structurally validated source into an ephemeral bitmap.
 *
 * This is deliberately separate from the durable `gallery-source-v1`
 * evidence contract. The bitmap is closed before this function resolves and
 * no decoded pixels, object URL, or decoder-specific metadata are persisted.
 */
export async function decodeGallerySourceImage(
  bytes: Uint8Array,
  mimeType: GallerySourceImageMimeType,
  expectedWidth: number,
  expectedHeight: number,
  decoder?: GallerySourceImageDecoder,
): Promise<GallerySourceImageDecodeResult> {
  if (
    !(bytes instanceof Uint8Array) || bytes.length < 1 ||
    bytes.length > GALLERY_SOURCE_IMAGE_MAX_BYTES ||
    !SUPPORTED_SOURCE_MIME_TYPES.has(mimeType) ||
    !validExpectedDimensions(expectedWidth, expectedHeight)
  ) {
    return { ok: false, error: "source_image_decode_contract_invalid" };
  }

  const selectedDecoder = decoder ?? runtimeDecoder();
  if (!selectedDecoder) {
    return { ok: false, error: "source_image_decode_unavailable" };
  }

  let decoded: DecodedGalleryImage;
  try {
    // Copy the source into a Blob-owned buffer before handing it to the native
    // decoder so caller mutation cannot race the decode boundary.
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
      return {
        ok: false,
        error: "source_image_decode_dimensions_mismatch",
      };
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
      // The decoded pixels are already unreachable after this boundary. A
      // runtime-specific close failure must not expose the submitted source.
    }
  }
}

const SUBMISSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function gallerySourcePreviewResponse(
  bytes: Uint8Array,
  metadata: {
    submissionId: string;
    mimeType: GallerySourceImageMimeType;
    width: number;
    height: number;
    validatedAt: string;
  },
): Response {
  if (
    !(bytes instanceof Uint8Array) || bytes.length < 1 ||
    bytes.length > GALLERY_SOURCE_IMAGE_MAX_BYTES ||
    !SUBMISSION_ID_PATTERN.test(metadata.submissionId) ||
    !SUPPORTED_SOURCE_MIME_TYPES.has(metadata.mimeType) ||
    !validExpectedDimensions(metadata.width, metadata.height) ||
    !Number.isFinite(Date.parse(metadata.validatedAt))
  ) {
    throw new Error("invalid_gallery_source_preview_response");
  }

  const body = Uint8Array.from(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": metadata.mimeType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
