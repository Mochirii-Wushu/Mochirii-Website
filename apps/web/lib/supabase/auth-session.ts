import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  requireBrowserSupabaseClient,
  requireReadyBrowserSupabaseClient,
} from "./client";
import {
  createError,
  createResult,
  failedResult,
  okResult,
  type AuthSessionResult,
  type AuthUserResult,
} from "./types";

export async function getCurrentSession() {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) return failedResult<AuthSessionResult>(error);
    return okResult<AuthSessionResult>({ session: data.session || null });
  } catch (error) {
    return failedResult<AuthSessionResult>(error);
  }
}

export async function getCurrentUser() {
  try {
    const client = await requireReadyBrowserSupabaseClient();
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

export async function requireAuth() {
  return getCurrentUser();
}
