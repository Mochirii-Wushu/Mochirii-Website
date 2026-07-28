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
  galleryPublicationDisplayStoragePath,
  galleryThumbnailStoragePath,
  parseGalleryDisplayPayload,
  parseGalleryThumbnailPayload,
} from "../_shared/gallery-thumbnail.ts";
import { isDecodableGalleryWebp } from "../_shared/gallery-webp-decoder.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = new Set(["approved", "rejected", "thumbnail"]);
const MEMBER_GALLERY_BUCKET = "member-gallery";
const PUBLIC_GALLERY_CATEGORIES = new Set([
  "portraits",
  "gatherings",
  "action",
  "scenery",
  "companions",
]);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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

  const bodyResult = await readRequiredJsonBody(req, 4 * 1024 * 1024);
  if (!bodyResult.ok) return bodyResult.response;

  const submissionId = safeString(bodyResult.body.submission_id, 80);
  const action = safeString(bodyResult.body.action, 20);
  const rawReason = safeString(bodyResult.body.reason, 500);
  const expectedUpdatedAt = safeString(bodyResult.body.expected_updated_at, 80);

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

  if (
    !expectedUpdatedAt ||
    !Number.isFinite(Date.parse(expectedUpdatedAt))
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_submission_revision",
        message:
          "Refresh the moderation queue before reviewing this submission.",
      },
      400,
    );
  }

  const expectedStatus = action === "thumbnail" ? "approved" : "pending";
  const { data: currentSubmission, error: lookupError } = await access
    .adminClient
    .from("gallery_submissions")
    .select(
      "id,user_id,storage_bucket,storage_path,gallery_publication_id,thumbnail_revision_id,thumbnail_storage_path,title,caption,category,mime_type,size_bytes,instagram_opt_in,updated_at",
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

  const currentUpdatedAt = safeString(currentSubmission.updated_at, 80);
  if (
    !currentUpdatedAt ||
    Date.parse(currentUpdatedAt) !== Date.parse(expectedUpdatedAt)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "stale_submission_revision",
        message:
          "This gallery submission changed before moderation began. Refresh and review it again.",
      },
      409,
    );
  }

  const thumbnailResult = action === "rejected"
    ? null
    : parseGalleryThumbnailPayload(bodyResult.body.thumbnail);
  const existingPublicationId = safeString(
    currentSubmission.gallery_publication_id,
    80,
  );
  const requiresDisplayUpload = action !== "rejected" &&
    !existingPublicationId;
  const displayResult = !requiresDisplayUpload
    ? null
    : parseGalleryDisplayPayload(bodyResult.body.display);

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

  if (displayResult && !displayResult.ok) {
    return jsonResponse(
      {
        ok: false,
        error: displayResult.error,
        message:
          "A bounded Gallery display image is required before publishing.",
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

  if (
    displayResult?.ok &&
    !await isDecodableGalleryWebp(
      displayResult.display.bytes,
      displayResult.display.width,
      displayResult.display.height,
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "display_decode_failed",
        message: "The Gallery display image could not be decoded safely.",
      },
      400,
    );
  }

  const userId = safeString(currentSubmission.user_id, 80);
  const bucket = safeString(currentSubmission.storage_bucket, 80);
  const originalStoragePath = safeString(currentSubmission.storage_path, 1000);
  const category = safeString(currentSubmission.category, 40)?.toLowerCase();
  const priorThumbnailRevisionId = safeString(
    currentSubmission.thumbnail_revision_id,
    80,
  );
  let publicationId: string | null = existingPublicationId;
  let publicOriginalPath: string | null = null;
  let thumbnailRevisionId: string | null = null;
  let thumbnailPath: string | null = null;

  if (thumbnailResult?.ok && (!requiresDisplayUpload || displayResult?.ok)) {
    if (
      !userId || bucket !== MEMBER_GALLERY_BUCKET || !originalStoragePath
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_storage_reference",
          message: "The gallery image storage reference is invalid.",
        },
        409,
      );
    }

    if (!category || !PUBLIC_GALLERY_CATEGORIES.has(category)) {
      return jsonResponse(
        {
          ok: false,
          error: "category_unclassified",
          message: "Choose a Gallery category before publishing this image.",
        },
        409,
      );
    }

    publicationId ||= crypto.randomUUID();
    thumbnailRevisionId = crypto.randomUUID();
    thumbnailPath = galleryThumbnailStoragePath(
      publicationId,
      thumbnailRevisionId,
    );

    if (requiresDisplayUpload && displayResult?.ok) {
      publicOriginalPath = galleryPublicationDisplayStoragePath(publicationId);
      const { error: displayUploadError } = await access.adminClient.storage
        .from(MEMBER_GALLERY_BUCKET)
        .upload(publicOriginalPath, displayResult.display.bytes, {
          contentType: displayResult.display.mimeType,
          cacheControl: "31536000",
          upsert: false,
        });

      if (displayUploadError) {
        console.error("moderate-gallery-submission display upload failed", {
          message: displayUploadError.message,
          submissionId,
        });
        return jsonResponse(
          {
            ok: false,
            error: "display_upload_failed",
            message: "The Gallery image could not be prepared.",
          },
          500,
        );
      }
    }

    const { error: thumbnailUploadError } = await access.adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .upload(thumbnailPath, thumbnailResult.thumbnail.bytes, {
        contentType: thumbnailResult.thumbnail.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });

    if (thumbnailUploadError) {
      if (publicOriginalPath) {
        await access.adminClient.storage.from(MEMBER_GALLERY_BUCKET).remove([
          publicOriginalPath,
        ]);
      }
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
  const displaySha256 = displayResult?.ok
    ? await sha256Hex(displayResult.display.bytes)
    : null;
  const thumbnailSha256 = thumbnailResult?.ok
    ? await sha256Hex(thumbnailResult.thumbnail.bytes)
    : null;
  const { data: commitData, error: commitError } = await access.adminClient.rpc(
    "gallery_commit_moderation",
    {
      p_submission_id: submissionId,
      p_moderator_id: access.userId,
      p_action: action,
      p_reason: rejectionReason,
      p_publication_id: publicationId,
      p_public_original_storage_path: publicOriginalPath,
      p_public_original_mime_type: displayResult?.ok
        ? displayResult.display.mimeType
        : null,
      p_public_original_size_bytes: displayResult?.ok
        ? displayResult.display.sizeBytes
        : null,
      p_public_original_width: displayResult?.ok
        ? displayResult.display.width
        : null,
      p_public_original_height: displayResult?.ok
        ? displayResult.display.height
        : null,
      p_public_original_sha256: displaySha256,
      p_thumbnail_revision_id: thumbnailRevisionId,
      p_thumbnail_storage_path: thumbnailPath,
      p_thumbnail_mime_type: thumbnailResult?.ok
        ? thumbnailResult.thumbnail.mimeType
        : null,
      p_thumbnail_size_bytes: thumbnailResult?.ok
        ? thumbnailResult.thumbnail.sizeBytes
        : null,
      p_thumbnail_width: thumbnailResult?.ok
        ? thumbnailResult.thumbnail.width
        : null,
      p_thumbnail_height: thumbnailResult?.ok
        ? thumbnailResult.thumbnail.height
        : null,
      p_thumbnail_sha256: thumbnailSha256,
      p_expected_thumbnail_revision_id: priorThumbnailRevisionId || null,
      p_expected_updated_at: expectedUpdatedAt,
    },
  );
  const commit =
    commitData && typeof commitData === "object" && !Array.isArray(commitData)
      ? commitData as JsonRecord
      : {};
  const committed = commit.committed === true;

  if (commitError || !committed) {
    const provisionalPaths = [thumbnailPath, publicOriginalPath]
      .filter((value): value is string => Boolean(value));
    if (provisionalPaths.length) {
      await access.adminClient.storage.from(MEMBER_GALLERY_BUCKET).remove(
        provisionalPaths,
      );
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

  const instagramJob = commit.instagramJob &&
      typeof commit.instagramJob === "object" &&
      !Array.isArray(commit.instagramJob)
    ? commit.instagramJob as JsonRecord
    : null;

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
