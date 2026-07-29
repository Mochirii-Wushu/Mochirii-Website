import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import {
  SPINNER_PRIVATE_RESPONSE_HEADERS,
  SPINNER_SESSION_COOKIE,
  decodeSpinnerSessionCookie,
  validateSpinnerAccessTokenForMode,
} from "./lib/spinner/session-policy.ts";
import { refreshSupabaseSession } from "./lib/supabase/proxy.ts";

const SPINNER_PAGE_PATH = "/spinner";

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
  // The matcher is intentionally exact. Keep this guard so a future matcher
  // expansion cannot put the session, live-state, or media handlers behind
  // the page preflight by accident.
  if (
    request.nextUrl.pathname !== SPINNER_PAGE_PATH &&
    request.nextUrl.pathname !== `${SPINNER_PAGE_PATH}/`
  ) return refreshSupabaseSession(request);
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
  matcher: [
    "/spinner",
    "/raffle/claim/:path*",
    "/leader-dashboard/raffle/:path*",
  ],
};
