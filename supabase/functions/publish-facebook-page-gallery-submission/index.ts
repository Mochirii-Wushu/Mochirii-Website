import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { publishFacebookPageJob } from "../_shared/facebook-page-publishing.ts";
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
  const message = safeString(bodyResult.body.message, 5000);
  const confirmed = bodyResult.body.confirm_facebook_publish === true;
  const expectedUpdatedAt = safeString(
    bodyResult.body.expected_updated_at,
    80,
  );
  const suppliedFingerprint = safeString(
    bodyResult.body.confirmation_fingerprint,
    64,
  );

  const copyValidation = validateSocialPublicationCopy([message]);
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
        message: "A valid Facebook Page publishing job id is required.",
      },
      400,
    );
  }

  if (!confirmed) {
    return jsonResponse(
      {
        ok: false,
        error: "facebook_page_publish_confirmation_required",
        message: "Confirm Facebook Page publishing before posting.",
      },
      400,
    );
  }

  if (
    !expectedUpdatedAt ||
    !socialPublicationFingerprintLooksValid(suppliedFingerprint)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "facebook_page_publish_confirmation_invalid",
        message:
          "Refresh the Facebook Page queue and confirm this exact revision.",
      },
      409,
    );
  }

  const { data: currentData, error: currentError } = await access.adminClient
    .from("gallery_facebook_page_publish_jobs")
    .select("id,status,attempt_count,updated_at,message")
    .eq("id", jobId)
    .maybeSingle();
  const current = currentData && typeof currentData === "object" &&
      !Array.isArray(currentData)
    ? currentData as Record<string, unknown>
    : null;
  const currentUpdatedAt = safeString(current?.updated_at, 80);
  const currentStatus = safeString(current?.status, 40);
  const currentAttemptCount = Number(current?.attempt_count);
  const finalMessage = message || safeString(current?.message, 5000);
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
          ? "facebook_page_confirmation_state_unavailable"
          : "facebook_page_publish_confirmation_stale",
        message:
          "Refresh the Facebook Page queue and confirm this exact revision.",
      },
      currentError ? 500 : 409,
    );
  }
  const confirmation = await socialPublicationConfirmationFingerprint({
    destination: "facebook_page",
    jobId: jobId.toLowerCase(),
    status: currentStatus,
    attemptCount: currentAttemptCount,
    updatedAt: currentUpdatedAt,
    moderatorUserId: access.userId.toLowerCase(),
    primaryCopy: finalMessage,
    altText: "",
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
        error: "facebook_page_publish_confirmation_mismatch",
        message:
          "The destination, revision, final message, or moderator changed. Confirm again.",
      },
      409,
    );
  }

  const published = await publishFacebookPageJob({
    adminClient: access.adminClient,
    actorId: access.userId,
    jobId,
    message: finalMessage,
    expectedUpdatedAt: currentUpdatedAt,
    confirmationFingerprint: confirmation.fingerprint,
    confirmationCopyHash: confirmation.copyHash,
  });

  if (published.ok) {
    return jsonResponse({
      ok: true,
      data: {
        jobId,
        status: published.status,
        facebookPhotoId: published.facebookPhotoId,
        facebookPostId: published.facebookPostId,
        facebookPermalink: published.facebookPermalink,
        publishedAt: published.publishedAt,
      },
      message: published.message,
    });
  }

  const statusCode = published.error === "job_not_found"
    ? 404
    : published.error === "job_not_publishable"
    ? 409
    : published.error === "facebook_page_not_configured"
    ? 500
    : published.error === "facebook_page_publish_disabled"
    ? 409
    : 502;

  return jsonResponse(
    {
      ok: false,
      error: published.error || "facebook_page_publish_failed",
      data: {
        jobId,
        status: published.status,
        attempted: published.attempted,
      },
      message: published.message,
    },
    statusCode,
  );
}
