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
  facebookAuthenticatedGraphUrl,
  facebookPageConfig,
  facebookPageObjectEvidence,
  facebookTokenRequestInit,
  normalizeFacebookPermalink,
} from "../_shared/facebook-page-publishing.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID_RE = /^[A-Za-z0-9_.:-]{1,255}$/;
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
  const facebookPhotoId = safeString(
    bodyResult.body.facebook_photo_id,
    255,
  );
  const facebookPostId = safeString(bodyResult.body.facebook_post_id, 255);
  const rawPermalink = safeString(bodyResult.body.facebook_permalink, 1000);
  const permalink = normalizeFacebookPermalink(rawPermalink);
  const note = safeString(bodyResult.body.note, 500);
  const confirmed = bodyResult.body.confirm_reconciliation === true;

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
  if (!resolution || !VALID_RESOLUTIONS.has(resolution)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_reconciliation_resolution",
        message: "Choose whether the Page post was published or not published.",
      },
      400,
    );
  }
  if (!confirmed) {
    return jsonResponse(
      {
        ok: false,
        error: "facebook_page_reconciliation_confirmation_required",
        message:
          "Confirm the Page inspection result before resolving this job.",
      },
      400,
    );
  }
  if (!note) {
    return jsonResponse(
      {
        ok: false,
        error: "facebook_page_reconciliation_note_required",
        message: "Record what was inspected on the Facebook Page.",
      },
      400,
    );
  }
  if (
    (facebookPhotoId && !PROVIDER_ID_RE.test(facebookPhotoId)) ||
    (facebookPostId && !PROVIDER_ID_RE.test(facebookPostId)) ||
    (rawPermalink && !permalink)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_facebook_page_reconciliation_evidence",
        message: "Facebook Page reconciliation evidence is invalid.",
      },
      400,
    );
  }
  if (
    resolution === "confirmed_not_published" &&
    (facebookPhotoId || facebookPostId || rawPermalink)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "contradictory_facebook_page_reconciliation_evidence",
        message:
          "Remove every Facebook photo id, post id, and permalink when no Page post exists.",
      },
      400,
    );
  }

  let verifiedPermalink = permalink;
  let pageOwnershipVerified = false;
  if (resolution === "confirmed_published") {
    const config = facebookPageConfig();
    if (!config.configured) {
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_reconciliation_verification_unavailable",
          message:
            "Canonical Page ownership cannot be verified until the server Page credentials are configured.",
        },
        409,
      );
    }

    const objectIds = [
      ...new Set(
        [facebookPostId, facebookPhotoId].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ];
    const providerPermalinks: string[] = [];
    for (const objectId of objectIds) {
      const evidenceUrl = await facebookAuthenticatedGraphUrl(
        config.apiVersion,
        `${encodeURIComponent(objectId)}?fields=id,from{id},permalink_url,link`,
        config.accessToken,
        config.appSecret,
      );
      if (!evidenceUrl) {
        return jsonResponse(
          {
            ok: false,
            error: "facebook_page_reconciliation_verification_failed",
            message:
              "The inspected Facebook object could not be checked against the pinned Page.",
          },
          409,
        );
      }

      try {
        const response = await fetch(
          evidenceUrl,
          facebookTokenRequestInit(config.accessToken, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
          }),
        );
        const body = response.ok ? await response.json() : null;
        const evidence = facebookPageObjectEvidence(body, objectId);
        if (!response.ok || !evidence.verified || !evidence.permalink) {
          return jsonResponse(
            {
              ok: false,
              error: "facebook_page_reconciliation_verification_failed",
              message:
                "The inspected Facebook object was not verified as a post from the pinned official Page.",
            },
            409,
          );
        }
        providerPermalinks.push(evidence.permalink);
      } catch {
        return jsonResponse(
          {
            ok: false,
            error: "facebook_page_reconciliation_verification_failed",
            message:
              "The inspected Facebook object could not be checked against the pinned Page.",
          },
          503,
        );
      }
    }

    if (
      permalink && !providerPermalinks.includes(permalink)
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_reconciliation_permalink_mismatch",
          message:
            "The supplied permalink does not match the canonical link returned for the pinned Page object.",
        },
        409,
      );
    }
    verifiedPermalink = permalink || providerPermalinks[0] || null;
    pageOwnershipVerified = Boolean(verifiedPermalink);
    if (!pageOwnershipVerified) {
      return jsonResponse(
        {
          ok: false,
          error: "facebook_page_reconciliation_verification_failed",
          message:
            "Canonical Page ownership evidence is required to confirm publication.",
        },
        409,
      );
    }
  }

  const { data, error } = await access.adminClient.rpc(
    "gallery_facebook_page_resolve_reconciliation",
    {
      p_job_id: jobId,
      p_actor_id: access.userId,
      p_resolution: resolution,
      p_facebook_photo_id: facebookPhotoId,
      p_facebook_post_id: facebookPostId,
      p_facebook_permalink: verifiedPermalink,
      p_note: note,
      p_page_ownership_verified: pageOwnershipVerified,
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
      "facebook_page_reconciliation_failed";
    console.warn("resolve-facebook-page-publish-reconciliation failed", {
      code: error?.code || reason,
      message: error?.message || reason,
      jobId,
    });
    const status = reason === "job_not_found"
      ? 404
      : reason === "job_not_reconcilable" || reason === "external_id_required"
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
        message: reason === "external_id_required"
          ? "A Facebook photo or post id is required to confirm publication."
          : reason === "job_not_reconcilable"
          ? "Only reconciliation-required jobs can be resolved."
          : "The Facebook Page reconciliation result could not be recorded.",
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
      facebookPhotoId: safeString(job.facebook_photo_id, 255),
      facebookPostId: safeString(job.facebook_post_id, 255),
      facebookPermalink: normalizeFacebookPermalink(job.facebook_permalink),
      lastError: safeString(job.last_error, 1000),
      publishedAt: safeString(job.published_at, 80),
      updatedAt: safeString(job.updated_at, 80),
    },
    message: resolution === "confirmed_published"
      ? "Facebook Page publication was confirmed and recorded."
      : "The missing Page post was confirmed; the job may now be retried with separate approval.",
  });
}
