import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  facebookPageConfig,
  facebookPageIdentityMatches,
  facebookTasksCanPublish,
  type JsonRecord,
} from "../_shared/facebook-page-publishing.ts";
import {
  fetchMetaGraphOnce,
  readBoundedMetaGraphJson,
} from "../_shared/meta-graph-security.ts";
import { metaProviderDiagnosticPayload } from "../_shared/meta-provider-diagnostic.ts";
import { logSafeMetaEvent } from "../_shared/safe-telemetry.ts";
import {
  CORS_HEADERS,
  jsonResponse,
  requireModeratorAccess,
} from "../_shared/gallery-moderation.ts";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
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
      data: metaProviderDiagnosticPayload({
        provider: "facebook_page",
        configured: false,
        publishEnabled: config.publishEnabled,
        providerErrorCategory: config.invalidFields.length
          ? "facebook_configuration_invalid"
          : "facebook_configuration_missing",
      }),
      message: "Facebook Page publishing is not configured yet.",
    });
  }

  try {
    const identityResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: config.expectedPageId,
      query: { fields: "id" },
      timeoutMs: 30_000,
    });
    const identity = await readBoundedMetaGraphJson(identityResponse);
    const identityMatches = identityResponse.ok &&
      facebookPageIdentityMatches(identity.id, config.expectedPageId);
    let createContentTaskVerified = false;
    if (identityMatches) {
      try {
        const taskResponse = await fetchMetaGraphOnce({
          accessToken: config.accessToken,
          appSecret: config.appSecret,
          path: config.expectedPageId,
          query: { fields: "tasks" },
          timeoutMs: 30_000,
        });
        const taskBody = asRecord(
          await readBoundedMetaGraphJson(taskResponse),
        );
        createContentTaskVerified = taskResponse.ok &&
          facebookTasksCanPublish(taskBody.tasks);
      } catch {
        createContentTaskVerified = false;
      }
    }
    if (!identityResponse.ok || !identityMatches) {
      logSafeMetaEvent("warn", "facebook_status_identity_failed", {
        provider: "facebook_page",
        stage: "identity_read",
        statusCode: identityResponse.status,
        identityMatches,
      });
    }
    return jsonResponse({
      ok: true,
      data: metaProviderDiagnosticPayload({
        provider: "facebook_page",
        configured: true,
        publishEnabled: config.publishEnabled,
        identityReachable: identityResponse.ok,
        identityMatches,
        createContentTaskVerified,
        providerErrorCategory: !identityResponse.ok
          ? "facebook_identity_read_failed"
          : !identityMatches
          ? "facebook_identity_mismatch"
          : !createContentTaskVerified
          ? "facebook_create_content_task_unverified"
          : null,
      }),
      message:
        "Facebook Page identity was checked. Token binding, scope, and expiry validation remain blocked until the debugger transport exception is approved.",
    });
  } catch (error) {
    logSafeMetaEvent("warn", "facebook_status_request_failed", {
      provider: "facebook_page",
      stage: "identity_read",
      errorCategory:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "provider_timeout"
          : "provider_network_error",
    });
    return jsonResponse({
      ok: true,
      data: metaProviderDiagnosticPayload({
        provider: "facebook_page",
        configured: true,
        publishEnabled: config.publishEnabled,
        providerErrorCategory: "facebook_identity_read_unavailable",
      }),
      message: "Facebook Page diagnostic could not complete.",
    });
  }
}
