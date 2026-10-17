import type { SupabaseClient } from "@supabase/supabase-js";
import { GALLERY_UUID, validateGalleryInputSize } from "../../../../packages/gallery-media/policy.ts";
import { galleryUploadEndpoint, uploadGalleryOriginal, type GalleryUploadProgress } from "./resumable-upload.ts";

export class GallerySubmissionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function submitGalleryOriginal({
  client, file, userId, uploadId, mimeType, supabaseUrl, metadata, signal, onProgress,
  upload = uploadGalleryOriginal,
}: {
  client: SupabaseClient; file: File; userId: string; uploadId: string; mimeType: string;
  supabaseUrl: string; metadata: Record<string, unknown>; signal?: AbortSignal;
  onProgress?: (progress: GalleryUploadProgress) => void; upload?: typeof uploadGalleryOriginal;
}) {
  if (!GALLERY_UUID.test(userId) || !GALLERY_UUID.test(uploadId)
    || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new GallerySubmissionError("upload_conflict");
  }
  validateGalleryInputSize(file.size);
  const expectedPath = `${userId}/${uploadId}.${mimeType.slice(6)}`;
  const token = async () => {
    signal?.throwIfAborted();
    const session = await client.auth.getSession();
    signal?.throwIfAborted();
    if (session.error || session.data.session?.user.id !== userId || !session.data.session.access_token) {
      throw new GallerySubmissionError("upload_account_changed");
    }
    return session.data.session.access_token;
  };
  await token();
  const reserved = await client.rpc("gallery_reserve_upload", {
    p_upload_id: uploadId, p_size_bytes: file.size, p_mime_type: mimeType,
  });
  if (reserved.error || !record(reserved.data)) throw new GallerySubmissionError("upload_unconfirmed");
  const reservation = reserved.data;
  if (reservation.ok !== true) throw new GallerySubmissionError(
    typeof reservation.code === "string" ? reservation.code : "upload_unconfirmed",
  );
  if (reservation.upload_id !== uploadId || reservation.storage_path !== expectedPath
    || !["reserved", "submitted"].includes(String(reservation.state))) {
    throw new GallerySubmissionError("upload_conflict");
  }
  await token();
  if (reservation.state === "reserved") {
    const filename = expectedPath.slice(userId.length + 1);
    const objects = await client.storage.from("member-gallery").list(userId, { search: filename, limit: 2 });
    if (objects.error) throw new GallerySubmissionError("upload_unconfirmed");
    const stored = objects.data?.find((item) => item.name === filename);
    if (stored && (Number(stored.metadata?.size) !== file.size || stored.metadata?.mimetype !== mimeType)) {
      throw new GallerySubmissionError("upload_conflict");
    }
    if (!stored) await upload(file, {
      endpoint: galleryUploadEndpoint(supabaseUrl), objectName: expectedPath, mimeType,
      signal, onProgress, token,
    });
  }
  await token();
  const completed = await client.rpc("gallery_complete_upload", {
    p_upload_id: uploadId, p_metadata: metadata,
  });
  if (completed.error || !record(completed.data)) throw new GallerySubmissionError("upload_unconfirmed");
  if (completed.data.ok !== true) throw new GallerySubmissionError(
    typeof completed.data.code === "string" ? completed.data.code : "upload_unconfirmed",
  );
  const submission = completed.data.submission;
  if (!record(submission) || submission.id !== uploadId || submission.user_id !== userId
    || submission.storage_path !== expectedPath || submission.mime_type !== mimeType
    || submission.size_bytes !== file.size) throw new GallerySubmissionError("upload_conflict");
  // A cancelled or switched account must not receive the prior member's result.
  await token();
  return submission;
}
