import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  GALLERY_MODERATOR_PREVIEW_MAX_BYTES,
  GALLERY_MODERATOR_PREVIEW_MAX_EDGE,
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
  GALLERY_MODERATOR_PREVIEW_VERSION,
  GALLERY_SANITIZER_ATTESTATION_HEADER,
  GALLERY_SOURCE_DECODE_VERSION,
} from "./moderation-preview-contract.ts";

export {
  GALLERY_MODERATOR_PREVIEW_MAX_BYTES,
  GALLERY_MODERATOR_PREVIEW_MAX_EDGE,
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
  GALLERY_MODERATOR_PREVIEW_VERSION,
  GALLERY_SOURCE_DECODE_VERSION,
};
export const GALLERY_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const GALLERY_SOURCE_MAX_EDGE = 4096;
export const GALLERY_SOURCE_MAX_PIXELS = 12_600_000;

const SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GENERATED_WEBP_IMAGE_CHUNKS = new Set(["VP8X", "ALPH", "VP8 ", "VP8L"]);
const GENERATED_WEBP_METADATA_CHUNKS = new Set(["ICCP", "EXIF", "XMP "]);
const EDGE_STEPS = [2560, 2304, 2048, 1920, 1600, 1440, 1280, 1024] as const;
const QUALITY_STEPS = [88, 82, 76, 70, 64, 58] as const;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GalleryModerationPreview = {
  bytes: Uint8Array;
  submissionId: string;
  sourceWidth: number;
  sourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  sourceValidatedAt: string;
  sourceDecodeVersion: typeof GALLERY_SOURCE_DECODE_VERSION;
  previewVersion: typeof GALLERY_MODERATOR_PREVIEW_VERSION;
};

export class GalleryModerationPreviewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("The private Gallery preview could not be prepared.");
    this.name = "GalleryModerationPreviewError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new GalleryModerationPreviewError(code);
}

function normalizedMimeType(value: string | null | undefined) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function positiveBoundedInteger(value: string | null, maximum: number, code: string) {
  const parsed = Number(value || 0);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) fail(code);
  return parsed;
}

function exactHeader(response: Response, name: string, code: string) {
  const value = String(response.headers.get(name) || "").trim();
  if (!value) fail(code);
  return value;
}

function validatedEndpoint(supabaseUrl: string, supabaseProjectRef: string) {
  let configured: URL;
  try {
    configured = new URL(String(supabaseUrl || ""));
  } catch {
    fail("preview_upstream_unconfigured");
  }
  const projectRef = String(supabaseProjectRef || "").trim().toLowerCase();
  const exactRoot = configured.pathname === "/" && !configured.search &&
    !configured.hash && !configured.username && !configured.password;
  const hostedHttps = configured.protocol === "https:" &&
    configured.hostname === `${projectRef}.supabase.co` && !configured.port;
  const localHttp = configured.protocol === "http:" &&
    (configured.hostname === "localhost" || configured.hostname === "127.0.0.1");
  if (!/^[a-z0-9]{20}$/.test(projectRef) || !exactRoot || (!hostedHttps && !localHttp)) {
    fail("preview_upstream_unconfigured");
  }
  return new URL(
    "/functions/v1/list-gallery-review-queue",
    configured.origin,
  );
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The upstream body may already be closed.
  }
}

function failIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) fail("preview_request_aborted");
}

async function readExactBoundedBody(
  response: Response,
  expectedBytes: number,
  signal?: AbortSignal,
) {
  failIfAborted(signal);
  if (!response.body) fail("preview_source_empty");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedBytes);
  let received = 0;
  try {
    while (true) {
      failIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value?.byteLength) continue;
      received += chunk.value.byteLength;
      if (received > expectedBytes || received > GALLERY_SOURCE_MAX_BYTES) {
        await reader.cancel("gallery_preview_source_too_large");
        fail("preview_source_too_large");
      }
      bytes.set(chunk.value, received - chunk.value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedBytes) fail("preview_source_size_mismatch");
  return bytes;
}

function boundedDimensions(width: number, height: number, maximumEdge: number) {
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function stripGeneratedWebpMetadata(bytes: Uint8Array) {
  if (
    bytes.byteLength < 20 || ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 !==
      bytes.byteLength
  ) {
    fail("preview_output_invalid");
  }

  const chunks: Uint8Array[] = [];
  let offset = 12;
  let hasImage = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail("preview_output_invalid");
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 4,
      4,
    ).getUint32(0, true);
    const dataEnd = offset + 8 + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (dataEnd < offset + 8 || paddedEnd > bytes.byteLength) {
      fail("preview_output_invalid");
    }
    if (GENERATED_WEBP_METADATA_CHUNKS.has(chunkType)) {
      offset = paddedEnd;
      continue;
    }
    if (!GENERATED_WEBP_IMAGE_CHUNKS.has(chunkType)) {
      fail("preview_output_invalid");
    }
    const chunk = Uint8Array.from(bytes.subarray(offset, paddedEnd));
    if (chunkType === "VP8X") {
      if (chunkSize !== 10 || (chunk[8] & 0x02) !== 0) {
        fail("preview_output_invalid");
      }
      chunk[8] &= ~(0x20 | 0x08 | 0x04);
    }
    if (chunkType === "VP8 " || chunkType === "VP8L") hasImage = true;
    chunks.push(chunk);
    offset = paddedEnd;
  }
  if (!hasImage || offset !== bytes.byteLength) fail("preview_output_invalid");

  const outputLength = 12 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(outputLength);
  output.set(bytes.subarray(0, 12));
  let outputOffset = 12;
  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  return output;
}

async function encodeBoundedPreview(
  sourceBytes: Uint8Array,
  source: {
    mimeType: string;
    width: number;
    height: number;
  },
  signal?: AbortSignal,
) {
  failIfAborted(signal);
  let decoded;
  try {
    decoded = await loadImage(Buffer.from(
      sourceBytes.buffer,
      sourceBytes.byteOffset,
      sourceBytes.byteLength,
    ));
  } catch {
    fail("preview_source_decode_failed");
  }
  failIfAborted(signal);

  const decodedWidth = Number(decoded.width || 0);
  const decodedHeight = Number(decoded.height || 0);
  const orientationSwap = source.mimeType === "image/jpeg" &&
    decodedWidth === source.height && decodedHeight === source.width;
  if (
    (!orientationSwap && (decodedWidth !== source.width || decodedHeight !== source.height)) ||
    decodedWidth < 1 || decodedHeight < 1 ||
    decodedWidth > GALLERY_SOURCE_MAX_EDGE || decodedHeight > GALLERY_SOURCE_MAX_EDGE ||
    decodedWidth * decodedHeight > GALLERY_SOURCE_MAX_PIXELS
  ) {
    fail("preview_source_dimensions_mismatch");
  }

  const canvas = createCanvas(1, 1);
  const context = canvas.getContext("2d", { alpha: true });
  const attempted = new Set<string>();
  try {
    for (const maximumEdge of EDGE_STEPS) {
      failIfAborted(signal);
      const dimensions = boundedDimensions(decodedWidth, decodedHeight, maximumEdge);
      const key = `${dimensions.width}x${dimensions.height}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(decoded, 0, 0, dimensions.width, dimensions.height);

      for (const quality of QUALITY_STEPS) {
        failIfAborted(signal);
        const encoded = stripGeneratedWebpMetadata(
          await canvas.encode("webp", quality),
        );
        failIfAborted(signal);
        if (encoded.byteLength < 1 || encoded.byteLength > GALLERY_MODERATOR_PREVIEW_MAX_BYTES) {
          continue;
        }
        let verification;
        try {
          verification = await loadImage(encoded);
        } catch {
          continue;
        }
        if (verification.width !== dimensions.width || verification.height !== dimensions.height) {
          continue;
        }
        return {
          bytes: new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength),
          width: dimensions.width,
          height: dimensions.height,
        };
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  fail("preview_output_unavailable");
}

export async function prepareGalleryModerationPreview({
  accessToken,
  expectedUpdatedAt,
  publishableKey,
  sanitizerAttestation,
  submissionId,
  supabaseProjectRef,
  supabaseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
  signal,
}: {
  accessToken: string;
  expectedUpdatedAt: string;
  publishableKey: string;
  sanitizerAttestation: string;
  submissionId: string;
  supabaseProjectRef: string;
  supabaseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GalleryModerationPreview> {
  if (
    !accessToken || !publishableKey || !sanitizerAttestation ||
    sanitizerAttestation.length > 8 * 1024
  ) fail("preview_upstream_unconfigured");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    fail("preview_upstream_unconfigured");
  }
  failIfAborted(signal);
  const endpoint = validatedEndpoint(supabaseUrl, supabaseProjectRef);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("timed out", "TimeoutError")),
    timeoutMs,
  );
  const operationSignal = controller.signal;
  try {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/octet-stream",
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          [GALLERY_SANITIZER_ATTESTATION_HEADER]: sanitizerAttestation,
        },
        body: JSON.stringify({
          action: "prepare_preview",
          submission_id: submissionId,
          expected_updated_at: expectedUpdatedAt,
        }),
        signal: operationSignal,
      });
    } catch {
      fail("preview_upstream_unavailable");
    }

    failIfAborted(operationSignal);
    if (!response.ok) {
      await cancelResponseBody(response);
      fail("preview_upstream_denied");
    }
    let mimeType: string;
    let sizeBytes: number;
    let sourceWidth: number;
    let sourceHeight: number;
    let sourceValidatedAt: string;
    try {
      const contentEncoding = String(response.headers.get("content-encoding") || "identity")
        .trim().toLowerCase();
      if (contentEncoding !== "identity") fail("preview_source_encoding_invalid");
      mimeType = normalizedMimeType(response.headers.get("content-type"));
      if (!SOURCE_TYPES.has(mimeType)) fail("preview_source_type_invalid");
      sizeBytes = positiveBoundedInteger(
        response.headers.get("content-length"),
        GALLERY_SOURCE_MAX_BYTES,
        "preview_source_size_invalid",
      );
      const responseSubmissionId = exactHeader(
        response,
        "x-gallery-submission-id",
        "preview_source_identity_invalid",
      );
      if (responseSubmissionId !== submissionId) fail("preview_source_identity_invalid");
      sourceWidth = positiveBoundedInteger(
        response.headers.get("x-gallery-source-width"),
        GALLERY_SOURCE_MAX_EDGE,
        "preview_source_dimensions_invalid",
      );
      sourceHeight = positiveBoundedInteger(
        response.headers.get("x-gallery-source-height"),
        GALLERY_SOURCE_MAX_EDGE,
        "preview_source_dimensions_invalid",
      );
      if (sourceWidth * sourceHeight > GALLERY_SOURCE_MAX_PIXELS) {
        fail("preview_source_dimensions_invalid");
      }
      sourceValidatedAt = exactHeader(
        response,
        "x-gallery-source-validated-at",
        "preview_source_timestamp_invalid",
      );
      if (!Number.isFinite(Date.parse(sourceValidatedAt))) fail("preview_source_timestamp_invalid");
      const sourceDecodeVersion = exactHeader(
        response,
        "x-gallery-source-decode-version",
        "preview_source_decoder_invalid",
      );
      if (sourceDecodeVersion !== GALLERY_SOURCE_DECODE_VERSION) {
        fail("preview_source_decoder_invalid");
      }
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }

    const sourceBytes = await readExactBoundedBody(
      response,
      sizeBytes,
      operationSignal,
    );
    failIfAborted(operationSignal);
    const encoded = await encodeBoundedPreview(sourceBytes, {
      mimeType,
      width: sourceWidth,
      height: sourceHeight,
    }, operationSignal);
    return {
      bytes: encoded.bytes,
      submissionId,
      sourceWidth,
      sourceHeight,
      previewWidth: encoded.width,
      previewHeight: encoded.height,
      sourceValidatedAt,
      sourceDecodeVersion: GALLERY_SOURCE_DECODE_VERSION,
      previewVersion: GALLERY_MODERATOR_PREVIEW_VERSION,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
