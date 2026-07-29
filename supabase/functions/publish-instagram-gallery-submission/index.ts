import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { publishInstagramJob } from "../_shared/instagram-publishing.ts";
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
  const caption = safeString(bodyResult.body.caption, 2200);
  const altText = safeString(bodyResult.body.alt_text, 1000);
  const confirmed = bodyResult.body.confirm_instagram_publish === true;

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

  const published = await publishInstagramJob({
    adminClient: access.adminClient,
    actorId: access.userId,
    jobId,
    caption,
    altText,
  });

  if (published.ok) {
    return jsonResponse({
      ok: true,
      data: {
        jobId,
        status: published.status,
        instagramContainerId: published.instagramContainerId,
        instagramMediaId: published.instagramMediaId,
        instagramPermalink: published.instagramPermalink,
        publishedAt: published.publishedAt,
      },
      message: published.message,
    });
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
    {
      ok: false,
      error: published.error || "instagram_publish_failed",
      data: {
        jobId,
        status: published.status,
        attempted: published.attempted,
        instagramContainerId: published.instagramContainerId,
        instagramMediaId: published.instagramMediaId,
        instagramPermalink: published.instagramPermalink,
      },
      message: published.message,
    },
    statusCode,
  );
}
