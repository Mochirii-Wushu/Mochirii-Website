import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireModeratorAccess } from "../_shared/gallery-moderation.ts";
import {
  authenticateSpinnerUser,
  requestedSpinnerAccessMode,
  requireActiveVerifiedSpinnerMember,
  resolveModeratorAuthorizationRoute,
  SPINNER_MODERATOR_CACHE_MS,
  type SpinnerMemberAccess,
} from "../_shared/spinner-authority.ts";
import {
  buildDiscordOutboxPayloads,
  buildSnapshotResponseData,
  canonicalRosterPayload,
  commandRequestHash,
  createLiveDrawPlan,
  normalizeDrawMode,
  normalizeParticipants,
  readBoundedSpinnerJsonObject,
  serializeSnapshot,
  sha256Hex,
  type SpinnerSnapshot,
} from "../_shared/spinner-live.ts";
import {
  animationManifestHash,
  buildAnimationManifest,
} from "../_shared/spinner-media.ts";

type JsonRecord = Record<string, unknown>;
type SpinnerAction = "set_roster" | "spin" | "reset";

const SPINNER_VARY = "Authorization, X-Mochirii-Spinner-Mode";
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  Vary: SPINNER_VARY,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve((req: Request) =>
  withProtectedCors(req, handleRequest(req), {
    allowedMethods: "GET, POST, OPTIONS",
  })
);

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method === "GET") return handleSnapshot(req);
  if (req.method === "POST") return handleCommand(req);
  return jsonResponse({ ok: false, message: "Page unavailable." }, 404);
}

async function handleSnapshot(req: Request): Promise<Response> {
  const requestedMode = requestedSpinnerAccessMode(req);
  const access = requestedMode === "controller"
    ? await requireSpinnerController(req)
    : await requireActiveVerifiedSpinnerMember(req);
  if (!access.ok) {
    return jsonResponse(
      { ok: false, message: "Page unavailable." },
      access.status === 401 ? 401 : 404,
    );
  }

  const adminClient = access.adminClient;
  const mode = requestedMode;

  if (!await recoverStaleCommands(adminClient)) {
    return jsonResponse({
      ok: false,
      message: "Live raffle state is unavailable.",
    }, 503);
  }

  const { data, error } = await adminClient.rpc("spinner_finalize_reveal");
  if (error || !data) {
    console.error("spinner-live-session snapshot failed", {
      code: error?.code,
      message: error?.message || "Missing state",
    });
    return jsonResponse({
      ok: false,
      message: "Live raffle state is unavailable.",
    }, 503);
  }

  let snapshot: SpinnerSnapshot;
  try {
    snapshot = serializeSnapshot(data);
  } catch (error) {
    console.error("spinner-live-session snapshot serialization failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({
      ok: false,
      message: "Live raffle state is unavailable.",
    }, 503);
  }

  let receipt: JsonRecord | undefined;
  let receiptCommandId: string | undefined;
  if (mode === "controller" && snapshot.drawId) {
    const { data: receiptRow, error: receiptError } = await adminClient
      .from("spinner_draw_receipts")
      .select("receipt,command_id")
      .eq("draw_id", snapshot.drawId)
      .maybeSingle();
    if (receiptError) {
      console.error("spinner-live-session controller receipt recovery failed", {
        code: receiptError.code,
        message: receiptError.message,
      });
      return jsonResponse({
        ok: false,
        message: "Live raffle state is unavailable.",
      }, 503);
    }
    if (!receiptRow) {
      if (snapshot.phase !== "revealed") {
        console.error("spinner-live-session active draw receipt is missing");
        return jsonResponse({
          ok: false,
          message: "Live raffle state is unavailable.",
        }, 503);
      }
    } else if (
      !receiptRow.receipt ||
      typeof receiptRow.receipt !== "object" ||
      Array.isArray(receiptRow.receipt) ||
      typeof receiptRow.command_id !== "string" ||
      !UUID_PATTERN.test(receiptRow.command_id)
    ) {
      console.error("spinner-live-session controller receipt recovery returned invalid data");
      return jsonResponse({
        ok: false,
        message: "Live raffle state is unavailable.",
      }, 503);
    } else {
      receipt = receiptRow.receipt as JsonRecord;
      receiptCommandId = receiptRow.command_id;
    }
  }

  const etag = snapshotEtag(snapshot);
  const serverNow = new Date().toISOString();
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...PRIVATE_HEADERS,
        ETag: etag,
        "X-Mochirii-Server-Time": serverNow,
      },
    });
  }
  return jsonResponse(
    {
      ok: true,
      data: buildSnapshotResponseData(
        mode,
        snapshot,
        serverNow,
        receipt,
        receiptCommandId,
      ),
    },
    200,
    { ETag: etag },
  );
}

async function handleCommand(req: Request): Promise<Response> {
  const moderator = await requireSpinnerController(req);
  if (!moderator.ok) {
    return jsonResponse({ ok: false, message: "Page unavailable." }, 404);
  }

  if (!await recoverStaleCommands(moderator.adminClient)) {
    return jsonResponse({
      ok: false,
      message: "The command could not be completed.",
    }, 503);
  }
  const { error: finalizeError } = await moderator.adminClient.rpc(
    "spinner_finalize_reveal",
  );
  if (finalizeError) {
    console.error(
      "spinner-live-session pre-command reveal finalization failed",
      {
        code: finalizeError.code,
        message: finalizeError.message,
      },
    );
    return jsonResponse({
      ok: false,
      message: "The command could not be completed.",
    }, 503);
  }

  const parsedBody = await readBoundedSpinnerJsonObject(req);
  if (!parsedBody.ok) {
    return jsonResponse({ ok: false, message: "The command is invalid." }, 400);
  }
  const body = parsedBody.value;
  const action = body.action;
  const commandId = typeof body.commandId === "string"
    ? body.commandId.trim()
    : "";
  const expectedRevision = Number(body.expectedRevision);
  if (
    !isSpinnerAction(action) || !UUID_PATTERN.test(commandId) ||
    !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
  ) {
    return jsonResponse({ ok: false, message: "The command is invalid." }, 400);
  }

  let commandInput: JsonRecord;
  let stagedPayload: JsonRecord | null = null;
  try {
    if (action === "set_roster") {
      const participants = normalizeParticipants(body.participants);
      const rosterHashSha256 = await sha256Hex(
        canonicalRosterPayload(participants),
      );
      commandInput = { action, expectedRevision, participants };
      stagedPayload = { participants, rosterHashSha256 };
    } else if (action === "spin") {
      if (Object.prototype.hasOwnProperty.call(body, "durationMs")) {
        throw new TypeError("Spin duration is fixed by the raffle protocol.");
      }
      const drawMode = normalizeDrawMode(body.drawMode);
      commandInput = { version: 2, action, expectedRevision, drawMode };
    } else {
      commandInput = { action, expectedRevision };
      stagedPayload = {};
    }
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error instanceof Error
        ? error.message
        : "The command is invalid.",
    }, 400);
  }

  const requestHashSha256 = await commandRequestHash(commandInput);
  const reserve = await callRpc(
    moderator.adminClient,
    "spinner_reserve_command",
    {
      p_command_id: commandId,
      p_action: action,
      p_actor_id: moderator.userId,
      p_expected_revision: expectedRevision,
      p_request_hash_sha256: requestHashSha256,
    },
  );
  if (!reserve.ok) return commandError(reserve);

  if (reserve.reserved !== true) {
    if (reserve.status === "applied") {
      return appliedCommandResponse(reserve, commandId);
    }
    if (reserve.status === "pending" && reserve.staged === true) {
      const resumed = await callRpc(
        moderator.adminClient,
        "spinner_apply_command",
        { p_command_id: commandId },
      );
      return resumed.ok
        ? appliedCommandResponse(resumed, commandId)
        : commandError(resumed);
    }
    if (reserve.status === "rejected") return commandError(reserve);
    return jsonResponse({
      ok: false,
      message: "Another command is still being completed.",
    }, 409);
  }

  if (action === "spin") {
    const { data: state, error: stateError } = await moderator.adminClient
      .from("spinner_live_state")
      .select("revision,phase,reveal_at,participants,final_rotation")
      .eq("singleton_id", 1)
      .single();
    if (stateError || !state || Number(state.revision) !== expectedRevision) {
      console.error("spinner-live-session reserved draw state lookup failed", {
        code: stateError?.code,
        message: stateError?.message || "Revision changed",
      });
      await rejectUnstagedSpin(moderator.adminClient, commandId);
      return jsonResponse({
        ok: false,
        message: "The live roster changed. Refresh and try again.",
      }, 409);
    }

    try {
      const plan = await createLiveDrawPlan(state.participants, {
        startRotation: Number(state.final_rotation || 0),
        drawMode: normalizeDrawMode(commandInput.drawMode),
      });
      const discord = buildDiscordOutboxPayloads(plan.receipt, plan.startAt);
      const animationManifest = await buildAnimationManifest(plan.receipt, plan);
      stagedPayload = {
        version: 2,
        receipt: plan.receipt,
        planHashSha256: plan.planHashSha256,
        rounds: plan.receipt.rounds,
        startAt: plan.startAt,
        revealAt: plan.revealAt,
        durationMs: plan.durationMs,
        startRotation: plan.startRotation,
        finalRotation: plan.finalRotation,
        discordChannelKey: discord.channelKey,
        discordChannelId: discord.channelId,
        discordStartPayload: discord.startPayload,
        discordResultPayload: discord.resultPayload,
        animationManifest,
        animationManifestHashSha256: await animationManifestHash(animationManifest),
      };
    } catch (error) {
      console.error("spinner-live-session secure draw preparation failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      await rejectUnstagedSpin(moderator.adminClient, commandId);
      return jsonResponse({
        ok: false,
        message: "A secure draw could not be prepared.",
      }, 503);
    }
  }

  const stage = await callRpc(moderator.adminClient, "spinner_stage_command", {
    p_command_id: commandId,
    p_payload: stagedPayload,
  });
  if (!stage.ok) {
    if (action === "spin") {
      await rejectUnstagedSpin(moderator.adminClient, commandId);
    }
    return commandError(stage);
  }

  const applied = await callRpc(
    moderator.adminClient,
    "spinner_apply_command",
    { p_command_id: commandId },
  );
  return applied.ok
    ? appliedCommandResponse(applied, commandId)
    : commandError(applied);
}

function appliedCommandResponse(result: JsonRecord, commandId: string): Response {
  try {
    const snapshot = serializeSnapshot(result.snapshot);
    const receipt = result.receipt && typeof result.receipt === "object"
      ? result.receipt
      : undefined;
    return jsonResponse(
      {
        ok: true,
        data: {
          snapshot,
          serverNow: new Date().toISOString(),
          commandId,
          ...(receipt ? { receipt } : {}),
        },
      },
      200,
      {
        ETag: snapshotEtag(snapshot),
      },
    );
  } catch (error) {
    console.error("spinner-live-session command serialization failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({
      ok: false,
      message: "The command completed but its state could not be loaded.",
    }, 503);
  }
}

function commandError(result: JsonRecord): Response {
  const error = typeof result.error === "string"
    ? result.error
    : "command_failed";
  if (error === "revision_conflict") {
    return jsonResponse({
      ok: false,
      error,
      revision: result.revision,
      message: "The live roster changed. Refresh and try again.",
    }, 409);
  }
  if (error === "draw_in_progress" || error === "command_in_progress") {
    return jsonResponse({
      ok: false,
      error,
      message: "A draw or roster command is already in progress.",
    }, 409);
  }
  if (error === "spin_result_not_durable") {
    return jsonResponse({
      ok: false,
      error,
      message: "That draw attempt did not complete. Start a new spin.",
    }, 409);
  }
  if (
    error === "invalid_roster" || error === "invalid_receipt" ||
    error === "invalid_payload" || error === "command_id_conflict"
  ) {
    return jsonResponse({
      ok: false,
      error,
      message: "The command is invalid.",
    }, 400);
  }
  console.error("spinner-live-session command failed", { error });
  return jsonResponse({
    ok: false,
    message: "The command could not be completed.",
  }, 503);
}

async function recoverStaleCommands(
  adminClient: SupabaseClient,
): Promise<boolean> {
  const recovery = await callRpc(adminClient, "spinner_recover_commands", {});
  return recovery.ok === true;
}

async function rejectUnstagedSpin(
  adminClient: SupabaseClient,
  commandId: string,
): Promise<void> {
  const result = await callRpc(
    adminClient,
    "spinner_reject_unstaged_spin",
    { p_command_id: commandId },
  );
  if (!result.ok) {
    console.error(
      "spinner-live-session could not terminalize an unstaged draw",
      {
        commandId,
        error: result.error,
      },
    );
  }
}

async function requireSpinnerController(
  req: Request,
): Promise<SpinnerMemberAccess> {
  const identity = await authenticateSpinnerUser(req);
  if (!identity.ok) return identity;

  const expiresAt = await lookupModeratorAuthorizationExpiry(
    identity.adminClient,
    identity.userId,
  );
  const verified: {
    access: { adminClient: SupabaseClient; userId: string } | null;
  } = { access: null };
  const route = await resolveModeratorAuthorizationRoute(
    expiresAt,
    async () => {
      const moderator = await requireModeratorAccess(req);
      if (!moderator.ok || moderator.userId !== identity.userId) return false;
      verified.access = {
        adminClient: moderator.adminClient,
        userId: moderator.userId,
      };
      return true;
    },
  );

  if (route === "cached") return identity;
  if (route !== "verified" || !verified.access) {
    return { ok: false, status: 404, error: "not_found" };
  }
  await rememberModeratorAuthorization(
    verified.access.adminClient,
    verified.access.userId,
  );
  return { ok: true, ...verified.access };
}

async function lookupModeratorAuthorizationExpiry(
  adminClient: SupabaseClient,
  userId: string,
): Promise<unknown> {
  const { data, error } = await adminClient
    .from("spinner_moderator_authorizations")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("spinner-live-session moderator cache lookup failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return data?.expires_at;
}

async function rememberModeratorAuthorization(
  adminClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const verifiedAt = new Date();
  const expiresAt = new Date(
    verifiedAt.getTime() + SPINNER_MODERATOR_CACHE_MS,
  );
  const { error } = await adminClient
    .from("spinner_moderator_authorizations")
    .upsert({
      user_id: userId,
      verified_at: verifiedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }, { onConflict: "user_id" });
  if (error) {
    console.error("spinner-live-session moderator cache update failed", {
      code: error.code,
      message: error.message,
    });
  }
}

async function callRpc(
  adminClient: SupabaseClient,
  name: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  const { data, error } = await adminClient.rpc(name, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    console.error("spinner-live-session database command failed", {
      operation: name,
      code: error?.code,
      message: error?.message || "Missing result",
    });
    return { ok: false, error: "database_command_failed" };
  }
  return data as JsonRecord;
}

function isSpinnerAction(value: unknown): value is SpinnerAction {
  return value === "set_roster" || value === "spin" || value === "reset";
}

function snapshotEtag(snapshot: SpinnerSnapshot): string {
  const plan = snapshot.version === 2 ? `-${snapshot.planHashSha256}` : "";
  return `"spinner-${snapshot.sessionId}-${snapshot.revision}-${snapshot.phase}${plan}"`;
}

function jsonResponse(
  body: JsonRecord,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const serverTime = new Date().toISOString();
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      "X-Mochirii-Server-Time": serverTime,
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}
