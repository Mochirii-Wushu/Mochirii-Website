import { NextRequest, NextResponse } from "next/server";
import { resolveAuthReturnPath } from "@/lib/supabase/auth-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

function redirectResponse(url: URL) {
  return NextResponse.redirect(url, {
    status: 303,
    headers: PRIVATE_HEADERS,
  });
}

function failedSignInUrl(request: NextRequest, nextPath: string) {
  const url = new URL("/auth", request.url);
  url.searchParams.set("redirect", nextPath);
  url.searchParams.set("error", "sign_in_failed");
  return url;
}

export async function GET(request: NextRequest) {
  const queryKeys = [...request.nextUrl.searchParams.keys()];
  const nextValues = request.nextUrl.searchParams.getAll("next");
  const codeValues = request.nextUrl.searchParams.getAll("code");
  const nextPath = resolveAuthReturnPath(nextValues.length === 1 ? nextValues[0] : null);
  const code = String(codeValues.length === 1 ? codeValues[0] : "").trim();
  if (
    queryKeys.some((key) => key !== "code" && key !== "next")
    || nextValues.length > 1
    || codeValues.length !== 1
    || !code
    || code.length > 4_096
  ) {
    return redirectResponse(failedSignInUrl(request, nextPath));
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return redirectResponse(failedSignInUrl(request, nextPath));

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectResponse(failedSignInUrl(request, nextPath));

  return redirectResponse(new URL(nextPath, request.url));
}
