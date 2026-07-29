import { requireReadyBrowserSupabaseClient } from "./client";
import { createError, createResult, failedResult, okResult, type SocialAccount } from "./types";

const socialAccountFields =
  "id,user_id,member_profile_id,provider,provider_subject,provider_user_id,username,profile_url,status,profile_link_visible,federation_enabled,last_login_at,last_synced_at,revoked_at,created_at,updated_at";

export async function listMySocialAccounts() {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    const { data, error, status, statusText } = await client
      .from("social_accounts")
      .select(socialAccountFields)
      .order("provider", { ascending: true });

    if (error) {
      return createResult<SocialAccount[]>({
        ok: false,
        status,
        statusText,
        data: [],
        error: createError(error),
      });
    }

    return okResult((Array.isArray(data) ? data : []) as SocialAccount[]);
  } catch (error) {
    return failedResult<SocialAccount[]>(error, []);
  }
}
