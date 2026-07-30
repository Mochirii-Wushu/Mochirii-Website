import {
  GALLERY_MODERATOR_PREVIEW_MAX_BYTES,
  GALLERY_MODERATOR_PREVIEW_MAX_EDGE,
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
  GALLERY_MODERATOR_PREVIEW_VERSION,
  GALLERY_SOURCE_DECODE_VERSION,
  type GalleryPreparedPreview,
} from "./moderation-preview-contract.ts";

const PREVIEW_ROUTE = "/api/gallery/moderation-preview";
const DEFAULT_TIMEOUT_MS = 25_000;

function positiveIntegerHeader(response: Response, name: string, maximum: number) {
  const value = Number(response.headers.get(name) || 0);
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : null;
}

function exactHeader(response: Response, name: string) {
  return String(response.headers.get(name) || "").trim();
}

function hasWebpContainerSignature(bytes: Uint8Array) {
  return bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 &&
    bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50;
}

export async function parseGalleryModerationPreviewResponse(
  response: Response,
  expectedSubmissionId: string,
): Promise<GalleryPreparedPreview | null> {
  if (!response.ok || response.status !== 200) return null;
  const mimeType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0].trim().toLowerCase();
  const sizeBytes = positiveIntegerHeader(
    response,
    "content-length",
    GALLERY_MODERATOR_PREVIEW_MAX_BYTES,
  );
  const submissionId = exactHeader(response, "x-gallery-submission-id");
  const sourceWidth = positiveIntegerHeader(
    response,
    "x-gallery-source-width",
    4096,
  );
  const sourceHeight = positiveIntegerHeader(
    response,
    "x-gallery-source-height",
    4096,
  );
  const previewWidth = positiveIntegerHeader(
    response,
    "x-gallery-preview-width",
    GALLERY_MODERATOR_PREVIEW_MAX_EDGE,
  );
  const previewHeight = positiveIntegerHeader(
    response,
    "x-gallery-preview-height",
    GALLERY_MODERATOR_PREVIEW_MAX_EDGE,
  );
  const sourceValidatedAt = exactHeader(
    response,
    "x-gallery-source-validated-at",
  );
  const sourceDecodeVersion = exactHeader(
    response,
    "x-gallery-source-decode-version",
  );
  const previewVersion = exactHeader(
    response,
    "x-gallery-preview-version",
  );
  const cacheControl = exactHeader(response, "cache-control").toLowerCase();
  const contentEncoding = exactHeader(response, "content-encoding").toLowerCase() ||
    "identity";
  if (
    mimeType !== GALLERY_MODERATOR_PREVIEW_MIME_TYPE ||
    !sizeBytes || submissionId !== expectedSubmissionId ||
    !sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 12_600_000 ||
    !previewWidth || !previewHeight ||
    !Number.isFinite(Date.parse(sourceValidatedAt)) ||
    sourceDecodeVersion !== GALLERY_SOURCE_DECODE_VERSION ||
    previewVersion !== GALLERY_MODERATOR_PREVIEW_VERSION ||
    !cacheControl.includes("private") || !cacheControl.includes("no-store") ||
    contentEncoding !== "identity" ||
    exactHeader(response, "x-content-type-options").toLowerCase() !== "nosniff" ||
    !exactHeader(response, "x-robots-tag").toLowerCase().includes("noindex") ||
    exactHeader(response, "referrer-policy").toLowerCase() !== "no-referrer"
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // The same-origin body may already be closed.
    }
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== sizeBytes || !hasWebpContainerSignature(bytes)) return null;
  return {
    blob: new Blob([bytes], { type: GALLERY_MODERATOR_PREVIEW_MIME_TYPE }),
    submissionId,
    sourceWidth,
    sourceHeight,
    previewWidth,
    previewHeight,
    sourceValidatedAt,
    sourceDecodeVersion: GALLERY_SOURCE_DECODE_VERSION,
    previewVersion: GALLERY_MODERATOR_PREVIEW_VERSION,
  };
}

export async function fetchGalleryModerationPreview({
  accessToken,
  expectedUpdatedAt,
  signal,
  submissionId,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  accessToken: string;
  expectedUpdatedAt: string;
  signal?: AbortSignal;
  submissionId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(PREVIEW_ROUTE, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ submissionId, expectedUpdatedAt }),
      signal: controller.signal,
    });
    return await parseGalleryModerationPreviewResponse(response, submissionId);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
