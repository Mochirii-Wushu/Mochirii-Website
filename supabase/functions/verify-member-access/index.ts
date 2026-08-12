import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  asRecord,
  asStringArray,
  defaultDisplayName,
  discordAvatarUrl,
  providerSubject,
  resolveDiscordIdentity,
  safeString,
  type JsonRecord,
} from "../_shared/member-verification-identity.ts";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";
import {
  currentMemberAccess,
  discordVerificationNeedsRefresh,
} from "../_shared/member-access-policy.ts";
import { buildSocialServiceEntitlement } from "../_shared/social-service-entitlement.ts";

type SyncedIdentity = {
  provider: string;
  provider_subject: string;
  provider_email: string | null;
  provider_email_verified: boolean;
  provider_phone: string | null;
  provider_phone_verified: boolean;
  display_label: string | null;
  active: boolean;
  first_observed_at?: string;
  last_observed_at: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 5_000;
const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const EXPECTED_REQUIRED_ROLE_IDS = ["1468659807736299520", "1078630751077142615"];
const APPROVED_PROVIDER_IDS = new Set(["discord", "phone", "apple", "facebook", "google", "kakao", "twitch", "spotify"]);
const NON_DISCORD_METHODS = new Set(["manual_review", "phone", "apple", "facebook", "google", "kakao", "twitch", "spotify"]);
const LOCKED_STATUSES = new Set(["suspended", "archived"]);

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function parseCsv(value: string | null | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

async function readOptionalBody(req: Request): Promise<JsonRecord> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return {};
  try {
    return asRecord(await req.json());
  } catch {
    return {};
  }
}


function identityDisplayLabel(provider: string, identityData: JsonRecord, user: JsonRecord): string | null {
  const metadata = asRecord(user.user_metadata);
  const email = safeString(identityData.email || user.email, 120);
  const phone = safeString(identityData.phone || user.phone, 40);
  return safeString(
    identityData.global_name ||
      identityData.full_name ||
      identityData.name ||
      identityData.preferred_username ||
      identityData.user_name ||
      identityData.username ||
      metadata.global_name ||
      metadata.full_name ||
      metadata.name ||
      email ||
      phone ||
      provider,
    120,
  );
}

function normalizeIdentity(identityValue: unknown, user: JsonRecord, now: string): SyncedIdentity | null {
  const identity = asRecord(identityValue);
  const provider = safeString(identity.provider, 40)?.toLowerCase();
  if (!provider || !APPROVED_PROVIDER_IDS.has(provider)) return null;

  const identityData = asRecord(identity.identity_data);
  const subject = providerSubject(provider, identity, identityData, user);
  if (!subject) return null;

  const email = safeString(identityData.email || user.email, 320);
  const phone = safeString(identityData.phone || user.phone, 40);
  return {
    provider,
    provider_subject: subject,
    provider_email: email,
    provider_email_verified: truthy(identityData.email_verified || identityData.verified_email),
    provider_phone: phone,
    provider_phone_verified: provider === "phone" || truthy(identityData.phone_verified),
    display_label: identityDisplayLabel(provider, identityData, user),
    active: true,
    last_observed_at: now,
  };
}

function phoneIdentity(user: JsonRecord, now: string): SyncedIdentity | null {
  const phone = safeString(user.phone, 40);
  if (!phone) return null;

  return {
    provider: "phone",
    provider_subject: phone,
    provider_email: null,
    provider_email_verified: false,
    provider_phone: phone,
    provider_phone_verified: true,
    display_label: phone,
    active: true,
    last_observed_at: now,
  };
}

function publicIdentity(identity: JsonRecord): JsonRecord {
  return {
    provider: safeString(identity.provider, 40),
    providerSubject: safeString(identity.provider_subject, 255),
    displayLabel: safeString(identity.display_label, 120),
    emailVerified: identity.provider_email_verified === true,
    phoneVerified: identity.provider_phone_verified === true,
    active: identity.active === true,
    lastObservedAt: safeString(identity.last_observed_at, 80),
  };
}

function publicVerification(verification: JsonRecord | null): JsonRecord | null {
  if (!verification) return null;
  return {
    status: safeString(verification.gallery_access_status, 40),
    method: safeString(verification.gallery_access_method, 40),
    verifiedAt: safeString(verification.gallery_access_verified_at, 80),
    expiresAt: safeString(verification.gallery_access_expires_at, 80),
    reviewedAt: safeString(verification.reviewed_at, 80),
    reason: safeString(verification.redacted_reason, 500),
  };
}

async function syncIdentities(
  adminClient: SupabaseClient,
  userId: string,
  user: JsonRecord,
  now: string,
): Promise<SyncedIdentity[]> {
  const rawIdentities = Array.isArray(user.identities) ? user.identities : [];
  const normalized = rawIdentities
    .map((identity) => normalizeIdentity(identity, user, now))
    .filter((identity): identity is SyncedIdentity => Boolean(identity));
  const phone = phoneIdentity(user, now);
  if (phone && !normalized.some((identity) => identity.provider === "phone" && identity.provider_subject === phone.provider_subject)) {
    normalized.push(phone);
  }

  const { error: deactivateError } = await adminClient
    .from("member_auth_identities")
    .update({ active: false, updated_at: now })
    .eq("user_id", userId);

  if (deactivateError) {
    console.error("verify-member-access identity deactivate failed", {
      code: deactivateError.code,
      message: deactivateError.message,
    });
    throw new Error("Linked sign-in methods could not be synced.");
  }

  if (normalized.length > 0) {
    const rows = normalized.map((identity) => ({
      user_id: userId,
      ...identity,
    }));
    const { error: upsertError } = await adminClient
      .from("member_auth_identities")
      .upsert(rows, { onConflict: "user_id,provider,provider_subject" });

    if (upsertError) {
      console.error("verify-member-access identity upsert failed", {
        code: upsertError.code,
        message: upsertError.message,
      });
      throw new Error("Linked sign-in methods could not be saved.");
    }
  }

  const { data: verificationRow, error: verificationLookupError } = await adminClient
    .from("member_verifications")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (verificationLookupError) {
    console.error("verify-member-access verification sync timestamp failed", {
      code: verificationLookupError.code,
      message: verificationLookupError.message,
    });
    throw new Error("Member verification state could not be synced.");
  }

  const verificationWrite = verificationRow
    ? await adminClient
      .from("member_verifications")
      .update({ last_identity_sync_at: now, updated_at: now })
      .eq("user_id", userId)
    : await adminClient
      .from("member_verifications")
      .insert({ user_id: userId, last_identity_sync_at: now });

  if (verificationWrite.error) {
    console.error("verify-member-access verification sync timestamp failed", {
      code: verificationWrite.error.code,
      message: verificationWrite.error.message,
    });
    throw new Error("Member verification state could not be synced.");
  }

  return normalized;
}

async function ensureMemberProfile(
  adminClient: SupabaseClient,
  userId: string,
  user: JsonRecord,
  profile: JsonRecord | null,
): Promise<JsonRecord | null> {
  if (profile) return profile;

  const { data, error } = await adminClient
    .from("member_profiles")
    .insert({
      id: userId,
      display_name: defaultDisplayName(user),
      member_status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("verify-member-access profile bootstrap failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Member profile could not be created.");
  }

  return data as JsonRecord | null;
}

export async function updateDiscordProfile(
  adminClient: SupabaseClient,
  userId: string,
  user: JsonRecord,
  profile: JsonRecord | null,
  discordUserId: string,
  now: string,
  options: {
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const configuredGuildId = Deno.env.get("DISCORD_GUILD_ID") || "";
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN") || "";
  const configuredRequiredRoleIds = parseCsv(Deno.env.get("DISCORD_REQUIRED_ROLE_IDS"));
  const guildConfigMatches = configuredGuildId === EXPECTED_DISCORD_GUILD_ID;
  const roleConfigMatches =
    configuredRequiredRoleIds.length === EXPECTED_REQUIRED_ROLE_IDS.length &&
    EXPECTED_REQUIRED_ROLE_IDS.every((roleId) => configuredRequiredRoleIds.includes(roleId));

  if (!botToken || !guildConfigMatches || !roleConfigMatches) {
    return { ok: false, status: 500, message: "Discord verification is not configured yet. Please contact leadership." };
  }

  let discordResponse: Response;
  try {
    discordResponse = await (options.fetchImpl || fetch)(
      `${DISCORD_API_BASE}/guilds/${encodeURIComponent(EXPECTED_DISCORD_GUILD_ID)}/members/${encodeURIComponent(discordUserId)}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(
          options.requestTimeoutMs || DISCORD_REQUEST_TIMEOUT_MS,
        ),
      },
    );
  } catch (error) {
    console.warn("verify-member-access Discord lookup unavailable", {
      cause: error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network",
    });
    return {
      ok: false,
      status: 503,
      message: "Discord verification is temporarily unavailable. Please try again.",
    };
  }

  if (discordResponse.status === 429) {
    const retryAfter = discordResponse.headers.get("retry-after");
    return {
      ok: false,
      status: 429,
      message: retryAfter
        ? `Discord verification is rate limited. Try again in ${retryAfter} seconds.`
        : "Discord verification is rate limited. Please try again soon.",
    };
  }

  const currentStatus = safeString(profile?.member_status, 40) || "pending";
  const lockedStatus = LOCKED_STATUSES.has(currentStatus);
  const basePayload = {
    discord_user_id: discordUserId,
    display_name: safeString(profile?.display_name, 40) || defaultDisplayName(user),
    has_required_discord_roles: false,
    discord_checked_at: now,
    discord_verified_at: null,
    member_status: lockedStatus ? currentStatus : "pending",
  };

  if (discordResponse.status === 404) {
    const { error } = await adminClient.from("member_profiles").upsert(
      {
        id: userId,
        ...basePayload,
        discord_roles: [],
        discord_member_pending: null,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("verify-member-access Discord profile upsert failed", {
        code: error.code,
        message: error.message,
      });
      throw new Error("Discord verification could not update this profile.");
    }
    return { ok: true, message: "Discord account is linked, but this member is not in the Discord server yet." };
  }

  if (!discordResponse.ok) {
    return { ok: false, status: discordResponse.status, message: "Discord verification could not be completed. Please try again later." };
  }

  const member = await discordResponse.json() as JsonRecord;
  const discordUser = asRecord(member.user);
  const roles = asStringArray(member.roles);
  const roleSet = new Set(roles);
  const missingRoleIds = EXPECTED_REQUIRED_ROLE_IDS.filter((roleId) => !roleSet.has(roleId));
  const pending = member.pending === true;
  const hasRequiredRoles = missingRoleIds.length === 0;
  const eligibleStatus = hasRequiredRoles && !pending;
  const nextStatus = lockedStatus ? currentStatus : eligibleStatus ? "active" : "pending";
  const discordUsername = safeString(discordUser.username, 80);
  const discordGlobalName = safeString(discordUser.global_name, 100);
  const discordAvatar = discordAvatarUrl(discordUser);

  const { error } = await adminClient.from("member_profiles").upsert(
    {
      id: userId,
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      discord_global_name: discordGlobalName,
      discord_avatar_url: discordAvatar,
      discord_roles: roles,
      discord_member_pending: pending,
      has_required_discord_roles: hasRequiredRoles,
      discord_checked_at: now,
      discord_verified_at: eligibleStatus ? now : null,
      member_status: nextStatus,
      display_name: safeString(profile?.display_name, 40) || discordGlobalName || discordUsername || defaultDisplayName(user),
      avatar_url: safeString(profile?.avatar_url, 500) || discordAvatar,
      discord_handle: discordUsername || discordGlobalName,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("verify-member-access Discord profile upsert failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Discord verification could not update this profile.");
  }

  if (eligibleStatus && !lockedStatus) {
    return { ok: true, message: "Discord membership verified. Gallery uploads are available." };
  }
  if (pending) return { ok: true, message: "Complete Discord server onboarding before gallery uploads are available." };
  if (!hasRequiredRoles) return { ok: true, message: "Discord is linked, but required server roles are missing." };
  return { ok: true, message: "Discord roles were found, but this website account is not active. Please contact leadership." };
}

if (import.meta.main) {
  Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, message: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("verify-member-access missing Supabase service configuration", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });
    return jsonResponse({ ok: false, message: "Member verification is not configured yet." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse({ ok: false, message: "Sign in before checking member verification." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } = await adminClient.auth.getUser(accessToken);
  const user = userData?.user as unknown as JsonRecord | undefined;
  if (userError || !user?.id) {
    console.warn("verify-member-access invalid user JWT", {
      message: userError?.message || "Missing user",
    });
    return jsonResponse({ ok: false, message: "Your sign-in session could not be verified. Please sign in again." }, 401);
  }

  const userId = String(user.id);
  const body = await readOptionalBody(req);
  const now = new Date().toISOString();

  const { data: profileBefore } = await adminClient.from("member_profiles").select("*").eq("id", userId).maybeSingle();
  let profile = profileBefore as JsonRecord | null;
  try {
    profile = await ensureMemberProfile(adminClient, userId, user, profile);
  } catch (error) {
    return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "Member profile could not be created." }, 500);
  }

  let syncedIdentities: SyncedIdentity[] = [];
  try {
    syncedIdentities = await syncIdentities(adminClient, userId, user, now);
  } catch (error) {
    return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "Identity sync failed." }, 500);
  }

  const discordUserId = resolveDiscordIdentity(user, syncedIdentities);
  let verificationMessage: string | null = null;
  if (
    discordUserId &&
    (body.refreshDiscord === true ||
      discordVerificationNeedsRefresh(profile, discordUserId))
  ) {
    try {
      const discordResult = await updateDiscordProfile(adminClient, userId, user, profile, discordUserId, now);
      verificationMessage = discordResult.message || null;
      if (!discordResult.ok) {
        console.warn("verify-member-access Discord refresh warning", {
          status: discordResult.status,
          message: discordResult.message,
        });
        return jsonResponse(
          {
            ok: false,
            message: discordResult.message ||
              "Discord verification is temporarily unavailable. Please try again.",
          },
          discordResult.status === 429 ? 429 : 503,
        );
      }
    } catch (error) {
      console.error("verify-member-access Discord refresh failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse({ ok: false, message: "Discord verification could not be refreshed." }, 500);
    }
  }

  // These final-state reads are independent after the optional Discord refresh.
  const profileQuery = adminClient
    .from("member_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const verificationQuery = adminClient
    .from("member_verifications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const identityQuery = adminClient
    .from("member_auth_identities")
    .select("provider,provider_subject,display_label,provider_email_verified,provider_phone_verified,active,last_observed_at")
    .eq("user_id", userId)
    .eq("active", true)
    .order("provider", { ascending: true });

  const [
    { data: profileData, error: profileError },
    { data: verificationData, error: verificationLookupError },
    { data: identityRows, error: identityLookupError },
  ] = await Promise.all([profileQuery, verificationQuery, identityQuery]);

  if (profileError) {
    console.error("verify-member-access profile lookup failed", {
      code: profileError.code,
      message: profileError.message,
    });
    return jsonResponse({ ok: false, message: "Member profile could not be loaded." }, 500);
  }

  if (verificationLookupError) {
    console.error("verify-member-access verification lookup failed", {
      code: verificationLookupError.code,
      message: verificationLookupError.message,
    });
    return jsonResponse({ ok: false, message: "Member verification could not be loaded." }, 500);
  }

  let verification = verificationData as JsonRecord | null;
  const expiresAt = safeString(verification?.gallery_access_expires_at, 80);
  if (
    safeString(verification?.gallery_access_status, 40) === "approved" &&
    expiresAt &&
    Number.isFinite(Date.parse(expiresAt)) &&
    Date.parse(expiresAt) < Date.now()
  ) {
    const { data: expiredData } = await adminClient
      .from("member_verifications")
      .update({ gallery_access_status: "expired", updated_at: now })
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    verification = expiredData as JsonRecord | null;
  }

  if (identityLookupError) {
    console.error("verify-member-access identity lookup failed", {
      code: identityLookupError.code,
      message: identityLookupError.message,
    });
    return jsonResponse({ ok: false, message: "Linked sign-in methods could not be loaded." }, 500);
  }

  const latestProfile = profileData as JsonRecord | null;
  const memberStatus = safeString(latestProfile?.member_status, 40) || "pending";
  const trustedDiscordUserId = resolveDiscordIdentity(
    user,
    (Array.isArray(identityRows) ? identityRows : []) as SyncedIdentity[],
  );
  const entitlementEvaluatedAtMs = Date.now();
  const access = currentMemberAccess({
    profile: latestProfile,
    verification,
    trustedDiscordUserId,
    nowMs: entitlementEvaluatedAtMs,
  });
  const { discordVerified, manualApproved } = access;
  const galleryEligible = access.eligible;
  const socialEntitlement = buildSocialServiceEntitlement({
    memberStatus,
    discordVerified,
    discordVerifiedAt: latestProfile?.discord_verified_at,
    evaluatedAtMs: entitlementEvaluatedAtMs,
  });
  const method = discordVerified
    ? "discord"
    : manualApproved
      ? safeString(verification?.gallery_access_method, 40) || "manual_review"
      : null;

  let message = verificationMessage || "Member verification checked.";
  let next = "Complete Discord verification or ask leadership to review your member verification.";
  if (galleryEligible) {
    message = method === "discord"
      ? "Discord membership verified. Gallery uploads are available."
      : "Moderator-approved member verification is active. Gallery uploads are available.";
    next = "Submit an image or review your gallery submission history.";
  } else if (memberStatus === "suspended" || memberStatus === "archived") {
    message = "Gallery upload access is unavailable for this member status.";
    next = "Contact leadership if this status looks wrong.";
  } else if (verification && !NON_DISCORD_METHODS.has(safeString(verification.gallery_access_method, 40) || "")) {
    next = "Use Discord verification or request a supported member review method.";
  }

  return jsonResponse({
    ok: true,
    data: {
      galleryEligible,
      method,
      memberStatus,
      discordVerified,
      manualApproved,
      identities: (Array.isArray(identityRows) ? identityRows : []).map((identity) => publicIdentity(identity as JsonRecord)),
      verification: publicVerification(verification),
      socialEntitlement,
      profile: latestProfile,
      message,
      next,
    },
    message,
  });
}
