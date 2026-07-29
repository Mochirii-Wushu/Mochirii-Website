const DEFAULT_AUTH_RETURN_PATH = "/account";

const SIMPLE_AUTH_RETURN_PATHS = new Set([
  "/account",
  "/gallery-submit",
  "/games/mochi-pets",
  "/leader-dashboard",
  "/leader-dashboard/raffle",
  "/raffle/claim",
  "/social",
]);

const MAX_RETURN_PATH_LENGTH = 1_024;
const MAX_AUTHORIZATION_ID_LENGTH = 512;

function safeLocalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (
    !raw ||
    raw.length > MAX_RETURN_PATH_LENGTH ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) return null;

  try {
    const url = new URL(raw, "https://auth.mochirii.invalid");
    return url.origin === "https://auth.mochirii.invalid" ? url : null;
  } catch {
    return null;
  }
}

function oauthConsentReturnPath(url: URL) {
  if (url.pathname !== "/oauth/consent" || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  const authorizationIds = url.searchParams.getAll("authorization_id");
  const authorizationId = authorizationIds[0] || "";
  if (
    keys.some((key) => key !== "authorization_id") ||
    authorizationIds.length !== 1 ||
    authorizationId.length < 1 ||
    authorizationId.length > MAX_AUTHORIZATION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(authorizationId)
  ) return null;

  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

export function resolveAuthReturnPath(value: unknown) {
  const url = safeLocalUrl(value);
  if (!url) return DEFAULT_AUTH_RETURN_PATH;
  if (SIMPLE_AUTH_RETURN_PATHS.has(url.pathname) && !url.search && !url.hash) {
    return url.pathname;
  }
  return oauthConsentReturnPath(url) || DEFAULT_AUTH_RETURN_PATH;
}

export function authCallbackPath(value: unknown) {
  return `/auth/callback?next=${encodeURIComponent(resolveAuthReturnPath(value))}`;
}

export function authLoginPath(value: unknown) {
  return `/auth?redirect=${encodeURIComponent(resolveAuthReturnPath(value))}`;
}
