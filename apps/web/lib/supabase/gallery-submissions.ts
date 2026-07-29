import { requireReadyBrowserSupabaseClient } from "./client";
import {
  ACCEPTED_IMAGE_TYPES,
  INSTAGRAM_WEBSITE_OPT_IN_COPY_VERSION,
  MAX_GALLERY_SOURCE_EDGE,
  MAX_GALLERY_SOURCE_PIXELS,
  MAX_UPLOAD_BYTES,
  MEMBER_GALLERY_BUCKET,
  SUBMISSION_FIELDS,
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

const acceptedTypes = new Set<string>(ACCEPTED_IMAGE_TYPES);

function fieldLabel(key: string) {
  return key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function extensionFromFile(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["jpg", "jpeg", "png", "webp"].includes(fromName)) return fromName === "jpg" ? "jpeg" : fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpeg";
}

function safeFilenamePart(name: string) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return base || "gallery-image";
}

function buildStoragePath(userId: string, file: File) {
  const randomPart =
    typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  const filename = `${Date.now()}-${randomPart}-${safeFilenamePart(file.name)}.${extensionFromFile(file)}`;
  return `${userId}/${filename}`;
}

export function validateGalleryFile(file: File | null | undefined) {
  if (!file) throw new Error("Choose an image file before uploading.");
  if (!acceptedTypes.has(file.type)) throw new Error("Upload a JPEG, PNG, or WebP image.");
  if (file.size <= 0) throw new Error("The selected file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Images must be 8 MB or smaller.");
}

async function validateGalleryFileDimensions(file: File) {
  if (typeof createImageBitmap !== "function") return;
  const image = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (
      image.width < 1 || image.height < 1 ||
      image.width > MAX_GALLERY_SOURCE_EDGE ||
      image.height > MAX_GALLERY_SOURCE_EDGE ||
      image.width * image.height > MAX_GALLERY_SOURCE_PIXELS
    ) {
      throw new Error("Images must be no larger than 4096 pixels per edge and 12.6 megapixels.");
    }
  } finally {
    image.close();
  }
}

export function cleanSubmissionMetadata(metadata: GallerySubmissionMetadata = {}) {
  const clean: Record<string, string> = {};

  Object.entries(SUBMISSION_FIELDS).forEach(([key, max]) => {
    const value = String(metadata[key as keyof GallerySubmissionMetadata] ?? "").trim();
    if (!value) return;
    if (value.length > max) throw new Error(`${fieldLabel(key)} must be ${max} characters or fewer.`);
    clean[key] = value;
  });

  return clean as Pick<GallerySubmissionMetadata, keyof typeof SUBMISSION_FIELDS>;
}

export async function uploadMemberGalleryImage(file: File | null | undefined, metadata: GallerySubmissionMetadata = {}) {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    validateGalleryFile(file);
    const validFile = file as File;
    await validateGalleryFileDimensions(validFile);

    const access = await requireActiveMember({ refresh: true });
    if (!access.ok || !access.data?.user) return access;

    const user = access.data.user;
    const cleanMetadata = cleanSubmissionMetadata(metadata);
    const storagePath = buildStoragePath(user.id, validFile);
    const { data: uploadData, error: uploadError } = await client.storage
      .from(MEMBER_GALLERY_BUCKET)
      .upload(storagePath, validFile, {
        cacheControl: "3600",
        contentType: validFile.type,
        upsert: false,
      });

    if (uploadError) return failedResult(uploadError);

    const row = {
      user_id: user.id,
      storage_bucket: MEMBER_GALLERY_BUCKET,
      storage_path: storagePath,
      original_filename: validFile.name.slice(0, 255) || "gallery-image",
      mime_type: validFile.type,
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
      await client.storage.from(MEMBER_GALLERY_BUCKET).remove([storagePath]).catch(() => {});
      return failedResult(insertError, { upload: uploadData, storagePath });
    }

    return okResult(
      {
        upload: uploadData,
        submission: submission as GallerySubmission,
      },
      "Image submitted for moderation.",
    );
  } catch (error) {
    return failedResult(error);
  }
}

export async function listMyGallerySubmissions() {
  try {
    const client = await requireReadyBrowserSupabaseClient();
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
