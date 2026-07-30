import { invokeEdgeFunction, requireBrowserSupabaseClient } from "./client";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  MEMBER_GALLERY_BUCKET,
  SUBMISSION_FIELDS,
} from "./config";
import { buildGallerySocialWithdrawalRequest } from "@/lib/gallery/social-consent-withdrawal";
import { requireAuth } from "./auth";
import { requireActiveMember } from "./profile";
import {
  createError,
  createResult,
  failedResult,
  okResult,
  type GallerySubmission,
  type GallerySocialDestination,
  type GallerySocialWithdrawalResponse,
  type GallerySocialWithdrawalStatus,
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
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Images must be 8 MiB or smaller.");
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
    const client = requireBrowserSupabaseClient();
    validateGalleryFile(file);
    const validFile = file as File;
    const socialOptIn = metadata.instagramOptIn === true || metadata.facebookPageOptIn === true;
    if (metadata.uploadRightsConfirmed !== true) {
      throw new Error("Confirm that you own or may submit this image and have permission involving identifiable people.");
    }
    if (socialOptIn && validFile.type.toLowerCase() !== "image/jpeg") {
      throw new Error("Instagram or Facebook Page publishing requires a JPEG. Uncheck both destinations to submit a PNG or WebP image to the Gallery only.");
    }

    const access = await requireActiveMember({ refresh: true });
    if (!access.ok || !access.data?.user) return access;

    const user = access.data.user;
    const cleanMetadata = cleanSubmissionMetadata(metadata);
    const storagePath = buildStoragePath(user.id, validFile);
    const { error: uploadError } = await client.storage
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
      upload_rights_confirmed: true,
      instagram_opt_in: metadata.instagramOptIn === true,
      facebook_page_opt_in: metadata.facebookPageOptIn === true,
    };

    const { data: submission, error: insertError } = await client
      .from("gallery_submissions")
      .insert(row)
      .select("id,original_filename,mime_type,size_bytes,title,caption,category,status,rejection_reason,reviewed_at,created_at,updated_at,submission_source,instagram_opt_in,facebook_page_opt_in,upload_rights_confirmed")
      .single();

    if (insertError) {
      await client.storage.from(MEMBER_GALLERY_BUCKET).remove([storagePath]).catch(() => {});
      return failedResult(insertError);
    }

    return okResult(
      {
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
    const client = requireBrowserSupabaseClient();
    const auth = await requireAuth();
    if (!auth.ok || !auth.data?.user) return auth;

    const { data, error, status, statusText } = await client
      .from("gallery_submissions")
      .select("id,original_filename,mime_type,size_bytes,title,caption,category,status,rejection_reason,reviewed_at,created_at,updated_at,submission_source,instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version,instagram_opt_in_contract_version,instagram_consent_version,facebook_page_opt_in,facebook_page_opt_in_at,facebook_page_opt_in_source,facebook_page_opt_in_copy_version,facebook_page_opt_in_contract_version,facebook_page_consent_version,upload_rights_confirmed")
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

    const submissions = (Array.isArray(data) ? data : []) as GallerySubmission[];
    const submissionIds = submissions.map((submission) => submission.id).filter(Boolean);
    if (!submissionIds.length) return okResult(submissions);

    const { data: withdrawalData, error: withdrawalError } = await client
      .from("gallery_social_withdrawal_status")
      .select("submission_id,destination,state,external_removal_required,requested_at,updated_at")
      .in("submission_id", submissionIds);
    if (withdrawalError) return failedResult<GallerySubmission[]>(withdrawalError);

    const withdrawalsBySubmission = new Map<string, GallerySocialWithdrawalStatus[]>();
    for (const status of (Array.isArray(withdrawalData) ? withdrawalData : []) as GallerySocialWithdrawalStatus[]) {
      const current = withdrawalsBySubmission.get(status.submission_id) || [];
      current.push(status);
      withdrawalsBySubmission.set(status.submission_id, current);
    }
    return okResult(submissions.map((submission) => ({
      ...submission,
      social_withdrawals: withdrawalsBySubmission.get(submission.id) || [],
    })));
  } catch (error) {
    return failedResult<GallerySubmission[]>(error);
  }
}

export async function withdrawGalleryPublicationConsent(
  submissionId: string,
  destination: GallerySocialDestination,
) {
  try {
    const body = buildGallerySocialWithdrawalRequest(submissionId, destination);
    return invokeEdgeFunction<GallerySocialWithdrawalResponse>(
      "withdraw-gallery-publication-consent",
      body,
    );
  } catch (error) {
    return failedResult<GallerySocialWithdrawalResponse>(error);
  }
}
