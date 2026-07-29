import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSupabaseConfigured,
  SUPABASE_AUTH_COOKIE_OPTIONS,
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config";
import {
  clearLegacyAuthStorage,
  runLegacyAuthCutover,
  safeLegacyAuthStorage,
  shouldRetireLegacyAuthForEvent,
  type LegacyAuthCutoverResult,
} from "./legacy-auth-cutover";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "./raffle-auth-paths";
import { createError, createResult, failedResult, okResult, type SupabaseResult } from "./types";

let browserClient: SupabaseClient | null = null;
let authCutoverPromise: Promise<LegacyAuthCutoverResult> | null = null;

function browserStorage() {
  return typeof window === "undefined" ? null : safeLegacyAuthStorage(() => window.localStorage);
}

function retireLegacyBrowserAuth() {
  const storage = browserStorage();
  if (storage) clearLegacyAuthStorage(storage, SUPABASE_AUTH_STORAGE_KEY);
}

function startAuthCutover(client: SupabaseClient) {
  if (authCutoverPromise) return authCutoverPromise;
  const storage = browserStorage();
  authCutoverPromise = runLegacyAuthCutover({
    auth: client.auth,
    storage,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    href: window.location.href,
    replaceUrl(cleanPath) {
      window.history.replaceState(window.history.state, "", cleanPath);
    },
    additionalSimplePaths: PRIVATE_RAFFLE_AUTH_RETURN_PATHS,
  });
  void authCutoverPromise.then(() => {
    client.auth.onAuthStateChange((event) => {
      if (shouldRetireLegacyAuthForEvent(event)) retireLegacyBrowserAuth();
    });
  });
  return authCutoverPromise;
}

export function getBrowserSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;

  browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
    },
  });
  startAuthCutover(browserClient);

  return browserClient;
}

export function requireBrowserSupabaseClient() {
  const client = getBrowserSupabaseClient();
  if (!client) throw new Error("Supabase public environment variables are not configured.");
  return client;
}

export async function requireReadyBrowserSupabaseClient() {
  const client = requireBrowserSupabaseClient();
  await startAuthCutover(client);
  return client;
}

export async function getBrowserAuthCutoverResult() {
  const client = requireBrowserSupabaseClient();
  return await startAuthCutover(client);
}

export function clearLegacyBrowserAuthStorage() {
  retireLegacyBrowserAuth();
}

async function parseFunctionError(error: unknown) {
  const context = error && typeof error === "object" ? (error as { context?: Response }).context : null;
  if (!context || typeof context.json !== "function") return null;

  try {
    return await context.json();
  } catch {
    return null;
  }
}

export async function invokeEdgeFunction<T>(functionName: string, body: Record<string, unknown> = {}): Promise<SupabaseResult<T>> {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    const { data, error } = await client.functions.invoke(functionName, { body });

    if (error) {
      const payload = await parseFunctionError(error);
      const context = error && typeof error === "object" ? (error as { context?: Response }).context : null;
      return createResult<T>({
        ok: false,
        status: context?.status || 0,
        statusText: context?.statusText || "Function Error",
        data: (payload as T) || null,
        error: createError(payload || error, "Supabase Edge Function request failed."),
        message:
          (payload && typeof payload === "object" && "message" in payload ? String(payload.message || "") : "") ||
          (error instanceof Error ? error.message : "") ||
          "Supabase Edge Function request failed.",
      });
    }

    if (data && typeof data === "object" && "ok" in data && data.ok === false) {
      return createResult<T>({
        ok: false,
        status: 200,
        statusText: "Function Error",
        data: data as T,
        error: createError(data, "Supabase Edge Function request failed."),
        message: "message" in data ? String(data.message || "") : "Supabase Edge Function request failed.",
      });
    }

    const payload = data && typeof data === "object" && "data" in data ? (data.data as T) : (data as T);
    const message = data && typeof data === "object" && "message" in data ? String(data.message || "") : null;
    return okResult(payload, message);
  } catch (error) {
    return failedResult<T>(error);
  }
}
