const MAX_ACCESS_CREDENTIAL_LENGTH = 4_096;

export type VerifiedServerSession =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; reason: "signed-out" | "unavailable" };

type AuthSessionResult = {
  data: { session: { access_token?: string | null } | null };
  error: unknown;
};

type AuthClaimsResult = {
  data: { claims?: { sub?: unknown } | null } | null;
  error: unknown;
};

export type ServerAuthReader = {
  getSession: () => Promise<AuthSessionResult>;
  getClaims: (accessToken: string) => Promise<AuthClaimsResult>;
};

type AuthFailureReason = Extract<VerifiedServerSession, { ok: false }>["reason"];

function field(error: unknown, key: "name" | "code") {
  if (!error || typeof error !== "object" || !(key in error)) return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function status(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const value = (error as Record<string, unknown>).status;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function classifyServerAuthFailure({
  error,
  credentialPresent,
}: {
  error: unknown;
  credentialPresent: boolean;
}): AuthFailureReason {
  if (!credentialPresent) return "signed-out";

  const errorName = field(error, "name");
  const errorCode = field(error, "code");
  const errorStatus = status(error);

  if (
    errorName === "AuthSessionMissingError" ||
    errorName === "AuthInvalidJwtError" ||
    errorName === "AuthRefreshDiscardedError" ||
    errorCode === "invalid_jwt" ||
    errorCode === "session_not_found" ||
    errorCode === "refresh_token_not_found" ||
    errorCode === "refresh_token_already_used" ||
    errorStatus === 400 ||
    errorStatus === 401 ||
    errorStatus === 403
  ) {
    return "signed-out";
  }

  if (errorName === "AuthRetryableFetchError" || errorStatus === 0 || (errorStatus !== null && errorStatus >= 500)) {
    return "unavailable";
  }

  // With an auth cookie present, an unclassified SDK or network failure must
  // not be presented as a logout. The protected page still fails closed.
  return "unavailable";
}

export async function resolveVerifiedServerSession({
  credentialPresent,
  auth,
}: {
  credentialPresent: boolean;
  auth: ServerAuthReader;
}): Promise<VerifiedServerSession> {
  if (!credentialPresent) return { ok: false, reason: "signed-out" };

  // The session is used only to obtain the bearer. Authorization remains
  // blocked until getClaims verifies that bearer below.
  let sessionResult: AuthSessionResult;
  try {
    sessionResult = await auth.getSession();
  } catch (error) {
    return { ok: false, reason: classifyServerAuthFailure({ error, credentialPresent }) };
  }

  if (sessionResult.error) {
    return {
      ok: false,
      reason: classifyServerAuthFailure({ error: sessionResult.error, credentialPresent }),
    };
  }

  const accessToken = String(sessionResult.data.session?.access_token || "");
  if (!accessToken || accessToken.length > MAX_ACCESS_CREDENTIAL_LENGTH) {
    return { ok: false, reason: "signed-out" };
  }

  let claimsResult: AuthClaimsResult;
  try {
    claimsResult = await auth.getClaims(accessToken);
  } catch (error) {
    return { ok: false, reason: classifyServerAuthFailure({ error, credentialPresent: true }) };
  }

  if (claimsResult.error) {
    return {
      ok: false,
      reason: classifyServerAuthFailure({ error: claimsResult.error, credentialPresent: true }),
    };
  }

  const userId = String(claimsResult.data?.claims?.sub || "").trim();
  if (!userId) return { ok: false, reason: "signed-out" };

  return { ok: true, accessToken, userId };
}

export function supabaseAuthCookieStorageKey(supabaseUrl: string) {
  try {
    const projectRef = new URL(supabaseUrl).hostname.toLowerCase().split(".")[0] || "";
    return /^[a-z0-9-]+$/.test(projectRef) ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export function hasSupabaseAuthCookie(cookieNames: readonly string[], supabaseUrl: string) {
  const storageKey = supabaseAuthCookieStorageKey(supabaseUrl);
  if (!storageKey) return false;
  return cookieNames.some((name) => name === storageKey || new RegExp(`^${storageKey}\\.\\d+$`).test(name));
}

export type ModeratorAccessResult =
  | { ok: true }
  | { ok: false; reason: "invalid-token" | "missing-config" | "denied" | "rate-limited" | "upstream" };

export function leaderDashboardAccessDisposition(access: ModeratorAccessResult) {
  if (access.ok) return "authorized" as const;
  if (access.reason === "denied" || access.reason === "invalid-token") return "not-found" as const;
  return "unavailable" as const;
}
