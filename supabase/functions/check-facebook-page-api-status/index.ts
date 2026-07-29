import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  FACEBOOK_CANONICAL_PAGE_ID,
  FACEBOOK_CANONICAL_PAGE_NAME,
  FACEBOOK_CANONICAL_PAGE_URL,
  facebookAuthenticatedGraphUrl,
  facebookPageConfig,
  facebookPageIdentityMatches,
  facebookTasksCanPublish,
  facebookTokenRequestInit,
  type JsonRecord,
} from "../_shared/facebook-page-publishing.ts";
import {
  CORS_HEADERS,
  jsonResponse,
  requireModeratorAccess,
  safeString,
} from "../_shared/gallery-moderation.ts";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function diagnosticPayload(values: JsonRecord): JsonRecord {
  return {
    configured: false,
    pageReachable: false,
    publishEnabled: false,
    publishAuthorityConfirmed: false,
    provider: "facebook_graph",
    apiVersion: null,
    page: null,
    checkedAt: new Date().toISOString(),
    ...values,
  };
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

  const config = facebookPageConfig();
  if (!config.configured) {
    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: false,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion || null,
        missingSecrets: config.missingSecrets,
        invalidFields: config.invalidFields,
        message: config.invalidFields.length
          ? "Facebook Page publishing configuration has invalid identifiers."
          : "Facebook Page publishing is not configured in Supabase secrets yet.",
      }),
      message: "Facebook Page publishing is not configured yet.",
    });
  }

  const statusUrl = await facebookAuthenticatedGraphUrl(
    config.apiVersion,
    `${FACEBOOK_CANONICAL_PAGE_ID}?fields=id,name,link`,
    config.accessToken,
    config.appSecret,
  );
  if (!statusUrl) {
    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: true,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion,
        message: "Facebook Graph API version is invalid.",
      }),
      message: "Facebook Graph API version is invalid.",
    });
  }

  try {
    const response = await fetch(
      statusUrl,
      facebookTokenRequestInit(
        config.accessToken,
        {
          headers: {
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(30_000),
        },
      ),
    );

    if (!response.ok) {
      console.warn("check-facebook-page-api-status page diagnostic failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return jsonResponse({
        ok: true,
        data: diagnosticPayload({
          configured: true,
          publishEnabled: config.publishEnabled,
          apiVersion: config.apiVersion,
          statusCode: response.status,
          message:
            "Facebook Page credentials are present, but the Page diagnostic failed. Confirm the Page id, Page access token, and permissions.",
        }),
        message: "Facebook Page diagnostic failed.",
      });
    }

    const pageBody = asRecord(await response.json());
    const pageId = safeString(pageBody.id, 255);
    const pageName = safeString(pageBody.name, 200);
    const pageMatches = facebookPageIdentityMatches(pageId, pageName);
    let tasks: string[] = [];
    let taskEvidenceAvailable = false;
    const tasksUrl = await facebookAuthenticatedGraphUrl(
      config.apiVersion,
      `${FACEBOOK_CANONICAL_PAGE_ID}?fields=tasks`,
      config.accessToken,
      config.appSecret,
    );
    if (pageMatches && tasksUrl) {
      try {
        const tasksResponse = await fetch(
          tasksUrl,
          facebookTokenRequestInit(config.accessToken, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
          }),
        );
        if (tasksResponse.ok) {
          const tasksBody = asRecord(await tasksResponse.json());
          if (Array.isArray(tasksBody.tasks)) {
            taskEvidenceAvailable = true;
            tasks = tasksBody.tasks.map((task) => safeString(task, 100)).filter(
              (task): task is string => Boolean(task),
            );
          }
        }
      } catch {
        // Page identity remains a valid read-only diagnostic. Task evidence is
        // optional because Meta documents Page tasks on /me/accounts for a
        // User token, not on this Page-token identity request.
      }
    }
    const publishAuthorityConfirmed = pageMatches &&
      facebookTasksCanPublish(tasks);
    const page = pageId
      ? {
        id: pageId,
        name: pageName,
        link: pageMatches ? FACEBOOK_CANONICAL_PAGE_URL : null,
        tasks,
        taskEvidenceAvailable,
      }
      : null;

    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: true,
        pageReachable: Boolean(page && pageMatches),
        publishEnabled: config.publishEnabled,
        publishAuthorityConfirmed,
        apiVersion: config.apiVersion,
        page,
        message: !pageMatches
          ? `Meta did not return the pinned ${FACEBOOK_CANONICAL_PAGE_NAME} Page identity.`
          : !config.publishEnabled
          ? "Facebook Page identity is readable. The server publishing activation flag is off."
          : publishAuthorityConfirmed
          ? "Facebook Page identity is readable, publishing is enabled, and create-content task evidence was observed."
          : taskEvidenceAvailable
          ? "Facebook Page identity is readable and publishing is enabled, but task evidence did not confirm create-content authority. The first genuine approved post remains the canary."
          : "Facebook Page identity is readable and publishing is enabled. Task evidence is unavailable, so the first genuine approved post remains the canary.",
      }),
      message: !pageMatches
        ? "Facebook Page identity did not match the pinned official Page."
        : !config.publishEnabled
        ? "Facebook Page identity passed; publishing remains disabled."
        : publishAuthorityConfirmed
        ? "Facebook Page publishing diagnostic passed with task evidence."
        : "Facebook Page identity passed; publishing is enabled and the first genuine approved post remains the canary.",
    });
  } catch (error) {
    console.warn("check-facebook-page-api-status request failed", {
      errorName: error instanceof Error ? error.name : "UnknownFetchError",
    });
    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: true,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion,
        message:
          "Facebook Page credentials are present, but the diagnostic could not reach Meta.",
      }),
      message: "Facebook Page diagnostic could not complete.",
    });
  }
}
