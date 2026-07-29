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
import {
  decodeFacebookPageQueueCursor,
  encodeFacebookPageQueueCursor,
  FACEBOOK_PAGE_QUEUE_STATUSES,
  parseFacebookPageQueuePageSize,
  parseFacebookPageQueueStatus,
} from "../_shared/facebook-page-queue-pagination.ts";
import { normalizeFacebookPermalink } from "../_shared/facebook-page-publishing.ts";

const EVENT_LIMIT = 250;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set<string>(FACEBOOK_PAGE_QUEUE_STATUSES);

function displayName(profile: JsonRecord | null | undefined): string {
  return safeString(profile?.discord_global_name, 100) ||
    safeString(profile?.display_name, 40) ||
    safeString(profile?.discord_username, 80) ||
    "Mochirii Member";
}

function profileSummary(
  profile: JsonRecord | null | undefined,
): JsonRecord | null {
  if (!profile) return null;
  return {
    displayName: displayName(profile),
    discordUsername: safeString(profile.discord_username, 80),
    discordGlobalName: safeString(profile.discord_global_name, 100),
    discordUserId: safeString(profile.discord_user_id, 40),
  };
}

function approvedThumbnailUrl(publicationId: string): string | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!UUID_RE.test(publicationId) || !supabaseUrl) return null;

  try {
    const url = new URL(
      "/functions/v1/list-approved-gallery-submissions",
      supabaseUrl,
    );
    url.searchParams.set("asset", "thumbnail");
    url.searchParams.set("id", publicationId);
    return url.toString();
  } catch {
    return null;
  }
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

  const requestedStatus = parseFacebookPageQueueStatus(bodyResult.body.status);
  const pageSize = parseFacebookPageQueuePageSize(bodyResult.body.page_size);
  if (!requestedStatus || !pageSize) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_facebook_page_queue_request",
        message: "Choose a valid Facebook Page queue status and page size.",
      },
      400,
    );
  }
  let cursor;
  try {
    cursor = decodeFacebookPageQueueCursor(
      bodyResult.body.cursor,
      requestedStatus,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_facebook_page_queue_cursor",
        message: "Refresh the Facebook Page queue before changing pages.",
      },
      400,
    );
  }

  const { data: quarantineData, error: quarantineError } = await access
    .adminClient.rpc("gallery_facebook_page_quarantine_stale_publish_jobs");
  const quarantine = quarantineData && typeof quarantineData === "object" &&
      !Array.isArray(quarantineData)
    ? quarantineData as JsonRecord
    : null;
  if (quarantineError || quarantine?.committed !== true) {
    console.error("list-facebook-page-publish-queue quarantine failed", {
      code: quarantineError?.code || "invalid_quarantine_response",
      message: quarantineError?.message || "Invalid quarantine response",
    });
    return jsonResponse(
      {
        ok: false,
        error: "facebook_page_stale_publish_quarantine_failed",
        message:
          "Stale Facebook Page publishing attempts could not be checked.",
      },
      500,
    );
  }
  const quarantinedStaleCount = Number(quarantine.quarantined_count || 0);
  const summary: Record<string, number | string> = {
    status: requestedStatus,
    total: 0,
    shown: 0,
    stalePublishingQuarantined: Number.isSafeInteger(quarantinedStaleCount) &&
        quarantinedStaleCount >= 0
      ? quarantinedStaleCount
      : 0,
  };

  const countResults = await Promise.all(
    [...VALID_STATUSES].map(async (status) => ({
      status,
      result: await access.adminClient
        .from("gallery_facebook_page_publish_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    })),
  );

  for (const { status, result } of countResults) {
    if (result.error) {
      console.error("list-facebook-page-publish-queue count failed", {
        status,
        code: result.error.code,
        message: result.error.message,
      });
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_job_count_failed",
          message: "Facebook Page publishing counts could not be loaded.",
        },
        500,
      );
    }
    const count = Number(result.count || 0);
    summary[status] = count;
    summary.total = Number(summary.total || 0) + count;
  }

  let jobQuery = access.adminClient
    .from("gallery_facebook_page_publish_jobs")
    .select(
      "id,submission_id,status,eligibility_reason,message,source_mime_type,source_size_bytes,facebook_photo_id,facebook_post_id,facebook_permalink,last_error,attempt_count,published_by,published_at,created_at,updated_at",
    );
  if (requestedStatus !== "all") {
    jobQuery = jobQuery.eq("status", requestedStatus);
  }
  if (cursor) {
    jobQuery = jobQuery.or(
      `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
    );
  }

  const { data: jobData, error: jobError } = await jobQuery
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (jobError) {
    console.error("list-facebook-page-publish-queue job lookup failed", {
      code: jobError.code,
      message: jobError.message,
    });
    return jsonResponse(
      {
        ok: false,
        error: "facebook_page_job_lookup_failed",
        message: "Facebook Page publishing jobs could not be loaded.",
      },
      500,
    );
  }

  const jobRows = Array.isArray(jobData) ? jobData as JsonRecord[] : [];
  const hasMore = jobRows.length > pageSize;
  const jobs = jobRows.slice(0, pageSize);
  let nextCursor: string | null = null;
  if (hasMore && jobs.length > 0) {
    const lastJob = jobs[jobs.length - 1];
    try {
      nextCursor = encodeFacebookPageQueueCursor(requestedStatus, {
        updatedAt: String(lastJob.updated_at || ""),
        id: String(lastJob.id || ""),
      });
    } catch {
      console.error("list-facebook-page-publish-queue cursor encoding failed");
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_queue_cursor_failed",
          message: "Facebook Page queue pagination could not be prepared.",
        },
        500,
      );
    }
  }
  const jobIds = [
    ...new Set(
      jobs.map((job) => safeString(job.id, 80)).filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  const submissionIds = [
    ...new Set(
      jobs.map((job) => safeString(job.submission_id, 80)).filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];

  const submissionsById = new Map<string, JsonRecord>();
  if (submissionIds.length > 0) {
    const { data, error } = await access.adminClient
      .from("gallery_submissions")
      .select(
        "id,user_id,gallery_publication_id,original_filename,mime_type,size_bytes,title,caption,category,status,reviewed_at,created_at,submission_source,discord_guild_id,discord_channel_id,discord_message_id,discord_attachment_id,discord_user_id,facebook_page_opt_in,facebook_page_opt_in_at,facebook_page_opt_in_source,facebook_page_opt_in_copy_version,facebook_page_opt_in_contract_version",
      )
      .in("id", submissionIds);
    if (error) {
      console.error("list-facebook-page-publish-queue submissions failed", {
        code: error.code,
        message: error.message,
      });
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_submission_lookup_failed",
          message: "Facebook Page submission details could not be loaded.",
        },
        500,
      );
    }
    (Array.isArray(data) ? data as JsonRecord[] : []).forEach((submission) => {
      const id = safeString(submission.id, 80);
      if (id) submissionsById.set(id, submission);
    });
  }

  const eventsByJobId = new Map<string, JsonRecord[]>();
  const allEvents: JsonRecord[] = [];
  if (jobIds.length > 0) {
    const { data, error } = await access.adminClient
      .from("gallery_facebook_page_publish_events")
      .select("id,job_id,submission_id,actor_id,action,created_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);
    if (error) {
      console.error("list-facebook-page-publish-queue events failed", {
        code: error.code,
        message: error.message,
      });
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_event_lookup_failed",
          message: "Facebook Page publishing history could not be loaded.",
        },
        500,
      );
    }
    allEvents.push(...(Array.isArray(data) ? data as JsonRecord[] : []));
    allEvents.forEach((event) => {
      const jobId = safeString(event.job_id, 80);
      if (!jobId) return;
      const current = eventsByJobId.get(jobId) || [];
      current.push(event);
      eventsByJobId.set(jobId, current);
    });
  }

  const userIds = [
    ...new Set([
      ...[...submissionsById.values()].map((submission) =>
        safeString(submission.user_id, 80)
      ),
      ...jobs.map((job) => safeString(job.published_by, 80)),
      ...allEvents.map((event) => safeString(event.actor_id, 80)),
    ].filter((value): value is string => Boolean(value))),
  ];
  const profilesById = new Map<string, JsonRecord>();
  if (userIds.length > 0) {
    const { data, error } = await access.adminClient
      .from("member_profiles")
      .select(
        "id,display_name,discord_username,discord_global_name,discord_user_id",
      )
      .in("id", userIds);
    if (error) {
      console.error("list-facebook-page-publish-queue profiles failed", {
        code: error.code,
        message: error.message,
      });
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_profile_lookup_failed",
          message: "Facebook Page profile details could not be loaded.",
        },
        500,
      );
    }
    (Array.isArray(data) ? data as JsonRecord[] : []).forEach((profile) => {
      const id = safeString(profile.id, 80);
      if (id) profilesById.set(id, profile);
    });
  }

  const queue = [];
  for (const job of jobs) {
    const jobId = safeString(job.id, 80) || "";
    const submissionId = safeString(job.submission_id, 80) || "";
    const submission = submissionsById.get(submissionId) || {};
    const galleryPublicationId = safeString(
      submission.gallery_publication_id,
      80,
    );
    const thumbnailUrl = galleryPublicationId
      ? approvedThumbnailUrl(galleryPublicationId)
      : null;
    const previewError = thumbnailUrl ? null : "approved_thumbnail_unavailable";

    const userId = safeString(submission.user_id, 80) || "";
    const profile = profilesById.get(userId) || {};
    const events = (eventsByJobId.get(jobId) || []).map((event) => {
      const actorId = safeString(event.actor_id, 80);
      return {
        id: safeString(event.id, 80),
        action: safeString(event.action, 40),
        createdAt: safeString(event.created_at, 80),
        actor: actorId
          ? profileSummary(profilesById.get(actorId) || null)
          : null,
      };
    });

    queue.push({
      id: jobId,
      status: safeString(job.status, 40),
      eligibilityReason: safeString(job.eligibility_reason, 500),
      message: safeString(job.message, 5000),
      sourceMimeType: safeString(job.source_mime_type, 80),
      sourceSizeBytes: Number(job.source_size_bytes || 0),
      facebookPhotoId: safeString(job.facebook_photo_id, 255),
      facebookPostId: safeString(job.facebook_post_id, 255),
      facebookPermalink: normalizeFacebookPermalink(job.facebook_permalink),
      lastError: safeString(job.last_error, 1000),
      attemptCount: Number(job.attempt_count || 0),
      publishedAt: safeString(job.published_at, 80),
      createdAt: safeString(job.created_at, 80),
      updatedAt: safeString(job.updated_at, 80),
      galleryPublicationId,
      thumbnailUrl,
      previewError,
      submission: {
        id: submissionId,
        status: safeString(submission.status, 20),
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
        title: safeString(submission.title, 80),
        caption: safeString(submission.caption, 300),
        category: safeString(submission.category, 40),
        originalFilename: safeString(submission.original_filename, 255),
        mimeType: safeString(submission.mime_type, 80),
        sizeBytes: Number(submission.size_bytes || 0),
        createdAt: safeString(submission.created_at, 80),
        reviewedAt: safeString(submission.reviewed_at, 80),
        facebookPageOptIn: submission.facebook_page_opt_in === true,
        facebookPageOptInAt: safeString(
          submission.facebook_page_opt_in_at,
          80,
        ),
        facebookPageOptInSource: safeString(
          submission.facebook_page_opt_in_source,
          80,
        ),
        facebookPageOptInCopyVersion: safeString(
          submission.facebook_page_opt_in_copy_version,
          80,
        ),
        facebookPageOptInContractVersion: safeString(
          submission.facebook_page_opt_in_contract_version,
          80,
        ),
      },
      events,
    });
  }

  summary.shown = queue.length;
  return jsonResponse({
    ok: true,
    data: {
      jobs: queue,
      count: queue.length,
      status: requestedStatus,
      pageSize,
      nextCursor,
      hasMore,
      summary,
    },
    message: queue.length
      ? `${requestedStatus} Facebook Page publishing jobs loaded.`
      : `No ${requestedStatus} Facebook Page publishing jobs.`,
  });
}
