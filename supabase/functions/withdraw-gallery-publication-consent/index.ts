import "@supabase/functions-js/edge-runtime.d.ts";
import {
  protectedOptionsResponse,
  withProtectedCors,
} from "../_shared/cors.ts";
import {
  asRecord,
  jsonResponse,
  readRequiredJsonBody,
  safeString,
} from "../_shared/gallery-moderation.ts";
import { createAdminClient } from "../_shared/member-profiles.ts";
import { logSafeMetaEvent } from "../_shared/safe-telemetry.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESTINATIONS = new Set(["facebook_page", "instagram"]);

Deno.serve((req: Request) =>
  req.method === "OPTIONS"
    ? protectedOptionsResponse(req)
    : withProtectedCors(req, handleRequest(req))
);

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return jsonResponse(
      {
        ok: false,
        error: "gallery_withdrawal_not_configured",
        message: "Gallery consent withdrawal is not configured yet.",
      },
      500,
    );
  }
  const accessToken = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!accessToken) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_auth",
        message: "Sign in before withdrawing publication consent.",
      },
      401,
    );
  }
  const { data: userData, error: userError } = await adminClient.auth.getUser(
    accessToken,
  );
  const userId = safeString(userData?.user?.id, 80);
  if (userError || !userId || !UUID_RE.test(userId)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_auth",
        message: "Your sign-in session could not be verified.",
      },
      401,
    );
  }

  const bodyResult = await readRequiredJsonBody(req);
  if (!bodyResult.ok) return bodyResult.response;
  const submissionId = safeString(bodyResult.body.submission_id, 80);
  const destination = safeString(bodyResult.body.destination, 40);
  if (
    !submissionId || !UUID_RE.test(submissionId) || !destination ||
    !DESTINATIONS.has(destination)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_gallery_withdrawal_request",
        message: "Choose a valid Gallery submission and destination.",
      },
      400,
    );
  }

  const { data, error } = await adminClient.rpc(
    "gallery_withdraw_social_publication_consent",
    {
      p_submission_id: submissionId,
      p_destination: destination,
      p_actor_id: userId,
    },
  );
  const payload = asRecord(data);
  if (error || payload.committed !== true) {
    const reason = safeString(payload.reason, 80) ||
      "gallery_withdrawal_failed";
    logSafeMetaEvent("warn", "gallery_withdrawal_commit_failed", {
      destination,
      stage: "withdrawal_commit",
      errorCategory: reason,
    });
    const status = reason === "submission_not_found"
      ? 404
      : reason === "submission_not_owned"
      ? 403
      : reason === "destination_not_consented"
      ? 409
      : 500;
    return jsonResponse(
      {
        ok: false,
        error: reason,
        message: status === 403
          ? "Only the submitting member may withdraw this consent."
          : status === 409
          ? "That destination does not have active publication consent."
          : status === 404
          ? "The Gallery submission was not found."
          : "Publication consent could not be withdrawn.",
      },
      status,
    );
  }

  const action = safeString(payload.action, 80);
  const jobStatus = safeString(payload.job_status, 40);
  return jsonResponse({
    ok: true,
    data: {
      destination,
      action,
      status: jobStatus,
      requiresModeratorInspection:
        payload.requires_moderator_inspection === true,
      removalRequestCreated: payload.removal_request_created === true,
    },
    message: payload.removal_request_created === true
      ? "Consent was withdrawn and a removal request was recorded for the published copy."
      : payload.requires_moderator_inspection === true
      ? "Consent was withdrawn and the destination was quarantined for moderator inspection."
      : "Consent was withdrawn and any pending destination job was canceled.",
  });
}
