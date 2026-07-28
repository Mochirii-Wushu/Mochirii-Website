"use client";

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_GALLERY_SOURCE_EDGE,
  MAX_GALLERY_SOURCE_PIXELS,
  MAX_UPLOAD_BYTES,
} from "@/lib/supabase/config";

export const galleryThumbnailMimeType = "image/webp";
export const galleryThumbnailMaximumBytes = 80 * 1024;
export const galleryThumbnailMaximumEdge = 720;
export const galleryDisplayMaximumBytes = 2 * 1024 * 1024;
export const galleryDisplayMaximumEdge = 2560;
export const gallerySourceMaximumBytes = MAX_UPLOAD_BYTES;
export const gallerySourceMaximumEdge = MAX_GALLERY_SOURCE_EDGE;
export const gallerySourceMaximumPixels = MAX_GALLERY_SOURCE_PIXELS;

export type GalleryThumbnailPayload = {
  base64: string;
  mime_type: typeof galleryThumbnailMimeType;
  size_bytes: number;
  width: number;
  height: number;
};

export type GalleryDisplayPayload = GalleryThumbnailPayload;
export type GalleryPublicationMedia = {
  display: GalleryDisplayPayload;
  thumbnail: GalleryThumbnailPayload;
};
export type GalleryModerationMedia = {
  display: GalleryDisplayPayload | null;
  thumbnail: GalleryThumbnailPayload;
};

type DrawableImage = ImageBitmap | HTMLImageElement;

const thumbnailEdgeSteps = [720, 640, 560, 480, 400, 320, 240, 180] as const;
const thumbnailQualitySteps = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32] as const;
const displayEdgeSteps = [2560, 2304, 2048, 1920, 1600, 1440, 1280, 1024] as const;
const displayQualitySteps = [0.88, 0.82, 0.76, 0.7, 0.64, 0.58] as const;
const acceptedGallerySourceMimeTypes = new Set<string>(ACCEPTED_IMAGE_TYPES);

type GallerySourceExpectation = {
  mimeType: string;
  sizeBytes: number;
};

function normalizedMimeType(value: string | null | undefined) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function validatedGallerySourceExpectation(
  expectation: GallerySourceExpectation,
) {
  const mimeType = normalizedMimeType(expectation.mimeType);
  const sizeBytes = Number(expectation.sizeBytes);
  if (!acceptedGallerySourceMimeTypes.has(mimeType)) {
    throw new Error("The gallery image preview has an unsupported image type.");
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > gallerySourceMaximumBytes) {
    throw new Error("The gallery image preview has an invalid file size.");
  }
  return { mimeType, sizeBytes };
}

function validatedGallerySourceUrl(sourceUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("The gallery image preview address was invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error("The gallery image preview address was invalid.");
  }
  return parsed.toString();
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already closed or was canceled by the caller.
  }
}

export async function fetchBoundedGallerySource(
  sourceUrl: string,
  expectation: GallerySourceExpectation,
  signal?: AbortSignal,
): Promise<Blob> {
  const expected = validatedGallerySourceExpectation(expectation);
  const response = await fetch(validatedGallerySourceUrl(sourceUrl), {
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error("The gallery image preview could not be loaded.");
  }

  const responseMimeType = normalizedMimeType(response.headers.get("content-type"));
  if (
    responseMimeType !== expected.mimeType ||
    !acceptedGallerySourceMimeTypes.has(responseMimeType)
  ) {
    await cancelResponseBody(response);
    throw new Error("The gallery image preview type did not match its review record.");
  }

  const contentEncoding = String(response.headers.get("content-encoding") || "identity")
    .trim()
    .toLowerCase();
  if (contentEncoding !== "identity") {
    await cancelResponseBody(response);
    throw new Error("The gallery image preview response was not safely bounded.");
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength !== expected.sizeBytes ||
      contentLength < 1 ||
      contentLength > gallerySourceMaximumBytes
    ) {
      await cancelResponseBody(response);
      throw new Error("The gallery image preview size did not match its review record.");
    }
  }

  if (!response.body) {
    throw new Error("The gallery image preview response was empty.");
  }

  const reader = response.body.getReader();
  const sourceBytes = new Uint8Array(expected.sizeBytes);
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > gallerySourceMaximumBytes || totalBytes > expected.sizeBytes) {
        await reader.cancel("gallery_source_too_large");
        throw new Error("The gallery image preview exceeded its reviewed size.");
      }
      sourceBytes.set(value, totalBytes - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== expected.sizeBytes) {
    throw new Error("The gallery image preview size did not match its review record.");
  }
  return new Blob([sourceBytes.buffer], { type: responseMimeType });
}

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
): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () =>
      resolve({ image, revoke: () => URL.revokeObjectURL(objectUrl) });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The gallery image could not be decoded."));
    };
    image.src = objectUrl;
  });
}

async function decodeImage(
  blob: Blob,
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
      // Some otherwise supported images or engines can reject ImageBitmap decoding.
      // The ordinary image decoder remains the compatible, bounded fallback.
    }
  }

  const loaded = await loadHtmlImage(blob);
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

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }

  return btoa(binary);
}

async function encodeBoundedWebp(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  decoded: { image: DrawableImage; width: number; height: number },
  maximumBytes: number,
  edgeSteps: readonly number[],
  qualitySteps: readonly number[],
): Promise<GalleryThumbnailPayload | null> {
  const attemptedDimensions = new Set<string>();
  for (const maximumEdge of edgeSteps) {
    const dimensions = boundedDimensions(
      decoded.width,
      decoded.height,
      maximumEdge,
    );
    const dimensionKey = `${dimensions.width}x${dimensions.height}`;
    if (attemptedDimensions.has(dimensionKey)) continue;
    attemptedDimensions.add(dimensionKey);

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
      const image = await canvasBlob(canvas, quality);
      if (!image || image.type !== galleryThumbnailMimeType) continue;
      if (image.size < 1 || image.size > maximumBytes) continue;

      return {
        base64: await blobToBase64(image),
        mime_type: galleryThumbnailMimeType,
        size_bytes: image.size,
        width: dimensions.width,
        height: dimensions.height,
      };
    }
  }
  return null;
}

async function createGalleryMedia(
  sourceBlob: Blob,
  includeDisplay: boolean,
): Promise<{ display: GalleryDisplayPayload | null; thumbnail: GalleryThumbnailPayload }> {
  const sourceMimeType = normalizedMimeType(sourceBlob.type);
  if (!acceptedGallerySourceMimeTypes.has(sourceMimeType)) {
    throw new Error("The gallery image preview has an unsupported image type.");
  }
  if (sourceBlob.size < 1 || sourceBlob.size > gallerySourceMaximumBytes) {
    throw new Error("The gallery image preview has an invalid file size.");
  }

  const decoded = await decodeImage(sourceBlob);
  if (
    decoded.width < 1 || decoded.height < 1 ||
    decoded.width > gallerySourceMaximumEdge ||
    decoded.height > gallerySourceMaximumEdge ||
    decoded.width * decoded.height > gallerySourceMaximumPixels
  ) {
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
    const display = includeDisplay
      ? await encodeBoundedWebp(
        canvas,
        context,
        decoded,
        galleryDisplayMaximumBytes,
        displayEdgeSteps,
        displayQualitySteps,
      )
      : null;
    const thumbnail = await encodeBoundedWebp(
      canvas,
      context,
      decoded,
      galleryThumbnailMaximumBytes,
      thumbnailEdgeSteps,
      thumbnailQualitySteps,
    );
    if ((!includeDisplay || display) && thumbnail) return { display, thumbnail };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    decoded.release();
  }

  throw new Error(
    "This image could not be reduced to the Gallery publication limits.",
  );
}

export async function createGalleryPublicationMedia(
  sourceBlob: Blob,
): Promise<GalleryPublicationMedia> {
  const media = await createGalleryMedia(sourceBlob, true);
  if (!media.display) {
    throw new Error("The Gallery display image could not be prepared.");
  }
  return { display: media.display, thumbnail: media.thumbnail };
}

export async function createGalleryThumbnail(
  sourceBlob: Blob,
): Promise<GalleryThumbnailPayload> {
  return (await createGalleryMedia(sourceBlob, false)).thumbnail;
}
