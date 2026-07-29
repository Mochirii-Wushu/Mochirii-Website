import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSupabaseConfigured,
  SUPABASE_AUTH_COOKIE_OPTIONS,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config";

let rafflePublicClient: SupabaseClient | null = null;

export function requireRafflePublicClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase public environment variables are not configured.");
  }
  if (!rafflePublicClient) {
    rafflePublicClient = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
      auth: {
        flowType: "pkce",
        detectSessionInUrl: false,
      },
    });
  }
  return rafflePublicClient;
}
