import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, type JsonRecord } from "./gallery-moderation.ts";
import { galleryThumbnailStoragePath } from "./gallery-thumbnail.ts";
import { readGalleryModerationBody, validateProcessedGalleryMedia } from "./gallery-processed-media.ts";
import { isDecodableGalleryWebp } from "./gallery-webp-decoder.ts";
import { GALLERY_MEDIA_VERSION, GALLERY_UUID } from "../../../packages/gallery-media/policy.ts";

// The live handler calls this exact consumer; tests inject Storage/RPC faults.
export async function runGalleryModeration(req: Request, access: { adminClient: SupabaseClient; userId: string }, secret: string) {
  let body: JsonRecord;
  try { body = await readGalleryModerationBody(req); }
  catch { return jsonResponse({ ok: false, error: "moderation_body_rejected", message: "The moderation request could not be read safely." }, 400); }
  const submissionId = body.submission_id;
  const action = body.action;
  if (typeof submissionId !== "string" || !GALLERY_UUID.test(submissionId)
    || typeof action !== "string" || !["approved", "rejected", "thumbnail"].includes(action)
    || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500))) {
    return jsonResponse({ ok: false, error: "moderation_input_rejected", message: "Choose a valid submission and moderation action." }, 400);
  }
  let media: Awaited<ReturnType<typeof validateProcessedGalleryMedia>> | null = null;
  if (action !== "rejected") {
    try {
      media = await validateProcessedGalleryMedia(body, req, access.userId, secret);
      if (!await isDecodableGalleryWebp(media.thumbnail.bytes, media.thumbnail.width, media.thumbnail.height)) {
        throw new Error("thumbnail_decode_failed");
      }
    } catch {
      return jsonResponse({ ok: false, error: "processed_media_rejected", message: "Safe viewing images must be prepared before approval." }, 400);
    }
  }
  const { data: current, error: lookupError } = await access.adminClient.from("gallery_submissions")
    .select("id,user_id,status,storage_bucket,storage_path,mime_type,size_bytes,thumbnail_revision_id,thumbnail_storage_path,viewer_revision_id,viewer_storage_path")
    .eq("id", submissionId).maybeSingle();
  if (lookupError || !current) return jsonResponse({ ok: false, error: "submission_unavailable", message: "Refresh the queue before trying again." }, 409);
  if (media && current.status === "approved" && current.viewer_revision_id === media.revisionId) {
    return jsonResponse({ ok: true, message: "This image is already published." });
  }
  if (current.status !== (action === "thumbnail" ? "approved" : "pending")
    || (media && (current.storage_bucket !== media.source.storage_bucket || current.storage_path !== media.source.storage_path
      || current.mime_type !== media.source.mime_type || current.size_bytes !== media.source.size_bytes
      || current.thumbnail_revision_id !== body.expected_thumbnail_revision_id))) {
    return jsonResponse({ ok: false, error: "source_changed", message: "This submission changed. Refresh the queue." }, 409);
  }
  const bucket = access.adminClient.storage.from("member-gallery");
  const thumbnailPath = media ? galleryThumbnailStoragePath(submissionId, media.revisionId) : null;
  const fullPath = media ? `_approved/full/${submissionId}/${media.revisionId}.webp` : null;
  const written: string[] = [];
  const cleanUnselected = async () => {
    if (!written.length) return;
    try { await bucket.remove(written); } catch { /* Only own unselected objects; private cleanup can retry. */ }
  };
  if (media && fullPath && thumbnailPath) {
    for (const [path, image] of [[fullPath, media.full], [thumbnailPath, media.thumbnail]] as const) {
      let uploaded;
      try { uploaded = await bucket.upload(path, image.bytes, { contentType: image.mimeType, cacheControl: "31536000", upsert: false }); }
      catch { await cleanUnselected(); return jsonResponse({ ok: false, error: "media_store_failed", message: "Viewing images could not be stored. Retry from the queue." }, 503); }
      if (uploaded.error) {
        await cleanUnselected();
        return jsonResponse({ ok: false, error: "media_store_failed", message: "Viewing images could not be stored. Retry from the queue." }, 503);
      }
      written.push(path);
    }
  }
  let committed;
  try {
    committed = await access.adminClient.rpc("gallery_commit_moderation", {
      p_submission_id: submissionId, p_moderator_id: access.userId, p_action: action,
      p_reason: action === "rejected" ? String(body.reason || "Rejected by moderator.") : null,
      p_thumbnail_revision_id: media?.revisionId || null, p_thumbnail_storage_path: thumbnailPath,
      p_thumbnail_mime_type: media?.thumbnail.mimeType || null, p_thumbnail_size_bytes: media?.thumbnail.sizeBytes || null,
      p_expected_thumbnail_revision_id: current.thumbnail_revision_id || null,
      p_media: media ? { ...media.source, etag: String(media.source.etag).toLowerCase(),
        viewer_storage_path: fullPath, viewer_size_bytes: media.full.sizeBytes, viewer_width: media.full.width,
        viewer_height: media.full.height, processing_version: GALLERY_MEDIA_VERSION } : null,
    });
  } catch {
    // Unknown completion: a lost response is not proof of rollback.
    return jsonResponse({ ok: false, error: "publication_unconfirmed", message: "Publication could not be confirmed. Refresh the queue before retrying." }, 503);
  }
  const result = committed.data as JsonRecord | null;
  if (committed.error || result?.committed !== true) {
    const definiteRollback = committed.error && ["22023", "23514", "42501", "40001", "40P01"].includes(committed.error.code);
    if (definiteRollback || (!committed.error && result?.committed === false)) await cleanUnselected();
    return jsonResponse({ ok: false, error: "publication_unconfirmed", message: "This submission changed or publication could not be confirmed. Refresh the queue." }, 409);
  }
  if (action === "thumbnail") {
    // A winning compare-and-swap proves only these previously selected paths
    // obsolete. Originals and newer concurrent revisions are never deleted.
    const stale = [
      [current.thumbnail_storage_path, `_approved/thumbs/${submissionId}/${current.thumbnail_revision_id}.webp`],
      [current.viewer_storage_path, `_approved/full/${submissionId}/${current.viewer_revision_id}.webp`],
    ].filter(([path, expected]) => typeof path === "string" && path === expected && path !== fullPath && path !== thumbnailPath)
      .map(([path]) => path as string);
    if (stale.length) { try { await bucket.remove(stale); } catch { /* Private cleanup can retry. */ } }
  }
  return jsonResponse({ ok: true, message: action === "approved" ? "Submission approved for the guild gallery."
    : action === "thumbnail" ? "Gallery viewing images prepared." : "Submission declined." });
}
