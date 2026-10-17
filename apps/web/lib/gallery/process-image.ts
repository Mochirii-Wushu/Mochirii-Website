import sharp, { type Sharp } from "sharp";
import { createHash } from "node:crypto";
import {
  GALLERY_FULL_MAX_BYTES, GALLERY_FULL_MAX_EDGE, GALLERY_INPUT_MAX_PIXELS,
  GALLERY_PROCESSING_MAX_MS, GALLERY_PROCESSING_MAX_RSS,
  GALLERY_THUMB_MAX_BYTES, GALLERY_THUMB_MAX_EDGE, GalleryImageError,
  inspectGalleryInput,
} from "../../../../packages/gallery-media/policy.ts";

export type ProcessedGalleryImage = {
  base64: string;
  mime_type: "image/webp";
  size_bytes: number;
  width: number;
  height: number;
};

const options = { failOn: "warning", limitInputPixels: GALLERY_INPUT_MAX_PIXELS, limitInputChannels: 4, sequentialRead: true } as const;

export async function processGalleryImage(
  input: Uint8Array,
  { signal, fullMaximumBytes = GALLERY_FULL_MAX_BYTES, fullMaximumEdge = GALLERY_FULL_MAX_EDGE }:
  { signal?: AbortSignal; fullMaximumBytes?: number; fullMaximumEdge?: number } = {},
) {
  const source = inspectGalleryInput(input);
  if (!Number.isSafeInteger(fullMaximumBytes) || fullMaximumBytes < 1024 || fullMaximumBytes > GALLERY_FULL_MAX_BYTES
    || !Number.isSafeInteger(fullMaximumEdge) || fullMaximumEdge < 128 || fullMaximumEdge > GALLERY_FULL_MAX_EDGE) {
    throw new GalleryImageError("image_target_rejected");
  }
  const deadline = performance.now() + GALLERY_PROCESSING_MAX_MS;
  let memoryExceeded = false;
  let timeExceeded = false;
  const active = new Set<Sharp>();
  const cancel = () => { for (const operation of active) operation.destroy(); };
  const guard = () => {
    signal?.throwIfAborted();
    if (memoryExceeded || process.memoryUsage().rss > GALLERY_PROCESSING_MAX_RSS) {
      memoryExceeded = true;
      throw new GalleryImageError("image_memory_rejected");
    }
    if (timeExceeded || performance.now() >= deadline) throw new GalleryImageError("image_processing_timeout");
  };
  const timer = setInterval(() => {
    if (process.memoryUsage().rss > GALLERY_PROCESSING_MAX_RSS) { memoryExceeded = true; cancel(); }
    if (performance.now() >= deadline) { timeExceeded = true; cancel(); }
  }, 50);
  timer.unref();
  signal?.addEventListener("abort", cancel, { once: true });

  const encode = async (bytes: Uint8Array, maximumEdge: number, maximumBytes: number, steps: readonly (readonly [number, number])[]) => {
    for (const [edge, quality] of steps) {
      guard();
      const operation = sharp(bytes, options).autoOrient().toColourspace("srgb")
        .resize({ width: Math.min(edge, maximumEdge), height: Math.min(edge, maximumEdge), fit: "inside", withoutEnlargement: true })
        .webp({ quality, alphaQuality: 100, effort: 4 })
        .timeout({ seconds: Math.max(1, Math.min(10, Math.floor((deadline - performance.now()) / 1000))) });
      active.add(operation);
      let encoded;
      try { encoded = await operation.toBuffer({ resolveWithObject: true }); }
      finally { active.delete(operation); operation.destroy(); }
      guard();
      if (encoded.data.length > maximumBytes) continue;
      const inspected = inspectGalleryInput(encoded.data);
      if (inspected.mimeType !== "image/webp" || inspected.width !== encoded.info.width || inspected.height !== encoded.info.height) {
        throw new GalleryImageError("image_content_rejected");
      }
      return { bytes: encoded.data, width: encoded.info.width, height: encoded.info.height };
    }
    throw new GalleryImageError("image_target_rejected");
  };
  const payload = (image: { bytes: Buffer; width: number; height: number }): ProcessedGalleryImage => ({
    base64: image.bytes.toString("base64"), mime_type: "image/webp", size_bytes: image.bytes.length,
    width: image.width, height: image.height,
  });

  try {
    guard();
    const metadataOperation = sharp(input, options).timeout({ seconds: 3 });
    active.add(metadataOperation);
    let metadata;
    try { metadata = await metadataOperation.metadata(); }
    finally { active.delete(metadataOperation); metadataOperation.destroy(); }
    guard();
    const expectedFormat = source.mimeType === "image/jpeg" ? "jpeg" : source.mimeType.slice(6);
    if (metadata.format !== expectedFormat || metadata.width !== source.width || metadata.height !== source.height
      || (metadata.pages ?? 1) !== 1) throw new GalleryImageError("image_content_rejected");
    const full = await encode(input, fullMaximumEdge, fullMaximumBytes,
      [[2560, 82], [2560, 68], [2048, 76], [1600, 76], [1280, 68], [1024, 60]]);
    const thumbnail = await encode(full.bytes, GALLERY_THUMB_MAX_EDGE, GALLERY_THUMB_MAX_BYTES,
      [[720, 82], [720, 68], [640, 68], [560, 60], [480, 52], [320, 52]]);
    guard();
    return { full: payload(full), thumbnail: payload(thumbnail), sourceSha256: createHash("sha256").update(input).digest("hex"),
      sourceMimeType: source.mimeType, sourceWidth: source.width, sourceHeight: source.height };
  } catch (error) {
    if (signal?.aborted) throw new GalleryImageError("image_processing_cancelled");
    if (memoryExceeded) throw new GalleryImageError("image_memory_rejected");
    if (timeExceeded || performance.now() >= deadline) throw new GalleryImageError("image_processing_timeout");
    if (error instanceof GalleryImageError) throw error;
    throw new GalleryImageError("image_content_rejected");
  } finally {
    clearInterval(timer);
    signal?.removeEventListener("abort", cancel);
    cancel();
  }
}
