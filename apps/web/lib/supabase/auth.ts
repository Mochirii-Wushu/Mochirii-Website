import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { authCallbackPath, safeInternalRedirectPath } from "@/lib/auth-redirect";
import type { SpinnerAccessMode } from "@/lib/spinner/session-policy";
import {
  AUTH_PROVIDER_REGISTRY,
  isOAuthProviderId,
  phoneAuthReady,
  providerToSupabaseProvider,
  type OAuthProviderId,
} from "./auth-providers";
import { requireBrowserSupabaseClient } from "./client";
import { normalizePhoneForOtp, normalizePhoneOtpCode, requirePhoneCaptchaToken } from "./phone-auth-policy";
import { failedResult, okResult, createResult, createError, type AuthSessionResult, type AuthUserResult } from "./types";

export async function getCurrentSession() {
  try {
    const client = requireBrowserSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) return failedResult<AuthSessionResult>(error);
    return okResult<AuthSessionResult>({ session: data.session || null });
  } catch (error) {
    return failedResult<AuthSessionResult>(error);
  }
}

export async function getCurrentUser() {
  try {
    const client = requireBrowserSupabaseClient();
    const { data, error } = await client.auth.getUser();
    if (error) return failedResult<AuthUserResult>(error);
    if (!data.user) {
      return createResult<AuthUserResult>({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        data: null,
        error: createError("Choose a sign-in method first."),
      });
    }
    return okResult<AuthUserResult>({ user: data.user });
  } catch (error) {
    return failedResult<AuthUserResult>(error);
  }
}

export function onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
  try {
    const client = requireBrowserSupabaseClient();
    return okResult(client.auth.onAuthStateChange(callback).data);
  } catch (error) {
    return failedResult(error);
  }
}

function resolveRedirectTo(value = "/account") {
  if (typeof window === "undefined") return value;
  return new URL(authCallbackPath(safeInternalRedirectPath(value)), window.location.origin).href;
}

export async function signInWithProvider(provider: OAuthProviderId, options: { redirectTo?: string } = {}) {
  try {
    if (!isOAuthProviderId(provider)) throw new Error("That sign-in provider is not supported.");

    const client = requireBrowserSupabaseClient();
    const config = AUTH_PROVIDER_REGISTRY[provider];
    const { data, error } = await client.auth.signInWithOAuth({
      provider: providerToSupabaseProvider(provider),
      options: {
        redirectTo: resolveRedirectTo(options.redirectTo || "/account"),
        ...(config.scopes ? { scopes: config.scopes } : {}),
      },
    });
    if (error) return failedResult(error);
    return okResult(data);
  } catch (error) {
    return failedResult(error);
  }
}

export async function linkProviderIdentity(provider: OAuthProviderId, options: { redirectTo?: string } = {}) {
  try {
    if (!isOAuthProviderId(provider)) throw new Error("That sign-in provider is not supported.");

    const client = requireBrowserSupabaseClient();
    const config = AUTH_PROVIDER_REGISTRY[provider];
    const { data, error } = await client.auth.linkIdentity({
      provider: providerToSupabaseProvider(provider),
      options: {
        redirectTo: resolveRedirectTo(options.redirectTo || "/account"),
        ...(config.scopes ? { scopes: config.scopes } : {}),
      },
    });
    if (error) return failedResult(error);
    return okResult(data);
  } catch (error) {
    return failedResult(error);
  }
}

export async function getLinkedIdentities() {
  try {
    const client = requireBrowserSupabaseClient();
    const authWithIdentities = client.auth as typeof client.auth & {
      getUserIdentities?: () => Promise<{ data?: { identities?: unknown[] } | unknown[] | null; error?: unknown }>;
    };
    if (typeof authWithIdentities.getUserIdentities === "function") {
      const { data, error } = await authWithIdentities.getUserIdentities();
      if (error) return failedResult(error);
      const identities = Array.isArray(data) ? data : Array.isArray(data?.identities) ? data.identities : [];
      return okResult(identities);
    }

    const user = await getCurrentUser();
    if (!user.ok) return user;
    return okResult(Array.isArray(user.data?.user.identities) ? user.data.user.identities : []);
  } catch (error) {
    return failedResult(error);
  }
}

export async function signInWithPhoneOtp({
  phone,
  captchaToken,
}: {
  phone: string;
  captchaToken: string;
}) {
  try {
    if (!phoneAuthReady()) throw new Error("Phone sign-in is unavailable.");
    const cleanPhone = normalizePhoneForOtp(phone);
    const cleanCaptchaToken = requirePhoneCaptchaToken(captchaToken);

    const client = requireBrowserSupabaseClient();
    const { data, error } = await client.auth.signInWithOtp({
      phone: cleanPhone,
      options: {
        shouldCreateUser: false,
        captchaToken: cleanCaptchaToken,
      },
    });
    if (error) return failedResult(error);
    return okResult(data, "Code sent. Check your phone.");
  } catch (error) {
    return failedResult(error);
  }
}

export async function verifyPhoneOtp({ phone, token }: { phone: string; token: string }) {
  try {
    if (!phoneAuthReady()) throw new Error("Phone sign-in is unavailable.");
    const cleanPhone = normalizePhoneForOtp(phone);
    const cleanToken = normalizePhoneOtpCode(token);

    const client = requireBrowserSupabaseClient();
    const { data, error } = await client.auth.verifyOtp({
      phone: cleanPhone,
      token: cleanToken,
      type: "sms",
    });
    if (error) return failedResult(error);
    return okResult(data, "Phone sign-in complete.");
  } catch (error) {
    return failedResult(error);
  }
}

export async function signInWithDiscord(options: { redirectTo?: string } = {}) {
  return signInWithProvider("discord", options);
}

async function requestPrivateSpinnerSession(init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch("/spinner/session", {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function openPrivateSpinnerSession(requestedMode: SpinnerAccessMode): Promise<
  { ok: true; mode: SpinnerAccessMode } | { ok: false }
> {
  if (typeof window === "undefined") return { ok: false };

  try {
    const sessionResult = await getCurrentSession();
    const accessToken = sessionResult.data?.session?.access_token || "";
    if (!sessionResult.ok || !accessToken) return { ok: false };

    const response = await requestPrivateSpinnerSession({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Spinner-Mode": requestedMode,
      },
    }, 8_000);
    const mode = response.headers.get("X-Spinner-Mode");
    if (response.status !== 204 || mode !== requestedMode) {
      return { ok: false };
    }
    return { ok: true, mode };
  } catch {
    return { ok: false };
  }
}

export async function openPrivateSpinnerViewerHandoff(): Promise<
  { ok: true; mode: SpinnerAccessMode } | { ok: false }
> {
  if (typeof window === "undefined") return { ok: false };

  try {
    const sessionResult = await getCurrentSession();
    const accessToken = sessionResult.data?.session?.access_token || "";
    if (!sessionResult.ok || !accessToken) return { ok: false };

    const response = await requestPrivateSpinnerSession({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Spinner-Mode": "viewer",
        "X-Spinner-Preserve-Session": "true",
      },
    }, 8_000);
    const mode = response.headers.get("X-Spinner-Mode");
    return response.status === 204 && (mode === "controller" || mode === "viewer")
      ? { ok: true, mode }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function clearPrivateSpinnerSession() {
  if (typeof window === "undefined") return;
  try {
    await requestPrivateSpinnerSession({
      method: "DELETE",
      headers: { Accept: "application/json" },
      keepalive: true,
    }, 4_000);
  } catch {
    // Server-issued spinner access remains bounded by its short expiry.
  }
}

export async function signOut() {
  try {
    await clearPrivateSpinnerSession();
    const client = requireBrowserSupabaseClient();
    const { error } = await client.auth.signOut();
    if (error) return failedResult(error);
    return okResult(true, "Signed out.");
  } catch (error) {
    return failedResult(error);
  }
}

export async function requireAuth() {
  return getCurrentUser();
}
