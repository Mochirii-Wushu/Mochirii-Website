import type { SupabaseClient, User } from "@supabase/supabase-js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifiedAuthenticatedUser = {
  user: User;
  userId: string;
};

/**
 * Establishes identity from verified access-token claims before performing the
 * authoritative Auth user lookup used for revocation and current-account
 * checks. Authorization must be derived from server-owned profile data, never
 * from user-editable metadata on the returned user.
 */
export async function verifyAuthenticatedUser(
  auth: SupabaseClient["auth"],
  accessToken: string,
): Promise<VerifiedAuthenticatedUser | null> {
  try {
    const { data: claimsData, error: claimsError } = await auth.getClaims(
      accessToken,
    );
    if (claimsError || !claimsData?.claims) return null;

    const claims = claimsData.claims;
    const subject = typeof claims.sub === "string" ? claims.sub : "";
    const audience = claims.aud;
    const authenticatedAudience = audience === "authenticated" ||
      (Array.isArray(audience) && audience.includes("authenticated"));
    if (
      !UUID_RE.test(subject) ||
      claims.role !== "authenticated" ||
      !authenticatedAudience ||
      claims.is_anonymous === true
    ) {
      return null;
    }

    const { data: userData, error: userError } = await auth.getUser(
      accessToken,
    );
    const user = userData.user;
    if (
      userError || !user || user.id !== subject || user.is_anonymous === true
    ) {
      return null;
    }

    return { user, userId: subject };
  } catch {
    return null;
  }
}
