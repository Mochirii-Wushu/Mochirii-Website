import {
  GALLERY_LOCAL_SANITIZER_ATTESTATION,
  GALLERY_MODERATOR_PREVIEW_MAX_BYTES,
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
} from "./moderation-preview-contract.ts";
import type {
  GalleryModerationPreview,
  prepareGalleryModerationPreview,
} from "./moderation-preview-server-core.ts";

const MAX_REQUEST_BYTES = 1024;
const MAX_BEARER_BYTES = 4096;
const MAX_ATTESTATION_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PreparePreview = typeof prepareGalleryModerationPreview;

export const GALLERY_PREVIEW_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, Origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  "Referrer-Policy": "no-referrer",
} as const;

export function opaqueGalleryPreviewDenied() {
  return new Response(null, { status: 404, headers: GALLERY_PREVIEW_PRIVATE_HEADERS });
}

export function galleryPreviewRequestIsSameOrigin(request: Request) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function readGalleryPreviewBearer(value: string | null) {
  const raw = String(value || "");
  if (raw.length > MAX_BEARER_BYTES + 16) return null;
  const match = raw.match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  if (!match || match[1].length > MAX_BEARER_BYTES) return null;
  return match[1];
}

function exactLoopbackPair(requestUrl: string, supabaseUrl: string) {
  let request: URL;
  let upstream: URL;
  try {
    request = new URL(requestUrl);
    upstream = new URL(supabaseUrl);
  } catch {
    return false;
  }
  const loopback = (hostname: string) =>
    hostname === "localhost" || hostname === "127.0.0.1";
  return request.protocol === "http:" && upstream.protocol === "http:" &&
    loopback(request.hostname) && loopback(upstream.hostname);
}

export function readGalleryPreviewSanitizerAttestation(
  request: Request,
  supabaseUrl: string,
) {
  const token = String(request.headers.get("x-vercel-oidc-token") || "").trim();
  if (
    token.length >= 32 && token.length <= MAX_ATTESTATION_BYTES &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) return token;
  return exactLoopbackPair(request.url, supabaseUrl)
    ? GALLERY_LOCAL_SANITIZER_ATTESTATION
    : null;
}

async function readRequestBody(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return null;
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_REQUEST_BYTES)) {
    return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value?.byteLength) continue;
      received += chunk.value.byteLength;
      if (received > MAX_REQUEST_BYTES) {
        await reader.cancel("gallery_preview_request_too_large");
        return null;
      }
      bytes.set(chunk.value, received - chunk.value.byteLength);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  if (received < 2) return null;
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, received));
  } catch {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "submissionId" && key !== "expectedUpdatedAt")) return null;
  const submissionId = String(record.submissionId || "").trim();
  const expectedUpdatedAt = String(record.expectedUpdatedAt || "").trim();
  if (!UUID_RE.test(submissionId) || !Number.isFinite(Date.parse(expectedUpdatedAt))) return null;
  return { submissionId, expectedUpdatedAt };
}

function hasWebpContainerSignature(bytes: Uint8Array) {
  return bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 &&
    bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50;
}

function previewResponse(preview: GalleryModerationPreview) {
  if (
    preview.bytes.byteLength > GALLERY_MODERATOR_PREVIEW_MAX_BYTES ||
    !hasWebpContainerSignature(preview.bytes)
  ) {
    return opaqueGalleryPreviewDenied();
  }
  const body = new Uint8Array(preview.bytes.byteLength);
  body.set(preview.bytes);
  return new Response(body.buffer, {
    status: 200,
    headers: {
      ...GALLERY_PREVIEW_PRIVATE_HEADERS,
      "Content-Length": String(body.byteLength),
      "Content-Type": GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
      "X-Gallery-Submission-Id": preview.submissionId,
      "X-Gallery-Source-Width": String(preview.sourceWidth),
      "X-Gallery-Source-Height": String(preview.sourceHeight),
      "X-Gallery-Preview-Width": String(preview.previewWidth),
      "X-Gallery-Preview-Height": String(preview.previewHeight),
      "X-Gallery-Source-Validated-At": preview.sourceValidatedAt,
      "X-Gallery-Source-Decode-Version": preview.sourceDecodeVersion,
      "X-Gallery-Preview-Version": preview.previewVersion,
    },
  });
}

export async function handleGalleryModerationPreviewRequest(request: Request, {
  publishableKey,
  supabaseProjectRef,
  supabaseUrl,
  preparePreview,
}: {
  publishableKey: string;
  supabaseProjectRef: string;
  supabaseUrl: string;
  preparePreview?: PreparePreview;
}) {
  if (request.method !== "POST" || new URL(request.url).search || !galleryPreviewRequestIsSameOrigin(request)) {
    return opaqueGalleryPreviewDenied();
  }
  const accessToken = readGalleryPreviewBearer(request.headers.get("authorization"));
  if (!accessToken) return opaqueGalleryPreviewDenied();
  const sanitizerAttestation = readGalleryPreviewSanitizerAttestation(
    request,
    supabaseUrl,
  );
  if (!sanitizerAttestation) return opaqueGalleryPreviewDenied();
  const body = await readRequestBody(request);
  if (!body) return opaqueGalleryPreviewDenied();
  try {
    const prepare = preparePreview ??
      (await import("./moderation-preview-server")).prepareGalleryModerationPreview;
    const preview = await prepare({
      accessToken,
      expectedUpdatedAt: body.expectedUpdatedAt,
      publishableKey,
      sanitizerAttestation,
      submissionId: body.submissionId,
      supabaseProjectRef,
      supabaseUrl,
      signal: request.signal,
    });
    return previewResponse(preview);
  } catch {
    return opaqueGalleryPreviewDenied();
  }
}
