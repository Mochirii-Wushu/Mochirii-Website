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
  decodeGallerySourceImage,
  gallerySourcePreviewResponse,
} from "../_shared/gallery-source-decode.ts";
import { validateGallerySourceBytes } from "../_shared/gallery-source-image.ts";
import {
  galleryPreviewSanitizerIsAttested,
  galleryPreviewVercelIdentityFromEnv,
} from "../_shared/gallery-preview-attestation.ts";
import { safeGalleryModeratorProfile } from "../_shared/gallery-response-safety.ts";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const EVENT_LIMIT = 250;
const MEMBER_GALLERY_BUCKET = "member-gallery";
const VALID_STATUSES = new Set(["pending", "approved", "rejected", "archived"]);
const VALID_THUMBNAIL_STATES = new Set(["all", "missing", "ready"]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function normalizeStatus(value: unknown): string {
  const status = safeString(value, 20)?.toLowerCase() || "pending";
  return VALID_STATUSES.has(status) ? status : "pending";
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
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
    "Mōchirīī Member"
  );
}

function profileSummary(
  profile: JsonRecord | null | undefined,
): JsonRecord | null {
  return safeGalleryModeratorProfile(profile);
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

  if (bodyResult.body.checkOnly === true) {
    return jsonResponse({
      ok: true,
      hasAccess: true,
      data: {
        hasAccess: true,
      },
      message: "Moderator access verified.",
    });
  }

  if (bodyResult.body.action === "prepare_preview") {
    if (
      !(await galleryPreviewSanitizerIsAttested(req, {
        supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
        vercelIdentity: galleryPreviewVercelIdentityFromEnv(),
      }))
    ) {
      return new Response(null, {
        status: 404,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag":
            "noindex, nofollow, noarchive, nosnippet, noimageindex",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const submissionId = safeString(bodyResult.body.submission_id, 80);
    const expectedUpdatedAt = safeString(
      bodyResult.body.expected_updated_at,
      80,
    );
    if (
      !submissionId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(submissionId) ||
      !expectedUpdatedAt ||
      !Number.isFinite(Date.parse(expectedUpdatedAt))
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_preview_request",
          message:
            "Refresh the moderation queue before preparing this preview.",
        },
        400,
      );
    }

    const { data: candidateData, error: candidateError } = await access
      .adminClient.rpc(
        "gallery_source_validation_candidate",
        { p_submission_id: submissionId },
      );
    const candidate = asRecord(candidateData);
    const candidateUpdatedAt = safeString(candidate.submission_updated_at, 80);
    const storageBucket = safeString(candidate.storage_bucket, 80);
    const storagePath = safeString(candidate.storage_path, 1000);
    const sourceMimeType =
      safeString(candidate.source_mime_type, 80)?.toLowerCase() || null;
    const sourceSizeBytes = Number(candidate.source_size_bytes || 0);
    const storageObjectId = safeString(candidate.storage_object_id, 80);
    const storageObjectVersion = safeString(
      candidate.storage_object_version,
      255,
    );
    const storageObjectUpdatedAt = safeString(
      candidate.storage_object_updated_at,
      80,
    );
    if (
      candidateError || candidate.ok !== true ||
      !candidateUpdatedAt ||
      Date.parse(candidateUpdatedAt) !== Date.parse(expectedUpdatedAt) ||
      storageBucket !== MEMBER_GALLERY_BUCKET || !storagePath ||
      !storageObjectId || !storageObjectUpdatedAt ||
      !sourceMimeType || !Number.isSafeInteger(sourceSizeBytes)
    ) {
      return jsonResponse(
        {
          ok: false,
          error: candidateError
            ? "source_validation_lookup_failed"
            : "stale_submission_revision",
          message:
            "The private Gallery source changed or cannot be validated. Refresh the queue and review it again.",
        },
        candidateError ? 500 : 409,
      );
    }

    const { data: reservationData, error: reservationError } = await access
      .adminClient.rpc(
        "gallery_reserve_moderation_preview",
        {
          p_reserved_bytes: sourceSizeBytes,
        },
      );
    const reservation = asRecord(reservationData);
    if (reservationError) {
      console.error("list-gallery-review-queue source preview budget failed", {
        category: "reservation_unavailable",
      });
      return jsonResponse(
        {
          ok: false,
          error: "source_preview_budget_unavailable",
          message: "The private Gallery preview is temporarily unavailable.",
        },
        503,
      );
    }
    if (reservation.allowed !== true) {
      return jsonResponse(
        {
          ok: false,
          error: "source_preview_budget_exhausted",
          message: "The private Gallery preview is temporarily unavailable.",
        },
        429,
      );
    }

    const { data: sourceBlob, error: sourceDownloadError } = await access
      .adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .download(storagePath);
    if (
      sourceDownloadError || !sourceBlob || sourceBlob.size !== sourceSizeBytes
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "source_download_failed",
          message: "The private Gallery source could not be validated safely.",
        },
        409,
      );
    }

    const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
    const validation = await validateGallerySourceBytes(
      sourceBytes,
      sourceMimeType,
    );
    if (!validation.ok) {
      console.warn("list-gallery-review-queue source validation rejected", {
        category: "source_validation_rejected",
      });
      return jsonResponse(
        {
          ok: false,
          error: "source_validation_failed",
          message:
            "This image cannot be opened safely for moderation. Ask the member to upload a smaller static image.",
        },
        422,
      );
    }

    const decode = await decodeGallerySourceImage(
      sourceBytes,
      validation.source.mimeType,
      validation.source.width,
      validation.source.height,
    );
    if (!decode.ok) {
      console.warn("list-gallery-review-queue source decode rejected", {
        category: "source_decode_rejected",
      });
      return jsonResponse(
        {
          ok: false,
          error: "source_decode_failed",
          message:
            "This image cannot be opened safely for moderation. Ask the member to upload a smaller static image.",
        },
        422,
      );
    }

    const { data: commitData, error: commitError } = await access.adminClient
      .rpc(
        "gallery_commit_source_validation",
        {
          p_submission_id: submissionId,
          p_expected_submission_updated_at: expectedUpdatedAt,
          p_expected_storage_object_id: storageObjectId,
          p_expected_storage_object_version: storageObjectVersion,
          p_expected_storage_object_updated_at: storageObjectUpdatedAt,
          p_source_mime_type: validation.source.mimeType,
          p_source_size_bytes: validation.source.sizeBytes,
          p_source_width: validation.source.width,
          p_source_height: validation.source.height,
          p_source_sha256: validation.source.sha256,
        },
      );
    const commit = asRecord(commitData);
    if (commitError || commit.committed !== true) {
      return jsonResponse(
        {
          ok: false,
          error: commitError
            ? "source_validation_commit_failed"
            : "source_validation_conflict",
          message:
            "The private Gallery source changed during validation. Refresh the queue and review it again.",
        },
        commitError ? 500 : 409,
      );
    }
    const sourceValidatedAt = safeString(commit.validated_at, 80);
    if (!sourceValidatedAt || !Number.isFinite(Date.parse(sourceValidatedAt))) {
      return jsonResponse(
        {
          ok: false,
          error: "source_validation_timestamp_invalid",
          message: "The private Gallery preview could not be verified.",
        },
        500,
      );
    }

    return gallerySourcePreviewResponse(sourceBytes, {
      submissionId,
      mimeType: validation.source.mimeType,
      width: validation.source.width,
      height: validation.source.height,
      validatedAt: sourceValidatedAt,
    });
  }

  const requestedStatus = normalizeStatus(bodyResult.body.status);
  const requestedPage = boundedInteger(bodyResult.body.page, 1, 1, 10000);
  const requestedPageSize = boundedInteger(
    bodyResult.body.page_size,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );
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

  const { count: missingThumbnailCount, error: missingThumbnailCountError } =
    await access.adminClient
      .from("gallery_submissions")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .is("thumbnail_revision_id", null);

  if (missingThumbnailCountError) {
    console.error("list-gallery-review-queue thumbnail count failed", {
      code: missingThumbnailCountError.code,
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
    .select(
      "id,user_id,storage_bucket,storage_path,gallery_publication_id,thumbnail_mime_type,thumbnail_size_bytes,thumbnail_width,thumbnail_height,original_filename,mime_type,size_bytes,title,caption,category,status,rejection_reason,reviewed_by,reviewed_at,created_at,updated_at,submission_source,instagram_opt_in,facebook_page_opt_in",
      { count: "exact" },
    )
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
  submissionQuery = submissionQuery.range(
    pageOffset,
    pageOffset + requestedPageSize - 1,
  );

  const { data: submissionData, error: submissionError, count: filteredCount } =
    await submissionQuery;

  if (submissionError) {
    console.error("list-gallery-review-queue submission lookup failed", {
      code: submissionError.code,
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

  const submissions = Array.isArray(submissionData)
    ? submissionData as JsonRecord[]
    : [];
  const submissionIds = [
    ...new Set(
      submissions
        .map((submission) => safeString(submission.id, 80))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const sourceValidationsBySubmissionId = new Map<string, JsonRecord>();
  if (submissionIds.length > 0) {
    const { data: validationData, error: validationError } = await access
      .adminClient.rpc(
        "gallery_source_validation_states",
        { p_submission_ids: submissionIds },
      );
    if (validationError || !Array.isArray(validationData)) {
      console.error(
        "list-gallery-review-queue source validation lookup failed",
        {
          code: validationError?.code,
          category: validationError
            ? "database_lookup_rejected"
            : "invalid_validation_response",
        },
      );
      return jsonResponse(
        {
          ok: false,
          error: "source_validation_lookup_failed",
          message: "Gallery source validation status could not be loaded.",
        },
        500,
      );
    }
    for (const value of validationData) {
      const validation = asRecord(value);
      const submissionId = safeString(validation.submission_id, 80);
      if (submissionId) {
        sourceValidationsBySubmissionId.set(submissionId, validation);
      }
    }
  }
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

    moderationEvents.push(
      ...(Array.isArray(eventData) ? eventData as JsonRecord[] : []),
    );
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
        ...submissions.map((submission) =>
          safeString(submission.reviewed_by, 80)
        ),
        ...moderationEvents.map((event) => safeString(event.moderator_id, 80)),
      ]
        .filter((value): value is string => Boolean(value)),
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
      console.error("list-gallery-review-queue profile lookup failed", {
        code: profileError.code,
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

    (Array.isArray(profileData) ? profileData as JsonRecord[] : []).forEach(
      (profile) => {
        const id = safeString(profile.id, 80);
        if (id) profilesById.set(id, profile);
      },
    );
  }

  const queue = [];

  for (const submission of submissions) {
    const bucket = safeString(submission.storage_bucket, 80) ||
      MEMBER_GALLERY_BUCKET;
    const storagePath = safeString(submission.storage_path, 1000);
    const submissionId = safeString(submission.id, 80);
    const sourceValidation = submissionId
      ? sourceValidationsBySubmissionId.get(submissionId) || null
      : null;
    let previewError: string | null = null;

    if (bucket !== MEMBER_GALLERY_BUCKET || !storagePath) {
      console.warn(
        "list-gallery-review-queue skipped invalid storage reference",
        {
          category: "invalid_storage_reference",
          bucketMatches: bucket === MEMBER_GALLERY_BUCKET,
          hasStoragePath: Boolean(storagePath),
        },
      );
      previewError = "invalid_storage_reference";
    } else if (!sourceValidation) {
      previewError = "source_validation_required";
    }

    const userId = safeString(submission.user_id, 80) || "";
    const profile = profilesById.get(userId) || {};
    const reviewerId = safeString(submission.reviewed_by, 80);
    const reviewer = reviewerId ? profilesById.get(reviewerId) || null : null;
    const events = (eventsBySubmissionId.get(submissionId || "") || []).map(
      (event) => {
        const moderatorId = safeString(event.moderator_id, 80);
        return {
          id: safeString(event.id, 80),
          action: safeString(event.action, 20),
          reason: safeString(event.reason, 500),
          createdAt: safeString(event.created_at, 80),
          moderator: moderatorId
            ? profileSummary(profilesById.get(moderatorId) || null)
            : null,
        };
      },
    );

    queue.push({
      id: submissionId,
      status: safeString(submission.status, 20) || requestedStatus,
      source: safeString(submission.submission_source, 40) || "website",
      uploader: {
        displayName: displayName(profile),
        discordUsername: safeString(profile.discord_username, 80),
        discordGlobalName: safeString(profile.discord_global_name, 100),
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
      thumbnailMimeType: safeString(submission.thumbnail_mime_type, 80),
      thumbnailSizeBytes: Number(submission.thumbnail_size_bytes || 0) || null,
      thumbnailWidth: Number(submission.thumbnail_width || 0) || null,
      thumbnailHeight: Number(submission.thumbnail_height || 0) || null,
      publicationReady: Boolean(
        safeString(submission.gallery_publication_id, 80),
      ),
      sourceValidationState: sourceValidation ? "validated" : "required",
      previewError,
      instagramOptIn: submission.instagram_opt_in === true,
      facebookPageOptIn: submission.facebook_page_opt_in === true,
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
    },
    message: queue.length
      ? `${requestedStatus} gallery submissions loaded.`
      : `No ${requestedStatus} gallery submissions.`,
  });
}
