import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  constantTimeEquals,
  parsePixelfedSocialSyncPayload,
  PIXELFED_SOCIAL_SYNC_SECRET_HEADER,
  type JsonRecord,
} from "../_shared/pixelfed-social-sync.ts";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";
import { currentMemberAccess } from "../_shared/member-access-policy.ts";
import { buildSocialServiceEntitlement } from "../_shared/social-service-entitlement.ts";
import {
  asRecord,
  resolveDiscordIdentity,
} from "../_shared/member-verification-identity.ts";

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function verifySyncSecret(req: Request): boolean {
  const expected = Deno.env.get("PIXELFED_SOCIAL_SYNC_SECRET") || "";
  const actual = req.headers.get(PIXELFED_SOCIAL_SYNC_SECRET_HEADER) || "";
  return Boolean(expected && actual && constantTimeEquals(actual, expected));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (!verifySyncSecret(req)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("sync-pixelfed-social-account missing Supabase service configuration", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });
    return jsonResponse({ ok: false, error: "service_not_configured" }, 500);
  }

  let payload;
  try {
    payload = parsePixelfedSocialSyncPayload(await req.json());
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_payload",
        message: error instanceof Error ? error.message : "Invalid payload.",
      },
      400,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const [
    { data: userData, error: userError },
    { data: profileData, error: profileError },
  ] = await Promise.all([
    adminClient.auth.admin.getUserById(payload.sub),
    adminClient
      .from("member_profiles")
      .select("id,member_status,discord_user_id,has_required_discord_roles,discord_verified_at")
      .eq("id", payload.sub)
      .maybeSingle(),
  ]);

  if (userError || !userData?.user?.id) {
    console.warn("sync-pixelfed-social-account rejected unknown user", {
      message: userError?.message || "Missing user",
    });
    return jsonResponse({ ok: false, error: "unknown_user" }, 404);
  }

  if (profileError) {
    console.error("sync-pixelfed-social-account profile lookup failed", {
      code: profileError.code,
      message: profileError.message,
    });
    return jsonResponse({ ok: false, error: "profile_lookup_failed" }, 500);
  }

  const now = new Date().toISOString();
  const entitlementEvaluatedAtMs = Date.now();
  const user = asRecord(userData.user);
  const access = currentMemberAccess({
    profile: profileData ? asRecord(profileData) : null,
    verification: null,
    trustedDiscordUserId: resolveDiscordIdentity(user),
    nowMs: entitlementEvaluatedAtMs,
  });
  const socialEntitlement = buildSocialServiceEntitlement({
    memberStatus: profileData?.member_status,
    discordVerified: access.discordVerified,
    discordVerifiedAt: profileData?.discord_verified_at,
    evaluatedAtMs: entitlementEvaluatedAtMs,
  });

  if (!socialEntitlement.allowed) {
    const { error: revokeError } = await adminClient
      .from("social_accounts")
      .update({
        status: "revoked",
        profile_link_visible: false,
        federation_enabled: false,
        revoked_at: now,
        last_synced_at: now,
      })
      .eq("user_id", payload.sub)
      .eq("provider", "pixelfed");

    if (revokeError) {
      console.error("sync-pixelfed-social-account access revocation failed", {
        code: revokeError.code,
        message: revokeError.message,
      });
      return jsonResponse({ ok: false, error: "access_revocation_failed" }, 500);
    }

    return jsonResponse({ ok: false, error: "current_member_access_required" }, 403);
  }

  const socialAccount: JsonRecord = {
    user_id: payload.sub,
    member_profile_id: profileData?.id || null,
    provider: "pixelfed",
    provider_subject: payload.sub,
    provider_user_id: payload.provider_user_id,
    username: payload.username,
    profile_url: payload.profile_url,
    status: "active",
    federation_enabled: false,
    last_synced_at: now,
    revoked_at: null,
  };
  if (payload.event === "login" || payload.event === "account_created") {
    socialAccount.last_login_at = now;
  }

  const { error: upsertError } = await adminClient
    .from("social_accounts")
    .upsert(
      socialAccount,
      { onConflict: "user_id,provider" },
    );

  if (upsertError) {
    console.error("sync-pixelfed-social-account upsert failed", {
      code: upsertError.code,
      message: upsertError.message,
    });
    return jsonResponse({ ok: false, error: "social_account_upsert_failed" }, 500);
  }

  return jsonResponse({
    ok: true,
    status: "synced",
    profileUrl: payload.profile_url,
  });
});
