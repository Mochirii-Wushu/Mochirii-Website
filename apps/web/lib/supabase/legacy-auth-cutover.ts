import type { AuthChangeEvent } from "@supabase/supabase-js";
import { freshAuthLoginPath, reviewedAuthReturnPath } from "./auth-redirect.ts";

export const LEGACY_AUTH_MAX_BYTES = 65_536;
export const LEGACY_AUTH_MAX_TOKEN_CHARS = 32_768;
export const LEGACY_AUTH_CUTOVER_VERSION = "cookie-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function safeLegacyAuthStorage(getStorage: () => StorageLike) {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

type CutoverAuth = {
  getClaims: () => Promise<{ data?: { claims?: unknown } | null; error?: unknown }>;
  setSession: (session: { access_token: string; refresh_token: string }) => Promise<{
    data?: { session?: unknown } | null;
    error?: unknown;
  }>;
  signOut: (options: { scope: "local" }) => Promise<unknown>;
};

export type LegacyAuthCutoverResult = {
  status: "cookie-session" | "migrated" | "none" | "invalid" | "reauth-required" | "legacy-oauth";
  reauthPath?: string;
};

type LegacyOAuthCutover = {
  cleanPath: string;
  reauthPath: string;
};

function storageKeys(storageKey: string) {
  return [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`] as const;
}

function safeStorageValue(storage: StorageLike, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageRemove(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // An unavailable storage area cannot expose its contents to this page.
  }
}

function markOutcome(storage: StorageLike, storageKey: string, outcome: LegacyAuthCutoverResult["status"]) {
  try {
    storage.setItem(`${storageKey}-cookie-cutover`, `${LEGACY_AUTH_CUTOVER_VERSION}:${outcome}`);
  } catch {
    // The marker is nonessential and never carries identity or token material.
  }
}

export function clearLegacyAuthStorage(storage: StorageLike, storageKey: string) {
  storageKeys(storageKey).forEach((key) => safeStorageRemove(storage, key));
}

function boundedToken(value: unknown) {
  return typeof value === "string" && value.length >= 16 && value.length <= LEGACY_AUTH_MAX_TOKEN_CHARS
    && !/[\s\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

export function parseLegacyAuthSession(raw: unknown) {
  if (typeof raw !== "string" || !raw || new TextEncoder().encode(raw).byteLength > LEGACY_AUTH_MAX_BYTES) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = boundedToken(value?.access_token);
    const refreshToken = boundedToken(value?.refresh_token);
    return accessToken && refreshToken
      ? { access_token: accessToken, refresh_token: refreshToken }
      : null;
  } catch {
    return null;
  }
}

function hasVerifiedSubject(claims: unknown) {
  return Boolean(
    claims && typeof claims === "object" && !Array.isArray(claims)
      && typeof (claims as { sub?: unknown }).sub === "string"
      && (claims as { sub: string }).sub.trim(),
  );
}

const LEGACY_OAUTH_QUERY_KEYS = [
  "access_token",
  "code",
  "error",
  "error_description",
  "refresh_token",
] as const;

function hasLegacyOAuthResult(url: URL) {
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  return LEGACY_OAUTH_QUERY_KEYS.some((key) => url.searchParams.has(key) || fragment.has(key));
}

function reviewedAuthPageDestination(url: URL, additionalSimplePaths?: ReadonlySet<string>) {
  const redirects = url.searchParams.getAll("redirect");
  const keys = [...url.searchParams.keys()];
  if (redirects.length !== 1 || keys.some((key) => key !== "redirect")) return null;
  return reviewedAuthReturnPath(redirects[0], additionalSimplePaths);
}

export function legacyOAuthCutoverForUrl(
  href: string,
  additionalSimplePaths?: ReadonlySet<string>,
): LegacyOAuthCutover | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.pathname === "/auth/callback") return null;

  if (!hasLegacyOAuthResult(url)) return null;

  LEGACY_OAUTH_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  if (url.pathname === "/auth") {
    const returnPath = reviewedAuthPageDestination(url, additionalSimplePaths);
    return {
      cleanPath: returnPath ? `/auth?redirect=${encodeURIComponent(returnPath)}` : "/auth",
      reauthPath: freshAuthLoginPath(returnPath || "/account", additionalSimplePaths),
    };
  }

  const cleanPath = `${url.pathname}${url.search}`;
  const returnPath = reviewedAuthReturnPath(cleanPath, additionalSimplePaths);
  return returnPath
    ? { cleanPath, reauthPath: freshAuthLoginPath(returnPath, additionalSimplePaths) }
    : null;
}

export function shouldRetireLegacyAuthForEvent(event: AuthChangeEvent) {
  return event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "SIGNED_OUT";
}

export async function runLegacyAuthCutover({
  auth,
  storage,
  storageKey,
  href,
  replaceUrl,
  additionalSimplePaths,
}: {
  auth: CutoverAuth;
  storage: StorageLike | null;
  storageKey: string;
  href?: string;
  replaceUrl?: (cleanPath: string) => void;
  additionalSimplePaths?: ReadonlySet<string>;
}): Promise<LegacyAuthCutoverResult> {
  const oldOAuth = href ? legacyOAuthCutoverForUrl(href, additionalSimplePaths) : null;
  if (oldOAuth) {
    replaceUrl?.(oldOAuth.cleanPath);
    if (storage) {
      clearLegacyAuthStorage(storage, storageKey);
      markOutcome(storage, storageKey, "legacy-oauth");
    }
    await auth.signOut({ scope: "local" }).catch(() => undefined);
    return { status: "legacy-oauth", reauthPath: oldOAuth.reauthPath };
  }

  if (!storage) return { status: "none" };

  const raw = safeStorageValue(storage, storageKey);
  if (!raw) {
    clearLegacyAuthStorage(storage, storageKey);
    markOutcome(storage, storageKey, "none");
    return { status: "none" };
  }

  try {
    const claims = await auth.getClaims();
    if (!claims.error && hasVerifiedSubject(claims.data?.claims)) {
      clearLegacyAuthStorage(storage, storageKey);
      markOutcome(storage, storageKey, "cookie-session");
      return { status: "cookie-session" };
    }
  } catch {
    // Continue to the bounded legacy handoff and fail closed if it cannot validate.
  }

  const legacySession = parseLegacyAuthSession(raw);
  if (!legacySession) {
    clearLegacyAuthStorage(storage, storageKey);
    markOutcome(storage, storageKey, "invalid");
    await auth.signOut({ scope: "local" }).catch(() => undefined);
    return { status: "invalid", reauthPath: freshAuthLoginPath("/account") };
  }

  try {
    const result = await auth.setSession(legacySession);
    if (!result.error && result.data?.session) {
      clearLegacyAuthStorage(storage, storageKey);
      markOutcome(storage, storageKey, "migrated");
      return { status: "migrated" };
    }
  } catch {
    // The common failure path below clears every legacy token before reauth.
  }

  clearLegacyAuthStorage(storage, storageKey);
  markOutcome(storage, storageKey, "reauth-required");
  await auth.signOut({ scope: "local" }).catch(() => undefined);
  return { status: "reauth-required", reauthPath: freshAuthLoginPath("/account") };
}
