import "server-only";

import { cache } from "react";
import { validateSpinnerModeratorToken } from "@/lib/spinner/session-policy";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { createServerComponentSupabaseClient } from "./server-client";

const MAX_ACCESS_TOKEN_LENGTH = 4_096;

export type VerifiedServerSession =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; reason: "signed-out" | "unavailable" };

export const getVerifiedServerSession = cache(async (): Promise<VerifiedServerSession> => {
  const client = await createServerComponentSupabaseClient();
  if (!client) return { ok: false, reason: "unavailable" };

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token || "";
  if (sessionResult.error || !accessToken) return { ok: false, reason: "signed-out" };
  if (accessToken.length > MAX_ACCESS_TOKEN_LENGTH) return { ok: false, reason: "signed-out" };

  const claimsResult = await client.auth.getClaims(accessToken);
  const userId = String(claimsResult.data?.claims?.sub || "").trim();
  if (claimsResult.error || !userId) return { ok: false, reason: "signed-out" };

  return { ok: true, accessToken, userId };
});

export async function verifyServerModeratorAccess(accessToken: string) {
  return validateSpinnerModeratorToken({
    accessToken,
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  });
}
