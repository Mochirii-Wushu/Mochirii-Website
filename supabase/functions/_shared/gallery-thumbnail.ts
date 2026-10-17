export const GALLERY_THUMBNAIL_MIME_TYPE = "image/webp";
export const GALLERY_THUMBNAIL_MAX_BYTES = 80 * 1024;
export const GALLERY_THUMBNAIL_MAX_EDGE = 720;

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

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function integer(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function decodeBase64(value: unknown, maximum = GALLERY_THUMBNAIL_MAX_BYTES): Uint8Array | null {
  const encoded = String(value ?? "").trim();
  const maximumEncodedLength = Math.ceil(maximum / 3) * 4;

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
    return bytes.length <= maximum ? bytes : null;
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
  let offset = 12;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const chunk = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkSize;
    if (dataEnd > bytes.length) return null;

    if (chunk === "ANIM" || chunk === "ANMF") return null;

    if (chunk === "VP8X") {
      if (
        canvasDimensions || imageDimensions || chunkSize !== 10 ||
        (bytes[dataOffset] & 0xc3) !== 0
      ) return null;
      canvasDimensions = {
        width: uint24le(bytes, dataOffset + 4) + 1,
        height: uint24le(bytes, dataOffset + 7) + 1,
      };
    } else if (chunk === "VP8L") {
      if (imageDimensions || chunkSize < 5 || bytes[dataOffset] !== 0x2f) {
        return null;
      }
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
    canvasDimensions &&
    (canvasDimensions.width !== imageDimensions.width ||
      canvasDimensions.height !== imageDimensions.height)
  ) return null;

  return canvasDimensions || imageDimensions;
}

export function parseGalleryThumbnailPayload(
  value: unknown,
): GalleryThumbnailParseResult {
  const payload = asRecord(value);
  const mimeType = String(payload.mime_type ?? "").trim().toLowerCase();
  const claimedSize = integer(payload.size_bytes);
  const claimedWidth = integer(payload.width);
  const claimedHeight = integer(payload.height);
  const bytes = decodeBase64(payload.base64);

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
    Math.max(dimensions.width, dimensions.height) > GALLERY_THUMBNAIL_MAX_EDGE
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

export function galleryThumbnailStoragePath(
  submissionId: string,
  revisionId: string,
): string {
  return `_approved/thumbs/${submissionId}/${revisionId}.webp`;
}

// Full derivatives are additionally authenticated as output of the trusted Node
// decoder. Edge retains its complete bounded libwebp decode for every thumbnail.
export function parseGalleryFullPayload(value: unknown): GalleryThumbnailParseResult {
  const payload = asRecord(value);
  const bytes = decodeBase64(payload.base64, 3 * 1024 * 1024);
  if (payload.mime_type !== "image/webp" || !bytes || payload.size_bytes !== bytes.length) {
    return { ok: false, error: "full_bytes_invalid" };
  }
  const dimensions = webpDimensions(bytes);
  if (!dimensions || payload.width !== dimensions.width || payload.height !== dimensions.height
    || dimensions.width < 1 || dimensions.height < 1 || Math.max(dimensions.width, dimensions.height) > 2560) {
    return { ok: false, error: "full_dimensions_invalid" };
  }
  let offset = 12;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.length) {
    const tag = ascii(bytes, offset, 4);
    // Sharp's published output contains no EXIF, ICC, XMP, animation, or unknown chunks.
    if (!["VP8X", "ALPH", "VP8 ", "VP8L"].includes(tag)) return { ok: false, error: "full_metadata_rejected" };
    const size = view.getUint32(offset + 4, true);
    if (tag === "VP8X" && (bytes[offset + 8] & ~0x10)) return { ok: false, error: "full_metadata_rejected" };
    offset += 8 + size + (size & 1);
  }
  return { ok: true, thumbnail: { bytes, ...dimensions, mimeType: "image/webp", sizeBytes: bytes.length } };
}
