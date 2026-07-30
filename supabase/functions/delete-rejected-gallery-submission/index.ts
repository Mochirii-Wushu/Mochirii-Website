import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  isSafeMemberGalleryObject,
  normalizeRejectedGalleryCleanupRequest,
} from "../_shared/gallery-cleanup.ts";
import {
  CORS_HEADERS,
  type JsonRecord,
  jsonResponse,
  readRequiredJsonBody,
  requireModeratorAccess,
  safeString,
} from "../_shared/gallery-moderation.ts";

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

  const request = normalizeRejectedGalleryCleanupRequest(bodyResult.body);
  if (!request.ok) {
    return jsonResponse(
      {
        ok: false,
        error: request.error,
        message: request.message,
      },
      request.status,
    );
  }

  const { data: submission, error: lookupError } = await access.adminClient
    .from("gallery_submissions")
    .select("id,user_id,status,storage_bucket,storage_path")
    .eq("id", request.submissionId)
    .eq("status", "rejected")
    .maybeSingle();

  if (lookupError) {
    console.error("delete-rejected-gallery-submission lookup failed", {
      code: lookupError.code,
    });

    return jsonResponse(
      {
        ok: false,
        error: "submission_lookup_failed",
        message: "The rejected gallery submission could not be loaded.",
      },
      500,
    );
  }

  if (!submission) {
    return jsonResponse(
      {
        ok: false,
        error: "submission_not_rejected",
        message: "Only rejected gallery submissions can be cleaned up.",
      },
      409,
    );
  }

  const record = submission as JsonRecord;
  const storageBucket = safeString(record.storage_bucket, 80) || "";
  const storagePath = safeString(record.storage_path, 1000) || "";
  const userId = safeString(record.user_id, 80) || "";

  if (!isSafeMemberGalleryObject(storageBucket, storagePath, userId)) {
    console.error(
      "delete-rejected-gallery-submission unsafe storage reference",
      {
        category: "unsafe_storage_reference",
        bucketMatches: storageBucket === "member-gallery",
        hasStoragePath: Boolean(storagePath),
        hasUserId: Boolean(userId),
      },
    );

    return jsonResponse(
      {
        ok: false,
        error: "unsafe_storage_reference",
        message:
          "The rejected submission storage reference is not safe to delete automatically.",
      },
      409,
    );
  }

  const { data: removedObjects, error: storageError } = await access.adminClient
    .storage
    .from(storageBucket)
    .remove([storagePath]);

  if (storageError) {
    console.error("delete-rejected-gallery-submission storage delete failed", {
      category: "storage_delete_rejected",
    });

    return jsonResponse(
      {
        ok: false,
        error: "storage_delete_failed",
        message:
          "The rejected submission object could not be removed from Storage.",
      },
      500,
    );
  }

  const { data: deletedRows, error: deleteError } = await access.adminClient
    .from("gallery_submissions")
    .delete()
    .eq("id", request.submissionId)
    .eq("status", "rejected")
    .select("id");

  if (deleteError) {
    console.error("delete-rejected-gallery-submission row delete failed", {
      code: deleteError.code,
    });

    return jsonResponse(
      {
        ok: false,
        error: "submission_delete_failed",
        message:
          "The Storage object was removed, but the rejected submission row could not be deleted.",
      },
      500,
    );
  }

  const deletedSubmission = Array.isArray(deletedRows) ? deletedRows[0] : null;
  if (!deletedSubmission) {
    return jsonResponse(
      {
        ok: false,
        error: "submission_delete_conflict",
        message:
          "The Storage object was removed, but the rejected submission was no longer available to delete.",
      },
      409,
    );
  }

  const deletedAt = new Date().toISOString();
  console.info("delete-rejected-gallery-submission completed", {
    removedObjectCount: Array.isArray(removedObjects)
      ? removedObjects.length
      : 0,
    category: "rejected_submission_removed",
  });

  return jsonResponse({
    ok: true,
    data: {
      submissionId: request.submissionId,
      removedObjectCount: Array.isArray(removedObjects)
        ? removedObjects.length
        : 0,
      deletedAt,
    },
    message: "Rejected gallery submission and Storage object cleaned up.",
  });
}
