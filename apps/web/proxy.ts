import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { protectedPageContentSecurityPolicy } from "./lib/security/protected-csp.ts";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./lib/supabase/config.ts";
import {
  SPINNER_PRIVATE_RESPONSE_HEADERS,
  SPINNER_SESSION_COOKIE,
  decodeSpinnerSessionCookie,
  validateSpinnerAccessTokenForMode,
} from "./lib/spinner/session-policy.ts";

const SPINNER_PAGE_PATH = "/spinner";
const SUPABASE_SESSION_PATHS = new Set(["/leader-dashboard", "/oauth/consent"]);

async function refreshSupabaseSession(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const contentSecurityPolicy = protectedPageContentSecurityPolicy(nonce);

  function protectedResponse() {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
    requestHeaders.set("x-nonce", nonce);
    const nextResponse = NextResponse.next({ request: { headers: requestHeaders } });
    nextResponse.headers.set("Content-Security-Policy", contentSecurityPolicy);
    nextResponse.headers.set("Cache-Control", "private, no-store, max-age=0");
    nextResponse.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
    return nextResponse;
  }

  if (!isSupabaseConfigured()) return protectedResponse();

  let response = protectedResponse();
  const client = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "pkce",
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

  await client.auth.getClaims();
  return response;
}

function clearSpinnerCookie(response: NextResponse) {
  response.cookies.set({
    name: SPINNER_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: SPINNER_PAGE_PATH,
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

function opaqueDenied() {
  return clearSpinnerCookie(new NextResponse(null, {
    status: 404,
    headers: SPINNER_PRIVATE_RESPONSE_HEADERS,
  }));
}

export async function proxy(request: NextRequest) {
  if (SUPABASE_SESSION_PATHS.has(request.nextUrl.pathname)) {
    return refreshSupabaseSession(request);
  }

  // The matcher is intentionally exact. Keep this guard so a future matcher
  // expansion cannot put the session, live-state, or media handlers behind
  // the page preflight by accident.
  if (
    request.nextUrl.pathname !== SPINNER_PAGE_PATH &&
    request.nextUrl.pathname !== `${SPINNER_PAGE_PATH}/`
  ) return NextResponse.next();
  if (request.method !== "GET" && request.method !== "HEAD") return opaqueDenied();

  const session = decodeSpinnerSessionCookie(
    request.cookies.get(SPINNER_SESSION_COOKIE)?.value || "",
  );
  if (!session) return opaqueDenied();

  const access = await validateSpinnerAccessTokenForMode({
    mode: session.mode,
    accessToken: session.accessToken,
    supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, ""),
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
  });
  if (!access.ok || access.mode !== session.mode) return opaqueDenied();

  return NextResponse.next();
}

export const config = {
  matcher: ["/spinner", "/leader-dashboard", "/oauth/consent"],
};
