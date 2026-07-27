import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isSupabaseConfigured,
  SUPABASE_AUTH_COOKIE_OPTIONS,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config";
import { PRIVATE_AUTH_HEADERS } from "./raffle-response-policy";

function applyPrivateHeaders(response: NextResponse, headers: Record<string, string> = {}) {
  Object.entries({ ...PRIVATE_AUTH_HEADERS, ...headers }).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  return response;
}

export async function refreshSupabaseSession(request: NextRequest) {
  let response = applyPrivateHeaders(NextResponse.next({ request }));
  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        applyPrivateHeaders(response, headers);
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch {
    // The page/DAL remains the authorization boundary and fails closed.
  }

  return applyPrivateHeaders(response);
}
