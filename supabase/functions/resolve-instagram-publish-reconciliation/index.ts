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
import { normalizeInstagramPostPermalink } from "../_shared/instagram-publishing.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTAGRAM_MEDIA_ID_RE = /^\d{5,255}$/;
const VALID_RESOLUTIONS = new Set([
  "confirmed_published",
  "confirmed_not_published",
]);

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
  const resolution = safeString(bodyResult.body.resolution, 40);
  const mediaId = safeString(bodyResult.body.instagram_media_id, 255);
  const rawPermalink = safeString(bodyResult.body.instagram_permalink, 1000);
  const permalink = normalizeInstagramPostPermalink(rawPermalink);
  const note = safeString(bodyResult.body.note, 500);
  const confirmed = bodyResult.body.confirm_reconciliation === true;

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
  if (!resolution || !VALID_RESOLUTIONS.has(resolution)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_reconciliation_resolution",
        message:
          "Choose whether the Instagram post was published or not published.",
      },
      400,
    );
  }
  if (!confirmed) {
    return jsonResponse(
      {
        ok: false,
        error: "instagram_reconciliation_confirmation_required",
        message:
          "Confirm the Instagram account inspection result before resolving this job.",
      },
      400,
    );
  }
  if (!note) {
    return jsonResponse(
      {
        ok: false,
        error: "instagram_reconciliation_note_required",
        message: "Record what was inspected on the official Instagram account.",
      },
      400,
    );
  }
  if (
    resolution === "confirmed_published" &&
    (!mediaId || !INSTAGRAM_MEDIA_ID_RE.test(mediaId) || !permalink)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "instagram_reconciliation_evidence_required",
        message:
          "A numeric Instagram media id and canonical official post or reel permalink are required to confirm publication.",
      },
      400,
    );
  }
  if (
    resolution === "confirmed_not_published" &&
    (mediaId || rawPermalink)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "unexpected_instagram_reconciliation_evidence",
        message:
          "Do not attach publication identifiers when confirming that no post exists.",
      },
      400,
    );
  }

  const { data, error } = await access.adminClient.rpc(
    "gallery_instagram_resolve_reconciliation",
    {
      p_job_id: jobId,
      p_actor_id: access.userId,
      p_resolution: resolution,
      p_instagram_media_id: mediaId,
      p_instagram_permalink: permalink,
      p_note: note,
    },
  );
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as JsonRecord
    : {};
  const job = payload.job && typeof payload.job === "object" &&
      !Array.isArray(payload.job)
    ? payload.job as JsonRecord
    : null;

  if (error || payload.committed !== true || !job) {
    const reason = safeString(payload.reason, 80) ||
      "instagram_reconciliation_failed";
    console.warn("resolve-instagram-publish-reconciliation failed", {
      code: error?.code || reason,
      message: error?.message || reason,
      jobId,
    });
    const status = reason === "job_not_found"
      ? 404
      : reason === "job_not_reconcilable" ||
          reason === "external_evidence_required"
      ? 409
      : 500;
    return jsonResponse(
      {
        ok: false,
        error: reason,
        data: {
          jobId,
          status: safeString(payload.status, 40),
        },
        message: reason === "external_evidence_required"
          ? "A media id and Instagram permalink are required to confirm publication."
          : reason === "job_not_reconcilable"
          ? "Only reconciliation-required jobs can be resolved."
          : "The Instagram reconciliation result could not be recorded.",
      },
      status,
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      jobId: safeString(job.id, 80),
      submissionId: safeString(job.submission_id, 80),
      status: safeString(job.status, 40),
      instagramMediaId: safeString(job.instagram_media_id, 255),
      instagramPermalink: safeString(job.instagram_permalink, 1000),
      lastError: safeString(job.last_error, 1000),
      publishedAt: safeString(job.published_at, 80),
      updatedAt: safeString(job.updated_at, 80),
    },
    message: resolution === "confirmed_published"
      ? "Instagram publication was confirmed and recorded."
      : "The missing Instagram post was confirmed; the job may now be retried with separate approval.",
  });
}
