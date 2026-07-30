import { validateGallerySourceBytes } from "./gallery-source-image.ts";

export const GALLERY_THUMBNAIL_MIME_TYPE = "image/webp";
export const GALLERY_THUMBNAIL_MAX_BYTES = 80 * 1024;
export const GALLERY_THUMBNAIL_MAX_EDGE = 720;
export const GALLERY_DISPLAY_MAX_BYTES = 2 * 1024 * 1024;
export const GALLERY_DISPLAY_MAX_EDGE = 2560;
export const GALLERY_SOCIAL_MIME_TYPE = "image/jpeg";
export const GALLERY_SOCIAL_MAX_BYTES = 8 * 1024 * 1024;
export const GALLERY_SOCIAL_MIN_WIDTH = 320;
export const GALLERY_SOCIAL_MAX_WIDTH = 1440;
export const GALLERY_SOCIAL_MAX_HEIGHT = 1800;
export const GALLERY_SOCIAL_SANITIZER_VERSION = "gallery-social-jpeg-v1";
export const GALLERY_SOCIAL_METADATA_POLICY = "jfif-only-no-app-metadata-v1";

const STATIC_WEBP_CHUNKS = new Set(["VP8X", "ALPH", "VP8 ", "VP8L"]);
const VP8X_ALPHA_FLAG = 0x10;

type JsonRecord = Record<string, unknown>;

export type GalleryThumbnail = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: typeof GALLERY_THUMBNAIL_MIME_TYPE;
  sizeBytes: number;
};

export type GalleryThumbnailParseResult =
  | { ok: true; thumbnail: GalleryThumbnail }
  | { ok: false; error: string };

export type GalleryDisplayImage = GalleryThumbnail;
export type GalleryDisplayParseResult =
  | { ok: true; display: GalleryDisplayImage }
  | { ok: false; error: string };

export type GallerySocialDerivative = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: typeof GALLERY_SOCIAL_MIME_TYPE;
  sizeBytes: number;
  sanitizerVersion: typeof GALLERY_SOCIAL_SANITIZER_VERSION;
  metadataPolicy: typeof GALLERY_SOCIAL_METADATA_POLICY;
};

export type GallerySocialParseResult =
  | { ok: true; social: GallerySocialDerivative }
  | { ok: false; error: string };

export type GallerySocialDerivationResult =
  | { ok: true; social: GallerySocialDerivative }
  | { ok: false; error: string };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function integer(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function decodeBase64(value: unknown, maximumBytes: number): Uint8Array | null {
  const encoded = String(value ?? "").trim();
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4;

  if (
    !encoded || encoded.length > maximumEncodedLength ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    return null;
  }

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    return bytes.length <= maximumBytes ? bytes : null;
  } catch {
    return null;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function isStrictMinimalJfifSegment(
  bytes: Uint8Array,
  markerStart: number,
  segmentLength: number,
): boolean {
  const dataOffset = markerStart + 4;
  return markerStart === 2 && segmentLength === 16 &&
    ascii(bytes, dataOffset, 5) === "JFIF\0" &&
    bytes[dataOffset + 5] === 1 && bytes[dataOffset + 6] <= 2 &&
    bytes[dataOffset + 7] <= 2 &&
    uint16be(bytes, dataOffset + 8) > 0 &&
    uint16be(bytes, dataOffset + 10) > 0 &&
    bytes[dataOffset + 12] === 0 && bytes[dataOffset + 13] === 0;
}

function jpegHasOnlyMinimalJfifMetadata(bytes: Uint8Array): boolean {
  if (
    bytes.length < 14 || bytes[0] !== 0xff || bytes[1] !== 0xd8
  ) return false;

  let offset = 2;
  let sawJfif = false;

  while (offset < bytes.length) {
    const markerStart = offset;
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return offset === bytes.length;
    if (
      marker === 0x00 || marker === 0x01 || marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) return false;
    if (offset + 2 > bytes.length) return false;

    const segmentLength = uint16be(bytes, offset);
    const dataOffset = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) return false;

    if (marker === 0xe0) {
      if (
        sawJfif ||
        !isStrictMinimalJfifSegment(bytes, markerStart, segmentLength)
      ) return false;
      sawJfif = true;
    } else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      // EXIF/XMP, ICC, vendor APP segments, and comments are all rejected.
      return false;
    }

    offset = segmentEnd;
    if (marker !== 0xda) continue;

    let foundMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      let codeOffset = offset + 1;
      while (codeOffset < bytes.length && bytes[codeOffset] === 0xff) {
        codeOffset += 1;
      }
      if (codeOffset >= bytes.length) return false;

      const scanMarker = bytes[codeOffset];
      if (
        scanMarker === 0x00 ||
        (scanMarker >= 0xd0 && scanMarker <= 0xd7)
      ) {
        offset = codeOffset + 1;
        continue;
      }

      foundMarker = true;
      break;
    }
    if (!foundMarker) return false;
  }

  return false;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function stripJpegApplicationMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 14 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const parts = [bytes.slice(0, 2)];
  let offset = 2;
  let sawJfif = false;
  while (offset < bytes.length) {
    const markerStart = offset;
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9) {
      if (offset !== bytes.length) return null;
      parts.push(bytes.slice(markerStart, offset));
      return concatBytes(parts);
    }
    if (
      marker === 0x00 || marker === 0x01 || marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length
    ) return null;

    const segmentLength = uint16be(bytes, offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) return null;
    if (marker === 0xe0) {
      if (
        sawJfif ||
        !isStrictMinimalJfifSegment(bytes, markerStart, segmentLength)
      ) return null;
      sawJfif = true;
      parts.push(bytes.slice(markerStart, segmentEnd));
    } else if (marker >= 0xe1 && marker <= 0xef) {
      // APP1-APP15 can affect presentation (EXIF, ICC, SPIFF, JUMBF/HDR,
      // Photoshop, Adobe transforms, or vendor semantics), so fail closed.
      return null;
    } else if (marker !== 0xfe) {
      parts.push(bytes.slice(markerStart, segmentEnd));
    }
    offset = segmentEnd;
    if (marker !== 0xda) continue;

    const entropyStart = offset;
    let foundMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      let codeOffset = offset + 1;
      while (codeOffset < bytes.length && bytes[codeOffset] === 0xff) {
        codeOffset += 1;
      }
      if (codeOffset >= bytes.length) return null;
      const scanMarker = bytes[codeOffset];
      if (
        scanMarker === 0x00 ||
        (scanMarker >= 0xd0 && scanMarker <= 0xd7)
      ) {
        offset = codeOffset + 1;
        continue;
      }
      foundMarker = true;
      break;
    }
    if (!foundMarker) return null;
    parts.push(bytes.slice(entropyStart, offset));
  }
  return null;
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredRiffSize = view.getUint32(4, true) + 8;
  if (declaredRiffSize !== bytes.length || declaredRiffSize < 20) return null;

  let canvasDimensions: { width: number; height: number } | null = null;
  let imageDimensions: { width: number; height: number } | null = null;
  let vp8xFlags: number | null = null;
  let alphaChunkPresent = false;
  let imageChunk: "VP8 " | "VP8L" | null = null;
  let offset = 12;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const chunk = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkSize;
    if (dataEnd > bytes.length) return null;

    if (!STATIC_WEBP_CHUNKS.has(chunk) || imageDimensions) return null;

    if (chunk === "VP8X") {
      if (
        offset !== 12 || canvasDimensions || chunkSize !== 10 ||
        (bytes[dataOffset] & ~VP8X_ALPHA_FLAG) !== 0
      ) return null;
      vp8xFlags = bytes[dataOffset];
      canvasDimensions = {
        width: uint24le(bytes, dataOffset + 4) + 1,
        height: uint24le(bytes, dataOffset + 7) + 1,
      };
    } else if (chunk === "ALPH") {
      if (
        !canvasDimensions || alphaChunkPresent || chunkSize < 1 ||
        vp8xFlags === null || (vp8xFlags & VP8X_ALPHA_FLAG) === 0
      ) return null;
      alphaChunkPresent = true;
    } else if (chunk === "VP8L") {
      if (alphaChunkPresent || chunkSize < 5 || bytes[dataOffset] !== 0x2f) {
        return null;
      }
      imageChunk = chunk;
      imageDimensions = {
        width: 1 + bytes[dataOffset + 1] +
          ((bytes[dataOffset + 2] & 0x3f) << 8),
        height: 1 + (bytes[dataOffset + 2] >> 6) +
          (bytes[dataOffset + 3] << 2) +
          ((bytes[dataOffset + 4] & 0x0f) << 10),
      };
    } else if (chunk === "VP8 ") {
      if (
        imageDimensions || chunkSize < 10 || bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a
      ) return null;
      imageChunk = chunk;
      imageDimensions = {
        width: (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) &
          0x3fff,
        height: (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) &
          0x3fff,
      };
    }

    offset = dataEnd + (chunkSize % 2);
  }

  if (offset !== bytes.length || !imageDimensions) return null;
  if (
    vp8xFlags !== null && (vp8xFlags & VP8X_ALPHA_FLAG) !== 0 &&
    imageChunk === "VP8 " && !alphaChunkPresent
  ) return null;
  if (
    canvasDimensions &&
    (canvasDimensions.width !== imageDimensions.width ||
      canvasDimensions.height !== imageDimensions.height)
  ) return null;

  return canvasDimensions || imageDimensions;
}

function parseGalleryWebpPayload(
  value: unknown,
  maximumBytes: number,
  maximumEdge: number,
): GalleryThumbnailParseResult {
  const payload = asRecord(value);
  const mimeType = String(payload.mime_type ?? "").trim().toLowerCase();
  const claimedSize = integer(payload.size_bytes);
  const claimedWidth = integer(payload.width);
  const claimedHeight = integer(payload.height);
  const bytes = decodeBase64(payload.base64, maximumBytes);

  if (mimeType !== GALLERY_THUMBNAIL_MIME_TYPE) {
    return { ok: false, error: "thumbnail_mime_type_invalid" };
  }

  if (!bytes || bytes.length < 30 || claimedSize !== bytes.length) {
    return { ok: false, error: "thumbnail_bytes_invalid" };
  }

  const dimensions = webpDimensions(bytes);
  if (
    !dimensions || claimedWidth !== dimensions.width ||
    claimedHeight !== dimensions.height
  ) {
    return { ok: false, error: "thumbnail_dimensions_invalid" };
  }

  if (
    dimensions.width < 1 || dimensions.height < 1 ||
    Math.max(dimensions.width, dimensions.height) > maximumEdge
  ) {
    return { ok: false, error: "thumbnail_dimensions_out_of_bounds" };
  }

  return {
    ok: true,
    thumbnail: {
      bytes,
      width: dimensions.width,
      height: dimensions.height,
      mimeType: GALLERY_THUMBNAIL_MIME_TYPE,
      sizeBytes: bytes.length,
    },
  };
}

export function parseGalleryThumbnailPayload(
  value: unknown,
): GalleryThumbnailParseResult {
  return parseGalleryWebpPayload(
    value,
    GALLERY_THUMBNAIL_MAX_BYTES,
    GALLERY_THUMBNAIL_MAX_EDGE,
  );
}

export function parseGalleryDisplayPayload(
  value: unknown,
): GalleryDisplayParseResult {
  const parsed = parseGalleryWebpPayload(
    value,
    GALLERY_DISPLAY_MAX_BYTES,
    GALLERY_DISPLAY_MAX_EDGE,
  );
  return parsed.ok ? { ok: true, display: parsed.thumbnail } : parsed;
}

export async function parseGallerySocialPayload(
  value: unknown,
): Promise<GallerySocialParseResult> {
  const payload = asRecord(value);
  const mimeType = String(payload.mime_type ?? "").trim().toLowerCase();
  const claimedSize = integer(payload.size_bytes);
  const claimedWidth = integer(payload.width);
  const claimedHeight = integer(payload.height);
  const bytes = decodeBase64(payload.base64, GALLERY_SOCIAL_MAX_BYTES);

  if (mimeType !== GALLERY_SOCIAL_MIME_TYPE) {
    return { ok: false, error: "social_derivative_mime_type_invalid" };
  }
  if (!bytes || bytes.length < 14 || claimedSize !== bytes.length) {
    return { ok: false, error: "social_derivative_bytes_invalid" };
  }
  if (!jpegHasOnlyMinimalJfifMetadata(bytes)) {
    return { ok: false, error: "social_derivative_metadata_invalid" };
  }

  const validated = await validateGallerySourceBytes(
    bytes,
    GALLERY_SOCIAL_MIME_TYPE,
  );
  if (!validated.ok) {
    return { ok: false, error: "social_derivative_decode_invalid" };
  }
  if (
    claimedWidth !== validated.source.width ||
    claimedHeight !== validated.source.height
  ) {
    return { ok: false, error: "social_derivative_dimensions_invalid" };
  }
  if (
    validated.source.width < GALLERY_SOCIAL_MIN_WIDTH ||
    validated.source.width > GALLERY_SOCIAL_MAX_WIDTH ||
    validated.source.height < 1 ||
    validated.source.height > GALLERY_SOCIAL_MAX_HEIGHT ||
    validated.source.width * 5 < validated.source.height * 4 ||
    validated.source.width * 100 > validated.source.height * 191
  ) {
    return {
      ok: false,
      error: "social_derivative_dimensions_out_of_bounds",
    };
  }

  return {
    ok: true,
    social: {
      bytes,
      width: validated.source.width,
      height: validated.source.height,
      mimeType: GALLERY_SOCIAL_MIME_TYPE,
      sizeBytes: bytes.length,
      sanitizerVersion: GALLERY_SOCIAL_SANITIZER_VERSION,
      metadataPolicy: GALLERY_SOCIAL_METADATA_POLICY,
    },
  };
}

export async function deriveGallerySocialJpegFromSource(
  sourceBytes: Uint8Array,
  sourceMimeType: unknown,
): Promise<GallerySocialDerivationResult> {
  if (String(sourceMimeType ?? "").trim().toLowerCase() !== "image/jpeg") {
    return { ok: false, error: "social_source_format_ineligible" };
  }

  const validated = await validateGallerySourceBytes(sourceBytes, "image/jpeg");
  if (!validated.ok) {
    return { ok: false, error: "social_source_decode_invalid" };
  }
  if (
    validated.source.width < GALLERY_SOCIAL_MIN_WIDTH ||
    validated.source.width > GALLERY_SOCIAL_MAX_WIDTH ||
    validated.source.height < 1 ||
    validated.source.height > GALLERY_SOCIAL_MAX_HEIGHT ||
    validated.source.width * 5 < validated.source.height * 4 ||
    validated.source.width * 100 > validated.source.height * 191
  ) {
    return { ok: false, error: "social_source_dimensions_ineligible" };
  }

  const stripped = stripJpegApplicationMetadata(sourceBytes);
  if (
    !stripped || stripped.length < 14 ||
    stripped.length > GALLERY_SOCIAL_MAX_BYTES ||
    !jpegHasOnlyMinimalJfifMetadata(stripped)
  ) {
    return { ok: false, error: "social_source_sanitization_failed" };
  }

  return {
    ok: true,
    social: {
      bytes: stripped,
      width: validated.source.width,
      height: validated.source.height,
      mimeType: GALLERY_SOCIAL_MIME_TYPE,
      sizeBytes: stripped.length,
      sanitizerVersion: GALLERY_SOCIAL_SANITIZER_VERSION,
      metadataPolicy: GALLERY_SOCIAL_METADATA_POLICY,
    },
  };
}

export function galleryPublicationDisplayStoragePath(
  publicationId: string,
): string {
  return `_approved/publications/${publicationId}/display.webp`;
}

export function galleryThumbnailStoragePath(
  publicationId: string,
  revisionId: string,
): string {
  return `_approved/publications/${publicationId}/revisions/${revisionId}/thumbnail.webp`;
}
