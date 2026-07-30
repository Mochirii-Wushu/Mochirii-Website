import {
  fetchMetaGraphOnce,
  META_GRAPH_API_VERSION,
  META_TOKEN_DEBUG_QUERY_TRANSPORT_NOT_APPROVED,
  metaTokenDebuggerTransportApproved,
  readBoundedMetaGraphJson,
} from "./meta-graph-security.ts";

const META_ASSET_ID_RE = /^\d{5,30}$/;

export type InstagramPageLinkageResult = {
  requestAttempted: boolean;
  runtimePageMatchesPin: boolean;
  runtimeInstagramAccountMatchesPin: boolean;
  facebookPageReachable: boolean;
  facebookPageIdentityMatches: boolean;
  instagramBusinessAccountPresent: boolean;
  instagramBusinessAccountMatches: boolean;
  verified: boolean;
};

type InstagramPageLinkageOptions = {
  accessToken: string;
  appSecret: string;
  runtimePageId: string;
  expectedPageId: string;
  runtimeInstagramAccountId: string;
  expectedInstagramAccountId: string;
  fetchImpl?: typeof fetch;
  nowUnixSeconds?: () => number;
  timeoutMs?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function emptyInstagramPageLinkage(values: {
  runtimePageMatchesPin: boolean;
  runtimeInstagramAccountMatchesPin: boolean;
  requestAttempted?: boolean;
}): InstagramPageLinkageResult {
  return {
    requestAttempted: values.requestAttempted === true,
    runtimePageMatchesPin: values.runtimePageMatchesPin,
    runtimeInstagramAccountMatchesPin: values.runtimeInstagramAccountMatchesPin,
    facebookPageReachable: false,
    facebookPageIdentityMatches: false,
    instagramBusinessAccountPresent: false,
    instagramBusinessAccountMatches: false,
    verified: false,
  };
}

export async function readInstagramPageLinkageOnce(
  options: InstagramPageLinkageOptions,
): Promise<InstagramPageLinkageResult> {
  const runtimePageMatchesPin = META_ASSET_ID_RE.test(options.expectedPageId) &&
    options.runtimePageId === options.expectedPageId;
  const runtimeInstagramAccountMatchesPin = META_ASSET_ID_RE.test(
    options.expectedInstagramAccountId,
  ) &&
    options.runtimeInstagramAccountId === options.expectedInstagramAccountId;
  if (
    !options.accessToken || !options.appSecret || !runtimePageMatchesPin ||
    !runtimeInstagramAccountMatchesPin
  ) {
    return emptyInstagramPageLinkage({
      runtimePageMatchesPin,
      runtimeInstagramAccountMatchesPin,
    });
  }

  const response = await fetchMetaGraphOnce({
    accessToken: options.accessToken,
    appSecret: options.appSecret,
    path: options.runtimePageId,
    query: { fields: "id,instagram_business_account" },
    fetchImpl: options.fetchImpl,
    nowUnixSeconds: options.nowUnixSeconds,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  const body = await readBoundedMetaGraphJson(response);
  const linkedAccount = asRecord(body.instagram_business_account);
  const facebookPageIdentityMatches = response.ok &&
    body.id === options.expectedPageId;
  const instagramBusinessAccountPresent = response.ok &&
    META_ASSET_ID_RE.test(String(linkedAccount.id ?? ""));
  const instagramBusinessAccountMatches = instagramBusinessAccountPresent &&
    linkedAccount.id === options.expectedInstagramAccountId;

  return {
    requestAttempted: true,
    runtimePageMatchesPin,
    runtimeInstagramAccountMatchesPin,
    facebookPageReachable: response.ok,
    facebookPageIdentityMatches,
    instagramBusinessAccountPresent,
    instagramBusinessAccountMatches,
    verified: facebookPageIdentityMatches && instagramBusinessAccountMatches,
  };
}

export type MetaProviderDiagnosticInput = {
  provider: "facebook_page" | "instagram";
  configured: boolean;
  publishEnabled: boolean;
  identityReachable?: boolean;
  identityMatches?: boolean;
  createContentTaskVerified?: boolean;
  facebookPageReachable?: boolean;
  facebookPageIdentityMatches?: boolean;
  instagramBusinessAccountPresent?: boolean;
  instagramBusinessAccountMatches?: boolean;
  pageToInstagramLinkageVerified?: boolean;
  quotaReadable?: boolean;
  quotaExhausted?: boolean;
  providerErrorCategory?: string | null;
  checkedAt?: Date;
};

const ERROR_CATEGORY_RE = /^[a-z][a-z0-9_]{0,79}$/;

function safeCategory(value: unknown): string | null {
  const category = String(value ?? "").trim().toLowerCase();
  return ERROR_CATEGORY_RE.test(category) ? category : null;
}

export function metaProviderDiagnosticPayload(
  values: MetaProviderDiagnosticInput,
): Record<string, unknown> {
  const debugTransportApproved = metaTokenDebuggerTransportApproved();
  const providerErrorCategory = safeCategory(values.providerErrorCategory);
  return {
    provider: values.provider,
    configured: values.configured,
    apiVersion: META_GRAPH_API_VERSION,
    publishEnabled: values.publishEnabled,
    tokenDebuggerCalled: false,
    tokenDebuggerTransportApproved: debugTransportApproved,
    tokenBindingVerified: false,
    tokenTypeVerified: false,
    scopesVerified: false,
    expiryVerified: false,
    dataAccessExpiryVerified: false,
    tokenExpiryWindow: null,
    dataAccessExpiryWindow: null,
    identityReachable: values.identityReachable === true,
    identityMatches: values.identityMatches === true,
    createContentTaskVerified: values.provider === "facebook_page"
      ? values.createContentTaskVerified === true
      : null,
    facebookPageReachable: values.provider === "instagram"
      ? values.facebookPageReachable === true
      : null,
    facebookPageIdentityMatches: values.provider === "instagram"
      ? values.facebookPageIdentityMatches === true
      : null,
    instagramBusinessAccountPresent: values.provider === "instagram"
      ? values.instagramBusinessAccountPresent === true
      : null,
    instagramBusinessAccountMatches: values.provider === "instagram"
      ? values.instagramBusinessAccountMatches === true
      : null,
    pageToInstagramLinkageVerified: values.provider === "instagram"
      ? values.pageToInstagramLinkageVerified === true
      : null,
    quotaReadable: values.provider === "instagram"
      ? values.quotaReadable === true
      : null,
    quotaExhausted: values.provider === "instagram"
      ? values.quotaExhausted === true
      : null,
    businessAccountSubtypeVerification: values.provider === "instagram"
      ? "manual_required"
      : null,
    ready: false,
    errorCategory: META_TOKEN_DEBUG_QUERY_TRANSPORT_NOT_APPROVED,
    providerErrorCategory,
    checkedAt: (values.checkedAt || new Date()).toISOString(),
  };
}
