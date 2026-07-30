export type GalleryJsonRecord = Record<string, unknown>;

const SAFE_MODERATION_CONFLICTS = new Set([
  "submission_not_found",
  "submission_not_pending",
  "submission_not_approved",
  "submission_revision_conflict",
  "stale_thumbnail_revision",
  "original_object_mismatch",
  "thumbnail_object_mismatch",
]);

function record(value: unknown): GalleryJsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as GalleryJsonRecord
    : {};
}

export function gallerySafeText(
  value: unknown,
  maximumLength: number,
): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximumLength) : null;
}

export function safeGalleryModeratorProfile(
  value: unknown,
): GalleryJsonRecord | null {
  const profile = record(value);
  if (Object.keys(profile).length === 0) return null;

  return {
    displayName: gallerySafeText(profile.discord_global_name, 100) ||
      gallerySafeText(profile.display_name, 40) ||
      gallerySafeText(profile.discord_username, 80) ||
      "Mōchirīī Member",
    discordUsername: gallerySafeText(profile.discord_username, 80),
    discordGlobalName: gallerySafeText(profile.discord_global_name, 100),
  };
}

export function safeGalleryPublishJob(
  value: unknown,
): GalleryJsonRecord | null {
  const job = record(value);
  if (Object.keys(job).length === 0) return null;

  return {
    id: gallerySafeText(job.id, 80),
    submissionId: gallerySafeText(job.submission_id, 80),
    status: gallerySafeText(job.status, 40),
    createdAt: gallerySafeText(job.created_at, 80),
    updatedAt: gallerySafeText(job.updated_at, 80),
  };
}

export function safeInstagramPublishQueueItem(
  value: unknown,
): GalleryJsonRecord {
  const item = record(value);
  return {
    id: item.id,
    status: item.status,
    eligibilityReason: item.eligibilityReason,
    caption: item.caption,
    altText: item.altText,
    instagramMediaId: item.instagramMediaId,
    instagramPermalink: item.instagramPermalink,
    attemptCount: item.attemptCount,
    attemptStartedAt: item.attemptStartedAt,
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    galleryPublicationId: item.galleryPublicationId,
    thumbnailUrl: item.thumbnailUrl,
    previewError: item.previewError,
    submission: item.submission,
    events: item.events,
  };
}

export function safeInstagramPublishResponse(
  jobId: unknown,
  value: unknown,
): GalleryJsonRecord {
  const published = record(value);
  if (published.ok === true) {
    return {
      ok: true,
      data: {
        jobId,
        status: published.status,
        instagramMediaId: published.instagramMediaId,
        instagramPermalink: published.instagramPermalink,
        publishedAt: published.publishedAt,
      },
      message: published.message,
    };
  }

  return {
    ok: false,
    error: published.error || "instagram_publish_failed",
    data: {
      jobId,
      status: published.status,
      attempted: published.attempted,
      instagramMediaId: published.instagramMediaId,
      instagramPermalink: published.instagramPermalink,
    },
    message: published.message,
  };
}

export function safeGalleryModerationSubmission(
  value: unknown,
): GalleryJsonRecord {
  const submission = record(value);
  return {
    id: gallerySafeText(submission.id, 80),
    status: gallerySafeText(submission.status, 20),
    title: gallerySafeText(submission.title, 80),
    caption: gallerySafeText(submission.caption, 300),
    category: gallerySafeText(submission.category, 40),
    rejectionReason: gallerySafeText(submission.rejection_reason, 500),
    createdAt: gallerySafeText(submission.created_at, 80),
    reviewedAt: gallerySafeText(submission.reviewed_at, 80),
    updatedAt: gallerySafeText(submission.updated_at, 80),
    publicationReady: Boolean(
      gallerySafeText(submission.gallery_publication_id, 80),
    ),
    instagramOptIn: submission.instagram_opt_in === true,
    facebookPageOptIn: submission.facebook_page_opt_in === true,
  };
}

export function safeGalleryModerationConflict(value: unknown): string {
  const code = gallerySafeText(value, 80);
  return code && SAFE_MODERATION_CONFLICTS.has(code)
    ? code
    : "moderation_conflict";
}
