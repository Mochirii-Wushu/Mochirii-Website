import "@supabase/functions-js/edge-runtime.d.ts";
import {
  instagramAppSecretProof,
  instagramConfig,
  instagramGraphUrl,
  instagramIdentityMatches,
  instagramIdentitySummary,
  instagramProofUrl,
  instagramTokenRequestInit,
  type JsonRecord,
} from "../_shared/instagram-publishing.ts";
import {
  jsonResponse,
  requireModeratorAccess,
} from "../_shared/gallery-moderation.ts";
import {
  protectedOptionsResponse,
  withProtectedCors,
} from "../_shared/cors.ts";

function diagnosticPayload(values: JsonRecord): JsonRecord {
  return {
    configured: false,
    accountReachable: false,
    publishEnabled: false,
    accountIdPinned: false,
    provider: "instagram_graph",
    apiVersion: null,
    checkedAt: new Date().toISOString(),
    ...values,
  };
}

Deno.serve((req: Request) =>
  req.method === "OPTIONS"
    ? protectedOptionsResponse(req)
    : withProtectedCors(req, handleRequest(req))
);

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const access = await requireModeratorAccess(req);
  if (!access.ok) return access.response;

  const config = instagramConfig();
  if (!config.configured) {
    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: false,
        accountReachable: false,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion || null,
        appId: config.appId || null,
        expectedAppId: config.expectedAppId,
        accountIdPinned: config.accountIdPinned,
        missingSecrets: config.missingSecrets,
        invalidFields: config.invalidFields,
        message: config.invalidFields.length
          ? "Instagram publishing configuration has invalid identifiers."
          : "Meta API publishing is not configured in Supabase secrets yet.",
      }),
      message: "Meta API publishing is not configured yet.",
    });
  }

  const statusUrl = instagramGraphUrl(
    config.apiVersion,
    `${encodeURIComponent(config.accountId)}?fields=id,username,account_type`,
  );
  if (!statusUrl) {
    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: true,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion || null,
        appId: config.appId,
        expectedAppId: config.expectedAppId,
        accountIdPinned: config.accountIdPinned,
        message: "Instagram API version is not configured.",
      }),
      message: "Instagram API version is not configured.",
    });
  }

  try {
    const appSecretProof = await instagramAppSecretProof(
      config.appSecret,
      config.accessToken,
    );
    const response = await fetch(
      instagramProofUrl(statusUrl, appSecretProof),
      instagramTokenRequestInit(config.accessToken, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      }),
    );

    if (!response.ok) {
      console.warn("check-instagram-api-status account diagnostic failed", {
        status: response.status,
        statusText: response.statusText,
      });

      return jsonResponse({
        ok: true,
        data: diagnosticPayload({
          configured: true,
          accountReachable: false,
          publishEnabled: config.publishEnabled,
          apiVersion: config.apiVersion,
          appId: config.appId,
          expectedAppId: config.expectedAppId,
          accountIdPinned: config.accountIdPinned,
          statusCode: response.status,
          message:
            "Meta API credentials are present, but the account diagnostic failed. Confirm the account id, token, permissions, and provider path.",
        }),
        message: "Meta API account diagnostic failed.",
      });
    }

    const identityBody = await response.json();
    const identityMatches = instagramIdentityMatches(
      identityBody,
      config.accountId,
    );
    const account = instagramIdentitySummary(identityBody);

    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: true,
        accountReachable: identityMatches,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion,
        appId: config.appId,
        expectedAppId: config.expectedAppId,
        accountIdPinned: config.accountIdPinned,
        account,
        message: !identityMatches
          ? "Meta returned a different Instagram identity or account type than the configured Mōchirīī Business account."
          : !config.accountIdPinned
          ? "The Business identity passed, but the configured account id does not match the independently stored expected account id. Publishing remains disabled."
          : !config.publishEnabled
          ? "The @mochirii_guild Business account is readable. The server publishing activation flag is off."
          : "The @mochirii_guild Business account is readable and server publishing is enabled.",
      }),
      message: !identityMatches
        ? "Instagram account identity did not match @mochirii_guild."
        : !config.accountIdPinned
        ? "Instagram identity passed; the expected account id secret does not match."
        : !config.publishEnabled
        ? "Instagram account identity passed; publishing remains disabled."
        : "Meta API account diagnostic passed.",
    });
  } catch (error) {
    console.warn(
      "check-instagram-api-status account diagnostic request failed",
      {
        errorType: error instanceof Error ? error.name : "request_failed",
      },
    );

    return jsonResponse({
      ok: true,
      data: diagnosticPayload({
        configured: true,
        accountReachable: false,
        publishEnabled: config.publishEnabled,
        apiVersion: config.apiVersion,
        appId: config.appId,
        expectedAppId: config.expectedAppId,
        accountIdPinned: config.accountIdPinned,
        message:
          "Meta API credentials are present, but the diagnostic request could not reach Meta.",
      }),
      message: "Meta API account diagnostic could not complete.",
    });
  }
}
