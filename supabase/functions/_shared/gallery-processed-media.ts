import { GALLERY_MEDIA_BODY_MAX_BYTES, GALLERY_MEDIA_VERSION, GALLERY_UUID, readBoundedGalleryBody } from "../../../packages/gallery-media/policy.ts";
import { verifyGalleryMedia } from "../../../packages/gallery-media/proof.ts";
import { parseGalleryFullPayload, parseGalleryThumbnailPayload } from "./gallery-thumbnail.ts";
import type { JsonRecord } from "./gallery-moderation.ts";

const record = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: JsonRecord, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export async function readGalleryModerationBody(req: Request): Promise<JsonRecord> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers.get("content-type") || "")) throw new Error("moderation_body_rejected");
  const bytes = await readBoundedGalleryBody(req, GALLERY_MEDIA_BODY_MAX_BYTES);
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(raw);
  if (!record(value)) throw new Error("moderation_body_rejected");
  // The signature covers exact raw bytes, not a lossy/reordered JSON representation.
  Object.defineProperty(value, "_rawBody", { value: raw, enumerable: false });
  return value;
}

export async function validateProcessedGalleryMedia(body: JsonRecord, req: Request, actorId: string, secret: string, now = Date.now()) {
  if (!exactKeys(body, ["protocol", "issued_at_ms", "actor_id", "submission_id", "action", "reason",
    "revision_id", "expected_thumbnail_revision_id", "source", "full", "thumbnail"])
    || body.protocol !== GALLERY_MEDIA_VERSION || body.actor_id !== actorId
    || typeof body.submission_id !== "string" || !GALLERY_UUID.test(body.submission_id)
    || typeof body.revision_id !== "string" || !GALLERY_UUID.test(body.revision_id)
    || !["approved", "thumbnail"].includes(String(body.action))
    || typeof body.reason !== "string" || body.reason.length > 500
    || !Number.isSafeInteger(body.issued_at_ms) || now - Number(body.issued_at_ms) > 120_000
    || Number(body.issued_at_ms) > now + 5_000
    || (body.expected_thumbnail_revision_id !== null && (typeof body.expected_thumbnail_revision_id !== "string"
      || !GALLERY_UUID.test(body.expected_thumbnail_revision_id)))
    || !await verifyGalleryMedia(String(body._rawBody || ""), req.headers.get("x-mochirii-gallery-proof") || "", secret)) {
    throw new Error("processing_proof_rejected");
  }
  const source = body.source;
  if (!record(source) || !exactKeys(source, ["storage_bucket", "storage_path", "mime_type", "size_bytes", "etag", "sha256"])
    || source.storage_bucket !== "member-gallery" || typeof source.storage_path !== "string"
    || source.storage_path.length > 1000 || !/^[0-9a-f-]{36}\//i.test(source.storage_path)
    || /[\\\x00-\x1f\x7f]/.test(source.storage_path)
    || source.storage_path.split("/").some((part) => !part || part === "." || part === "..")
    || !["image/jpeg", "image/png", "image/webp"].includes(String(source.mime_type))
    || !Number.isSafeInteger(source.size_bytes) || Number(source.size_bytes) < 1 || Number(source.size_bytes) > 104857600
    || typeof source.etag !== "string" || !/^[0-9a-f]{32}(?:-[1-9][0-9]{0,5})?$/i.test(source.etag)
    || typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error("processing_source_rejected");
  const full = parseGalleryFullPayload(body.full), thumbnail = parseGalleryThumbnailPayload(body.thumbnail);
  if (!full.ok || !thumbnail.ok) throw new Error("processing_images_rejected");
  return { source, full: full.thumbnail, thumbnail: thumbnail.thumbnail, revisionId: body.revision_id };
}
