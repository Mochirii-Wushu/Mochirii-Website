import "@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  asRecord,
  completeFrozenDraw,
  constantTimeSecretMatches,
  createRaffleAdminClient,
  freezeCycle,
  jsonResponse,
  safeString,
} from "../_shared/raffle-edge.ts";
import {
  alternateTransition,
  dueClaimReminderCodes,
  dueCycleReminderCodes,
  hasActivePrizeRecipient,
} from "../_shared/raffle-schedule.ts";
import { raffleOperationalGates } from "../_shared/raffle-flags.ts";

Deno.serve(handleRequest);

function presentedSecret(req: Request): string {
  return (req.headers.get("x-raffle-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
}

async function recordAuditOnce(
  adminClient: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await adminClient.from("raffle_audit_events")
    .upsert(payload, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function recordDueReminders(
  adminClient: SupabaseClient,
  now: Date,
): Promise<number> {
  let recorded = 0;
  const { data: cycles, error: cycleError } = await adminClient.from(
    "raffle_cycles",
  )
    .select("id,status,opens_at,closes_at")
    .eq("status", "open")
    .lte("opens_at", now.toISOString());
  if (cycleError) throw cycleError;

  for (const value of cycles || []) {
    const cycle = asRecord(value);
    const opensAt = new Date(safeString(cycle.opens_at, 80));
    const closesAt = new Date(safeString(cycle.closes_at, 80));
    const due = Number.isFinite(opensAt.getTime()) &&
        Number.isFinite(closesAt.getTime())
      ? dueCycleReminderCodes(
        safeString(cycle.status, 20),
        now,
        opensAt,
        closesAt,
      )
      : [];

    for (const messageCode of due) {
      if (
        await recordAuditOnce(adminClient, {
          cycle_id: cycle.id,
          event_type: "cycle_reminder_due",
          dedupe_key: `raffle:${cycle.id}:cycle-reminder:${messageCode}`,
          sanitized_data: { messageCode },
        })
      ) recorded += 1;
    }
  }

  const { data: claims, error: claimError } = await adminClient.from(
    "raffle_draw_results",
  )
    .select(
      "id,cycle_id,draw_id,member_id,status,claim_opened_at,claim_deadline",
    )
    .in("status", ["selected", "contacted"])
    .not("claim_opened_at", "is", null)
    .gt("claim_deadline", now.toISOString());
  if (claimError) throw claimError;

  for (const value of claims || []) {
    const claim = asRecord(value);
    const deadline = new Date(safeString(claim.claim_deadline, 80));
    const due = Number.isFinite(deadline.getTime())
      ? dueClaimReminderCodes(now, deadline)
      : [];
    for (const messageCode of due) {
      if (
        await recordAuditOnce(adminClient, {
          cycle_id: claim.cycle_id,
          draw_id: claim.draw_id,
          draw_result_id: claim.id,
          member_id: claim.member_id,
          event_type: "claim_reminder_due",
          dedupe_key: `raffle:${claim.id}:claim-reminder:${messageCode}`,
          sanitized_data: { messageCode },
        })
      ) recorded += 1;
    }
  }

  return recorded;
}

async function promoteAlternates(
  adminClient: SupabaseClient,
  now: Date,
): Promise<number> {
  const { data: cycles, error } = await adminClient.from("raffle_cycles")
    .select("id,status,expires_at,claim_window_days")
    .eq("status", "drawn")
    .lte("draw_at", now.toISOString());
  if (error) throw error;
  let changed = 0;

  for (const cycleValue of cycles || []) {
    const cycle = asRecord(cycleValue);
    const expiresAt = new Date(safeString(cycle.expires_at, 80));
    const claimWindowDays = Number(cycle.claim_window_days);
    const { data: results, error: resultError } = await adminClient.from(
      "raffle_draw_results",
    )
      .select(
        "id,result_kind,selection_order,status,claim_opened_at,claim_deadline,claimed_at",
      )
      .eq("cycle_id", cycle.id)
      .in("result_kind", ["paid_winner", "alternate"])
      .order("selection_order");
    if (resultError) throw resultError;

    for (const value of results || []) {
      const result = asRecord(value);
      const deadline = Date.parse(safeString(result.claim_deadline, 80));
      if (
        ["selected", "contacted"].includes(safeString(result.status, 30)) &&
        result.claim_opened_at && Number.isFinite(deadline) &&
        deadline <= now.getTime()
      ) {
        const { data: expired, error: expireError } = await adminClient.from(
          "raffle_draw_results",
        )
          .update({ status: "expired", updated_at: now.toISOString() })
          .eq("id", result.id).in("status", ["selected", "contacted"])
          .select("id").maybeSingle();
        if (expireError) throw expireError;
        if (expired) {
          result.status = "expired";
          await recordAuditOnce(adminClient, {
            cycle_id: cycle.id,
            draw_result_id: result.id,
            event_type: "claim_expired",
            dedupe_key: `raffle:${result.id}:claim-expired`,
            sanitized_data: { claimState: "expired" },
          });
          changed += 1;
        }
      }
    }

    const active = hasActivePrizeRecipient((results || []).map(asRecord));
    const alternate = (results || []).map(asRecord).find((result) =>
      result.result_kind === "alternate" && result.status === "selected" &&
      !result.claim_opened_at
    );
    const transition = alternateTransition(
      now,
      expiresAt,
      active,
      Boolean(alternate),
      claimWindowDays,
    );
    if (transition === "wait") continue;

    if (alternate && transition === "promote") {
      const openedAt = now.toISOString();
      const deadline = new Date(
        now.getTime() + claimWindowDays * 86_400_000,
      ).toISOString();
      const { data: promoted, error: promoteError } = await adminClient.from(
        "raffle_draw_results",
      )
        .update({
          status: "selected",
          claim_opened_at: openedAt,
          claim_deadline: deadline,
          claim_window_days: claimWindowDays,
          updated_at: openedAt,
        })
        .eq("id", alternate.id).eq("status", "selected").is(
          "claim_opened_at",
          null,
        )
        .select("id").maybeSingle();
      if (promoteError) throw promoteError;
      if (promoted) {
        await recordAuditOnce(adminClient, {
          cycle_id: cycle.id,
          draw_result_id: alternate.id,
          event_type: "alternate_promoted",
          dedupe_key: `raffle:${alternate.id}:alternate-promoted`,
          sanitized_data: { claimState: "selected" },
        });
        changed += 1;
      }
    } else if (transition === "complete") {
      const { data: completed, error: completeError } = await adminClient.from(
        "raffle_cycles",
      )
        .update({
          status: "complete",
          completed_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", cycle.id).eq("status", "drawn")
        .select("id").maybeSingle();
      if (completeError) throw completeError;
      if (completed) {
        await recordAuditOnce(adminClient, {
          cycle_id: cycle.id,
          event_type: "cycle_completed",
          dedupe_key: `raffle:${cycle.id}:cycle-completed`,
          sanitized_data: { cycleStatus: "complete" },
        });
        changed += 1;
      }
    }
  }

  return changed;
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Not found." }, 404);
  }
  if (!raffleOperationalGates().scheduling) {
    return jsonResponse({ ok: false, message: "Not found." }, 404);
  }

  const expectedSecret = Deno.env.get("RAFFLE_SCHEDULE_CRON_SECRET") || "";
  if (expectedSecret.length < 32) {
    return jsonResponse({ ok: false, message: "Not found." }, 404);
  }
  if (!await constantTimeSecretMatches(presentedSecret(req), expectedSecret)) {
    return jsonResponse({ ok: false, message: "Not found." }, 404);
  }
  const adminClient = createRaffleAdminClient();
  if (!adminClient) {
    return jsonResponse({
      ok: false,
      error: "not_configured",
      message: "Raffle scheduling is disabled.",
    }, 500);
  }

  const now = new Date();
  const summary = {
    opened: 0,
    blocked: 0,
    frozen: 0,
    drawn: 0,
    claimStatesChanged: 0,
    remindersDue: 0,
  };
  try {
    const { data: readyCycles, error: readyError } = await adminClient.from(
      "raffle_cycles",
    )
      .select("id").eq("status", "ready").lte("opens_at", now.toISOString()).gt(
        "closes_at",
        now.toISOString(),
      );
    if (readyError) throw readyError;
    for (const value of readyCycles || []) {
      const cycle = asRecord(value);
      const { data, error } = await adminClient.rpc("open_raffle_cycle", {
        p_cycle_id: cycle.id,
        p_actor_id: null,
        p_now: now.toISOString(),
      });
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      if (result.opened === true) summary.opened += 1;
      else if (result.cycleStatus === "blocked") summary.blocked += 1;
    }

    summary.remindersDue += await recordDueReminders(adminClient, now);

    const { data: openCycles, error: openError } = await adminClient.from(
      "raffle_cycles",
    )
      .select("id").eq("status", "open").lte("closes_at", now.toISOString());
    if (openError) throw openError;
    for (const value of openCycles || []) {
      await freezeCycle(
        adminClient,
        safeString(asRecord(value).id, 80),
        null,
        now,
      );
      summary.frozen += 1;
    }

    const { data: frozenCycles, error: frozenError } = await adminClient.from(
      "raffle_cycles",
    )
      .select("id").eq("status", "frozen").lte("draw_at", now.toISOString());
    if (frozenError) throw frozenError;
    for (const value of frozenCycles || []) {
      const cycleId = safeString(asRecord(value).id, 80);
      const frozen = await freezeCycle(adminClient, cycleId, null, now);
      const completed = await completeFrozenDraw(
        adminClient,
        frozen,
        null,
        now,
      );
      if (completed.duplicate !== true) summary.drawn += 1;
    }

    summary.claimStatesChanged = await promoteAlternates(adminClient, now);
    summary.remindersDue += await recordDueReminders(adminClient, now);
    return jsonResponse({
      ok: true,
      data: summary,
      message: "Raffle schedule processed idempotently.",
    });
  } catch (error) {
    console.error("raffle schedule failed", { failed: true });
    return jsonResponse({
      ok: false,
      message: "Raffle schedule could not be completed.",
    }, 500);
  }
}
