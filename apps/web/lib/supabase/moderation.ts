import { invokeEdgeFunction } from "./client";
import { getCurrentSession } from "./auth";
import {
  failedResult,
  okResult,
  type GalleryReviewQueue,
  type InstagramApiStatus,
  type InstagramPublishQueue,
  type InstagramPublishJob,
  type MemberVerificationReviewResponse,
  type ModerationStatus,
  type RejectedGalleryCleanupResponse,
} from "./types";
import type { GalleryModerationMedia } from "@/lib/gallery-thumbnail";
import { fetchGalleryModerationPreview } from "@/lib/gallery/moderation-preview-client";

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

  return invokeEdgeFunction("moderate-gallery-submission", {
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

export async function listInstagramPublishQueue(options: { status?: string } = {}) {
  const status = String(options.status || "queued").trim().toLowerCase() || "queued";
  return invokeEdgeFunction<InstagramPublishQueue>("list-instagram-publish-queue", { status });
}

export async function checkInstagramApiStatus() {
  return invokeEdgeFunction<InstagramApiStatus>("check-instagram-api-status", {});
}

export async function publishInstagramGallerySubmission({
  jobId,
  caption,
  altText,
  confirmPublish,
}: {
  jobId: string;
  caption: string;
  altText?: string;
  confirmPublish: boolean;
}) {
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) return failedResult("Choose an Instagram publishing job before publishing.");
  if (!confirmPublish) return failedResult("Confirm Instagram publishing before posting.");

  return invokeEdgeFunction<{ job?: InstagramPublishJob; instagramMediaId?: string; instagramPermalink?: string; publishedAt?: string }>(
    "publish-instagram-gallery-submission",
    {
      job_id: cleanJobId,
      caption: String(caption || "").trim().slice(0, 2200),
      alt_text: String(altText || "").trim().slice(0, 1000),
      confirmPublish,
    },
  );
}

export async function markInstagramGallerySubmissionShared({
  jobId,
  instagramPermalink = "",
  moderatorNote = "",
  confirmManualShare,
}: {
  jobId: string;
  instagramPermalink?: string;
  moderatorNote?: string;
  confirmManualShare: boolean;
}) {
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) return failedResult("Choose an Instagram publishing job before marking it shared.");
  if (!confirmManualShare) return failedResult("Confirm manual Instagram sharing before marking the job shared.");

  return invokeEdgeFunction<{ job?: InstagramPublishJob; instagramPermalink?: string | null; sharedAt?: string }>(
    "mark-instagram-gallery-submission-shared",
    {
      job_id: cleanJobId,
      instagram_permalink: String(instagramPermalink || "").trim().slice(0, 500),
      moderator_note: String(moderatorNote || "").trim().slice(0, 500),
      confirmManualShare,
    },
  );
}
