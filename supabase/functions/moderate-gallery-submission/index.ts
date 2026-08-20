import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  CORS_HEADERS,
  type JsonRecord,
  jsonResponse,
  readRequiredJsonBody,
  requireModeratorAccess,
  safeString,
} from "../_shared/gallery-moderation.ts";
import {
  galleryThumbnailStoragePath,
  parseGalleryThumbnailPayload,
} from "../_shared/gallery-thumbnail.ts";
import { isDecodableGalleryWebp } from "../_shared/gallery-webp-decoder.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = new Set(["approved", "rejected", "thumbnail"]);
const MEMBER_GALLERY_BUCKET = "member-gallery";
const INSTAGRAM_SUPPORTED_MIME_TYPES = new Set(["image/jpeg"]);

function buildInstagramCaption(submission: JsonRecord): string {
  const title = safeString(submission.title, 80);
  const caption = safeString(submission.caption, 300);
  const parts = [title, caption, "Shared from the Mōchirīī guild gallery."]
    .filter(Boolean);
  return parts.join("\n\n").slice(0, 2200);
}

function buildInstagramAltText(submission: JsonRecord): string {
  const title = safeString(submission.title, 80) || "Member gallery image";
  return `Mōchirīī guild gallery submission: ${title}`.slice(0, 1000);
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

  const bodyResult = await readRequiredJsonBody(req);
  if (!bodyResult.ok) return bodyResult.response;

  const submissionId = safeString(bodyResult.body.submission_id, 80);
  const action = safeString(bodyResult.body.action, 20);
  const rawReason = safeString(bodyResult.body.reason, 500);

  if (!submissionId || !UUID_RE.test(submissionId)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_submission_id",
        message: "A valid submission id is required.",
      },
      400,
    );
  }

  if (!action || !VALID_ACTIONS.has(action)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_action",
        message: "Moderation action must be approved, rejected, or thumbnail.",
      },
      400,
    );
  }

  const expectedStatus = action === "thumbnail" ? "approved" : "pending";
  const { data: currentSubmission, error: lookupError } = await access
    .adminClient
    .from("gallery_submissions")
    .select(
      "id,user_id,storage_bucket,storage_path,thumbnail_revision_id,thumbnail_storage_path,title,caption,mime_type,instagram_opt_in,submission_source,source_sha256",
    )
    .eq("id", submissionId)
    .eq("status", expectedStatus)
    .maybeSingle();

  if (lookupError) {
    console.error("moderate-gallery-submission lookup failed", {
      code: lookupError.code,
      message: lookupError.message,
      submissionId,
    });
    return jsonResponse(
      {
        ok: false,
        error: "submission_lookup_failed",
        message: "The gallery submission could not be loaded.",
      },
      500,
    );
  }

  if (!currentSubmission) {
    return jsonResponse(
      {
        ok: false,
        error: action === "thumbnail"
          ? "submission_not_approved"
          : "submission_not_pending",
        message: action === "thumbnail"
          ? "This gallery submission is not approved or could not be found."
          : "This gallery submission is no longer pending or could not be found.",
      },
      409,
    );
  }

  const thumbnailResult = action === "rejected"
    ? null
    : parseGalleryThumbnailPayload(bodyResult.body.thumbnail);

  if (thumbnailResult && !thumbnailResult.ok) {
    return jsonResponse(
      {
        ok: false,
        error: thumbnailResult.error,
        message: "A bounded gallery thumbnail is required before approval.",
      },
      400,
    );
  }

  if (
    thumbnailResult?.ok &&
    !await isDecodableGalleryWebp(
      thumbnailResult.thumbnail.bytes,
      thumbnailResult.thumbnail.width,
      thumbnailResult.thumbnail.height,
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "thumbnail_decode_failed",
        message: "The gallery thumbnail could not be decoded safely.",
      },
      400,
    );
  }

  const userId = safeString(currentSubmission.user_id, 80);
  const bucket = safeString(currentSubmission.storage_bucket, 80);
  const originalStoragePath = safeString(currentSubmission.storage_path, 1000);
  const priorThumbnailRevisionId = safeString(
    currentSubmission.thumbnail_revision_id,
    80,
  );
  const priorThumbnailPath = safeString(
    currentSubmission.thumbnail_storage_path,
    1000,
  );
  const submissionSource = safeString(currentSubmission.submission_source, 40);
  const sourceSha256 = safeString(currentSubmission.source_sha256, 64);
  let thumbnailRevisionId: string | null = null;
  let thumbnailPath: string | null = null;

  if (
    submissionSource === "discord" &&
    (!sourceSha256 || !/^[0-9a-f]{64}$/.test(sourceSha256))
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "source_integrity_unavailable",
        message:
          "This Discord gallery source cannot be verified for moderation.",
      },
      409,
    );
  }

  if (thumbnailResult?.ok) {
    if (!userId || bucket !== MEMBER_GALLERY_BUCKET || !originalStoragePath) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_storage_reference",
          message: "The gallery image storage reference is invalid.",
        },
        409,
      );
    }

    thumbnailRevisionId = crypto.randomUUID();
    thumbnailPath = galleryThumbnailStoragePath(
      submissionId,
      thumbnailRevisionId,
    );
    const { error: thumbnailUploadError } = await access.adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .upload(thumbnailPath, thumbnailResult.thumbnail.bytes, {
        contentType: thumbnailResult.thumbnail.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });

    if (thumbnailUploadError) {
      console.error("moderate-gallery-submission thumbnail upload failed", {
        message: thumbnailUploadError.message,
        submissionId,
      });
      return jsonResponse(
        {
          ok: false,
          error: "thumbnail_upload_failed",
          message: "The gallery thumbnail could not be stored.",
        },
        500,
      );
    }
  }

  const rejectionReason = action === "rejected"
    ? rawReason || "Rejected by moderator."
    : null;
  const { data: commitData, error: commitError } = await access.adminClient.rpc(
    "gallery_commit_moderation_checked",
    {
      p_submission_id: submissionId,
      p_moderator_id: access.userId,
      p_action: action,
      p_reason: rejectionReason,
      p_thumbnail_revision_id: thumbnailRevisionId,
      p_thumbnail_storage_path: thumbnailPath,
      p_thumbnail_mime_type: thumbnailResult?.ok
        ? thumbnailResult.thumbnail.mimeType
        : null,
      p_thumbnail_size_bytes: thumbnailResult?.ok
        ? thumbnailResult.thumbnail.sizeBytes
        : null,
      p_expected_thumbnail_revision_id: priorThumbnailRevisionId || null,
      p_expected_source_sha256: submissionSource === "discord"
        ? sourceSha256
        : null,
    },
  );
  const commit =
    commitData && typeof commitData === "object" && !Array.isArray(commitData)
      ? commitData as JsonRecord
      : {};
  const committed = commit.committed === true;

  if (commitError || !committed) {
    if (thumbnailPath) {
      await access.adminClient.storage.from(MEMBER_GALLERY_BUCKET).remove([
        thumbnailPath,
      ]);
    }
    console.error("moderate-gallery-submission atomic commit failed", {
      code: commitError?.code,
      message: commitError?.message || safeString(commit.reason, 80) ||
        "Atomic moderation conflict",
      submissionId,
    });
    return jsonResponse(
      {
        ok: false,
        error: commitError
          ? "moderation_commit_failed"
          : safeString(commit.reason, 80),
        message: action === "thumbnail"
          ? "This gallery thumbnail changed before the update completed. Refresh and try again."
          : "This gallery submission changed before moderation completed. Refresh and try again.",
      },
      commitError ? 500 : 409,
    );
  }

  const updatedSubmission =
    commit.submission && typeof commit.submission === "object" &&
      !Array.isArray(commit.submission)
      ? commit.submission as JsonRecord
      : {};
  const reviewedAt = safeString(updatedSubmission.reviewed_at, 80);

  if (
    action === "thumbnail" && priorThumbnailPath &&
    priorThumbnailPath !== thumbnailPath
  ) {
    const { error: staleThumbnailError } = await access.adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .remove([priorThumbnailPath]);
    if (staleThumbnailError) {
      console.warn(
        "moderate-gallery-submission stale thumbnail cleanup deferred",
        {
          message: staleThumbnailError.message,
          submissionId,
        },
      );
    }
  }

  let instagramJob: JsonRecord | null = null;
  if (action === "approved" && updatedSubmission.instagram_opt_in === true) {
    const mimeType = safeString(updatedSubmission.mime_type, 80);
    const isEligible = Boolean(
      mimeType && INSTAGRAM_SUPPORTED_MIME_TYPES.has(mimeType),
    );
    const instagramStatus = isEligible ? "queued" : "ineligible";
    const eligibilityReason = isEligible
      ? null
      : "Instagram v1 publishing supports JPEG images only.";

    const { data: jobData, error: jobError } = await access.adminClient
      .from("gallery_instagram_publish_jobs")
      .insert({
        submission_id: submissionId,
        status: instagramStatus,
        eligibility_reason: eligibilityReason,
        caption: buildInstagramCaption(updatedSubmission as JsonRecord),
        alt_text: buildInstagramAltText(updatedSubmission as JsonRecord),
        queued_by: access.userId,
      })
      .select("id,status,eligibility_reason,created_at")
      .maybeSingle();

    if (jobError || !jobData) {
      console.error("moderate-gallery-submission instagram job insert failed", {
        code: jobError?.code,
        message: jobError?.message || "Missing inserted Instagram job",
        submissionId,
      });

      return jsonResponse(
        {
          ok: false,
          error: "instagram_job_failed",
          message:
            "The submission was approved, but the Instagram publishing job could not be queued.",
        },
        500,
      );
    }

    instagramJob = jobData as JsonRecord;

    const { error: instagramEventError } = await access.adminClient
      .from("gallery_instagram_publish_events")
      .insert({
        job_id: safeString(instagramJob.id, 80),
        submission_id: submissionId,
        actor_id: access.userId,
        action: instagramStatus,
        details: {
          reason: eligibilityReason,
          mime_type: mimeType,
        },
      });

    if (instagramEventError) {
      console.error(
        "moderate-gallery-submission instagram event insert failed",
        {
          code: instagramEventError.code,
          message: instagramEventError.message,
          submissionId,
        },
      );

      return jsonResponse(
        {
          ok: false,
          error: "instagram_event_failed",
          message:
            "The submission was approved, but the Instagram publishing audit event could not be recorded.",
        },
        500,
      );
    }
  }

  return jsonResponse({
    ok: true,
    data: {
      submission: updatedSubmission,
      action,
      reviewedAt,
      instagramJob,
    },
    message: action === "approved"
      ? "Submission approved for the guild gallery."
      : action === "thumbnail"
      ? "Gallery thumbnail prepared."
      : "Submission declined.",
  });
}
