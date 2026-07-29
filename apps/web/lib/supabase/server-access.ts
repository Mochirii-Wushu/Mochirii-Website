import "server-only";

import { cache } from "react";
import { validateSpinnerModeratorToken } from "@/lib/spinner/session-policy";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import {
  resolveVerifiedServerSession,
  type VerifiedServerSession,
} from "./server-access-policy";
import { createServerComponentSupabaseContext } from "./server-client";

export type { VerifiedServerSession } from "./server-access-policy";

export const getVerifiedServerSession = cache(async (): Promise<VerifiedServerSession> => {
  const context = await createServerComponentSupabaseContext();
  if (!context) return { ok: false, reason: "unavailable" };

  return resolveVerifiedServerSession({
    credentialPresent: context.credentialPresent,
    auth: {
      getSession: () => context.client.auth.getSession(),
      getClaims: (accessToken) => context.client.auth.getClaims(accessToken),
    },
  });
});

export async function verifyServerModeratorAccess(accessToken: string) {
  return validateSpinnerModeratorToken({
    accessToken,
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  });
}
