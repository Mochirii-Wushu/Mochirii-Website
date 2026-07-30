import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { publishInstagramJob } from "../_shared/instagram-publishing.ts";
import { validateSocialPublicationCopy } from "../_shared/social-publication-copy.ts";
import {
  constantTimeHexEqual,
  socialPublicationConfirmationFingerprint,
  socialPublicationFingerprintLooksValid,
} from "../_shared/social-publication-confirmation.ts";
import {
  CORS_HEADERS,
  jsonResponse,
  readRequiredJsonBody,
  requireModeratorAccess,
  safeString,
} from "../_shared/gallery-moderation.ts";
import { safeInstagramPublishResponse } from "../_shared/gallery-response-safety.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const jobId = safeString(bodyResult.body.job_id, 80);
  const caption = safeString(bodyResult.body.caption, 2200);
  const altText = safeString(bodyResult.body.alt_text, 1000);
  const confirmed = bodyResult.body.confirm_instagram_publish === true;
  const expectedUpdatedAt = safeString(
    bodyResult.body.expected_updated_at,
    80,
  );
  const suppliedFingerprint = safeString(
    bodyResult.body.confirmation_fingerprint,
    64,
  );

  const copyValidation = validateSocialPublicationCopy([caption, altText]);
  if (!copyValidation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: copyValidation.error,
        message: copyValidation.message,
      },
      400,
    );
  }

  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_job_id",
        message: "A valid Instagram publishing job id is required.",
      },
      400,
    );
  }

  if (!confirmed) {
    return jsonResponse(
      {
        ok: false,
        error: "instagram_publish_confirmation_required",
        message: "Confirm Instagram publishing before posting.",
      },
      400,
    );
  }

  if (
    !altText || !expectedUpdatedAt ||
    !socialPublicationFingerprintLooksValid(suppliedFingerprint)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: !altText
          ? "instagram_alt_text_required"
          : "instagram_publish_confirmation_invalid",
        message: !altText
          ? "Moderator-reviewed Instagram alt text is required."
          : "Refresh the Instagram queue and confirm this exact revision.",
      },
      !altText ? 400 : 409,
    );
  }

  const { data: currentData, error: currentError } = await access.adminClient
    .from("gallery_instagram_publish_jobs")
    .select("id,status,attempt_count,updated_at,caption,alt_text")
    .eq("id", jobId)
    .maybeSingle();
  const current = currentData && typeof currentData === "object" &&
      !Array.isArray(currentData)
    ? currentData as Record<string, unknown>
    : null;
  const currentUpdatedAt = safeString(current?.updated_at, 80);
  const currentStatus = safeString(current?.status, 40);
  const currentAttemptCount = Number(current?.attempt_count);
  const finalCaption = caption || safeString(current?.caption, 2200);
  const finalAltText = altText || safeString(current?.alt_text, 1000);
  if (
    currentError || !current || !currentUpdatedAt || !currentStatus ||
    !Number.isSafeInteger(currentAttemptCount) ||
    currentAttemptCount < 0 ||
    currentUpdatedAt !== expectedUpdatedAt
  ) {
    return jsonResponse(
      {
        ok: false,
        error: currentError
          ? "instagram_confirmation_state_unavailable"
          : "instagram_publish_confirmation_stale",
        message: "Refresh the Instagram queue and confirm this exact revision.",
      },
      currentError ? 500 : 409,
    );
  }
  const confirmation = await socialPublicationConfirmationFingerprint({
    destination: "instagram",
    jobId: jobId.toLowerCase(),
    status: currentStatus,
    attemptCount: currentAttemptCount,
    updatedAt: currentUpdatedAt,
    moderatorUserId: access.userId.toLowerCase(),
    primaryCopy: finalCaption,
    altText: finalAltText,
  });
  if (
    !constantTimeHexEqual(
      suppliedFingerprint,
      confirmation.fingerprint,
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "instagram_publish_confirmation_mismatch",
        message:
          "The destination, revision, caption, alt text, or moderator changed. Confirm again.",
      },
      409,
    );
  }

  const published = await publishInstagramJob({
    adminClient: access.adminClient,
    actorId: access.userId,
    jobId,
    caption: finalCaption,
    altText: finalAltText,
    expectedUpdatedAt: currentUpdatedAt,
    confirmationFingerprint: confirmation.fingerprint,
    confirmationCopyHash: confirmation.copyHash,
  });

  if (published.ok) {
    return jsonResponse(safeInstagramPublishResponse(jobId, published));
  }

  const statusCode = published.error === "job_not_found"
    ? 404
    : published.error === "instagram_publish_disabled" ||
        published.status === "reconcile_required"
    ? 409
    : published.error === "instagram_not_configured"
    ? 500
    : published.attempted
    ? 502
    : 409;

  return jsonResponse(
    safeInstagramPublishResponse(jobId, published),
    statusCode,
  );
}
