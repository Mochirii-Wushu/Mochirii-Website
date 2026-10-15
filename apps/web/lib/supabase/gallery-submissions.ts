import { requireBrowserSupabaseClient } from "./client";
import {
  INSTAGRAM_WEBSITE_OPT_IN_COPY_VERSION,
  MAX_UPLOAD_BYTES,
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
import { type GalleryUploadProgress } from "../gallery/resumable-upload";
import { GallerySubmissionError, submitGalleryOriginal } from "../gallery/submission-operation.ts";
import { GALLERY_UUID, GalleryImageError } from "../../../../packages/gallery-media/policy.ts";

class GalleryUploadError extends Error {}


function fieldLabel(key: string) {
  return key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function validateGalleryFile(file: File | null | undefined) {
  if (!file) throw new GalleryUploadError("Choose an image file before uploading.");
  if (file.size <= 0) throw new GalleryUploadError("The selected file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new GalleryUploadError("Images must be 50 MiB or smaller.");
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
    const row = {
      original_filename: validFile.name.slice(0, 255) || "gallery-image",
      ...cleanMetadata,
      instagram_opt_in: metadata.instagramOptIn === true,
      instagram_opt_in_copy_version: metadata.instagramOptIn === true ? INSTAGRAM_WEBSITE_OPT_IN_COPY_VERSION : null,
    };
    const submission = await submitGalleryOriginal({ client, file: validFile, userId: user.id,
      uploadId, mimeType: inspected.mimeType, supabaseUrl: SUPABASE_URL, metadata: row,
      signal: options.signal, onProgress: options.onProgress });

    return okResult(
      {
        submission: submission as GallerySubmission,
      },
      "Image submitted for moderation.",
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return failedResult("Upload cancelled. No image was published.");
    if (error instanceof GalleryUploadError) return failedResult(error.message);
    if (error instanceof GallerySubmissionError) {
      const messages: Record<string, string> = {
        upload_daily_limit: "You have reached today's Gallery upload limit. Try again tomorrow (UTC+8).",
        upload_pending_limit: "You already have five images awaiting review. Please wait for moderation.",
        upload_storage_limit: "Your unreviewed Gallery uploads have reached their storage allowance.",
        upload_project_limit: "Gallery upload storage is temporarily full. Please contact a leader.",
        upload_access_denied: "Active member access could not be verified. Sign in again before uploading.",
        upload_account_changed: "Your account changed. Choose the image again after signing in.",
        upload_conflict: "This upload does not match the reserved image. Choose the image again.",
      };
      return failedResult(messages[error.code] || "The submission could not be confirmed. Retry with the same image; its original has been preserved.");
    }
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
