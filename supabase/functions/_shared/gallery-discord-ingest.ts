type JsonRecord = Record<string, unknown>;

const GALLERY_DISCORD_INGEST_ERROR_CODES = [
  "attachment_fetch_failed",
  "attachment_http_error",
  "attachment_redirect_invalid",
  "attachment_redirect_limit",
  "attachment_timeout",
  "attachment_too_large",
  "attachment_url_invalid",
] as const;

type GalleryDiscordIngestErrorCode =
  (typeof GALLERY_DISCORD_INGEST_ERROR_CODES)[number];

const galleryDiscordIngestErrorCodeSet = new Set<string>(
  GALLERY_DISCORD_INGEST_ERROR_CODES,
);

export class GalleryDiscordIngestError extends Error {
  constructor(readonly code: GalleryDiscordIngestErrorCode) {
    super(code);
    this.name = "GalleryDiscordIngestError";
  }
}

export function galleryDiscordIngestErrorCode(
  error: unknown,
): GalleryDiscordIngestErrorCode {
  const code = error instanceof GalleryDiscordIngestError ? error.code : "";
  return galleryDiscordIngestErrorCodeSet.has(code)
    ? code as GalleryDiscordIngestErrorCode
    : "attachment_fetch_failed";
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export async function constantTimeSecretEquals(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

export async function readBoundedJsonRecord(
  request: Request,
  maximumBytes: number,
): Promise<JsonRecord | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (contentType !== "application/json") return null;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("request_too_large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return record(json);
  } catch {
    return null;
  }
}

async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("attachment_too_large");
        throw new GalleryDiscordIngestError("attachment_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadAllowlistedAttachment({
  initialUrl,
  isAllowedUrl,
  maximumBytes,
  timeoutMs,
  maximumRedirects = 3,
  fetcher = fetch,
  headers = {},
}: {
  initialUrl: string;
  isAllowedUrl: (value: string) => string | null;
  maximumBytes: number;
  timeoutMs: number;
  maximumRedirects?: number;
  fetcher?: typeof fetch;
  headers?: Record<string, string>;
}): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string }> {
  let currentUrl = isAllowedUrl(initialUrl);
  if (!currentUrl) throw new GalleryDiscordIngestError("attachment_url_invalid");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
      let response: Response;
      try {
        response = await fetcher(currentUrl, {
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new GalleryDiscordIngestError("attachment_timeout");
        }
        throw error;
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel("redirect");
        if (redirectCount === maximumRedirects) {
          throw new GalleryDiscordIngestError("attachment_redirect_limit");
        }
        const location = response.headers.get("location");
        const nextUrl = location ? new URL(location, currentUrl).toString() : "";
        currentUrl = isAllowedUrl(nextUrl);
        if (!currentUrl) {
          throw new GalleryDiscordIngestError("attachment_redirect_invalid");
        }
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel("attachment_http_error");
        throw new GalleryDiscordIngestError("attachment_http_error");
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
        await response.body?.cancel("attachment_too_large");
        throw new GalleryDiscordIngestError("attachment_too_large");
      }
      return {
        bytes: await readBoundedResponseBytes(response, maximumBytes),
        contentType: response.headers.get("content-type") || "",
        finalUrl: currentUrl,
      };
    }
    throw new GalleryDiscordIngestError("attachment_redirect_limit");
  } catch (error) {
    if (error instanceof GalleryDiscordIngestError) throw error;
    throw new GalleryDiscordIngestError(
      controller.signal.aborted
        ? "attachment_timeout"
        : "attachment_fetch_failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}
