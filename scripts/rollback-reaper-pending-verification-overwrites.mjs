import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const CONFIRM_GUILD_ARG = "--confirm-guild=1078630751077142608";
const PENDING_VERIFICATION_MANAGED_BY = "reaper-pending-verification";
const DISCORD_MEMBER_OVERWRITE_TYPE = 1;
const PENDING_VERIFICATION_AUDIT_REASON = "Reaper pending verification containment rollback";
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmGuild = process.argv.find((arg) => arg.startsWith("--confirm-guild="))?.split("=")[1] || "";
const requestId = process.argv.find((arg) => arg.startsWith("--request-id="))?.slice("--request-id=".length) || "";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}.`);
  return value;
}

function getServiceRoleKey() {
  const direct = env("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;

  const secretKeys = env("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return "";

  try {
    const parsed = JSON.parse(secretKeys);
    return String(parsed.default || parsed.service_role || "");
  } catch {
    return "";
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function snowflake(value) {
  const text = String(value || "").trim();
  return /^\d{16,22}$/.test(text) ? text : "";
}

function bits(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function discordFetch(path, init = {}) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (init.method === "PUT" || init.method === "DELETE") {
    void response.body?.cancel().catch(() => undefined);
    if (response.status !== 204) throw new Error("Rollback permission write requires reconciliation.");
    return { ok: true, status: 204, data: null };
  }
  const data = await readPayload(response);

  return { ok: response.ok, status: response.status, data };
}

async function supabaseFetch(path, init = {}) {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey) throw new Error("Missing Supabase service role key.");

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    redirect: "error", signal: AbortSignal.timeout(10000),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
  const data = await readPayload(response);
  return { ok: response.ok, status: response.status, data };
}

async function receiptRpc(name, args) {
  const result = await supabaseFetch(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args), headers: { Prefer: "return=representation" } });
  if (!result.ok) throw new Error("Rollback receipt operation unavailable.");
  return result.data;
}

export function createRollbackRequest(callRpc, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("Rollback apply requires --request-id=<UUIDv4>; retain that ID for reconciliation.");
  const identity = { p_request_key: `rollback:${id}`, p_owner_id: randomUUID() };
  let owned = false; let writing = false; let completed = false;
  return {
    async reserve() {
      const result = await callRpc("reaper_reserve_pending_containment", { ...identity, p_subject_id: "*", p_input_sha256: createHash("sha256").update("pending-containment-rollback-v1").digest("hex") });
      owned = result === "acquired";
      if (!owned) throw new Error("Rollback receipt did not acquire the guild fence; inspect its status before continuing.");
    },
    async beforeWrite() {
      if (!owned || completed) throw new Error("Rollback does not own the guild fence.");
      writing = true;
      if (await callRpc("reaper_begin_pending_containment_write", identity) !== true) throw new Error("Rollback write fence rejected.");
    },
    async complete(result) {
      if (!owned || completed || await callRpc("reaper_finish_pending_containment", { ...identity, p_outcome: "completed", p_result: result }) !== true) throw new Error("Rollback completion requires receipt reconciliation.");
      completed = true;
    },
    async fail() {
      if (owned && !completed && await callRpc("reaper_finish_pending_containment", { ...identity, p_outcome: writing ? "blocked" : "rejected", p_result: null }) !== true) throw new Error("Rollback failure requires receipt reconciliation.");
    },
  };
}

async function loadRows(guildId) {
  const params = new URLSearchParams({
    select: "id,guild_id,channel_id,discord_user_id,owned_allow,owned_deny",
    guild_id: `eq.${guildId}`,
    managed_by: `eq.${PENDING_VERIFICATION_MANAGED_BY}`,
    active: "eq.true",
  });
  const response = await supabaseFetch(`/rest/v1/discord_managed_permission_overwrites?${params}`);
  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(`Supabase managed overwrite query failed with API ${response.status}.`);
  }
  return response.data.map(asRecord);
}

async function loadChannels(guildId, token) {
  const response = await discordFetch(`/guilds/${guildId}/channels`, {
    headers: {
      Authorization: `Bot ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(`Discord channel query failed with API ${response.status}.`);
  }
  return response.data.map(asRecord);
}

function memberOverwrite(channel, userId) {
  return asRecord(
    asArray(channel.permission_overwrites).find((overwrite) => {
      const record = asRecord(overwrite);
      return snowflake(record.id) === userId && Number(record.type) === DISCORD_MEMBER_OVERWRITE_TYPE;
    }),
  );
}

function planRollback(row, channel) {
  const rowId = String(row.id || "").trim();
  const channelId = snowflake(row.channel_id);
  const userId = snowflake(row.discord_user_id);
  const ownedAllow = bits(row.owned_allow);
  const ownedDeny = bits(row.owned_deny);

  if (!rowId || !channelId || !userId) {
    return { row, channelId, userId, discordWrite: false, dbWrite: false, missingChannel: false, invalid: true };
  }

  if (!channel) {
    return { row, channelId, userId, discordWrite: false, dbWrite: true, missingChannel: true, invalid: false };
  }

  const overwrite = memberOverwrite(channel, userId);
  const currentAllow = bits(overwrite.allow);
  const currentDeny = bits(overwrite.deny);
  const nextAllow = currentAllow & ~ownedAllow;
  const nextDeny = currentDeny & ~ownedDeny;
  const hasOverwrite = Boolean(overwrite.id);

  return {
    row,
    channelId,
    userId,
    currentAllow,
    currentDeny,
    nextAllow,
    nextDeny,
    discordWrite: hasOverwrite && (currentAllow !== nextAllow || currentDeny !== nextDeny),
    dbWrite: true,
    missingChannel: false,
    invalid: false,
    deleteOverwrite: nextAllow === 0n && nextDeny === 0n,
  };
}

async function writeDiscordRollback(change, token) {
  const headers = {
    Authorization: `Bot ${token}`,
    Accept: "application/json",
    "X-Audit-Log-Reason": encodeURIComponent(PENDING_VERIFICATION_AUDIT_REASON),
  };

  const response = change.deleteOverwrite
    ? await discordFetch(`/channels/${change.channelId}/permissions/${change.userId}`, {
      method: "DELETE",
      headers,
    })
    : await discordFetch(`/channels/${change.channelId}/permissions/${change.userId}`, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allow: change.nextAllow.toString(),
        deny: change.nextDeny.toString(),
        type: DISCORD_MEMBER_OVERWRITE_TYPE,
      }),
    });

  if (!response.ok) {
    throw new Error(`Discord rollback write failed for channel ${change.channelId} user ${change.userId} with API ${response.status}.`);
  }
}

async function clearRegistryRow(rowId) {
  const response = await supabaseFetch(`/rest/v1/discord_managed_permission_overwrites?id=eq.${encodeURIComponent(rowId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      owned_allow: "0",
      owned_deny: "0",
      active: false,
      cleared_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase rollback registry update failed for row ${rowId} with API ${response.status}.`);
  }
}

async function main() {
  const guildId = EXPECTED_DISCORD_GUILD_ID;
  if (apply && confirmGuild !== guildId) {
    throw new Error(`Rollback apply requires ${CONFIRM_GUILD_ARG}.`);
  }

  const token = requiredEnv("DISCORD_BOT_TOKEN");
  const request = apply ? createRollbackRequest(receiptRpc, requestId) : null;
  try {
    await request?.reserve();
    const [rows, channels] = await Promise.all([loadRows(guildId), loadChannels(guildId, token)]);
    const channelById = new Map(channels.map((channel) => [snowflake(channel.id), channel]));
    const changes = rows.map((row) => planRollback(row, channelById.get(snowflake(row.channel_id))));
    const validChanges = changes.filter((change) => !change.invalid);
    const discordWrites = validChanges.filter((change) => change.discordWrite);
    const dbWrites = validChanges.filter((change) => change.dbWrite);

    console.log(JSON.stringify({
      dryRun: !apply,
      guildId,
      managedBy: PENDING_VERIFICATION_MANAGED_BY,
      activeRows: rows.length,
      plannedDiscordWrites: discordWrites.length,
      plannedRegistryWrites: dbWrites.length,
      missingChannels: validChanges.filter((change) => change.missingChannel).length,
      invalidRows: changes.filter((change) => change.invalid).length,
      sample: validChanges.slice(0, 20).map((change) => ({
        channelId: change.channelId,
        discordUserId: change.userId,
        discordWrite: change.discordWrite,
        deleteOverwrite: Boolean(change.deleteOverwrite),
        missingChannel: change.missingChannel,
      })),
    }, null, 2));

    if (!apply) {
      console.log(`Dry run only. Apply requires --apply ${CONFIRM_GUILD_ARG} --request-id=<UUIDv4> after approval.`);
      return;
    }

    let appliedDiscordWrites = 0; let appliedDbWrites = 0;
    for (const change of validChanges) {
      if (change.discordWrite) {
        await request.beforeWrite();
        await writeDiscordRollback(change, token);
        appliedDiscordWrites++;
      }

      if (change.dbWrite) {
        await request.beforeWrite();
        await clearRegistryRow(String(change.row.id || ""));
        appliedDbWrites++;
      }
    }
    await request.complete({ discordWrites: appliedDiscordWrites, dbWrites: appliedDbWrites, staleRecordsCleared: 0 });

    console.log(`Rollback completed for ${validChanges.length} tracked pending-verification overwrite rows.`);
  } catch (error) { try { await request?.fail(); } catch { /* Keep uncertain ownership blocked. */ } throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
