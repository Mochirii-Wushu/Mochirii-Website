import { requireBrowserSupabaseClient } from "./client";
import {
  INSTAGRAM_WEBSITE_OPT_IN_COPY_VERSION,
  MAX_UPLOAD_BYTES,
  MEMBER_GALLERY_BUCKET,
  SUBMISSION_FIELDS,
  SUPABASE_URL,
} from "./config";
import { requireAuth } from "./auth";
import { requireActiveMember } from "./profile";
import {
  createError,
  createResult,
  failedResult,
  okResult,
  type GallerySubmission,
  type GallerySubmissionMetadata,
} from "./types";
import { inspectGalleryFileHeader } from "../gallery-thumbnail";
import { galleryUploadEndpoint, uploadGalleryOriginal, type GalleryUploadProgress } from "../gallery/resumable-upload";
import { GALLERY_UUID, GalleryImageError } from "../../../../packages/gallery-media/policy.ts";

class GalleryUploadError extends Error {}


function fieldLabel(key: string) {
  return key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function validateGalleryFile(file: File | null | undefined) {
  if (!file) throw new GalleryUploadError("Choose an image file before uploading.");
  if (file.size <= 0) throw new GalleryUploadError("The selected file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new GalleryUploadError("Images must be 100 MiB or smaller.");
}

export function cleanSubmissionMetadata(metadata: GallerySubmissionMetadata = {}) {
  const clean: Record<string, string> = {};

  Object.entries(SUBMISSION_FIELDS).forEach(([key, max]) => {
    const value = String(metadata[key as keyof GallerySubmissionMetadata] ?? "").trim();
    if (!value) return;
    if (value.length > max) throw new GalleryUploadError(`${fieldLabel(key)} must be ${max} characters or fewer.`);
    clean[key] = value;
  });

  return clean as Pick<GallerySubmissionMetadata, keyof typeof SUBMISSION_FIELDS>;
}

export async function uploadMemberGalleryImage(file: File | null | undefined, metadata: GallerySubmissionMetadata = {}, options: {
  uploadId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: GalleryUploadProgress) => void;
} = {}) {
  try {
    const client = requireBrowserSupabaseClient();
    validateGalleryFile(file);
    const validFile = file as File;
    const uploadId = options.uploadId || crypto.randomUUID();
    if (!GALLERY_UUID.test(uploadId)) throw new GalleryUploadError("Choose the image again before uploading.");
    const inspected = await inspectGalleryFileHeader(validFile);
    options.signal?.throwIfAborted();

    const access = await requireActiveMember({ refresh: true });
    if (!access.ok || !access.data?.user) return access;

    const user = access.data.user;
    const cleanMetadata = cleanSubmissionMetadata(metadata);
    const storagePath = `${user.id}/${uploadId}.${inspected.mimeType.slice(6)}`;
    const lookup = () => client.from("gallery_submissions").select("*").eq("id", uploadId).maybeSingle();
    const existing = await lookup();
    if (existing.error) return failedResult("Your previous upload could not be checked. Please try again.");
    const matches = (value: Record<string, unknown>) => value.user_id === user.id && value.storage_path === storagePath
      && value.mime_type === inspected.mimeType && value.size_bytes === validFile.size;
    if (existing.data) return matches(existing.data)
      ? okResult({ submission: existing.data as GallerySubmission }, "This image has already been submitted for moderation.")
      : failedResult("Choose the image again before uploading.");
    const filename = storagePath.slice(user.id.length + 1);
    const objects = await client.storage.from(MEMBER_GALLERY_BUCKET).list(user.id, { search: filename, limit: 2 });
    if (objects.error) return failedResult("Your upload could not be checked. Please try again.");
    const stored = objects.data?.find((item) => item.name === filename);
    if (stored && (Number(stored.metadata?.size) !== validFile.size || stored.metadata?.mimetype !== inspected.mimeType)) {
      return failedResult("Choose the image again before uploading.");
    }
    if (!stored) await uploadGalleryOriginal(validFile, {
      endpoint: galleryUploadEndpoint(SUPABASE_URL),
      objectName: storagePath, mimeType: inspected.mimeType, signal: options.signal, onProgress: options.onProgress,
      token: async () => {
        const session = await client.auth.getSession();
        return session.data.session?.user.id === user.id ? session.data.session.access_token : "";
      },
    });
    options.signal?.throwIfAborted();

    const row = {
      id: uploadId,
      user_id: user.id,
      storage_bucket: MEMBER_GALLERY_BUCKET,
      storage_path: storagePath,
      original_filename: validFile.name.slice(0, 255) || "gallery-image",
      mime_type: inspected.mimeType,
      size_bytes: validFile.size,
      ...cleanMetadata,
      instagram_opt_in: metadata.instagramOptIn === true,
      instagram_opt_in_at: metadata.instagramOptIn === true ? new Date().toISOString() : null,
      instagram_opt_in_source: metadata.instagramOptIn === true ? "website_upload" : null,
      instagram_opt_in_copy_version: metadata.instagramOptIn === true ? INSTAGRAM_WEBSITE_OPT_IN_COPY_VERSION : null,
    };

    const { data: submission, error: insertError } = await client
      .from("gallery_submissions")
      .insert(row)
      .select("*")
      .single();

    if (insertError) {
      // A network failure may follow a committed insert. Reconcile the same ID
      // before retrying; never delete its potentially selected original.
      const reconciled = await lookup();
      if (reconciled.data && matches(reconciled.data)) {
        return okResult({ submission: reconciled.data as GallerySubmission }, "Image submitted for moderation.");
      }
      return failedResult("The submission could not be confirmed. Retry to continue without uploading a second original.");
    }

    return okResult(
      {
        submission: submission as GallerySubmission,
      },
      "Image submitted for moderation.",
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return failedResult("Upload cancelled. No image was published.");
    if (error instanceof GalleryUploadError) return failedResult(error.message);
    if (error instanceof GalleryImageError) return failedResult("Choose a still JPEG, PNG, or WebP within the file and pixel limits.");
    return failedResult("The image could not be uploaded safely. Retry with the same image or choose another file.");
  }
}

export async function listMyGallerySubmissions() {
  try {
    const client = requireBrowserSupabaseClient();
    const auth = await requireAuth();
    if (!auth.ok || !auth.data?.user) return auth;

    const { data, error, status, statusText } = await client
      .from("gallery_submissions")
      .select("id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,title,caption,category,status,rejection_reason,reviewed_at,created_at,updated_at,submission_source,instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version")
      .eq("user_id", auth.data.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return createResult<GallerySubmission[]>({
        ok: false,
        status,
        statusText,
        data: null,
        error: createError(error),
      });
    }

    return okResult((Array.isArray(data) ? data : []) as GallerySubmission[]);
  } catch (error) {
    return failedResult<GallerySubmission[]>(error);
  }
}
