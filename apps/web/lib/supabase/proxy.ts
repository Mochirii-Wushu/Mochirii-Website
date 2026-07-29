import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { protectedPageContentSecurityPolicy } from "../security/protected-csp.ts";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "./auth-cookie-policy.ts";
import { PRIVATE_RAFFLE_HEADERS } from "./raffle-response-policy.ts";
import { supabaseServerFetch } from "./server-fetch.ts";

function applyPrivateHeaders(response: NextResponse, contentSecurityPolicy: string) {
  Object.entries(PRIVATE_RAFFLE_HEADERS).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export async function refreshSupabaseSession(request: NextRequest) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const contentSecurityPolicy = protectedPageContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  function protectedResponse() {
    return applyPrivateHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      contentSecurityPolicy,
    );
  }

  let response = protectedResponse();
  if (!supabaseUrl || !publishableKey) return response;

  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
    global: {
      fetch: supabaseServerFetch,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = protectedResponse();
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch {
    // The request-scoped DAL remains authoritative and fails closed.
  }
  return applyPrivateHeaders(response, contentSecurityPolicy);
}
