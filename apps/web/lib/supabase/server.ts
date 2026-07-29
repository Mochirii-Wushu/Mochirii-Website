import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  isSupabaseConfigured,
  SUPABASE_AUTH_COOKIE_OPTIONS,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config";
import {
  strictRouteHandlerCookieMethods,
  tolerantServerComponentCookieMethods,
} from "./server-cookie-adapters";

function createCookieClient(cookieMethods: ReturnType<typeof strictRouteHandlerCookieMethods>) {
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
    cookies: cookieMethods,
  });
}

export async function createServerComponentSupabaseClient() {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();
  return createCookieClient(tolerantServerComponentCookieMethods(cookieStore));
}

export async function createRouteHandlerSupabaseClient() {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();
  return createCookieClient(strictRouteHandlerCookieMethods(cookieStore));
}
