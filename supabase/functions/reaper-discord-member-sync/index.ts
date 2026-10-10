import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  applyPendingContainmentPlan,
  asArray,
  asRecord,
  buildSingleMemberPendingContainmentPlan,
  DISCORD_MEMBER_OVERWRITE_TYPE,
  MAX_PENDING_VERIFICATION_MUTATIONS,
  memberUserId,
  pendingChannelId,
  safeString,
  snowflake,
  logPendingContainmentSync,
  type JsonRecord,
  type PendingContainmentChange,
  type SupabaseAdminClient,
} from "../_shared/pending-verification-containment.ts";
import { SITE_ORIGIN } from "../_shared/public-origins.ts";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";
import { CONTAINMENT_UUID, ContainmentRequest, containmentInputHash, readContainmentJson, readContainmentReceipt, type ContainmentReceipt } from "../_shared/pending-containment-receipts.ts";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_API_USER_AGENT = `Mochirii-Reaper-MemberSync/1.0 (${SITE_ORIGIN})`;
const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const PENDING_VERIFICATION_AUDIT_REASON = "Reaper pending verification containment";
const MEMBER_SYNC_SECRET_HEADER = "x-mochirii-reaper-member-sync-secret";
const ALLOWED_EVENT_TYPES = new Set(["guildMemberAdd", "guildMemberUpdate"]);

type MemberSyncPayload = {
  request_id: string;
  event_type: "guildMemberAdd" | "guildMemberUpdate";
  guild_id: string;
  discord_user_id: string;
  roles: string[];
  gateway_sequence: number | null;
  occurred_at: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function serviceAdminClient(purpose: string): SupabaseAdminClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`Supabase service credentials are not configured for ${purpose}.`);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return diff === 0;
}

function verifyMemberSyncSecret(req: Request, expected: string): boolean {
  const actual = req.headers.get(MEMBER_SYNC_SECRET_HEADER) || "";
  return Boolean(expected && actual && actual.length <= 512 && expected.length <= 512 && constantTimeEquals(actual, expected));
}

function discordApiHeaders(contentType = false): Headers {
  const headers = new Headers({
    Authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN") || ""}`,
    Accept: "application/json",
    "User-Agent": DISCORD_API_USER_AGENT,
  });
  if (contentType) headers.set("Content-Type", "application/json");
  return headers;
}

async function discordApi(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Never replay a permission write after a timeout, network error, or 5xx.
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (init.method === "PUT" || init.method === "DELETE") {
    void response.body?.cancel().catch(() => undefined);
    if (response.status !== 204) throw new Error("Discord permission write requires reconciliation.");
    return { ok: true, status: 204, data: null };
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error("Discord response exceeds containment limit.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { ok: response.ok, status: response.status, data: size ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : null };
  } finally { if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); } }
}

function parsePayload(value: unknown): MemberSyncPayload {
  const record = asRecord(value);
  if (Object.keys(record).sort().join(",") !== "discord_user_id,event_type,gateway_sequence,guild_id,occurred_at,request_id,roles" ||
    typeof record.request_id !== "string" || !CONTAINMENT_UUID.test(record.request_id)) throw new SyntaxError("Invalid request identity.");
  if (typeof record.event_type !== "string" || typeof record.guild_id !== "string" || typeof record.discord_user_id !== "string" ||
    !/^\d{16,22}$/.test(record.discord_user_id)) throw new SyntaxError("Invalid member identity.");
  const eventType = safeString(record.event_type, 40);
  const guildId = snowflake(record.guild_id);
  const discordUserId = snowflake(record.discord_user_id);
  if (!Array.isArray(record.roles) || record.roles.length > 250 || record.roles.some((id) => typeof id !== "string" || !/^\d{16,22}$/.test(id)) ||
    new Set(record.roles).size !== record.roles.length) throw new SyntaxError("Invalid reported roles.");
  const roles = [...record.roles as string[]].sort();
  const gatewaySequence = record.gateway_sequence;
  if (gatewaySequence !== null && (!Number.isSafeInteger(gatewaySequence) || Number(gatewaySequence) < 0)) throw new SyntaxError("Invalid sequence.");
  const occurredAt = record.occurred_at;
  if (typeof occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt)) || new Date(occurredAt).toISOString() !== occurredAt) throw new SyntaxError("Invalid observation time.");

  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new SyntaxError("event_type must be guildMemberAdd or guildMemberUpdate.");
  }

  if (guildId !== EXPECTED_DISCORD_GUILD_ID) {
    throw new SyntaxError("guild_id does not match the configured Reaper guild.");
  }

  if (!discordUserId) {
    throw new SyntaxError("discord_user_id must be a Discord snowflake.");
  }

  return {
    request_id: record.request_id,
    event_type: eventType as MemberSyncPayload["event_type"],
    guild_id: guildId,
    discord_user_id: discordUserId,
    roles,
    gateway_sequence: gatewaySequence as number | null,
    occurred_at: occurredAt,
  };
}

async function fetchGuildChannels(): Promise<JsonRecord[]> {
  const response = await discordApi(`/guilds/${EXPECTED_DISCORD_GUILD_ID}/channels`, {
    headers: discordApiHeaders(),
  });

  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(`Guild channel fetch failed with Discord API ${response.status}.`);
  }

  return asArray(response.data).map(asRecord).filter((channel) => Boolean(pendingChannelId(channel)));
}

async function fetchGuildRoles(): Promise<JsonRecord[]> {
  const response = await discordApi(`/guilds/${EXPECTED_DISCORD_GUILD_ID}/roles`, {
    headers: discordApiHeaders(),
  });

  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(`Guild role fetch failed with Discord API ${response.status}.`);
  }

  return asArray(response.data).map(asRecord).filter((role) => Boolean(snowflake(role.id)));
}

async function fetchCurrentMember(discordUserId: string): Promise<JsonRecord | null> {
  const response = await discordApi(
    `/guilds/${EXPECTED_DISCORD_GUILD_ID}/members/${encodeURIComponent(discordUserId)}`,
    { headers: discordApiHeaders() },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Guild member fetch failed with Discord API ${response.status}.`);
  }

  const member = asRecord(response.data);
  const fetchedUserId = memberUserId(member);
  if (fetchedUserId !== discordUserId) {
    throw new Error("Discord returned an unexpected member payload.");
  }
  return member;
}

function discordApiErrorDetail(data: unknown): string {
  const record = asRecord(data);
  const code = safeString(record.code, 40);
  const message = safeString(record.message, 140);
  const details = [code ? `code ${code}` : "", message].filter(Boolean).join(": ");
  return details ? ` (${details})` : "";
}

export async function writePendingDiscordOverwrite(change: PendingContainmentChange): Promise<void> {
  const auditHeaders = discordApiHeaders(change.nextAllow !== 0n || change.nextDeny !== 0n);
  auditHeaders.set("X-Audit-Log-Reason", encodeURIComponent(PENDING_VERIFICATION_AUDIT_REASON));

  const removeOverwrite = change.nextAllow === 0n && change.nextDeny === 0n;
  const response = removeOverwrite
    ? await discordApi(`/channels/${change.channelId}/permissions/${change.userId}`, {
      method: "DELETE",
      headers: auditHeaders,
    })
    : await discordApi(`/channels/${change.channelId}/permissions/${change.userId}`, {
      method: "PUT",
      headers: auditHeaders,
      body: JSON.stringify({
        allow: change.nextAllow.toString(),
        deny: change.nextDeny.toString(),
        type: DISCORD_MEMBER_OVERWRITE_TYPE,
      }),
    });

  if (!response.ok) {
    throw new Error(
      `Discord overwrite ${change.detail} on ${change.channelName}:${change.channelId} user:${change.userId} failed with API ${response.status}${discordApiErrorDetail(response.data)}.`,
    );
  }
}

export type MemberSyncDependencies = {
  secret: string;
  botConfigured: boolean;
  admin(): SupabaseAdminClient;
  channels(): Promise<JsonRecord[]>;
  roles(): Promise<JsonRecord[]>;
  member(userId: string): Promise<JsonRecord | null>;
  write(change: PendingContainmentChange): Promise<void>;
  log: typeof logPendingContainmentSync;
};

function receiptResponse(requestId: string, receipt: ContainmentReceipt, statusLookup = false): Response {
  const status = receipt.state === "completed" || receipt.state === "missing" ? 200
    : receipt.state === "reserved" || receipt.state === "writing" ? (statusLookup ? 200 : 202) : 409;
  return jsonResponse({ ok: true, request_id: requestId, status: receipt.state, result: receipt.result }, status);
}

export async function handleMemberSync(req: Request, deps: MemberSyncDependencies): Promise<Response> {
  const url = new URL(req.url);
  const isStatus = url.pathname === "/reaper-discord-member-sync/status";
  if ((!isStatus && url.pathname !== "/reaper-discord-member-sync") || (isStatus ? req.method !== "GET" : req.method !== "POST")) {
    return jsonResponse({ ok: false, error: "Not found." }, 404);
  }
  if (!verifyMemberSyncSecret(req, deps.secret)) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  let request: ContainmentRequest | null = null;
  let payload: MemberSyncPayload | null = null;
  let admin: SupabaseAdminClient | null = null;
  try {
    if (isStatus) {
      const requestId = url.searchParams.get("request_id") || "";
      if ([...url.searchParams.keys()].join(",") !== "request_id" || !CONTAINMENT_UUID.test(requestId) || req.body) throw new SyntaxError("Invalid status identity.");
      return receiptResponse(requestId, await readContainmentReceipt(deps.admin(), `gateway:${requestId}`), true);
    }
    if (url.search || req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new SyntaxError("Invalid request.");
    payload = parsePayload(await readContainmentJson(req));
    if (!deps.botConfigured) throw new Error("Containment unavailable.");
    admin = deps.admin();
    request = new ContainmentRequest(admin, `gateway:${payload.request_id}`);
    const reserved = await request.reserve(payload.discord_user_id, await containmentInputHash(payload));
    if (reserved === "duplicate") return receiptResponse(payload.request_id, await readContainmentReceipt(admin, request.requestKey));
    if (reserved !== "acquired") return jsonResponse({ ok: false, request_id: payload.request_id, status: reserved, result: null,
      ...(reserved === "busy" || reserved === "disabled" ? { retry_after_ms: 1000 } : {}) }, 409);
    const [channels, member, roles] = await Promise.all([deps.channels(), deps.member(payload.discord_user_id), deps.roles()]);
    const plan = await buildSingleMemberPendingContainmentPlan(admin, channels, member, payload.discord_user_id, roles);
    if (plan.conflicts.length || plan.changes.filter((change) => change.discordWrite).length > MAX_PENDING_VERIFICATION_MUTATIONS) {
      await request.fail();
      return receiptResponse(payload.request_id, await readContainmentReceipt(admin, request.requestKey));
    }
    const result = await applyPendingContainmentPlan(admin, plan, deps.write, request.beforeWrite);
    const receipt = { discordWrites: result.discordWrites, dbWrites: result.dbWrites, staleRecordsCleared: result.staleRecordsCleared };
    await request.complete(receipt);
    // A diagnostic failure must never turn a committed receipt into a retryable
    // operation or hide the authoritative completion acknowledgment.
    await deps.log(admin, "apply", "success", "Gateway member containment completed.", plan, { source: "gateway_member_event", reportedRoleCount: payload.roles.length, ...receipt }).catch(() => undefined);
    return receiptResponse(payload.request_id, { state: "completed", result: receipt });
  } catch (error) {
    try { await request?.fail(); } catch { /* Preserve the non-expiring fence. */ }
    if (request && payload && admin) {
      try { return receiptResponse(payload.request_id, await readContainmentReceipt(admin, request.requestKey)); } catch { /* Receipt cannot be guessed. */ }
    }
    return jsonResponse({ ok: false, error: "Containment request requires reconciliation." }, error instanceof SyntaxError ? 400 : 503);
  }
}

if (import.meta.main) Deno.serve((req) => handleMemberSync(req, {
  secret: Deno.env.get("REAPER_PENDING_VERIFICATION_SYNC_SECRET") || "",
  botConfigured: Boolean(Deno.env.get("DISCORD_BOT_TOKEN")),
  admin: () => serviceAdminClient("pending verification member sync"),
  channels: fetchGuildChannels, roles: fetchGuildRoles, member: fetchCurrentMember,
  write: writePendingDiscordOverwrite, log: logPendingContainmentSync,
}));
