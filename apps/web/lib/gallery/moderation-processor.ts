import { createHash, randomUUID } from "node:crypto";
import {
  GALLERY_INPUT_MAX_BYTES, GALLERY_MEDIA_BODY_MAX_BYTES, GALLERY_MEDIA_VERSION,
  GALLERY_UUID, GalleryImageError, readBoundedGalleryBody,
} from "../../../../packages/gallery-media/policy.ts";
import { signGalleryMedia } from "../../../../packages/gallery-media/proof.ts";
import { processGalleryImage } from "./process-image.ts";

type ProcessorConfig = { supabaseUrl: string; publishableKey: string; processorSecret: string };
type ProcessorInput = { accessToken: string; submissionId: string; action: "approved" | "thumbnail"; reason?: string };
export type GalleryProcessingResult = { ok: boolean; code: string; message: string };

const messages: Record<string, string> = {
  image_size_rejected: "Choose an image no larger than 50 MiB.",
  image_dimensions_rejected: "Choose an image with at most 40 million pixels and no edge longer than 16,384 pixels.",
  image_content_rejected: "This image could not be decoded safely. Choose a valid JPEG, PNG, or WebP image.",
  image_animation_rejected: "Animated and multi-frame images are not supported. Choose one still image.",
  image_target_rejected: "This image could not be reduced to the Gallery delivery limits.",
  image_memory_rejected: "This image needs too much memory to process. Try a smaller image.",
  image_processing_timeout: "Image processing took too long. Try again or choose a smaller image.",
  image_processing_cancelled: "Image processing was cancelled.",
  image_processor_unavailable: "Image processing is temporarily unavailable.",
  processing_busy: "Another image is being processed. Please try again shortly.",
  processing_recovery_required: "Image processing needs a leadership recovery check before another image can be processed. Refresh the queue before retrying.",
  access_denied: "Moderator access could not be verified.",
  source_changed: "This submission changed. Refresh the queue before trying again.",
  publication_failed: "The image could not be published. Refresh the queue before trying again.",
};

const failure = (code: string): GalleryProcessingResult => ({ ok: false, code, message: messages[code] || messages.image_processor_unavailable });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function baseOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new GalleryImageError("image_processor_unavailable");
  }
  return url.origin;
}

function validateInput(value: ProcessorInput) {
  if (!isRecord(value) || typeof value.accessToken !== "string" || value.accessToken.length > 8192
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.accessToken)
    || typeof value.submissionId !== "string" || !GALLERY_UUID.test(value.submissionId)
    || !["approved", "thumbnail"].includes(value.action)
    || (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 500))) {
    throw new GalleryImageError("access_denied");
  }
}

export function createGalleryModerationProcessor({
  fetchImpl = globalThis.fetch,
  processImage = processGalleryImage,
  maximumMs = 50_000,
}: { fetchImpl?: typeof fetch; processImage?: typeof processGalleryImage; maximumMs?: number } = {}) {
  if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > 50_000) {
    throw new GalleryImageError("image_processor_unavailable");
  }
  // Local admission avoids duplicate work in one instance. The backend lease
  // additionally prevents overlapping originals/decodes across instances.
  let processing = false;
  return async (input: ProcessorInput, config: ProcessorConfig): Promise<GalleryProcessingResult> => {
    let ownsSlot = false;
    let releaseRequired = false;
    let releaseLease: (() => Promise<boolean>) | undefined;
    let released = true;
    let result: GalleryProcessingResult;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), maximumMs);
    timer.unref();
    try {
      result = await (async () => {
        validateInput(input);
        if (!config.publishableKey || !/^[0-9a-f]{64}$/i.test(config.processorSecret)) {
          throw new GalleryImageError("image_processor_unavailable");
        }
        const origin = baseOrigin(config.supabaseUrl);
        const headers = { apikey: config.publishableKey, Authorization: `Bearer ${input.accessToken}` };
        const request = async (url: string, init: RequestInit, maximum: number, requireJson = false,
          signal = controller.signal) => {
          signal.throwIfAborted();
          const response = await fetchImpl(url, { ...init, redirect: "manual", signal });
          if (response.url !== url || !response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new GalleryImageError(response.status === 401 || response.status === 403 ? "access_denied" : "publication_failed");
          }
          if (requireJson && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") || "")) {
            await response.body?.cancel().catch(() => {});
            throw new GalleryImageError("publication_failed");
          }
          return { response, bytes: await readBoundedGalleryBody(response, maximum, signal) };
        };
        const json = async (url: string, init: RequestInit, signal = controller.signal) => {
          const result = await request(url, init, 64 * 1024, true, signal);
          try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.bytes)) as unknown; }
          catch { throw new GalleryImageError("publication_failed"); }
        };
        const access = await json(`${origin}/functions/v1/list-gallery-review-queue`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ processingSource: input.submissionId }),
        });
        if (!isRecord(access) || access.ok !== true || !isRecord(access.data)
          || access.data.hasAccess !== true || typeof access.data.moderatorId !== "string"
          || !GALLERY_UUID.test(access.data.moderatorId)) throw new GalleryImageError("access_denied");
        const moderatorId = access.data.moderatorId;
        if (processing) return failure("processing_busy");
        processing = true; ownsSlot = true;
        if (!isRecord(access.data.submission)) throw new GalleryImageError("source_changed");
        const row = access.data.submission;
        if (row.id === input.submissionId && input.action === "approved" && row.status === "approved"
          && typeof row.viewer_revision_id === "string" && GALLERY_UUID.test(row.viewer_revision_id)) {
          return { ok: true, code: "already_published", message: "This submission is already approved. The queue has been refreshed." };
        }
        if (row.id !== input.submissionId || row.status !== (input.action === "thumbnail" ? "approved" : "pending")
          || row.storage_bucket !== "member-gallery" || typeof row.user_id !== "string" || !GALLERY_UUID.test(row.user_id)
          || typeof row.storage_path !== "string" || row.storage_path.length > 1000
          || !row.storage_path.startsWith(row.user_id + "/") || /[\\\x00-\x1f\x7f]/.test(row.storage_path)
          || row.storage_path.split("/").some((part) => !part || part === "." || part === "..")
          || !["image/jpeg", "image/png", "image/webp"].includes(String(row.mime_type))
          || !Number.isSafeInteger(row.size_bytes) || Number(row.size_bytes) < 1 || Number(row.size_bytes) > GALLERY_INPUT_MAX_BYTES) {
          throw new GalleryImageError("source_changed");
        }
        if (typeof access.data.signedOriginalUrl !== "string" || access.data.signedOriginalUrl.length > 8192) {
          throw new GalleryImageError("source_changed");
        }
        const source = new URL(access.data.signedOriginalUrl);
        const expectedSourcePath = `/storage/v1/object/sign/member-gallery/${row.storage_path.split("/").map(encodeURIComponent).join("/")}`;
        if (source.origin !== origin || source.username || source.password || source.hash || source.pathname !== expectedSourcePath
          || source.searchParams.size !== 1 || !source.searchParams.get("token")) throw new GalleryImageError("source_changed");

        const leaseId = randomUUID();
        const admission = async (operation: "acquire" | "release", signal: AbortSignal) => {
          const body = JSON.stringify({ processingAdmission: { protocol: "gallery-admission-v1", operation,
            actor_id: moderatorId, submission_id: input.submissionId, lease_id: leaseId, issued_at_ms: Date.now() } });
          const signature = await signGalleryMedia("gallery-processing-admission-v1\n" + body, config.processorSecret);
          const response = await json(`${origin}/functions/v1/list-gallery-review-queue`, {
            method: "POST", headers: { ...headers, "Content-Type": "application/json", "x-mochirii-gallery-admission-proof": signature }, body,
          }, signal);
          if (!isRecord(response) || response.ok !== true || !isRecord(response.data)
            || typeof response.data.acquired !== "boolean"
            || !(operation === "acquire"
              ? (response.data.code === "acquired" && response.data.acquired === true)
                || (["busy", "stale", "not_owner"].includes(String(response.data.code)) && response.data.acquired === false)
              : ["released", "not_owner"].includes(String(response.data.code)) && response.data.acquired === false)) {
            throw new GalleryImageError("image_processor_unavailable");
          }
          return response.data;
        };
        releaseLease = async () => {
          const response = await admission("release", AbortSignal.timeout(5_000));
          // An unknown token is not proof of retirement: an ambiguous acquire
          // may still commit after this release probe. Require durable release.
          return response.code === "released";
        };
        // A lost acquisition response is ambiguous. Attempt only an owner-token
        // release; never download/decode without an explicit acquired response.
        releaseRequired = true;
        const admitted = await admission("acquire", controller.signal);
        if (admitted.acquired !== true || admitted.code !== "acquired") {
          releaseRequired = false;
          return failure(admitted.code === "busy" ? "processing_busy" : "processing_recovery_required");
        }
        const { response, bytes } = await request(source.href, { cache: "no-store" }, GALLERY_INPUT_MAX_BYTES);
        const etag = (response.headers.get("etag") || "").replace(/^"|"$/g, "");
        if (bytes.length !== row.size_bytes || !/^[0-9a-f]{32}(?:-[1-9][0-9]{0,5})?$/i.test(etag)) {
          throw new GalleryImageError("source_changed");
        }
        // Await actual settlement even after abort; releasing on Promise.race
        // would permit another instance while native decoding is still active.
        const processed = await processImage(bytes, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (processed.sourceMimeType !== row.mime_type
          || processed.sourceSha256 !== createHash("sha256").update(bytes).digest("hex")) {
          throw new GalleryImageError("source_changed");
        }
        const body = JSON.stringify({
          protocol: GALLERY_MEDIA_VERSION, issued_at_ms: Date.now(), actor_id: access.data.moderatorId,
          submission_id: input.submissionId, action: input.action, reason: input.reason || "",
          revision_id: randomUUID(), expected_thumbnail_revision_id: row.thumbnail_revision_id || null,
          source: { storage_bucket: row.storage_bucket, storage_path: row.storage_path, mime_type: row.mime_type,
            size_bytes: row.size_bytes, etag, sha256: processed.sourceSha256 },
          full: processed.full, thumbnail: processed.thumbnail,
        });
        if (new TextEncoder().encode(body).length > GALLERY_MEDIA_BODY_MAX_BYTES) throw new GalleryImageError("image_target_rejected");
        const signature = await signGalleryMedia(body, config.processorSecret);
        const committed = await json(`${origin}/functions/v1/moderate-gallery-submission`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json", "x-mochirii-gallery-proof": signature }, body,
        });
        if (!isRecord(committed) || committed.ok !== true) throw new GalleryImageError("publication_failed");
        return { ok: true, code: "published", message: input.action === "approved"
          ? "Submission approved for the guild gallery." : "Gallery viewing images prepared." };
      })();
    } catch (error) {
      result = failure(controller.signal.aborted ? "image_processing_timeout"
        : error instanceof GalleryImageError ? error.code : "image_processor_unavailable");
    } finally {
      clearTimeout(timer);
      if (releaseRequired && releaseLease) {
        try { released = await releaseLease(); }
        catch { released = false; }
      }
      if (ownsSlot) processing = false;
    }
    return released ? result : failure("processing_recovery_required");
  };
}
