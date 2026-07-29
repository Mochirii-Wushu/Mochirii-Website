import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeInternalRedirectPath } from "@/lib/auth-redirect";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

function redirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), {
    headers: NO_STORE_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  const code = String(request.nextUrl.searchParams.get("code") || "").trim();
  const next = safeInternalRedirectPath(request.nextUrl.searchParams.get("next"));
  if (!code || code.length > 2_048 || !isSupabaseConfigured()) {
    return redirect(request, "/auth?error=session");
  }

  let response = redirect(request, next);
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
        response = redirect(request, next);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await client.auth.exchangeCodeForSession(code);
  return error ? redirect(request, "/auth?error=session") : response;
}
