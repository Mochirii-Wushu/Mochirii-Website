export const GALLERY_INPUT_MAX_BYTES = 100 * 1024 * 1024;
export const GALLERY_INPUT_MAX_PIXELS = 40_000_000;
export const GALLERY_INPUT_MAX_EDGE = 16_384;
export const GALLERY_FULL_MAX_BYTES = 3 * 1024 * 1024;
export const GALLERY_FULL_MAX_EDGE = 2560;
export const GALLERY_THUMB_MAX_BYTES = 80 * 1024;
export const GALLERY_THUMB_MAX_EDGE = 720;
export const GALLERY_PROCESSING_MAX_MS = 20_000;
export const GALLERY_PROCESSING_MAX_RSS = 768 * 1024 * 1024;
export const GALLERY_MEDIA_BODY_MAX_BYTES = 4_450_000;
export const GALLERY_MEDIA_VERSION = "gallery-media-v1";
export const GALLERY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GalleryImageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "GalleryImageError";
  }
}

export type GalleryInputMetadata = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

export function validateGalleryInputSize(size: number, maximum = GALLERY_INPUT_MAX_BYTES) {
  if (!Number.isSafeInteger(size) || size < 1 || size > maximum) {
    throw new GalleryImageError("image_size_rejected");
  }
}

export function validateGalleryDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || Math.max(width, height) > GALLERY_INPUT_MAX_EDGE
    || width * height > GALLERY_INPUT_MAX_PIXELS) {
    throw new GalleryImageError("image_dimensions_rejected");
  }
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

export function inspectGalleryInput(bytes: Uint8Array): GalleryInputMetadata {
  validateGalleryInputSize(bytes.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = (mimeType: GalleryInputMetadata["mimeType"], width: number, height: number) => {
    validateGalleryDimensions(width, height);
    return { mimeType, width, height };
  };
  const reject = (): never => { throw new GalleryImageError("image_content_rejected"); };
  if (bytes.length >= 33 && ascii(bytes, 1, 3) === "PNG"
    && bytes[0] === 0x89 && view.getUint32(4) === 0x0d0a1a0a) {
    if (view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return reject();
    const width = view.getUint32(16), height = view.getUint32(20);
    validateGalleryDimensions(width, height);
    let offset = 8, chunks = 0;
    while (offset + 12 <= bytes.length && ++chunks <= 8192) {
      const length = view.getUint32(offset), end = offset + 12 + length;
      if (end > bytes.length) return reject();
      const tag = ascii(bytes, offset + 4, 4);
      if (tag === "acTL" || tag === "fcTL" || tag === "fdAT") {
        throw new GalleryImageError("image_animation_rejected");
      }
      if (tag === "IEND") {
        if (length !== 0 || end !== bytes.length) return reject();
        return result("image/png", width, height);
      }
      offset = end;
    }
    return reject();
  }
  if (bytes.length >= 26 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) return reject();
    let width = 0, height = 0, offset = 12, frames = 0, chunks = 0;
    while (offset + 8 <= bytes.length && ++chunks <= 8192) {
      const tag = ascii(bytes, offset, 4), size = view.getUint32(offset + 4, true);
      const start = offset + 8, end = start + size + (size & 1);
      if (end > bytes.length) return reject();
      if (tag === "ANIM" || tag === "ANMF" || (tag === "VP8X" && (bytes[start] & 2))) {
        throw new GalleryImageError("image_animation_rejected");
      }
      if (tag === "VP8X") {
        if (size !== 10 || offset !== 12) return reject();
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (tag === "VP8L") {
        if (size < 5 || bytes[start] !== 0x2f) return reject();
        const bits = view.getUint32(start + 1, true);
        const w = 1 + (bits & 0x3fff), h = 1 + ((bits >>> 14) & 0x3fff);
        if (width && (width !== w || height !== h)) return reject();
        width = w; height = h; frames++;
      } else if (tag === "VP8 ") {
        if (size < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) return reject();
        const w = view.getUint16(start + 6, true) & 0x3fff, h = view.getUint16(start + 8, true) & 0x3fff;
        if (width && (width !== w || height !== h)) return reject();
        width = w; height = h; frames++;
      }
      offset = end;
    }
    if (offset !== bytes.length || frames !== 1) return reject();
    return result("image/webp", width, height);
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2, segments = 0, width = 0, height = 0;
    while (offset < bytes.length && ++segments <= 4096) {
      if (bytes[offset++] !== 0xff) return reject();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) return reject();
      const marker = bytes[offset++];
      if (marker === 0xda) return width ? result("image/jpeg", width, height) : reject();
      if (marker === 0xd9) return reject();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return reject();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return reject();
      if (marker === 0xe2 && length >= 6 && ascii(bytes, offset + 2, 4) === "MPF\0") {
        throw new GalleryImageError("image_animation_rejected");
      }
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || width) return reject();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
        validateGalleryDimensions(width, height);
      }
      offset += length;
    }
    return reject();
  }
  return reject();
}

export async function readBoundedGalleryBody(
  response: Pick<Response, "body" | "headers">,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new GalleryImageError("image_size_rejected");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel().catch(() => {});
    throw new GalleryImageError("image_size_rejected");
  }
  if (!response.body) throw new GalleryImageError("image_content_rejected");
  const reader = response.body.getReader();
  // A growable bounded buffer avoids one retained allocation per transport
  // fragment and copies each chunk before a producer can reuse its backing data.
  let bytes = new Uint8Array(0);
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      const nextLength = length + value.length;
      if (nextLength > maximum) throw new GalleryImageError("image_size_rejected");
      if (nextLength > bytes.length) {
        const grown = new Uint8Array(Math.min(maximum, Math.max(nextLength, bytes.length * 2, 65536)));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      bytes.set(value, length);
      length = nextLength;
    }
    if (length < 1) throw new GalleryImageError("image_content_rejected");
    return bytes.subarray(0, length);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
