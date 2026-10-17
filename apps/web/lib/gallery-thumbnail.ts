"use client";

import {
  GALLERY_INPUT_MAX_BYTES, GALLERY_THUMB_MAX_BYTES, GALLERY_THUMB_MAX_EDGE,
  validateGalleryDimensions, validateGalleryInputSize,
} from "../../../packages/gallery-media/policy.ts";

export const galleryThumbnailMimeType = "image/webp";
export const galleryThumbnailMaximumBytes = GALLERY_THUMB_MAX_BYTES;
export const galleryThumbnailMaximumEdge = GALLERY_THUMB_MAX_EDGE;

export async function inspectGalleryFileHeader(file: File) {
  validateGalleryInputSize(file.size, GALLERY_INPUT_MAX_BYTES);
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0, height = 0, mimeType = "";
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    if (view.getUint32(8) !== 13 || ascii(12, 4) !== "IHDR") throw new Error("The PNG header is invalid.");
    width = view.getUint32(16); height = view.getUint32(20); mimeType = "image/png";
    let offset = 8, chunks = 0, hasPixels = false;
    while (offset + 12 <= bytes.length && ++chunks <= 8192) {
      const size = view.getUint32(offset), tag = ascii(offset + 4, 4);
      if (tag === "IHDR" && offset !== 8) throw new Error("The PNG header is invalid.");
      if (tag === "acTL" || tag === "fcTL" || tag === "fdAT") throw new Error("Choose a still image; animations are not supported.");
      if (offset + size + 12 > file.size) throw new Error("The PNG is incomplete.");
      if (tag === "IDAT") { hasPixels = true; break; }
      offset += size + 12;
      if (offset > bytes.length) throw new Error("This image has too much header metadata to preview safely.");
    }
    if (chunks > 8192) throw new Error("This image has too much header metadata to preview safely.");
    if (!hasPixels) throw new Error("The PNG pixel header is missing.");
  } else if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== file.size) throw new Error("The WebP is incomplete.");
    const tag = ascii(12, 4);
    if (tag === "VP8X") {
      if (bytes[20] & 2) throw new Error("Choose a still image; animations are not supported.");
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (tag === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (tag === "VP8 " && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
    mimeType = "image/webp";
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = "image/jpeg";
    let offset = 2, segments = 0, hasPixels = false;
    while (offset + 4 <= bytes.length && ++segments <= 4096) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) { hasPixels = true; break; }
      if (marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (marker === 0xe2 && ascii(offset + 2, 4) === "MPF\0") throw new Error("Choose a single-frame image.");
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        if (width) throw new Error("Choose a single-frame image with one size header.");
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      offset += size;
    }
    if (!hasPixels) throw new Error("This image has too much or incomplete header metadata to preview safely.");
  }
  if (!mimeType || !width || !height) throw new Error("Choose a valid JPEG, PNG, or WebP image with a bounded header.");
  validateGalleryDimensions(width, height);
  return { mimeType, width, height };
}

type DrawableImage = ImageBitmap | HTMLImageElement;

const edgeSteps = [720, 640, 560, 480, 400, 320, 240, 180] as const;
const qualitySteps = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32] as const;

function canvasBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, galleryThumbnailMimeType, quality)
  );
}

function loadHtmlImage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    const detach = () => {
      image.onload = null; image.onerror = null;
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      detach(); image.src = ""; URL.revokeObjectURL(objectUrl);
      reject(new DOMException("Preview cancelled.", "AbortError"));
    };
    image.decoding = "async";
    image.onload = () => {
      detach();
      resolve({ image, revoke: () => URL.revokeObjectURL(objectUrl) });
    };
    image.onerror = () => {
      detach();
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The gallery image could not be decoded."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else image.src = objectUrl;
  });
}

async function decodeImage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<
  { image: DrawableImage; width: number; height: number; release: () => void }
> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      signal?.throwIfAborted();
      // Some otherwise supported images or engines can reject ImageBitmap decoding.
      // The ordinary image decoder remains the compatible, bounded fallback.
    }
  }

  signal?.throwIfAborted();
  const loaded = await loadHtmlImage(blob, signal);
  return {
    image: loaded.image,
    width: loaded.image.naturalWidth,
    height: loaded.image.naturalHeight,
    release: loaded.revoke,
  };
}

function boundedDimensions(width: number, height: number, maximumEdge: number) {
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function createGalleryPreview(file: File, signal?: AbortSignal): Promise<Blob> {
  const header = await inspectGalleryFileHeader(file);
  signal?.throwIfAborted();
  const sourceBlob = file.slice(0, file.size, header.mimeType);
  const deadline = AbortSignal.timeout(20_000);
  const decodeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const pending = decodeImage(sourceBlob, decodeSignal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    abandoned = true;
    rejectAbort(new DOMException("Preview cancelled.", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  pending.then((image) => { if (abandoned) image.release(); }).catch(() => {});
  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await Promise.race([
      pending,
      aborted,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { abandoned = true; reject(new Error("The image preview took too long.")); }, 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted) { decoded.release(); signal.throwIfAborted(); }
  try { validateGalleryDimensions(decoded.width, decoded.height); }
  catch (error) { decoded.release(); throw error; }
  if (decoded.width < 1 || decoded.height < 1) {
    decoded.release();
    throw new Error("The gallery image has invalid dimensions.");
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    decoded.release();
    throw new Error("This browser could not prepare the gallery image.");
  }

  try {
    for (const maximumEdge of edgeSteps) {
      signal?.throwIfAborted();
      const dimensions = boundedDimensions(
        decoded.width,
        decoded.height,
        maximumEdge,
      );
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(
        decoded.image,
        0,
        0,
        dimensions.width,
        dimensions.height,
      );

      for (const quality of qualitySteps) {
        signal?.throwIfAborted();
        const thumbnail = await canvasBlob(canvas, quality);
        if (!thumbnail || thumbnail.type !== galleryThumbnailMimeType) continue;
        if (
          thumbnail.size < 1 || thumbnail.size > galleryThumbnailMaximumBytes
        ) continue;

        return thumbnail;
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    decoded.release();
  }

  throw new Error(
    "This image could not be reduced to the gallery thumbnail limit.",
  );
}
