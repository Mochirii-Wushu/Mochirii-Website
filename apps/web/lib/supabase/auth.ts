import type { SpinnerAccessMode } from "@/lib/spinner/session-policy";
import {
  AUTH_PROVIDER_REGISTRY,
  isOAuthProviderId,
  providerToSupabaseProvider,
  type OAuthProviderId,
} from "./auth-providers";
import { authCallbackPath, resolveAuthReturnPath } from "./auth-redirect";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "./raffle-auth-paths";
import {
  clearLegacyBrowserAuthStorage,
  requireReadyBrowserSupabaseClient,
} from "./client";
import { getCurrentSession, getCurrentUser } from "./auth-session";
export { getCurrentSession, getCurrentUser, onAuthStateChange, requireAuth } from "./auth-session";
import { failedResult, okResult } from "./types";

function resolveRedirectTo(value = "/account") {
  const callback = authCallbackPath(
    resolveAuthReturnPath(value, PRIVATE_RAFFLE_AUTH_RETURN_PATHS),
    PRIVATE_RAFFLE_AUTH_RETURN_PATHS,
  );
  if (typeof window === "undefined") return callback;
  return new URL(callback, window.location.origin).href;
}

export async function signInWithProvider(provider: OAuthProviderId, options: { redirectTo?: string } = {}) {
  try {
    if (!isOAuthProviderId(provider)) throw new Error("That sign-in provider is not supported.");

    const client = await requireReadyBrowserSupabaseClient();
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

    const client = await requireReadyBrowserSupabaseClient();
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
    const client = await requireReadyBrowserSupabaseClient();
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
  shouldCreateUser = true,
}: {
  phone: string;
  captchaToken?: string;
  shouldCreateUser?: boolean;
}) {
  try {
    const cleanPhone = String(phone || "").trim();
    if (!cleanPhone) throw new Error("Enter a phone number before requesting a code.");

    const client = await requireReadyBrowserSupabaseClient();
    const { data, error } = await client.auth.signInWithOtp({
      phone: cleanPhone,
      options: {
        shouldCreateUser,
        ...(captchaToken ? { captchaToken } : {}),
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
    const cleanPhone = String(phone || "").trim();
    const cleanToken = String(token || "").trim();
    if (!cleanPhone || !cleanToken) throw new Error("Enter the phone number and verification code.");

    const client = await requireReadyBrowserSupabaseClient();
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
    const client = await requireReadyBrowserSupabaseClient();
    const { error } = await client.auth.signOut();
    clearLegacyBrowserAuthStorage();
    if (error) return failedResult(error);
    return okResult(true, "Signed out.");
  } catch (error) {
    clearLegacyBrowserAuthStorage();
    return failedResult(error);
  }
}
