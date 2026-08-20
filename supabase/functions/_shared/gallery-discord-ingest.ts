const GALLERY_DISCORD_INGEST_ERROR_CODES = [
  "attachment_fetch_failed",
  "attachment_content_length_mismatch",
  "attachment_http_error",
  "attachment_redirect_invalid",
  "attachment_redirect_limit",
  "attachment_timeout",
  "attachment_too_large",
  "attachment_url_invalid",
] as const;

export type GalleryDiscordIngestErrorCode =
  (typeof GALLERY_DISCORD_INGEST_ERROR_CODES)[number];

const knownErrorCodes = new Set<string>(GALLERY_DISCORD_INGEST_ERROR_CODES);
const DISCORD_GALLERY_ATTACHMENT_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "media.discordapp.com",
]);
const DISCORD_GALLERY_ATTACHMENT_PATH =
  /^\/(?:ephemeral-)?attachments\/(\d{16,22})\/(\d{16,22})\/[^/]+$/;

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
  return knownErrorCodes.has(code)
    ? code as GalleryDiscordIngestErrorCode
    : "attachment_fetch_failed";
}

export function validDiscordGalleryAttachmentUrl(
  value: unknown,
  expectedChannelId?: string,
  expectedAttachmentId?: string,
): string | null {
  if (typeof value !== "string") return null;
  if (!value || value.length > 4096 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    const pathMatch = DISCORD_GALLERY_ATTACHMENT_PATH.exec(url.pathname);
    if (
      url.protocol !== "https:" ||
      !DISCORD_GALLERY_ATTACHMENT_HOSTS.has(url.hostname) ||
      !pathMatch || url.username || url.password || url.hash || url.port ||
      (expectedChannelId !== undefined && pathMatch[1] !== expectedChannelId) ||
      (expectedAttachmentId !== undefined &&
        pathMatch[2] !== expectedAttachmentId)
    ) return null;
    return url.toString() === value ? value : null;
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
    for (;;) {
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
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (
    !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    !Number.isSafeInteger(maximumRedirects) || maximumRedirects < 0 ||
    maximumRedirects > 3
  ) throw new GalleryDiscordIngestError("attachment_fetch_failed");

  let currentUrl = isAllowedUrl(initialUrl);
  if (!currentUrl) {
    throw new GalleryDiscordIngestError("attachment_url_invalid");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (
      let redirectCount = 0;
      redirectCount <= maximumRedirects;
      redirectCount += 1
    ) {
      let response: Response;
      try {
        response = await fetcher(currentUrl, {
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new GalleryDiscordIngestError("attachment_timeout");
        }
        throw new GalleryDiscordIngestError("attachment_fetch_failed");
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel("redirect").catch(() => undefined);
        if (redirectCount === maximumRedirects) {
          throw new GalleryDiscordIngestError("attachment_redirect_limit");
        }
        const location = response.headers.get("location");
        let nextUrl = "";
        try {
          nextUrl = location ? new URL(location, currentUrl).toString() : "";
        } catch {
          throw new GalleryDiscordIngestError("attachment_redirect_invalid");
        }
        currentUrl = isAllowedUrl(nextUrl);
        if (!currentUrl) {
          throw new GalleryDiscordIngestError("attachment_redirect_invalid");
        }
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel("attachment_http_error").catch(() =>
          undefined
        );
        throw new GalleryDiscordIngestError("attachment_http_error");
      }
      const contentLengthText = response.headers.get("content-length");
      let contentLength: number | null = null;
      if (contentLengthText !== null) {
        const normalizedLength = contentLengthText.trim();
        contentLength = /^\d+$/.test(normalizedLength)
          ? Number(normalizedLength)
          : Number.NaN;
        if (
          !Number.isSafeInteger(contentLength) || contentLength < 0 ||
          contentLength > maximumBytes
        ) {
          await response.body?.cancel("attachment_too_large");
          throw new GalleryDiscordIngestError("attachment_too_large");
        }
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedResponseBytes(response, maximumBytes);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new GalleryDiscordIngestError("attachment_timeout");
        }
        if (error instanceof GalleryDiscordIngestError) throw error;
        throw new GalleryDiscordIngestError("attachment_fetch_failed");
      }
      if (contentLength !== null && contentLength !== bytes.byteLength) {
        throw new GalleryDiscordIngestError(
          "attachment_content_length_mismatch",
        );
      }
      return {
        bytes,
        contentType: response.headers.get("content-type") || "",
      };
    }
    throw new GalleryDiscordIngestError("attachment_redirect_limit");
  } finally {
    clearTimeout(timeout);
  }
}
