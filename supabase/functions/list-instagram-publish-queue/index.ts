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
import { normalizeInstagramPostPermalink } from "../_shared/instagram-publishing.ts";
import { safeInstagramPublishQueueItem } from "../_shared/gallery-response-safety.ts";
import { logSafeMetaEvent } from "../_shared/safe-telemetry.ts";

const DEFAULT_QUEUE_LIMIT = 25;
const MAX_QUEUE_LIMIT = 50;
const EVENT_LIMIT = 250;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const VALID_STATUSES = new Set([
  "queued",
  "ineligible",
  "publishing",
  "published",
  "failed",
  "reconcile_required",
  "canceled",
  "shared_manually",
]);

type QueueCursor = {
  version: 1;
  status: string;
  updatedAt: string;
  id: string;
};

function normalizeStatus(value: unknown): string {
  const status = safeString(value, 20)?.toLowerCase() || "queued";
  return status === "all" || VALID_STATUSES.has(status) ? status : "queued";
}

function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? Math.min(parsed, MAX_QUEUE_LIMIT)
    : DEFAULT_QUEUE_LIMIT;
}

function encodeCursor(cursor: QueueCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function cursorTimestamp(value: unknown): string | null {
  const timestamp = safeString(value, 80);
  if (!timestamp || !TIMESTAMPTZ_RE.test(timestamp)) return null;
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function decodeCursor(value: unknown, status: string): QueueCursor | null {
  const encoded = safeString(value, 512);
  if (!encoded) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

  try {
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<QueueCursor>;
    const updatedAt = cursorTimestamp(parsed.updatedAt);
    const id = safeString(parsed.id, 80);
    const parsedStatus = safeString(parsed.status, 20);
    if (
      parsed.version !== 1 || parsedStatus !== status || !updatedAt || !id ||
      !UUID_RE.test(id)
    ) return null;
    return {
      version: 1,
      status,
      updatedAt,
      id: id.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function publicThumbnailUrl(
  supabaseUrl: string,
  publicationId: string | null,
): string | null {
  if (!supabaseUrl || !publicationId || !UUID_RE.test(publicationId)) {
    return null;
  }
  const url = new URL(
    "/functions/v1/list-approved-gallery-submissions",
    supabaseUrl,
  );
  url.searchParams.set("asset", "thumbnail");
  url.searchParams.set("id", publicationId);
  return url.toString();
}

function displayName(profile: JsonRecord | null | undefined): string {
  return (
    safeString(profile?.discord_global_name, 100) ||
    safeString(profile?.display_name, 40) ||
    safeString(profile?.discord_username, 80) ||
    "Mōchirīī Member"
  );
}

function profileSummary(
  profile: JsonRecord | null | undefined,
): JsonRecord | null {
  if (!profile) return null;

  return {
    displayName: displayName(profile),
    discordUsername: safeString(profile.discord_username, 80),
    discordGlobalName: safeString(profile.discord_global_name, 100),
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

  const requestedStatus = normalizeStatus(bodyResult.body.status);
  const requestedLimit = normalizeLimit(bodyResult.body.limit);
  const rawCursor = safeString(bodyResult.body.cursor, 512);
  const cursor = decodeCursor(rawCursor, requestedStatus);
  if (rawCursor && !cursor) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_instagram_queue_cursor",
        message:
          "The Instagram queue cursor is invalid or belongs to another status.",
      },
      400,
    );
  }

  const { error: quarantineError } = await access.adminClient.rpc(
    "gallery_instagram_quarantine_stale_publish_jobs",
  );
  if (quarantineError) {
    logSafeMetaEvent("error", "instagram_queue_quarantine_failed", {
      provider: "instagram",
      stage: "stale_lease_quarantine",
      errorCategory: "database_operation_failed",
    });
    return jsonResponse(
      {
        ok: false,
        error: "instagram_stale_lease_quarantine_failed",
        message: "Instagram publishing safety state could not be loaded.",
      },
      500,
    );
  }
  const summary: Record<string, number | string> = {
    status: requestedStatus,
    total: 0,
    shown: 0,
  };

  const countResults = await Promise.all(
    [...VALID_STATUSES].map(async (status) => ({
      status,
      result: await access.adminClient
        .from("gallery_instagram_publish_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    })),
  );

  for (const { status, result } of countResults) {
    if (result.error) {
      logSafeMetaEvent("error", "instagram_queue_count_failed", {
        provider: "instagram",
        stage: "queue_count",
        errorCategory: "database_operation_failed",
      });

      return jsonResponse(
        {
          ok: false,
          error: "instagram_job_count_failed",
          message: "Instagram publishing counts could not be loaded.",
        },
        500,
      );
    }

    const count = Number(result.count || 0);
    summary[status] = count;
    summary.total = Number(summary.total || 0) + count;
  }

  let jobQuery = access.adminClient
    .from("gallery_instagram_publish_jobs")
    .select(
      "id,submission_id,status,eligibility_reason,caption,alt_text,instagram_media_id,instagram_permalink,attempt_count,attempt_started_at,published_by,published_at,created_at,updated_at",
    )
    .limit(requestedLimit + 1);

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
    .order("id", { ascending: false });

  if (jobError) {
    logSafeMetaEvent("error", "instagram_queue_lookup_failed", {
      provider: "instagram",
      stage: "queue_lookup",
      errorCategory: "database_operation_failed",
    });

    return jsonResponse(
      {
        ok: false,
        error: "instagram_job_lookup_failed",
        message: "Instagram publishing jobs could not be loaded.",
      },
      500,
    );
  }

  const pageRows = Array.isArray(jobData) ? jobData as JsonRecord[] : [];
  const hasMore = pageRows.length > requestedLimit;
  const jobs = pageRows.slice(0, requestedLimit);
  const jobIds = [
    ...new Set(
      jobs
        .map((job) => safeString(job.id, 80))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const submissionIds = [
    ...new Set(
      jobs
        .map((job) => safeString(job.submission_id, 80))
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const submissionsById = new Map<string, JsonRecord>();
  if (submissionIds.length > 0) {
    const { data: submissionData, error: submissionError } = await access
      .adminClient
      .from("gallery_submissions")
      .select(
        "id,user_id,gallery_publication_id,mime_type,size_bytes,title,caption,category,status,reviewed_at,created_at,submission_source,instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version,instagram_opt_in_contract_version",
      )
      .in("id", submissionIds);

    if (submissionError) {
      logSafeMetaEvent("error", "instagram_queue_submission_lookup_failed", {
        provider: "instagram",
        stage: "submission_lookup",
        errorCategory: "database_operation_failed",
      });

      return jsonResponse(
        {
          ok: false,
          error: "instagram_submission_lookup_failed",
          message: "Instagram submission details could not be loaded.",
        },
        500,
      );
    }

    (Array.isArray(submissionData) ? submissionData as JsonRecord[] : [])
      .forEach((submission) => {
        const id = safeString(submission.id, 80);
        if (id) submissionsById.set(id, submission);
      });
  }

  const eventsByJobId = new Map<string, JsonRecord[]>();
  const allEvents: JsonRecord[] = [];
  if (jobIds.length > 0) {
    const { data: eventData, error: eventError } = await access.adminClient
      .from("gallery_instagram_publish_events")
      .select("id,job_id,submission_id,actor_id,action,created_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    if (eventError) {
      logSafeMetaEvent("error", "instagram_queue_event_lookup_failed", {
        provider: "instagram",
        stage: "event_lookup",
        errorCategory: "database_operation_failed",
      });

      return jsonResponse(
        {
          ok: false,
          error: "instagram_event_lookup_failed",
          message: "Instagram publishing history could not be loaded.",
        },
        500,
      );
    }

    allEvents.push(
      ...(Array.isArray(eventData) ? eventData as JsonRecord[] : []),
    );
    allEvents.forEach((event) => {
      const jobId = safeString(event.job_id, 80);
      if (!jobId) return;
      const current = eventsByJobId.get(jobId) || [];
      current.push(event);
      eventsByJobId.set(jobId, current);
    });
  }

  const userIds = [
    ...new Set(
      [
        ...[...submissionsById.values()].map((submission) =>
          safeString(submission.user_id, 80)
        ),
        ...jobs.map((job) => safeString(job.published_by, 80)),
        ...allEvents.map((event) => safeString(event.actor_id, 80)),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const profilesById = new Map<string, JsonRecord>();

  if (userIds.length > 0) {
    const { data: profileData, error: profileError } = await access.adminClient
      .from("member_profiles")
      .select(
        "id,display_name,discord_username,discord_global_name",
      )
      .in("id", userIds);

    if (profileError) {
      logSafeMetaEvent("error", "instagram_queue_profile_lookup_failed", {
        provider: "instagram",
        stage: "profile_lookup",
        errorCategory: "database_operation_failed",
      });

      return jsonResponse(
        {
          ok: false,
          error: "instagram_profile_lookup_failed",
          message: "Instagram publishing profile details could not be loaded.",
        },
        500,
      );
    }

    (Array.isArray(profileData) ? profileData as JsonRecord[] : []).forEach(
      (profile) => {
        const id = safeString(profile.id, 80);
        if (id) profilesById.set(id, profile);
      },
    );
  }

  const queue = [];

  for (const job of jobs) {
    const jobId = safeString(job.id, 80) || "";
    const submissionId = safeString(job.submission_id, 80) || "";
    const submission = submissionsById.get(submissionId) || {};
    const publicationId = safeString(submission.gallery_publication_id, 80);
    const thumbnailUrl = publicThumbnailUrl(
      Deno.env.get("SUPABASE_URL") || "",
      publicationId,
    );

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

    queue.push(safeInstagramPublishQueueItem({
      id: jobId,
      status: safeString(job.status, 40),
      eligibilityReason: safeString(job.eligibility_reason, 300),
      caption: safeString(job.caption, 2200),
      altText: safeString(job.alt_text, 1000),
      instagramMediaId: safeString(job.instagram_media_id, 100),
      instagramPermalink: normalizeInstagramPostPermalink(
        job.instagram_permalink,
      ),
      attemptCount: Number(job.attempt_count || 0),
      attemptStartedAt: safeString(job.attempt_started_at, 80),
      publishedAt: safeString(job.published_at, 80),
      createdAt: safeString(job.created_at, 80),
      updatedAt: safeString(job.updated_at, 80),
      galleryPublicationId: publicationId,
      thumbnailUrl,
      previewError: thumbnailUrl ? null : "approved_thumbnail_unavailable",
      submission: {
        id: submissionId,
        status: safeString(submission.status, 20),
        source: safeString(submission.submission_source, 40) || "website",
        uploader: {
          displayName: displayName(profile),
          discordUsername: safeString(profile.discord_username, 80),
          discordGlobalName: safeString(profile.discord_global_name, 100),
        },
        title: safeString(submission.title, 80),
        caption: safeString(submission.caption, 300),
        category: safeString(submission.category, 40),
        mimeType: safeString(submission.mime_type, 80),
        sizeBytes: Number(submission.size_bytes || 0),
        createdAt: safeString(submission.created_at, 80),
        reviewedAt: safeString(submission.reviewed_at, 80),
        instagramOptIn: submission.instagram_opt_in === true,
        instagramOptInAt: safeString(submission.instagram_opt_in_at, 80),
        instagramOptInSource: safeString(
          submission.instagram_opt_in_source,
          80,
        ),
        instagramOptInCopyVersion: safeString(
          submission.instagram_opt_in_copy_version,
          80,
        ),
        instagramOptInContractVersion: safeString(
          submission.instagram_opt_in_contract_version,
          80,
        ),
      },
      events,
    }));
  }

  summary.shown = queue.length;
  const lastJob = hasMore ? jobs.at(-1) : null;
  const lastUpdatedAt = cursorTimestamp(lastJob?.updated_at);
  const lastJobId = safeString(lastJob?.id, 80);
  const nextCursor = hasMore && lastUpdatedAt && lastJobId &&
      UUID_RE.test(lastJobId)
    ? encodeCursor({
      version: 1,
      status: requestedStatus,
      updatedAt: lastUpdatedAt,
      id: lastJobId.toLowerCase(),
    })
    : null;

  return jsonResponse({
    ok: true,
    data: {
      items: queue,
      nextCursor,
      count: queue.length,
      status: requestedStatus,
      summary,
      pageSize: requestedLimit,
    },
    message: queue.length
      ? `${requestedStatus} Instagram publishing jobs loaded.`
      : `No ${requestedStatus} Instagram publishing jobs.`,
  });
}
