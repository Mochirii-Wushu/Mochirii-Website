import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  CORS_HEADERS,
  type JsonRecord,
  jsonResponse,
  readOptionalJsonBody,
  requireModeratorAccess,
  safeString,
} from "../_shared/gallery-moderation.ts";
import { GALLERY_UUID } from "../../../packages/gallery-media/policy.ts";

const SIGNED_URL_SECONDS = 10 * 60;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const EVENT_LIMIT = 250;
const MEMBER_GALLERY_BUCKET = "member-gallery";
const VALID_STATUSES = new Set(["pending", "approved", "rejected", "archived"]);
const VALID_THUMBNAIL_STATES = new Set(["all", "missing", "ready"]);

function normalizeStatus(value: unknown): string {
  const status = safeString(value, 20)?.toLowerCase() || "pending";
  return VALID_STATUSES.has(status) ? status : "pending";
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeThumbnailState(value: unknown): string {
  const state = safeString(value, 20)?.toLowerCase() || "all";
  return VALID_THUMBNAIL_STATES.has(state) ? state : "all";
}

function emptySummary(status: string) {
  return {
    status,
    pending: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
    missingThumbnails: 0,
    total: 0,
    shown: 0,
  };
}

function displayName(profile: JsonRecord | null | undefined): string {
  return (
    safeString(profile?.discord_global_name, 100) ||
    safeString(profile?.display_name, 40) ||
    safeString(profile?.discord_username, 80) ||
    "Mochirii Member"
  );
}

function profileSummary(profile: JsonRecord | null | undefined): JsonRecord | null {
  if (!profile) return null;

  return {
    displayName: displayName(profile),
    discordUsername: safeString(profile.discord_username, 80),
    discordGlobalName: safeString(profile.discord_global_name, 100),
    discordUserId: safeString(profile.discord_user_id, 40),
  };
}

Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const access = await requireModeratorAccess(req);
  if (!access.ok) return access.response;

  const bodyResult = await readOptionalJsonBody(req);
  if (!bodyResult.ok) return bodyResult.response;

  if (bodyResult.body.processingSource !== undefined) {
    const submissionId = safeString(bodyResult.body.processingSource, 80);
    if (!submissionId || !GALLERY_UUID.test(submissionId)) {
      return jsonResponse({ ok: false, message: "Choose a valid gallery submission." }, 400);
    }
    const { data: submission, error } = await access.adminClient.from("gallery_submissions")
      .select("id,user_id,storage_bucket,storage_path,mime_type,size_bytes,status,thumbnail_revision_id,viewer_revision_id")
      .eq("id", submissionId).maybeSingle();
    if (error || !submission || submission.storage_bucket !== MEMBER_GALLERY_BUCKET
      || !["pending", "approved"].includes(String(submission.status))) {
      return jsonResponse({ ok: false, message: "This submission is unavailable. Refresh the queue." }, 409);
    }
    const { data: signed, error: signingError } = await access.adminClient.storage.from(MEMBER_GALLERY_BUCKET)
      .createSignedUrl(String(submission.storage_path), 120);
    if (signingError || !signed?.signedUrl) {
      return jsonResponse({ ok: false, message: "The original image could not be loaded." }, 503);
    }
    return jsonResponse({ ok: true, data: { hasAccess: true, moderatorId: access.userId,
      submission, signedOriginalUrl: signed.signedUrl } });
  }

  if (bodyResult.body.checkOnly === true) {
    return jsonResponse({
      ok: true,
      hasAccess: true,
      data: {
        hasAccess: true,
        moderatorId: access.userId,
      },
      message: "Moderator access verified.",
    });
  }

  const requestedStatus = normalizeStatus(bodyResult.body.status);
  const requestedPage = boundedInteger(bodyResult.body.page, 1, 1, 10000);
  const requestedPageSize = boundedInteger(bodyResult.body.page_size, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const thumbnailState = requestedStatus === "approved"
    ? normalizeThumbnailState(bodyResult.body.thumbnail_state)
    : "all";
  const summary = emptySummary(requestedStatus);
  const countResults = await Promise.all(
    [...VALID_STATUSES].map(async (status) => ({
      status,
      result: await access.adminClient
        .from("gallery_submissions")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    })),
  );

  for (const { status, result } of countResults) {
    if (result.error) {
      console.error("list-gallery-review-queue count lookup failed", {
        status,
        code: result.error.code,
        message: result.error.message,
      });

      return jsonResponse(
        {
          ok: false,
          error: "submission_count_failed",
          message: "Gallery moderation counts could not be loaded.",
        },
        500,
      );
    }

    const count = Number(result.count || 0);
    summary[status as "pending" | "approved" | "rejected" | "archived"] = count;
    summary.total += count;
  }

  const { count: missingThumbnailCount, error: missingThumbnailCountError } = await access.adminClient
    .from("gallery_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .is("thumbnail_revision_id", null);

  if (missingThumbnailCountError) {
    console.error("list-gallery-review-queue thumbnail count failed", {
      code: missingThumbnailCountError.code,
      message: missingThumbnailCountError.message,
    });
    return jsonResponse(
      {
        ok: false,
        error: "thumbnail_count_failed",
        message: "Gallery thumbnail backfill count could not be loaded.",
      },
      500,
    );
  }
  summary.missingThumbnails = Number(missingThumbnailCount || 0);

  let submissionQuery = access.adminClient
    .from("gallery_submissions")
    .select("id,user_id,storage_bucket,storage_path,thumbnail_revision_id,thumbnail_storage_path,thumbnail_mime_type,thumbnail_size_bytes,original_filename,mime_type,size_bytes,title,caption,category,status,rejection_reason,reviewed_by,reviewed_at,created_at,updated_at,submission_source,discord_guild_id,discord_channel_id,discord_message_id,discord_attachment_id,discord_user_id,instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version", { count: "exact" })
    .eq("status", requestedStatus);

  if (thumbnailState === "missing") {
    submissionQuery = submissionQuery.is("thumbnail_revision_id", null);
  } else if (thumbnailState === "ready") {
    submissionQuery = submissionQuery.not("thumbnail_revision_id", "is", null);
  }

  if (requestedStatus === "pending") {
    submissionQuery = submissionQuery.order("created_at", { ascending: true });
  } else {
    submissionQuery = submissionQuery
      .order("reviewed_at", { ascending: false })
      .order("created_at", { ascending: false });
  }

  const pageOffset = (requestedPage - 1) * requestedPageSize;
  submissionQuery = submissionQuery.range(pageOffset, pageOffset + requestedPageSize - 1);

  const { data: submissionData, error: submissionError, count: filteredCount } = await submissionQuery;

  if (submissionError) {
    console.error("list-gallery-review-queue submission lookup failed", {
      code: submissionError.code,
      message: submissionError.message,
    });

    return jsonResponse(
      {
        ok: false,
        error: "submission_lookup_failed",
        message: "Pending gallery submissions could not be loaded.",
      },
      500,
    );
  }

  const submissions = Array.isArray(submissionData) ? submissionData as JsonRecord[] : [];
  const previewPaths = submissions
    .filter((submission) => safeString(submission.storage_bucket, 80) === MEMBER_GALLERY_BUCKET)
    .map((submission) => safeString(submission.storage_path, 1000))
    .filter((value): value is string => Boolean(value));
  const signedPreviewsByPath = new Map<string, string>();

  if (previewPaths.length > 0) {
    const { data: signedPreviewData, error: signedPreviewError } = await access.adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .createSignedUrls(previewPaths, SIGNED_URL_SECONDS);

    if (signedPreviewError) {
      console.warn("list-gallery-review-queue preview signing batch failed", {
        message: signedPreviewError.message,
      });
    } else {
      for (const signed of signedPreviewData || []) {
        const path = safeString(signed.path, 1000);
        const signedUrl = safeString(signed.signedUrl, 4000);
        if (path && signedUrl) signedPreviewsByPath.set(path, signedUrl);
      }
    }
  }
  const submissionIds = [
    ...new Set(
      submissions
        .map((submission) => safeString(submission.id, 80))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const eventsBySubmissionId = new Map<string, JsonRecord[]>();
  const moderationEvents: JsonRecord[] = [];

  if (submissionIds.length > 0) {
    const { data: eventData, error: eventError } = await access.adminClient
      .from("gallery_moderation_events")
      .select("id,submission_id,moderator_id,action,reason,created_at")
      .in("submission_id", submissionIds)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    if (eventError) {
      console.error("list-gallery-review-queue event lookup failed", {
        code: eventError.code,
        message: eventError.message,
      });

      return jsonResponse(
        {
          ok: false,
          error: "moderation_event_lookup_failed",
          message: "Moderation event history could not be loaded.",
        },
        500,
      );
    }

    moderationEvents.push(...(Array.isArray(eventData) ? eventData as JsonRecord[] : []));
    moderationEvents.forEach((event) => {
      const submissionId = safeString(event.submission_id, 80);
      if (!submissionId) return;
      const current = eventsBySubmissionId.get(submissionId) || [];
      current.push(event);
      eventsBySubmissionId.set(submissionId, current);
    });
  }

  const userIds = [
    ...new Set(
      [
        ...submissions.map((submission) => safeString(submission.user_id, 80)),
        ...submissions.map((submission) => safeString(submission.reviewed_by, 80)),
        ...moderationEvents.map((event) => safeString(event.moderator_id, 80)),
      ]
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const profilesById = new Map<string, JsonRecord>();

  if (userIds.length > 0) {
    const { data: profileData, error: profileError } = await access.adminClient
      .from("member_profiles")
      .select("id,display_name,discord_username,discord_global_name,discord_user_id")
      .in("id", userIds);

    if (profileError) {
      console.error("list-gallery-review-queue profile lookup failed", {
        code: profileError.code,
        message: profileError.message,
      });

      return jsonResponse(
        {
          ok: false,
          error: "profile_lookup_failed",
          message: "Uploader profile details could not be loaded.",
        },
        500,
      );
    }

    (Array.isArray(profileData) ? profileData as JsonRecord[] : []).forEach((profile) => {
      const id = safeString(profile.id, 80);
      if (id) profilesById.set(id, profile);
    });
  }

  const queue = [];

  for (const submission of submissions) {
    const bucket = safeString(submission.storage_bucket, 80) || MEMBER_GALLERY_BUCKET;
    const storagePath = safeString(submission.storage_path, 1000);
    const submissionId = safeString(submission.id, 80);
    let signedPreviewUrl: string | null = null;
    let previewError: string | null = null;

    if (bucket !== MEMBER_GALLERY_BUCKET || !storagePath) {
      console.warn("list-gallery-review-queue skipped invalid storage reference", {
        submissionId,
        bucket,
        hasStoragePath: Boolean(storagePath),
      });
      previewError = "invalid_storage_reference";
    } else {
      signedPreviewUrl = signedPreviewsByPath.get(storagePath) || null;
      if (!signedPreviewUrl) previewError = "preview_unavailable";
    }

    const userId = safeString(submission.user_id, 80) || "";
    const profile = profilesById.get(userId) || {};
    const reviewerId = safeString(submission.reviewed_by, 80);
    const reviewer = reviewerId ? profilesById.get(reviewerId) || null : null;
    const events = (eventsBySubmissionId.get(submissionId || "") || []).map((event) => {
      const moderatorId = safeString(event.moderator_id, 80);
      return {
        id: safeString(event.id, 80),
        action: safeString(event.action, 20),
        reason: safeString(event.reason, 500),
        createdAt: safeString(event.created_at, 80),
        moderator: moderatorId ? profileSummary(profilesById.get(moderatorId) || null) : null,
      };
    });

    queue.push({
      id: submissionId,
      status: safeString(submission.status, 20) || requestedStatus,
      source: safeString(submission.submission_source, 40) || "website",
      discord: {
        guildId: safeString(submission.discord_guild_id, 40),
        channelId: safeString(submission.discord_channel_id, 40),
        messageId: safeString(submission.discord_message_id, 40),
        attachmentId: safeString(submission.discord_attachment_id, 40),
        userId: safeString(submission.discord_user_id, 40),
      },
      uploader: {
        displayName: displayName(profile),
        discordUsername: safeString(profile.discord_username, 80),
        discordGlobalName: safeString(profile.discord_global_name, 100),
        discordUserId: safeString(profile.discord_user_id, 40),
      },
      reviewer: profileSummary(reviewer),
      title: safeString(submission.title, 80),
      caption: safeString(submission.caption, 300),
      category: safeString(submission.category, 40),
      originalFilename: safeString(submission.original_filename, 255),
      mimeType: safeString(submission.mime_type, 80),
      sizeBytes: Number(submission.size_bytes || 0),
      createdAt: safeString(submission.created_at, 80),
      reviewedAt: safeString(submission.reviewed_at, 80),
      updatedAt: safeString(submission.updated_at, 80),
      rejectionReason: safeString(submission.rejection_reason, 500),
      storageBucket: bucket,
      storagePath,
      thumbnailRevisionId: safeString(submission.thumbnail_revision_id, 80),
      thumbnailStoragePath: safeString(submission.thumbnail_storage_path, 1000),
      thumbnailMimeType: safeString(submission.thumbnail_mime_type, 80),
      thumbnailSizeBytes: Number(submission.thumbnail_size_bytes || 0) || null,
      signedPreviewUrl,
      previewError,
      instagramOptIn: submission.instagram_opt_in === true,
      instagramOptInAt: safeString(submission.instagram_opt_in_at, 80),
      instagramOptInSource: safeString(submission.instagram_opt_in_source, 80),
      instagramOptInCopyVersion: safeString(submission.instagram_opt_in_copy_version, 80),
      moderationEvents: events,
    });
  }

  summary.shown = queue.length;

  return jsonResponse({
    ok: true,
    data: {
      submissions: queue,
      count: queue.length,
      status: requestedStatus,
      thumbnailState,
      summary,
      pagination: {
        page: requestedPage,
        pageSize: requestedPageSize,
        total: Number(filteredCount || 0),
        totalPages: Math.ceil(Number(filteredCount || 0) / requestedPageSize),
        hasPrevious: requestedPage > 1,
        hasNext: pageOffset + queue.length < Number(filteredCount || 0),
      },
      signedUrlSeconds: SIGNED_URL_SECONDS,
    },
    message: queue.length
      ? `${requestedStatus} gallery submissions loaded.`
      : `No ${requestedStatus} gallery submissions.`,
  });
}
