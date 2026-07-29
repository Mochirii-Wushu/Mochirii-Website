import { invokeEdgeFunction } from "./client";
import { getCurrentSession } from "./auth";
import {
  failedResult,
  okResult,
  type FacebookPageApiStatus,
  type FacebookPageReconciliationResolution,
  type FacebookPageReconciliationResult,
  type FacebookPagePublishJobStatus,
  type FacebookPagePublishQueue,
  type GalleryReviewQueue,
  type InstagramApiStatus,
  type InstagramPublishQueue,
  type InstagramPublishJob,
  type InstagramReconciliationResolution,
  type InstagramReconciliationResult,
  type MemberVerificationReviewResponse,
  type ModerateGallerySubmissionResponse,
  type ModerationStatus,
  type RejectedGalleryCleanupResponse,
} from "./types";
import type { GalleryModerationMedia } from "@/lib/gallery-thumbnail";
import { fetchGalleryModerationPreview } from "@/lib/gallery/moderation-preview-client";
import { normalizeFacebookPermalink } from "@/lib/gallery/facebook-permalink";
import { normalizeInstagramPostPermalink } from "@/lib/gallery/instagram-action-confirmation";

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
    const items = Array.isArray(result.data.items) ? result.data.items : [];
    result.data = { ...result.data, jobs: items };
  }
  return result;
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
  if (
    resolution === "confirmed_published" &&
    (!/^\d{5,255}$/.test(cleanMediaId) || !cleanPermalink)
  ) {
    return failedResult<InstagramReconciliationResult>(
      "A confirmed publication requires its numeric media ID and canonical official post or reel permalink.",
    );
  }
  if (resolution === "confirmed_not_published" && (cleanMediaId || rawPermalink)) {
    return failedResult<InstagramReconciliationResult>(
      "Do not attach publication identifiers when confirming that no post exists.",
    );
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
  const pageSize = Number.isSafeInteger(options.pageSize) &&
      Number(options.pageSize) >= 1 &&
      Number(options.pageSize) <= 50
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

export async function publishFacebookPageGallerySubmission({
  jobId,
  message,
  confirmPublish,
}: {
  jobId: string;
  message: string;
  confirmPublish: boolean;
}) {
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) return failedResult("Choose a Facebook Page publishing job before publishing.");
  if (!confirmPublish) return failedResult("Confirm Facebook Page publishing before posting.");

  return invokeEdgeFunction<{
    jobId?: string;
    submissionId?: string;
    status?: FacebookPagePublishJobStatus | string;
    facebookPhotoId?: string;
    facebookPostId?: string;
    facebookPermalink?: string;
    publishedAt?: string;
    message?: string;
  }>("publish-facebook-page-gallery-submission", {
    job_id: cleanJobId,
    message: String(message || "").trim().slice(0, 5000),
    confirm_facebook_publish: confirmPublish,
  });
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
  const cleanResolution = String(resolution || "").trim().toLowerCase();
  const cleanNote = String(note || "").trim().slice(0, 500);
  const cleanPhotoId = String(facebookPhotoId || "").trim().slice(0, 255);
  const cleanPostId = String(facebookPostId || "").trim().slice(0, 255);
  const rawPermalink = String(facebookPermalink || "").trim().slice(0, 1000);
  const cleanPermalink = rawPermalink
    ? normalizeFacebookPermalink(rawPermalink)
    : null;

  if (!cleanJobId) {
    return failedResult("Choose a Facebook Page reconciliation job before continuing.");
  }
  if (!["confirmed_published", "confirmed_not_published"].includes(cleanResolution)) {
    return failedResult("Choose whether the Facebook Page post was published or not published.");
  }
  if (!cleanNote) {
    return failedResult("Record what you inspected on the Facebook Page.");
  }
  if (cleanResolution === "confirmed_published" && !cleanPhotoId && !cleanPostId) {
    return failedResult("A Facebook photo or post id is required to confirm publication.");
  }
  if (
    cleanResolution === "confirmed_not_published" &&
    (cleanPhotoId || cleanPostId || rawPermalink)
  ) {
    return failedResult(
      "Remove every Facebook photo id, post id, and permalink when no Page post exists.",
    );
  }
  if (rawPermalink && !cleanPermalink) {
    return failedResult(
      "Use a canonical HTTPS facebook.com post permalink without credentials or a fragment.",
    );
  }
  if (!confirmReconciliation) {
    return failedResult("Confirm the Facebook Page inspection result before resolving this job.");
  }

  return invokeEdgeFunction<FacebookPageReconciliationResult>(
    "resolve-facebook-page-publish-reconciliation",
    {
      job_id: cleanJobId,
      resolution: cleanResolution,
      note: cleanNote,
      facebook_photo_id: cleanPhotoId,
      facebook_post_id: cleanPostId,
      facebook_permalink: cleanPermalink || "",
      confirm_reconciliation: true,
    },
  );
}
