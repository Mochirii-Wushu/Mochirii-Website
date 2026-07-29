import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { getServiceRoleKey } from "./supabase-service-role.ts";
import {
  bonusChecklist,
  type BonusCompletion,
  calculateEntryCount,
} from "./raffle-entry.ts";
import {
  buildFrozenLedger,
  drawRaffle,
  type FrozenEntry,
  frozenLedgerHash,
  RAFFLE_DRAW_ALGORITHM_VERSION,
  randomHex,
  sha256Hex,
} from "./raffle-draw.ts";
import { selectCurrentCycleCandidate } from "./raffle-schedule.ts";
import { verifyAuthenticatedUser } from "./verified-auth.ts";

export type JsonRecord = Record<string, unknown>;

const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const EXPECTED_MODERATOR_ROLE_IDS = ["1078630751165222984"];
const DISCORD_API_BASE = "https://discord.com/api/v10";

export const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function safeString(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => safeString(item, 200)).filter(Boolean)
    : [];
}

export function jsonResponse(
  body: JsonRecord,
  status = 200,
  publicCors = false,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(publicCors ? PUBLIC_CORS_HEADERS : {}),
    },
  });
}

export async function readJson(
  req: Request,
  maxBytes = 16_384,
): Promise<JsonRecord> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("invalid_json");
  }

  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      throw new Error("invalid_json");
    }
    const declaredBytes = Number(normalizedLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new Error("invalid_json");
    }
    if (declaredBytes > maxBytes) throw new Error("request_too_large");
  }

  if (!req.body) return {};
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(maxBytes);
  } catch {
    throw new Error("invalid_json");
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = req.body.getReader();
  } catch {
    throw new Error("invalid_json");
  }

  const maxReadOperations = maxBytes + 1;
  let readOperations = 0;
  let totalBytes = 0;
  try {
    for (;;) {
      if (readOperations >= maxReadOperations) {
        try {
          await reader.cancel("request_too_large");
        } catch {
          // The size decision is authoritative even if the source cannot cancel.
        }
        throw new Error("request_too_large");
      }
      readOperations += 1;
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - totalBytes) {
        try {
          await reader.cancel("request_too_large");
        } catch {
          // The size decision is authoritative even if the source cannot cancel.
        }
        throw new Error("request_too_large");
      }
      bytes.set(value, totalBytes);
      totalBytes += value.byteLength;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_large") {
      throw error;
    }
    throw new Error("invalid_json");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The request result remains normalized if the runtime already released it.
    }
  }

  if (totalBytes === 0) return {};

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, totalBytes),
    );
    if (!text.trim()) return {};
    return asRecord(JSON.parse(text));
  } catch {
    throw new Error("invalid_json");
  }
}

export function createRaffleAdminClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = getServiceRoleKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    .trim();
}

export type MemberAccess = {
  ok: true;
  adminClient: SupabaseClient;
  user: User;
  userId: string;
  profile: JsonRecord;
} | {
  ok: false;
  response: Response;
};

export type RaffleMemberDependencies = {
  createAdminClient?: () => SupabaseClient | null;
};

export async function requireRaffleMember(
  req: Request,
  dependencies: RaffleMemberDependencies = {},
): Promise<MemberAccess> {
  const accessToken = bearerToken(req);
  if (!accessToken || accessToken.split(".").length !== 3) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "missing_auth",
        message: "Sign in to manage your Raffle entry.",
      }, 401),
    };
  }

  const adminClient = (dependencies.createAdminClient ||
    createRaffleAdminClient)();
  if (!adminClient) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "not_configured",
        message: "Raffle member access is not configured.",
      }, 500),
    };
  }

  const identity = await verifyAuthenticatedUser(adminClient.auth, accessToken);
  if (!identity) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "invalid_auth",
        message: "Your session could not be verified. Sign in again.",
      }, 401),
    };
  }

  const { data: profileData, error: profileError } = await adminClient
    .from("member_profiles")
    .select(
      "id,member_status,has_required_discord_roles,discord_verified_at,discord_user_id,discord_roles",
    )
    .eq("id", identity.userId)
    .maybeSingle();

  if (profileError) {
    console.error("raffle member profile lookup failed", { failed: true });
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "profile_unavailable",
        message: "Your member status could not be checked.",
      }, 500),
    };
  }

  return {
    ok: true,
    adminClient,
    user: identity.user,
    userId: identity.userId,
    profile: asRecord(profileData),
  };
}

export function raffleMemberProfileIsVerified(
  profileValue: unknown,
  now = Date.now(),
): boolean {
  const profile = asRecord(profileValue);
  const verifiedAt = Date.parse(safeString(profile.discord_verified_at, 80));
  return profile.member_status === "active" &&
    profile.has_required_discord_roles === true &&
    Number.isFinite(verifiedAt) &&
    verifiedAt >= now - 7 * 24 * 60 * 60 * 1000 &&
    verifiedAt <= now + 5 * 60 * 1000;
}

export type ModeratorAccess = {
  ok: true;
  adminClient: SupabaseClient;
  userId: string;
  discordUserId: string;
} | {
  ok: false;
  response: Response;
};

export type RaffleModeratorDependencies = {
  requireMember?: (req: Request) => Promise<MemberAccess>;
  fetcher?: typeof fetch;
  now?: () => number;
  configuration?: {
    guildId: string;
    botToken: string;
    moderatorRoleIds: string[];
  };
};

export async function requireRaffleModerator(
  req: Request,
  dependencies: RaffleModeratorDependencies = {},
): Promise<ModeratorAccess> {
  const member = await (dependencies.requireMember || requireRaffleMember)(req);
  if (!member.ok) return member;

  if (
    !raffleMemberProfileIsVerified(
      member.profile,
      (dependencies.now || Date.now)(),
    )
  ) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "leader_access_denied",
        message:
          "Raffle leader access requires current verified guild standing.",
      }, 403),
    };
  }

  const configuration = dependencies.configuration || {
    guildId: Deno.env.get("DISCORD_GUILD_ID") || "",
    botToken: Deno.env.get("DISCORD_BOT_TOKEN") || "",
    moderatorRoleIds: (Deno.env.get("DISCORD_MODERATOR_ROLE_IDS") || "").split(
      ",",
    )
      .map((value) => value.trim()).filter(Boolean),
  };
  const guildId = configuration.guildId;
  const botToken = configuration.botToken;
  const configuredRoles = configuration.moderatorRoleIds;
  const configurationMatches = guildId === EXPECTED_DISCORD_GUILD_ID &&
    configuredRoles.length === EXPECTED_MODERATOR_ROLE_IDS.length &&
    EXPECTED_MODERATOR_ROLE_IDS.every((roleId) =>
      configuredRoles.includes(roleId)
    );
  const discordUserId = safeString(member.profile.discord_user_id, 40);

  if (
    !botToken || !configurationMatches || !/^\d{16,22}$/.test(discordUserId)
  ) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "leader_access_not_configured",
        message: "Raffle leader access is not configured.",
      }, 500),
    };
  }

  const response = await (dependencies.fetcher || fetch)(
    `${DISCORD_API_BASE}/guilds/${EXPECTED_DISCORD_GUILD_ID}/members/${
      encodeURIComponent(discordUserId)
    }`,
    {
      headers: { Authorization: `Bot ${botToken}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    const status = response.status === 429
      ? 429
      : response.status === 404
      ? 403
      : 502;
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "leader_access_unavailable",
        message: "Raffle leader access could not be verified.",
      }, status),
    };
  }

  const guildMember = asRecord(await response.json());
  const roles = new Set(stringArray(guildMember.roles));
  if (
    guildMember.pending === true ||
    !EXPECTED_MODERATOR_ROLE_IDS.every((roleId) => roles.has(roleId))
  ) {
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: "leader_access_denied",
        message:
          "Raffle leader access requires the current guild moderator role.",
      }, 403),
    };
  }

  return {
    ok: true,
    adminClient: member.adminClient,
    userId: member.userId,
    discordUserId,
  };
}

export function memberEligibilityReason(
  profile: JsonRecord,
  cycle: JsonRecord,
  countryCode: string,
  ageAffirmed: boolean,
): string {
  if (
    stringArray(profile.discord_roles).some((roleId) =>
      EXPECTED_MODERATOR_ROLE_IDS.includes(roleId)
    )
  ) return "administrator_ineligible";
  if (safeString(profile.member_status, 40) !== "active") {
    return "member_not_in_good_standing";
  }
  if (profile.has_required_discord_roles !== true) {
    return "guild_membership_not_verified";
  }
  const verifiedAt = Date.parse(safeString(profile.discord_verified_at, 80));
  if (
    !Number.isFinite(verifiedAt) ||
    verifiedAt < Date.now() - 7 * 24 * 60 * 60 * 1000
  ) return "guild_verification_stale";
  if (!ageAffirmed) return "age_affirmation_required";
  if (!/^[A-Z]{2}$/.test(countryCode)) return "residence_country_required";
  if (!stringArray(cycle.approved_country_codes).includes(countryCode)) {
    return "country_not_eligible";
  }
  return "eligible";
}

export type RafflePublicView = {
  cycleStatus:
    | "inactive"
    | "scheduled"
    | "open"
    | "closed"
    | "drawing"
    | "results"
    | "paused";
  standardEntryStatus: "closed" | "open";
  bonusEntryStatus: "closed" | "open";
  timezone: "Asia/Singapore";
  opensAt: string | null;
  closesAt: string | null;
  drawAt: string | null;
  claimEndsAt: string | null;
  publicReward: string | null;
  baseEntries: 1;
  maximumBonusEntries: 9;
  maximumEntries: 10;
  rulesUrl: string | null;
  entrantCount: number | null;
  totalEntryCount: number | null;
  publicResult: "none" | "winner_confirmed";
};

function nullableCycleTimestamp(value: unknown): string | null {
  const candidate = safeString(value, 80);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

export function publicCycleDto(cycleValue: unknown): RafflePublicView | null {
  const cycle = asRecord(cycleValue);
  const cycleId = safeString(cycle.public_cycle_id, 64);
  if (!cycleId) return null;
  const internalStatus = safeString(cycle.status, 20);
  const drawAt = nullableCycleTimestamp(cycle.draw_at);
  const drawAtMs = drawAt ? Date.parse(drawAt) : Number.NaN;
  const cycleStatus: RafflePublicView["cycleStatus"] =
    internalStatus === "ready"
      ? "scheduled"
      : internalStatus === "open"
      ? "open"
      : internalStatus === "frozen"
      ? Number.isFinite(drawAtMs) && Date.now() >= drawAtMs
        ? "drawing"
        : "closed"
      : ["drawn", "complete"].includes(internalStatus)
      ? "results"
      : ["void", "blocked"].includes(internalStatus)
      ? "paused"
      : "inactive";
  const countsVisible = ["frozen", "drawn", "complete", "void"].includes(
    internalStatus,
  );
  const launchApproved = cycle.sponsor_approved === true &&
    cycle.rules_approved === true &&
    cycle.country_matrix_approved === true &&
    cycle.reward_approved === true && cycle.privacy_approved === true &&
    cycle.tax_approved === true && cycle.operations_approved === true;

  const claimWindowDays = Number(cycle.claim_window_days);
  const claimEndsAt = Number.isFinite(drawAtMs) &&
      Number.isInteger(claimWindowDays) && claimWindowDays > 0
    ? new Date(drawAtMs + claimWindowDays * 24 * 60 * 60 * 1000)
      .toISOString()
    : null;
  const entriesOpen = internalStatus === "open";

  return {
    cycleStatus,
    standardEntryStatus: entriesOpen ? "open" : "closed",
    bonusEntryStatus: entriesOpen ? "open" : "closed",
    timezone: "Asia/Singapore",
    opensAt: nullableCycleTimestamp(cycle.opens_at),
    closesAt: nullableCycleTimestamp(cycle.closes_at),
    drawAt,
    claimEndsAt,
    publicReward: launchApproved
      ? safeString(cycle.public_reward_label, 240) || null
      : null,
    baseEntries: 1,
    maximumBonusEntries: 9,
    maximumEntries: 10,
    rulesUrl: launchApproved
      ? safeString(cycle.rules_version_url, 120) || null
      : null,
    entrantCount: countsVisible ? Number(cycle.entrant_count || 0) : null,
    totalEntryCount: countsVisible
      ? Number(cycle.total_entry_count || 0)
      : null,
    publicResult: ["drawn", "complete"].includes(internalStatus)
      ? "winner_confirmed"
      : "none",
  };
}

export async function loadCurrentCycle(
  adminClient: SupabaseClient,
): Promise<JsonRecord | null> {
  const now = new Date().toISOString();
  const { data: candidates, error } = await adminClient
    .from("raffle_cycles")
    .select(
      "id,public_cycle_id,status,opens_at,closes_at,draw_at,expires_at,timezone,sponsor_display_name,public_reward_label,rules_version,rules_version_url,rules_content_hash,privacy_version,privacy_content_hash,country_matrix_version,country_matrix_hash,approved_country_codes,base_entries,max_bonus_entries,max_entries,claim_window_days,award_window_days,minimum_eligible_entrants,reward_value_cents,cycle_cost_ceiling_cents,entrant_count,total_entry_count,sponsor_approved,rules_approved,country_matrix_approved,reward_approved,privacy_approved,tax_approved,operations_approved",
    )
    .in("status", ["ready", "open", "frozen", "drawn", "complete"])
    .gte("expires_at", now)
    .order("draw_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const current = selectCurrentCycleCandidate(
    (candidates || []).map(asRecord),
  );
  return current ? asRecord(current) : null;
}

export async function loadMostRecentResultsCycle(
  adminClient: SupabaseClient,
): Promise<JsonRecord | null> {
  const { data, error } = await adminClient.from("raffle_cycles")
    .select("id,public_cycle_id,status,draw_at,expires_at")
    .in("status", ["drawn", "complete"])
    .gte("expires_at", new Date().toISOString())
    .order("draw_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? asRecord(data) : null;
}

export async function memberPrizeDrawStatus(
  adminClient: SupabaseClient,
  cycle: JsonRecord | null,
  memberId: string,
): Promise<JsonRecord> {
  if (!cycle?.id) {
    return {
      eligibilityState: "unknown",
      eligibilityReasonCode: "no_active_cycle",
      optInState: "locked",
      bonusRows: bonusChecklist([]).map((row) => ({
        key: row.bonusKey,
        completed: row.completed,
        completionPath: null,
      })),
      totalEntries: 0,
      claimState: "not_available",
      fulfillmentState: "unavailable",
      rewardChoice: null,
      openRewardAvailable: false,
    };
  }

  const { data: entryData, error: entryError } = await adminClient
    .from("raffle_entries")
    .select(
      "id,eligibility_status,eligibility_reason_code,opted_in_at,withdrawn_at,base_entry_count,frozen_entry_count",
    )
    .eq("cycle_id", cycle.id)
    .eq("member_id", memberId)
    .maybeSingle();
  if (entryError) throw entryError;
  const entry = asRecord(entryData);

  const bonusQuery = entry.id
    ? await adminClient.from("raffle_bonus_awards")
      .select("bonus_key,completion_method,revoked_at")
      .eq("entry_id", entry.id)
      .order("bonus_key")
    : { data: [], error: null };
  if (bonusQuery.error) throw bonusQuery.error;
  const completions: BonusCompletion[] = (bonusQuery.data || []).map(
    (value) => {
      const row = asRecord(value);
      return {
        bonusKey: safeString(row.bonus_key, 40),
        completionMethod: safeString(row.completion_method, 20),
        revoked: Boolean(row.revoked_at),
      };
    },
  );

  const { data: claimData, error: claimError } = await adminClient
    .from("raffle_draw_results")
    .select(
      "id,result_kind,status,claim_deadline,claimed_at,reward_route,fulfillment_status",
    )
    .eq("cycle_id", cycle.id)
    .eq("member_id", memberId)
    .in("result_kind", ["paid_winner", "alternate"])
    .maybeSingle();
  if (claimError) throw claimError;
  const claim = claimData ? asRecord(claimData) : null;
  const optedIn = Boolean(entry.id) && !entry.withdrawn_at;
  const rawEligibility = safeString(entry.eligibility_status, 20);
  const eligible = ["eligible", "frozen"].includes(rawEligibility);
  const totalEntries =
    entry.frozen_entry_count === null || entry.frozen_entry_count === undefined
      ? calculateEntryCount(eligible && optedIn, completions)
      : Number(entry.frozen_entry_count);
  const rawClaimState = safeString(claim?.status, 30);
  const rawFulfillmentState = safeString(claim?.fulfillment_status, 30);
  const rawRewardRoute = safeString(claim?.reward_route, 20);
  const entryLocked = ["frozen", "drawn", "complete"].includes(
    safeString(cycle.status, 20),
  );

  return {
    eligibilityState: eligible
      ? "eligible"
      : rawEligibility === "pending"
      ? "pending_review"
      : ["ineligible", "withdrawn"].includes(rawEligibility)
      ? "ineligible"
      : "unknown",
    eligibilityReasonCode: safeString(entry.eligibility_reason_code, 80) ||
      "monthly_opt_in_required",
    optInState: entryLocked ? "locked" : optedIn ? "opted_in" : "not_opted_in",
    bonusRows: bonusChecklist(completions).map((row) => ({
      key: row.bonusKey,
      completed: row.completed,
      completionPath: row.completionMethod === "primary"
        ? "activity"
        : row.completionMethod,
    })),
    totalEntries: Math.min(10, Math.max(0, totalEntries)),
    claimState: ["selected", "contacted"].includes(rawClaimState) &&
        Boolean(claim?.claim_deadline)
      ? "claimable"
      : ["claimed", "fulfilled"].includes(rawClaimState)
      ? "claimed"
      : rawClaimState === "declined"
      ? "declined"
      : ["expired", "ineligible", "void"].includes(rawClaimState)
      ? "expired"
      : "not_available",
    fulfillmentState: rawFulfillmentState === "not_requested"
      ? "not_started"
      : rawFulfillmentState === "pending"
      ? "pending_review"
      : rawFulfillmentState === "processing"
      ? "preparing"
      : rawFulfillmentState === "delivered"
      ? "completed"
      : rawFulfillmentState === "manual"
      ? "preparing"
      : "unavailable",
    rewardChoice: rawRewardRoute === "digital"
      ? "digital_choice"
      : rawRewardRoute === "in_game"
      ? "in_game"
      : null,
    openRewardAvailable: false,
  };
}

export async function freezeCycle(
  adminClient: SupabaseClient,
  cycleId: string,
  actorId: string | null,
  now: Date,
): Promise<JsonRecord> {
  const { data, error } = await adminClient.rpc("freeze_raffle_ledger", {
    p_cycle_id: cycleId,
    p_actor_id: actorId,
    p_ledger_salt: randomHex(32),
    p_now: now.toISOString(),
  });
  if (error) throw error;
  return asRecord(data);
}

export async function completeFrozenDraw(
  adminClient: SupabaseClient,
  frozenValue: JsonRecord,
  actorId: string | null,
  now: Date,
): Promise<JsonRecord> {
  const drawId = safeString(frozenValue.drawId, 80);
  const ledgerSalt = safeString(frozenValue.ledgerSalt, 128);
  if (safeString(frozenValue.drawStatus, 20) === "drawn") {
    return {
      drawId,
      cycleId: safeString(frozenValue.cycleId, 80),
      duplicate: true,
      ledgerHash: safeString(frozenValue.ledgerHash, 64),
      seedHash: safeString(frozenValue.seedHash, 64),
      resultCount: Number(frozenValue.entrantCount || 0),
    };
  }
  const entries: FrozenEntry[] = Array.isArray(frozenValue.ledger)
    ? frozenValue.ledger.map((value) => {
      const row = asRecord(value);
      return {
        memberId: safeString(row.memberId, 80),
        entryCount: Number(row.entryCount),
      };
    })
    : [];
  if (!drawId || !ledgerSalt) {
    throw new Error("Frozen draw evidence is incomplete.");
  }

  const ledger = await buildFrozenLedger(entries, ledgerSalt);
  const ledgerHash = await frozenLedgerHash(ledger);
  const { data: commitmentData, error: commitmentError } = await adminClient
    .rpc("record_raffle_ledger_hash", {
      p_draw_id: drawId,
      p_ledger_hash: ledgerHash,
      p_actor_id: actorId,
      p_now: now.toISOString(),
    });
  if (commitmentError) throw commitmentError;
  const commitment = asRecord(commitmentData);
  if (safeString(commitment.ledgerHash, 64) !== ledgerHash) {
    throw new Error("Frozen ledger commitment could not be verified.");
  }
  const seedHex = safeString(commitment.seedHex, 64);
  const seedHash = safeString(commitment.seedHash, 64);
  if (!/^[0-9a-f]{64}$/.test(seedHex) || !/^[0-9a-f]{64}$/.test(seedHash)) {
    throw new Error("Frozen draw seed commitment could not be verified.");
  }
  const results = await drawRaffle(ledger, seedHex);
  const { data, error } = await adminClient.rpc("complete_raffle_draw", {
    p_draw_id: drawId,
    p_ledger_hash: ledgerHash,
    p_seed_hex: seedHex,
    p_seed_hash: seedHash,
    p_algorithm_version: RAFFLE_DRAW_ALGORITHM_VERSION,
    p_results: results,
    p_actor_id: actorId,
    p_now: now.toISOString(),
  });
  if (error) {
    const { data: concurrentData, error: concurrentError } = await adminClient
      .from("raffle_draws")
      .select(
        "id,cycle_id,status,ledger_hash,seed_hash,entrant_count",
      )
      .eq("id", drawId)
      .eq("status", "drawn")
      .eq("ledger_hash", ledgerHash)
      .maybeSingle();
    if (!concurrentError && concurrentData) {
      const concurrent = asRecord(concurrentData);
      return {
        drawId: safeString(concurrent.id, 80),
        cycleId: safeString(concurrent.cycle_id, 80),
        duplicate: true,
        ledgerHash: safeString(concurrent.ledger_hash, 64),
        seedHash: safeString(concurrent.seed_hash, 64),
        resultCount: Number(concurrent.entrant_count || 0),
      };
    }
    throw error;
  }
  const completed = asRecord(data);
  if (completed.duplicate === true) {
    return {
      ...completed,
      ledgerHash: safeString(completed.ledgerHash, 64) || ledgerHash,
      seedHash: safeString(completed.seedHash, 64),
      resultCount: Number(completed.resultCount || entries.length),
    };
  }
  return {
    ...completed,
    ledgerHash,
    seedHash,
    resultCount: results.length,
  };
}

export async function publicDrawEvidence(
  adminClient: SupabaseClient,
  cycleId: string,
): Promise<JsonRecord | null> {
  const { data: drawData, error: drawError } = await adminClient
    .from("raffle_draws")
    .select(
      "id,status,ledger_hash,algorithm_version,drawn_at",
    )
    .eq("cycle_id", cycleId)
    .eq("status", "drawn")
    .maybeSingle();
  if (drawError) throw drawError;
  if (!drawData) return null;
  const draw = asRecord(drawData);

  const { data: resultData, error: resultError } = await adminClient
    .from("raffle_draw_results")
    .select("result_kind,selection_order,entry_ordinal,pseudonymous_member_id")
    .eq("draw_id", draw.id).order("selection_order");
  if (resultError) throw resultError;
  return await privacySafePublicDrawEvidence(draw, resultData || []);
}

export async function privacySafePublicDrawEvidence(
  drawValue: unknown,
  resultValues: unknown[],
): Promise<JsonRecord | null> {
  const draw = asRecord(drawValue);
  const drawingAt = safeString(draw.drawn_at, 80);
  const methodVersion = safeString(draw.algorithm_version, 100);
  const ledgerCommitment = safeString(draw.ledger_hash, 64).toLowerCase();
  if (
    draw.status !== "drawn" ||
    !Number.isFinite(Date.parse(drawingAt)) ||
    !methodVersion ||
    !/^[0-9a-f]{64}$/.test(ledgerCommitment) ||
    resultValues.length < 3
  ) return null;

  const canonicalResults = resultValues.map((value) => {
    const result = asRecord(value);
    const kind = safeString(result.result_kind, 30);
    const selectionOrder = Number(result.selection_order);
    const entryOrdinal = Number(result.entry_ordinal);
    const committedPseudonym = safeString(
      result.pseudonymous_member_id,
      64,
    ).toLowerCase();
    if (
      !["paid_winner", "honor", "alternate"].includes(kind) ||
      !Number.isSafeInteger(selectionOrder) || selectionOrder < 1 ||
      !Number.isSafeInteger(entryOrdinal) || entryOrdinal < 1 ||
      !/^[0-9a-f]{64}$/.test(committedPseudonym)
    ) throw new Error("raffle_public_evidence_invalid");
    return { kind, selectionOrder, entryOrdinal, committedPseudonym };
  });

  return {
    drawingAt,
    methodVersion,
    ledgerCommitment,
    resultCommitment: await sha256Hex(JSON.stringify(canonicalResults)),
  };
}

export async function memberResultNames(
  adminClient: SupabaseClient,
  cycleId: string,
): Promise<Record<string, string>> {
  const { data: cycleData, error: cycleError } = await adminClient
    .from("raffle_cycles")
    .select("public_cycle_id")
    .eq("id", cycleId)
    .maybeSingle();
  if (cycleError) throw cycleError;
  const publicCycleId = safeString(cycleData?.public_cycle_id, 64);
  if (!publicCycleId) return {};

  const { data: resultData, error: resultError } = await adminClient
    .from("raffle_draw_results")
    .select("member_id,result_kind,selection_order,status,claim_opened_at")
    .eq("cycle_id", cycleId)
    .order("selection_order");
  if (resultError) throw resultError;

  const visibleResults = (resultData || []).map(asRecord).filter((result) => {
    const kind = safeString(result.result_kind, 30);
    const status = safeString(result.status, 30);
    return !["void", "ineligible", "expired", "declined"].includes(status) &&
      (kind === "honor" || kind === "paid_winner" ||
        (kind === "alternate" && Boolean(result.claim_opened_at)));
  });
  const memberIds = [
    ...new Set(
      visibleResults.map((result) => safeString(result.member_id, 80)).filter(
        Boolean,
      ),
    ),
  ];
  if (!memberIds.length) return {};

  const { data: profiles, error: profileError } = await adminClient
    .from("member_profiles")
    .select("id,display_name")
    .in("id", memberIds);
  if (profileError) throw profileError;
  const displayNames = new Map(
    (profiles || []).map((profile) => [
      safeString(profile.id, 80),
      safeString(profile.display_name, 40),
    ]),
  );

  return Object.fromEntries(visibleResults.flatMap((result) => {
    const name = displayNames.get(safeString(result.member_id, 80));
    return name
      ? [[`${publicCycleId}:${Number(result.selection_order)}`, name]]
      : [];
  }));
}

export async function constantTimeSecretMatches(
  provided: string,
  expected: string,
): Promise<boolean> {
  if (!provided || !expected) return false;
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
}
