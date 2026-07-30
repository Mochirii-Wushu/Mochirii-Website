import { invokeEdgeFunction } from "./client";
import { getCurrentSession } from "./auth";
import {
  failedResult,
  okResult,
  type FacebookPageApiStatus,
  type FacebookPagePublishQueue,
  type FacebookPageReconciliationResolution,
  type FacebookPageReconciliationResult,
  type GalleryReviewQueue,
  type InstagramApiStatus,
  type InstagramPublishQueue,
  type InstagramReconciliationResolution,
  type InstagramReconciliationResult,
  type MemberVerificationReviewResponse,
  type ModerateGallerySubmissionResponse,
  type ModerationStatus,
  type RejectedGalleryCleanupResponse,
} from "./types";
import type { GalleryModerationMedia } from "@/lib/gallery-thumbnail";
import { fetchGalleryModerationPreview } from "@/lib/gallery/moderation-preview-client";
import {
  normalizeFacebookPermalink,
} from "@/lib/gallery/facebook-action-confirmation";
import { normalizeInstagramPostPermalink } from "@/lib/gallery/instagram-action-confirmation";
import type {
  FacebookPagePublicationRequest,
  InstagramPublicationRequest,
} from "@/lib/gallery/social-publication-request";
import { socialPublicationFingerprintLooksValid } from "@/lib/gallery/social-publication-confirmation";

export async function checkLeaderGalleryModerationAccess() {
  return invokeEdgeFunction<{ hasAccess?: boolean; moderatorId?: string }>("list-gallery-review-queue", {
    checkOnly: true,
  });
}

export async function listGalleryReviewQueue(options: {
  status?: ModerationStatus | string;
  page?: number;
  pageSize?: number;
  thumbnailState?: "all" | "missing" | "ready";
} = {}) {
  const status = String(options.status || "pending").trim().toLowerCase() || "pending";
  return invokeEdgeFunction<GalleryReviewQueue>("list-gallery-review-queue", {
    status,
    page: options.page || 1,
    page_size: options.pageSize || 25,
    thumbnail_state: options.thumbnailState || "all",
  });
}

export async function prepareGalleryReviewPreview(
  submissionId: string,
  expectedUpdatedAt: string,
  options: { signal?: AbortSignal } = {},
) {
  const cleanSubmissionId = String(submissionId || "").trim();
  const cleanExpectedUpdatedAt = String(expectedUpdatedAt || "").trim();
  if (!cleanSubmissionId || !cleanExpectedUpdatedAt) {
    return failedResult("Refresh the moderation queue before preparing this preview.");
  }
  const sessionResult = await getCurrentSession();
  const accessToken = sessionResult.data?.session?.access_token || "";
  if (!sessionResult.ok || !accessToken) {
    return failedResult("Sign in again before preparing this private preview.");
  }
  const preview = await fetchGalleryModerationPreview({
    accessToken,
    expectedUpdatedAt: cleanExpectedUpdatedAt,
    signal: options.signal,
    submissionId: cleanSubmissionId,
  });
  return preview
    ? okResult(preview, "Prepared private Gallery preview.")
    : failedResult("The private Gallery preview could not be prepared.");
}

export async function moderateGallerySubmission(
  submissionId: string,
  action: string,
  reason = "",
  publicationMedia: GalleryModerationMedia | null = null,
  expectedUpdatedAt = "",
) {
  const cleanSubmissionId = String(submissionId || "").trim();
  const cleanAction = String(action || "").trim().toLowerCase();
  if (!["approved", "rejected", "thumbnail"].includes(cleanAction)) {
    return failedResult("Moderation action must be approved, rejected, or thumbnail.");
  }
  if (!cleanSubmissionId) {
    return failedResult("Choose a gallery submission before moderating.");
  }
  const cleanExpectedUpdatedAt = String(expectedUpdatedAt || "").trim();
  if (!cleanExpectedUpdatedAt || !Number.isFinite(Date.parse(cleanExpectedUpdatedAt))) {
    return failedResult("Refresh the moderation queue before reviewing this submission.");
  }

  return invokeEdgeFunction<ModerateGallerySubmissionResponse>("moderate-gallery-submission", {
    submission_id: cleanSubmissionId,
    action: cleanAction,
    reason: String(reason || "").trim().slice(0, 500),
    expected_updated_at: cleanExpectedUpdatedAt,
    display: publicationMedia?.display || null,
    thumbnail: publicationMedia?.thumbnail || null,
  });
}

export async function deleteRejectedGallerySubmission(submissionId: string, confirmCleanup: boolean) {
  const cleanSubmissionId = String(submissionId || "").trim();
  if (!cleanSubmissionId) {
    return failedResult("Choose a rejected gallery submission before cleanup.");
  }
  if (!confirmCleanup) {
    return failedResult("Confirm rejected submission cleanup before deleting.");
  }

  return invokeEdgeFunction<RejectedGalleryCleanupResponse>("delete-rejected-gallery-submission", {
    submission_id: cleanSubmissionId,
    confirm_cleanup: true,
  });
}

export async function reviewMemberVerification({
  userId,
  action,
  method = "manual_review",
  reason = "",
  expiresAt = "",
}: {
  userId: string;
  action: "approve" | "reject" | "revoke";
  method?: string;
  reason?: string;
  expiresAt?: string;
}) {
  const cleanUserId = String(userId || "").trim();
  const cleanAction = String(action || "").trim().toLowerCase();
  if (!cleanUserId) return failedResult("Choose a member before reviewing verification.");
  if (!["approve", "reject", "revoke"].includes(cleanAction)) {
    return failedResult("Review action must be approve, reject, or revoke.");
  }

  return invokeEdgeFunction<MemberVerificationReviewResponse>("review-member-verification", {
    user_id: cleanUserId,
    action: cleanAction,
    method: String(method || "manual_review").trim().toLowerCase(),
    reason: String(reason || "").trim().slice(0, 500),
    expires_at: String(expiresAt || "").trim(),
  });
}

export async function listInstagramPublishQueue(options: {
  status?: string;
  cursor?: string;
  limit?: number;
} = {}) {
  const status = String(options.status || "queued").trim().toLowerCase() || "queued";
  const cursor = String(options.cursor || "").trim();
  const limit = Number.isSafeInteger(options.limit) && Number(options.limit) >= 1 && Number(options.limit) <= 50
    ? Number(options.limit)
    : 25;
  const result = await invokeEdgeFunction<InstagramPublishQueue>("list-instagram-publish-queue", {
    status,
    cursor: cursor || undefined,
    limit,
  });
  if (result.data) {
    const jobs = Array.isArray(result.data.items) ? result.data.items : [];
    result.data = { ...result.data, jobs };
  }
  return result;
}

export async function checkInstagramApiStatus() {
  return invokeEdgeFunction<InstagramApiStatus>("check-instagram-api-status", {});
}

export async function publishInstagramGallerySubmission(
  request: InstagramPublicationRequest,
) {
  if (
    request.confirm_instagram_publish !== true || !request.job_id ||
    !request.expected_updated_at || !request.alt_text ||
    !socialPublicationFingerprintLooksValid(request.confirmation_fingerprint)
  ) return failedResult("Refresh the Instagram queue and confirm this exact revision.");
  return invokeEdgeFunction<{
    jobId?: string;
    status?: string;
    instagramMediaId?: string;
    instagramPermalink?: string;
    publishedAt?: string;
  }>("publish-instagram-gallery-submission", request);
}

export async function resolveInstagramPublishReconciliation({
  jobId,
  resolution,
  instagramMediaId = "",
  instagramPermalink = "",
  note,
  confirmReconciliation,
}: {
  jobId: string;
  resolution: InstagramReconciliationResolution;
  instagramMediaId?: string;
  instagramPermalink?: string;
  note: string;
  confirmReconciliation: boolean;
}) {
  const cleanJobId = String(jobId || "").trim();
  const cleanNote = String(note || "").trim().slice(0, 500);
  const cleanMediaId = String(instagramMediaId || "").trim().slice(0, 255);
  const rawPermalink = String(instagramPermalink || "").trim().slice(0, 1000);
  const cleanPermalink = normalizeInstagramPostPermalink(rawPermalink);
  if (!cleanJobId) return failedResult<InstagramReconciliationResult>("Choose an Instagram job before reconciliation.");
  if (!cleanNote) return failedResult<InstagramReconciliationResult>("Record what was inspected on the official Instagram account.");
  if (resolution === "confirmed_published" && (!/^\d{5,255}$/.test(cleanMediaId) || !cleanPermalink)) {
    return failedResult<InstagramReconciliationResult>("A numeric media ID and canonical official post or reel permalink are required.");
  }
  if (resolution === "confirmed_not_published" && (cleanMediaId || rawPermalink)) {
    return failedResult<InstagramReconciliationResult>("Remove publication identifiers when confirming that no post exists.");
  }
  if (!confirmReconciliation) return failedResult<InstagramReconciliationResult>("Confirm the Instagram account inspection result.");
  return invokeEdgeFunction<InstagramReconciliationResult>(
    "resolve-instagram-publish-reconciliation",
    {
      job_id: cleanJobId,
      resolution,
      instagram_media_id: resolution === "confirmed_published" ? cleanMediaId : "",
      instagram_permalink: resolution === "confirmed_published" ? cleanPermalink : "",
      note: cleanNote,
      confirm_reconciliation: true,
    },
  );
}

export async function listFacebookPagePublishQueue(options: {
  status?: string;
  cursor?: string;
  pageSize?: number;
} = {}) {
  const status = String(options.status || "queued").trim().toLowerCase() || "queued";
  const cursor = String(options.cursor || "").trim();
  const pageSize = Number.isSafeInteger(options.pageSize) && Number(options.pageSize) >= 1 && Number(options.pageSize) <= 50
    ? Number(options.pageSize)
    : 25;
  return invokeEdgeFunction<FacebookPagePublishQueue>("list-facebook-page-publish-queue", {
    status,
    cursor: cursor || undefined,
    page_size: pageSize,
  });
}

export async function checkFacebookPageApiStatus() {
  return invokeEdgeFunction<FacebookPageApiStatus>("check-facebook-page-api-status", {});
}

export async function publishFacebookPageGallerySubmission(
  request: FacebookPagePublicationRequest,
) {
  if (
    request.confirm_facebook_publish !== true || !request.job_id ||
    !request.expected_updated_at ||
    !socialPublicationFingerprintLooksValid(request.confirmation_fingerprint)
  ) return failedResult("Refresh the Facebook Page queue and confirm this exact revision.");
  return invokeEdgeFunction<{
    jobId?: string;
    status?: string;
    facebookPhotoId?: string;
    facebookPostId?: string;
    facebookPermalink?: string;
    publishedAt?: string;
  }>("publish-facebook-page-gallery-submission", request);
}

export async function resolveFacebookPagePublishReconciliation({
  jobId,
  resolution,
  note,
  facebookPhotoId = "",
  facebookPostId = "",
  facebookPermalink = "",
  confirmReconciliation,
}: {
  jobId: string;
  resolution: FacebookPageReconciliationResolution;
  note: string;
  facebookPhotoId?: string;
  facebookPostId?: string;
  facebookPermalink?: string;
  confirmReconciliation: boolean;
}) {
  const cleanJobId = String(jobId || "").trim();
  const cleanNote = String(note || "").trim().slice(0, 500);
  const cleanPhotoId = String(facebookPhotoId || "").trim().slice(0, 255);
  const cleanPostId = String(facebookPostId || "").trim().slice(0, 255);
  const rawPermalink = String(facebookPermalink || "").trim().slice(0, 1000);
  const cleanPermalink = rawPermalink ? normalizeFacebookPermalink(rawPermalink) : null;
  if (!cleanJobId) return failedResult<FacebookPageReconciliationResult>("Choose a Facebook Page job before reconciliation.");
  if (!cleanNote) return failedResult<FacebookPageReconciliationResult>("Record what was inspected on the Facebook Page.");
  if (resolution === "confirmed_published" && !cleanPhotoId && !cleanPostId) {
    return failedResult<FacebookPageReconciliationResult>("A Facebook photo or post ID is required.");
  }
  if (resolution === "confirmed_not_published" && (cleanPhotoId || cleanPostId || rawPermalink)) {
    return failedResult<FacebookPageReconciliationResult>("Remove publication identifiers when confirming that no Page post exists.");
  }
  if (rawPermalink && !cleanPermalink) return failedResult<FacebookPageReconciliationResult>("Use a canonical Facebook post permalink.");
  if (!confirmReconciliation) return failedResult<FacebookPageReconciliationResult>("Confirm the Facebook Page inspection result.");
  return invokeEdgeFunction<FacebookPageReconciliationResult>(
    "resolve-facebook-page-publish-reconciliation",
    {
      job_id: cleanJobId,
      resolution,
      note: cleanNote,
      facebook_photo_id: resolution === "confirmed_published" ? cleanPhotoId : "",
      facebook_post_id: resolution === "confirmed_published" ? cleanPostId : "",
      facebook_permalink: resolution === "confirmed_published" ? cleanPermalink || "" : "",
      confirm_reconciliation: true,
    },
  );
}
