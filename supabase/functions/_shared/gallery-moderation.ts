import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  resolveDiscordIdentity,
  type SyncedProviderIdentity,
} from "./member-verification-identity.ts";
import { getServiceRoleKey } from "./supabase-service-role.ts";

export type JsonRecord = Record<string, unknown>;

type ModeratorAccessSuccess = {
  ok: true;
  adminClient: SupabaseClient;
  user: User;
  userId: string;
  discordUserId: string;
  roleIds: string[];
};

type ModeratorAccessFailure = {
  ok: false;
  response: Response;
};

export type ModeratorAccessResult =
  | ModeratorAccessSuccess
  | ModeratorAccessFailure;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISCORD_API_BASE = "https://discord.com/api/v10";
const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const EXPECTED_MODERATOR_ROLE_IDS = ["1078630751165222984"];
const OPTIONAL_JSON_MAXIMUM_BYTES = 16 * 1024;
const DISCORD_LOOKUP_TIMEOUT_MS = 5_000;
const DISCORD_RESPONSE_MAXIMUM_BYTES = 32 * 1024;

type DiscordModeratorLookupSuccess = {
  ok: true;
  roleIds: string[];
};

type DiscordModeratorLookupFailure = {
  ok: false;
  status: number;
  error: string;
  message: string;
};

export type DiscordModeratorLookupResult =
  | DiscordModeratorLookupSuccess
  | DiscordModeratorLookupFailure;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

export function safeString(value: unknown, maxLength: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

export function parseCsv(value: string | null | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readBoundedResponseRecord(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<JsonRecord | null> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel("response_too_large");
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const abortRead = () => {
    void reader.cancel("request_deadline_exceeded");
  };
  if (signal?.aborted) {
    abortRead();
    reader.releaseLock();
    return null;
  }
  signal?.addEventListener("abort", abortRead, { once: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("response_too_large");
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null;
  } catch {
    return null;
  }
}

export async function verifyLiveDiscordModerator(
  input: {
    botToken: string;
    discordUserId: string;
    expectedRoleIds: string[];
    timeoutMs?: number;
  },
  fetchImpl: FetchLike = fetch,
): Promise<DiscordModeratorLookupResult> {
  const timeoutMs = Number.isSafeInteger(input.timeoutMs) &&
      Number(input.timeoutMs) > 0 && Number(input.timeoutMs) <= 15_000
    ? Number(input.timeoutMs)
    : DISCORD_LOOKUP_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const finish = (
    result: DiscordModeratorLookupResult,
  ): DiscordModeratorLookupResult => {
    clearTimeout(timeout);
    return result;
  };
  let response: Response;

  try {
    response = await fetchImpl(
      `${DISCORD_API_BASE}/guilds/${
        encodeURIComponent(EXPECTED_DISCORD_GUILD_ID)
      }/members/${encodeURIComponent(input.discordUserId)}`,
      {
        headers: {
          Authorization: `Bot ${input.botToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    );
  } catch {
    return finish(
      controller.signal.aborted
        ? {
          ok: false,
          status: 503,
          error: "discord_lookup_timeout",
          message:
            "Discord moderation verification timed out. Please try again later.",
        }
        : {
          ok: false,
          status: 502,
          error: "discord_lookup_failed",
          message:
            "Discord moderation verification could not be completed. Please try again later.",
        },
    );
  }

  if (response.status === 429) {
    return finish({
      ok: false,
      status: 429,
      error: "discord_rate_limited",
      message: "Discord verification is rate limited. Please try again soon.",
    });
  }
  if (response.status === 404) {
    return finish({
      ok: false,
      status: 403,
      error: "not_guild_member",
      message:
        "Moderator access requires membership in the Mōchirīī Discord server.",
    });
  }
  if (response.status === 401 || response.status === 403) {
    return finish({
      ok: false,
      status: 502,
      error: "discord_configuration_error",
      message:
        "Discord moderation verification is not available yet. Please contact leadership.",
    });
  }
  if (!response.ok) {
    return finish({
      ok: false,
      status: 502,
      error: "discord_lookup_failed",
      message:
        "Discord moderation verification could not be completed. Please try again later.",
    });
  }

  const member = await readBoundedResponseRecord(
    response,
    DISCORD_RESPONSE_MAXIMUM_BYTES,
    controller.signal,
  );
  if (controller.signal.aborted) {
    return finish({
      ok: false,
      status: 503,
      error: "discord_lookup_timeout",
      message:
        "Discord moderation verification timed out. Please try again later.",
    });
  }
  const rawRoles = member?.roles;
  const pending = member?.pending;
  if (
    !Array.isArray(rawRoles) ||
    rawRoles.some((roleId) =>
      typeof roleId !== "string" || !/^\d{16,22}$/.test(roleId)
    ) ||
    (pending !== undefined && typeof pending !== "boolean")
  ) {
    return finish({
      ok: false,
      status: 502,
      error: "discord_response_invalid",
      message:
        "Discord moderation verification could not be completed. Please try again later.",
    });
  }

  const roles = [...new Set(rawRoles)];
  if (pending === true) {
    return finish({
      ok: false,
      status: 403,
      error: "discord_onboarding_pending",
      message:
        "Complete Discord server onboarding before using gallery moderation.",
    });
  }
  const roleSet = new Set(roles);
  if (input.expectedRoleIds.some((roleId) => !roleSet.has(roleId))) {
    return finish({
      ok: false,
      status: 403,
      error: "missing_moderator_role",
      message: "Gallery moderation requires the Discord Moderator role.",
    });
  }

  return finish({ ok: true, roleIds: roles });
}

async function readBoundedJsonBody(
  req: Request,
  maximumBytes: number,
): Promise<JsonRecord | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !req.body) {
    return null;
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return null;
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("request_too_large");
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  if (totalBytes < 1) return null;
  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readOptionalJsonBody(
  req: Request,
  maximumBytes = OPTIONAL_JSON_MAXIMUM_BYTES,
): Promise<{ ok: true; body: JsonRecord } | ModeratorAccessFailure> {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (contentType !== "application/json") return { ok: true, body: {} };

  const body = await readBoundedJsonBody(req, maximumBytes);
  if (!body) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: "invalid_json",
          message: "Request body must be valid JSON.",
        },
        400,
      ),
    };
  }
  return { ok: true, body };
}

export async function readRequiredJsonBody(
  req: Request,
  maximumBytes = 64 * 1024,
): Promise<{ ok: true; body: JsonRecord } | ModeratorAccessFailure> {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (contentType !== "application/json") {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          message: "Request body must be bounded JSON.",
        },
        400,
      ),
    };
  }

  const body = await readBoundedJsonBody(req, maximumBytes);
  if (!body) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          message: "Request body must be bounded JSON.",
        },
        400,
      ),
    };
  }
  return { ok: true, body };
}

export function moderatorConfigMatches(configuredRoleIds: string[]): boolean {
  return (
    configuredRoleIds.length === EXPECTED_MODERATOR_ROLE_IDS.length &&
    EXPECTED_MODERATOR_ROLE_IDS.every((roleId) =>
      configuredRoleIds.includes(roleId)
    )
  );
}

export async function requireModeratorAccess(
  req: Request,
): Promise<ModeratorAccessResult> {
  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "missing_auth",
          message: "Choose a sign-in method before opening gallery moderation.",
        },
        401,
      ),
    };
  }

  if (!looksLikeJwt(accessToken)) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "invalid_auth",
          message:
            "Your sign-in session could not be verified. Please sign in again.",
        },
        401,
      ),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();
  const configuredGuildId = Deno.env.get("DISCORD_GUILD_ID") || "";
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN") || "";
  const configuredModeratorRoleIds = parseCsv(
    Deno.env.get("DISCORD_MODERATOR_ROLE_IDS"),
  );
  const moderatorRoleNames = parseCsv(
    Deno.env.get("DISCORD_MODERATOR_ROLE_NAMES"),
  );
  const guildConfigMatches = configuredGuildId === EXPECTED_DISCORD_GUILD_ID;
  const roleConfigMatches = moderatorConfigMatches(configuredModeratorRoleIds);

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !configuredGuildId ||
    !botToken ||
    !guildConfigMatches ||
    !roleConfigMatches ||
    moderatorRoleNames.length === 0
  ) {
    console.error("gallery moderation missing required server configuration", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasGuildId: Boolean(configuredGuildId),
      hasBotToken: Boolean(botToken),
      guildConfigMatches,
      roleConfigMatches,
      configuredModeratorRoleCount: configuredModeratorRoleIds.length,
      moderatorRoleNameCount: moderatorRoleNames.length,
    });

    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "moderation_not_configured",
          message:
            "Gallery moderation is not configured yet. Please contact leadership.",
        },
        500,
      ),
    };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } = await adminClient.auth.getUser(
    accessToken,
  );
  const user = userData?.user;

  if (userError || !user?.id) {
    console.warn("gallery moderation invalid user JWT", {
      category: userError ? "authentication_rejected" : "missing_user",
    });

    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "invalid_auth",
          message:
            "Your sign-in session could not be verified. Please sign in again.",
        },
        401,
      ),
    };
  }

  const userId = String(user.id);
  const { data: identityRows, error: identityError } = await adminClient
    .from("member_auth_identities")
    .select("provider,provider_subject,active")
    .eq("user_id", userId)
    .eq("provider", "discord")
    .eq("active", true);

  if (identityError) {
    console.error("gallery moderation trusted identity lookup failed", {
      code: identityError.code,
    });
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "identity_lookup_failed",
          message:
            "Moderator access could not be verified. Please try again later.",
        },
        500,
      ),
    };
  }

  const discordUserId = resolveDiscordIdentity(
    user as unknown as JsonRecord,
    (identityRows || []) as SyncedProviderIdentity[],
  );

  if (!discordUserId) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "missing_discord_identity",
          message:
            "Discord identity was not found on this account. Link Discord from Account and try again.",
        },
        403,
      ),
    };
  }

  const { data: profileData, error: profileError } = await adminClient
    .from("member_profiles")
    .select("member_status,discord_user_id,discord_member_pending")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    console.error("gallery moderation local standing lookup failed", {
      code: profileError.code,
    });
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: "member_standing_lookup_failed",
          message:
            "Moderator access could not be verified. Please try again later.",
        },
        500,
      ),
    };
  }

  const profile = asRecord(profileData);
  const memberStatus = safeString(profile.member_status, 40);
  const profileDiscordUserId = safeString(profile.discord_user_id, 40);
  if (
    memberStatus !== "active" ||
    profile.discord_member_pending === true ||
    profileDiscordUserId !== discordUserId
  ) {
    const category = profile.discord_member_pending === true
      ? "discord_onboarding_pending"
      : profileDiscordUserId !== discordUserId
      ? "discord_identity_drift"
      : "member_not_active";
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: category,
          message: category === "discord_onboarding_pending"
            ? "Complete Discord server onboarding before using gallery moderation."
            : "Gallery moderation requires a current verified member account.",
        },
        403,
      ),
    };
  }

  const liveModerator = await verifyLiveDiscordModerator({
    botToken,
    discordUserId,
    expectedRoleIds: EXPECTED_MODERATOR_ROLE_IDS,
  });
  if (!liveModerator.ok) {
    console.warn("gallery moderation live Discord authorization failed", {
      category: liveModerator.error,
      status: liveModerator.status,
    });
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          hasAccess: false,
          error: liveModerator.error,
          message: liveModerator.message,
        },
        liveModerator.status,
      ),
    };
  }

  return {
    ok: true,
    adminClient,
    user,
    userId,
    discordUserId,
    roleIds: liveModerator.roleIds,
  };
}

function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return false;

  try {
    JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    return true;
  } catch {
    return false;
  }
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
