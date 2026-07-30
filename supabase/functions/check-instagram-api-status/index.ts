import "@supabase/functions-js/edge-runtime.d.ts";
import {
  instagramConfig,
  instagramIdentityMatches,
  instagramPublishingQuota,
} from "../_shared/instagram-publishing.ts";
import { facebookPageConfig } from "../_shared/facebook-page-publishing.ts";
import {
  fetchMetaGraphOnce,
  readBoundedMetaGraphJson,
} from "../_shared/meta-graph-security.ts";
import {
  metaProviderDiagnosticPayload,
  readInstagramPageLinkageOnce,
} from "../_shared/meta-provider-diagnostic.ts";
import { logSafeMetaEvent } from "../_shared/safe-telemetry.ts";
import {
  jsonResponse,
  requireModeratorAccess,
} from "../_shared/gallery-moderation.ts";
import {
  protectedOptionsResponse,
  withProtectedCors,
} from "../_shared/cors.ts";

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
  const pageConfig = facebookPageConfig();
  if (
    !config.configured || !config.accountIdPinned || !pageConfig.configured
  ) {
    const configurationInvalid = config.invalidFields.length > 0 ||
      pageConfig.invalidFields.length > 0;
    return jsonResponse({
      ok: true,
      data: metaProviderDiagnosticPayload({
        provider: "instagram",
        configured: false,
        publishEnabled: config.publishEnabled,
        providerErrorCategory: configurationInvalid
          ? "instagram_configuration_invalid"
          : "instagram_configuration_missing",
      }),
      message:
        "Instagram publishing and its linked Facebook Page identity are not configured yet.",
    });
  }

  let facebookPageReachable = false;
  let facebookPageIdentityMatches = false;
  let instagramBusinessAccountPresent = false;
  let instagramBusinessAccountMatches = false;
  let pageToInstagramLinkageVerified = false;
  let identityReachable = false;
  let identityMatches = false;
  let quotaReadable = false;
  let quotaExhausted = false;
  let providerErrorCategory: string | null = null;
  try {
    const linkage = await readInstagramPageLinkageOnce({
      accessToken: pageConfig.accessToken,
      appSecret: pageConfig.appSecret,
      runtimePageId: pageConfig.pageId,
      expectedPageId: pageConfig.expectedPageId,
      runtimeInstagramAccountId: config.accountId,
      expectedInstagramAccountId: config.expectedAccountId,
      timeoutMs: 30_000,
    });
    facebookPageReachable = linkage.facebookPageReachable;
    facebookPageIdentityMatches = linkage.facebookPageIdentityMatches;
    instagramBusinessAccountPresent = linkage.instagramBusinessAccountPresent;
    instagramBusinessAccountMatches = linkage.instagramBusinessAccountMatches;
    pageToInstagramLinkageVerified = linkage.verified;

    if (!facebookPageReachable) {
      providerErrorCategory = "instagram_page_linkage_read_failed";
    } else if (!facebookPageIdentityMatches) {
      providerErrorCategory = "instagram_facebook_page_identity_mismatch";
    } else if (!instagramBusinessAccountPresent) {
      providerErrorCategory = "instagram_business_account_not_linked";
    } else if (!instagramBusinessAccountMatches) {
      providerErrorCategory = "instagram_business_account_link_mismatch";
    }

    if (pageToInstagramLinkageVerified) {
      const identityResponse = await fetchMetaGraphOnce({
        accessToken: config.accessToken,
        appSecret: config.appSecret,
        path: config.expectedAccountId,
        query: { fields: "id,username" },
        timeoutMs: 30_000,
      });
      const identity = await readBoundedMetaGraphJson(identityResponse);
      identityReachable = identityResponse.ok;
      identityMatches = identityResponse.ok &&
        instagramIdentityMatches(identity, config.expectedAccountId);
      if (!identityResponse.ok) {
        providerErrorCategory = "instagram_identity_read_failed";
      } else if (!identityMatches) {
        providerErrorCategory = "instagram_identity_mismatch";
      }
    }

    if (pageToInstagramLinkageVerified && identityMatches) {
      const quotaResponse = await fetchMetaGraphOnce({
        accessToken: config.accessToken,
        appSecret: config.appSecret,
        path: `${config.expectedAccountId}/content_publishing_limit`,
        query: { fields: "quota_usage,config" },
        timeoutMs: 30_000,
      });
      const quota = instagramPublishingQuota(
        await readBoundedMetaGraphJson(quotaResponse),
      );
      quotaReadable = quotaResponse.ok && quota.readable;
      quotaExhausted = quotaReadable && quota.exhausted;
      if (!quotaReadable) {
        providerErrorCategory = "instagram_quota_read_failed";
      } else if (quotaExhausted) {
        providerErrorCategory = "instagram_quota_exhausted";
      }
    }
  } catch (error) {
    providerErrorCategory = error instanceof DOMException &&
        error.name === "TimeoutError"
      ? "provider_timeout"
      : "provider_network_error";
  }

  if (providerErrorCategory) {
    logSafeMetaEvent("warn", "instagram_status_incomplete", {
      provider: "instagram",
      stage: "provider_diagnostic",
      errorCategory: providerErrorCategory,
      facebookPageIdentityMatches,
      instagramBusinessAccountMatches,
      pageToInstagramLinkageVerified,
      identityMatches,
      quotaReadable,
    });
  }

  return jsonResponse({
    ok: true,
    data: metaProviderDiagnosticPayload({
      provider: "instagram",
      configured: true,
      publishEnabled: config.publishEnabled,
      facebookPageReachable,
      facebookPageIdentityMatches,
      instagramBusinessAccountPresent,
      instagramBusinessAccountMatches,
      pageToInstagramLinkageVerified,
      identityReachable,
      identityMatches,
      quotaReadable,
      quotaExhausted,
      providerErrorCategory,
    }),
    message:
      "The pinned Facebook Page linkage, Instagram identity, and provider quota were checked. Business subtype remains a manual prerequisite, and token binding, scopes, and expiry remain blocked until the debugger transport exception is approved.",
  });
}
