import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { hasSupabaseAuthCookie } from "./server-access-policy";

export async function createServerComponentSupabaseContext() {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();
  const client = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "pkce",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The request proxy refreshes
          // auth cookies before protected pages render.
        }
      },
    },
  });

  return {
    client,
    credentialPresent: hasSupabaseAuthCookie(cookieStore.getAll().map(({ name }) => name), SUPABASE_URL),
  };
}
