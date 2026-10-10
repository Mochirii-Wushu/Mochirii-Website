import {
  processEventSync,
  scheduledEventFieldsMatch,
  type ReaperEventSyncDependencies,
  selectExistingScheduledEvent,
} from "./reaper-event-sync-workflow.ts";
import { desiredEventsFromSchedule } from "./reaper-discord-events.ts";
import type { JsonRecord } from "./discord-interaction-helpers.ts";
import { createEventSyncDiscordApi, EventSyncPause } from "./reaper-event-sync-transport.ts";
import { scheduledEventBody } from "./reaper-discord-events.ts";
import scheduleData from "../../../apps/web/public/data/guild-schedule.json" with {
  type: "json",
};

const guildId = "123456789012345678";
const interactionId = "223456789012345678";
const nextInteractionId = "323456789012345678";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
let fixtureId = 0;
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
type Run = { owner: unknown; state: string; retryNotBefore?: string };

function harness() {
  const schedule = structuredClone(scheduleData);
  schedule.discordCoverVersion = `workflow-test-${++fixtureId}`;
  const runs = new Map<string, Run>();
  const messages: string[] = [];
  const writes: Array<{ path: string; method: string; body: JsonRecord }> = [];
  const registryWrites: JsonRecord[] = [];
  const rpcCalls: string[] = [];
  let resources: JsonRecord[] = [];
  let existing: unknown = [];
  let coverFailureAt = 0;
  let covers = 0;
  let providerFailure = "";
  let registryFailure = false;
  let loseOwnership = false;
  let loseOwnershipAfterWrite = false;
  let rpcFailure = "";
  let nextId = 423456789012345678n;
  let pauseAfter = -1;
  let pauseReason: "rate_limit" | "deadline" = "rate_limit";
  let malformedResponse = "";
  let wireFenceFailure = false;
  let rpcFailureBeforeCommit = false;
  let coverBytes = png;
  let registryUpdateFailure = false;
  const admin = {
    from(table: string) {
      equal(table, "discord_resources");
      const filters: JsonRecord = {};
      let update: JsonRecord | null = null;
      const query = {
        select(_fields: string) {
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        update(value: JsonRecord) {
          update = value;
          return query;
        },
        then(resolve: (value: unknown) => void) {
          if (update) {
            registryWrites.push(update);
            resources = resources.map((row) => Object.entries(filters).every(([key, value]) => row[key] === value) ? { ...row, ...update } : row);
          }
          else {
            equal(filters.discord_parent_id, guildId);
            equal(filters.enabled, true);
          }
          return Promise.resolve({ data: update ? resources : resources.filter((row) => row.enabled === true), error: update && registryUpdateFailure ? { code: "TEST_UPDATE" } : null }).then(
            resolve,
          );
        },
        upsert(value: JsonRecord) {
          registryWrites.push(value);
          if (!registryFailure) resources = [...resources.filter((row) => row.discord_id !== value.discord_id), { id: `registry-${value.discord_id}`, ...value }];
          return Promise.resolve({
            error: registryFailure
              ? { code: "TEST_FAILURE", message: "test" }
              : null,
          });
        },
      };
      return query;
    },
    rpc(name: string, args: JsonRecord) {
      rpcCalls.push(name);
      const key = String(args.p_interaction_id);
      const run = runs.get(key);
      if (name === rpcFailure && rpcFailureBeforeCommit) {
        rpcFailure = "";
        return Promise.resolve({ data: null, error: { code: "TEST_RPC_AMBIGUITY" } });
      }
      let data: unknown = false;
      if (name === "reaper_reserve_event_sync") {
        if (run) data = "duplicate";
        else if (
          [...runs.values()].some((entry) =>
            ["reserved", "writing", "blocked"].includes(entry.state)
          )
        ) data = "busy";
        else if ([...runs.values()].some((entry) => entry.state === "paused" && Date.parse(entry.retryNotBefore || "") > Date.now())) data = "cooldown";
        else {
          runs.set(key, { owner: args.p_owner_id, state: "reserved" });
          data = "acquired";
        }
      } else if (
        run && run.owner === args.p_owner_id &&
        ["reserved", "writing"].includes(run.state)
      ) {
        if (name === "reaper_begin_event_sync_write" && !loseOwnership) {
          run.state = "writing";
          data = true;
        }
        if (name === "reaper_pause_event_sync") {
          run.state = "paused";
          run.retryNotBefore = String(args.p_retry_not_before);
          data = true;
        }
        if (
          name === "reaper_finish_event_sync" &&
          !(run.state === "writing" && args.p_outcome === "rejected")
        ) {
          run.state = String(args.p_outcome);
          data = true;
        }
      }
      if (name === rpcFailure) {
        rpcFailure = "";
        return Promise.resolve({
          data: null,
          error: { code: "TEST_RPC_AMBIGUITY" },
        });
      }
      return Promise.resolve({ data, error: null });
    },
  };
  const deps: ReaperEventSyncDependencies = {
    interactionId,
    expectedGuildId: guildId,
    guildScheduleUrl: "https://mochirii.com/data/guild-schedule.json",
    discordApiUserAgent: "test",
    discordApiHeaders: () => new Headers(),
    serviceAdminClient: () => admin,
    editOriginalInteractionResponse: (_app, _token, message) => {
      messages.push(message);
      return Promise.resolve();
    },
    async discordApi(path, init = {}, beforeAttempt) {
      const method = init.method || "GET";
      if (method === "GET") {
        if (providerFailure === "pause-get") throw new EventSyncPause("deadline", new Date(Date.now() + 60_000).toISOString());
        return { ok: true, status: 200, data: existing };
      }
      assert(beforeAttempt, "Every actual provider attempt requires its own fence");
      if (wireFenceFailure) loseOwnership = true;
      await beforeAttempt();
      if (writes.length === pauseAfter) throw new EventSyncPause(pauseReason, new Date(Date.now() + 60_000).toISOString());
      assert(
        [...runs.values()].some((run) => run.state === "writing"),
        "Provider writes require a durable writing reservation",
      );
      writes.push({
        path,
        method,
        body: init.body ? JSON.parse(String(init.body)) : {},
      });
      if (loseOwnershipAfterWrite) loseOwnership = true;
      if (providerFailure === "network") {
        throw new Error("Ambiguous network failure");
      }
      if (providerFailure === "500") {
        return Promise.resolve({ ok: false, status: 500, data: {} });
      }
      if (providerFailure === "pause-lookalike") throw Object.assign(new Error("Untrusted pause"), { reason: "rate_limit", notBeforeIso: new Date().toISOString() });
      if (method === "DELETE") {
        existing = (existing as JsonRecord[]).filter((item) => item.id !== path.split("/").at(-1));
        return { ok: true, status: 204, data: null };
      }
      const id = method === "PATCH"
        ? path.split("/").at(-1)!
        : String(nextId++);
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const event = { ...body, id, guild_id: guildId, status: 1, entity_id: null,
        image: body.image ? "a".repeat(32) : null };
      if (malformedResponse === "id") event.id = "923456789012345678";
      if (malformedResponse === "guild") event.guild_id = "923456789012345678";
      if (malformedResponse === "fields") delete event.scheduled_end_time;
      if (malformedResponse === "image") event.image = "invalid";
      existing = [...(Array.isArray(existing) ? existing.filter((item) => item.id !== id) : []), event];
      return { ok: true, status: 200, data: event };
    },
  };
  const fetcher = ((url: unknown) => {
    if (String(url).includes("guild-schedule.json")) {
      return Promise.resolve(Response.json(schedule));
    }
    covers++;
    return Promise.resolve(
      new Response(coverFailureAt === covers ? "invalid" : coverBytes, {
        headers: {
          "Content-Type": coverFailureAt === covers ? "text/html" : "image/png",
        },
      }),
    );
  }) as typeof fetch;
  return {
    deps,
    schedule,
    runs,
    messages,
    writes,
    registryWrites,
    rpcCalls,
    fetcher,
    coverCount() {
      return covers;
    },
    setExisting(value: unknown) {
      existing = value;
    },
    setResources(value: JsonRecord[]) {
      resources = value;
    },
    failCover(index: number) {
      coverFailureAt = index;
    },
    failProvider(value: string) {
      providerFailure = value;
    },
    failRegistry() {
      registryFailure = true;
    },
    loseOwnership() {
      loseOwnership = true;
    },
    loseOwnershipAfterWrite() {
      loseOwnershipAfterWrite = true;
    },
    failRpc(name: string, beforeCommit = false) {
      rpcFailure = name;
      rpcFailureBeforeCommit = beforeCommit;
    },
    pauseAfter(count: number, reason: "rate_limit" | "deadline" = "rate_limit") { pauseAfter = count; pauseReason = reason; },
    malformedResponse(value: string) { malformedResponse = value; },
    failWireFence() { wireFenceFailure = true; },
    expireCooldown() { for (const run of runs.values()) run.retryNotBefore = new Date(0).toISOString(); pauseAfter = -1; },
    resources() { return resources; },
    events() { return existing as JsonRecord[]; },
    setCoverBytes(value: Uint8Array) { coverBytes = new Uint8Array(value); schedule.discordCoverVersion += "-changed"; },
    failRegistryUpdate() { registryUpdateFailure = true; },
  };
}

async function withHarness(
  test: (value: ReturnType<typeof harness>) => Promise<void>,
) {
  const value = harness();
  const originalFetch = globalThis.fetch;
  const oldToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const oldOverride = Deno.env.get("GUILD_SCHEDULE_URL");
  globalThis.fetch = value.fetcher;
  Deno.env.set("DISCORD_BOT_TOKEN", "test-placeholder");
  Deno.env.delete("GUILD_SCHEDULE_URL");
  try {
    await test(value);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) Deno.env.delete("DISCORD_BOT_TOKEN");
    else Deno.env.set("DISCORD_BOT_TOKEN", oldToken);
    if (oldOverride === undefined) Deno.env.delete("GUILD_SCHEDULE_URL");
    else Deno.env.set("GUILD_SCHEDULE_URL", oldOverride);
  }
}
const sync = (deps: ReaperEventSyncDependencies, mode = "apply") =>
  processEventSync(mode, "test-interaction-token", "523456789012345678", deps);

async function seedPartialScheduledEvents(h: ReturnType<typeof harness>) {
  const desired = desiredEventsFromSchedule(h.schedule).slice(0, 6);
  equal(desired.map((event) => event.key), ["monthly-gathering", "monthly-raffle", "guild-party", "breaking-army", "showdown", "guild-wars"]);
  const events: JsonRecord[] = [];
  const resources: JsonRecord[] = [];
  for (let i = 0; i < desired.length; i++) {
    const event = desired[i];
    const id = event.canonicalEventId || String(623456789012345678n + BigInt(i));
    events.push({ ...await scheduledEventBody(event, false), recurrence_rule: event.recurrenceRule, id, guild_id: guildId, status: 1, entity_id: null, image: "b".repeat(32) });
    resources.push({ id: `partial-${i}`, kind: "scheduled_event", discord_id: id, discord_parent_id: guildId, enabled: true, metadata: { managedBy: "reaper-event-sync", siteEventKey: event.key, coverImageUrl: event.coverImageUrl } });
  }
  h.setExisting(events);
  h.setResources(resources);
}

const partyKeeperId = "1558076114486698016";
const armyKeeperId = "1558076127216668793";
const armyDuplicateId = "1558076133428297841";
const hostedOwnerId = "11111111-1111-4111-8111-111111111111";
const legacyNow = new Date("2026-10-11T12:00:00+08:00");

async function seedLegacyActivities(h: ReturnType<typeof harness>) {
  h.deps.now = legacyNow;
  const desired = desiredEventsFromSchedule(h.schedule, legacyNow);
  const events: JsonRecord[] = [];
  const rows: JsonRecord[] = [];
  let id = 823456789012345678n;
  for (const event of desired) {
    const keys = event.legacyKeys || [event.key];
    for (const key of keys) {
      const keeperId = key === "guild-party-5" ? partyKeeperId
        : key === "breaking-army-1" ? armyKeeperId
        : key === "breaking-army-3" ? armyDuplicateId
        : event.canonicalEventId || String(id++);
      const selected = key === "breaking-army-3"
        ? { ...event, startIso: "2026-10-14T14:00:00.000Z", endIso: "2026-10-14T16:00:00.000Z" }
        : event;
      const provider = { ...await scheduledEventBody(selected, false), recurrence_rule: selected.recurrenceRule,
        id: keeperId, guild_id: guildId, status: 1, entity_id: null, image: "b".repeat(32) };
      // The owner retained five Discord events and intentionally removed all
      // other legacy weekday entries; their enabled registry rows still exist.
      if (!event.legacyKeys || [partyKeeperId, armyKeeperId, armyDuplicateId].includes(keeperId)) events.push(provider);
      rows.push({ id: `legacy-${key}`, kind: "scheduled_event", discord_id: keeperId, discord_parent_id: guildId, enabled: true,
        metadata: { managedBy: "reaper-event-sync", siteEventKey: key, coverImageUrl: event.coverImageUrl,
          startIso: selected.startIso, endIso: selected.endIso, recurrenceRule: selected.recurrenceRule } });
    }
  }
  equal(rows.length, 17);
  equal(events.length, 5);
  h.setExisting(events);
  h.setResources(rows);
}

function reserveHosted(h: ReturnType<typeof harness>, keys: string[], now: Date) {
  h.runs.set(nextInteractionId, { owner: hostedOwnerId, state: "reserved" });
  return { ...h.deps, now, interactionId: nextInteractionId, reservationOwnerId: hostedOwnerId, advanceKeys: keys };
}

Deno.test("actual legacy consolidation preserves the daily Party and Monday Army keepers and retires absent weekday mappings", () =>
  withHarness(async (h) => {
    await seedLegacyActivities(h);
    const beforeIds = h.events().map((event) => event.id);
    await sync(h.deps, "preview");
    equal(h.writes, []);
    equal(h.registryWrites, []);
    assert(h.messages.at(-1)?.includes(`Would remove duplicate: Breaking Army (event ${armyDuplicateId})`));
    await sync(h.deps);
    equal(h.runs.get(interactionId)?.state, "completed");
    const enabled = h.resources().filter((row) => row.enabled === true);
    equal(enabled.length, 8);
    equal(enabled.map((row) => (row.metadata as JsonRecord).siteEventKey).sort(), desiredEventsFromSchedule(h.schedule, legacyNow).map((event) => event.key).sort());
    equal(enabled.find((row) => (row.metadata as JsonRecord).siteEventKey === "guild-party")?.discord_id, partyKeeperId);
    equal(enabled.find((row) => (row.metadata as JsonRecord).siteEventKey === "breaking-army")?.discord_id, armyKeeperId);
    equal(h.events().length, 8);
    equal(h.writes.filter((write) => write.method === "DELETE").map((write) => write.path.split("/").at(-1)), [armyDuplicateId]);
    equal(h.events().filter((event) => beforeIds.includes(event.id)).map((event) => event.id).sort(), beforeIds.filter((id) => id !== armyDuplicateId).sort());
    const retired = h.resources().filter((row) => row.enabled === false);
    equal(retired.length, 13);
    assert(retired.every((row) => (row.metadata as JsonRecord).retiredBy === "reaper-event-sync"));
    equal((retired.find((row) => row.discord_id === armyDuplicateId)?.metadata as JsonRecord).retiredReason, "consolidated-activity-series");
    equal(h.writes.filter((write) => write.method === "POST").length, 4);
    const writes = h.writes.length, registryWrites = h.registryWrites.length;
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(h.writes.length, writes);
    equal(h.registryWrites.length, registryWrites);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
  }));

Deno.test("foreign same-title activities and ambiguous legacy keepers reject the complete plan before writes", async () => {
  for (const mode of ["preview", "apply"]) {
    for (const conflict of ["foreign-title", "ambiguous-legacy"]) await withHarness(async (h) => {
      await seedLegacyActivities(h);
      const army = h.events().find((event) => event.id === armyKeeperId)!;
      if (conflict === "foreign-title") h.events().push({ ...army, id: "923456789012345678", scheduled_start_time: "2026-10-20T14:00:00.000Z" });
      else Object.assign(h.events().find((event) => event.id === armyDuplicateId)!, { scheduled_start_time: army.scheduled_start_time, scheduled_end_time: army.scheduled_end_time });
      await sync(h.deps, mode);
      equal(h.writes, []);
      equal(h.registryWrites, []);
      equal(h.coverCount(), 0);
      equal(h.runs.get(interactionId)?.state, mode === "apply" ? "rejected" : undefined);
    });
  }
});

Deno.test("a paused legacy duplicate DELETE keeps its owned row and resumes from acknowledged keeper checkpoints", () =>
  withHarness(async (h) => {
    await seedLegacyActivities(h);
    h.pauseAfter(4);
    await sync(h.deps);
    equal(h.runs.get(interactionId)?.state, "paused");
    equal(h.writes.length, 4);
    equal(h.resources().find((row) => row.discord_id === armyDuplicateId)?.enabled, true);
    equal((h.resources().find((row) => row.discord_id === armyKeeperId)?.metadata as JsonRecord).siteEventKey, "breaking-army");
    assert(h.events().some((event) => event.id === armyDuplicateId));
    assert(!h.messages.at(-1)?.includes(`Removed duplicate: Breaking Army (event ${armyDuplicateId})`));
    assert(h.messages.at(-1)?.includes("Updated: Breaking Army"));
    h.expireCooldown();
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal(h.writes.filter((write) => write.path.endsWith(`/${armyKeeperId}`) && write.method === "PATCH").length, 1);
    equal(h.writes.filter((write) => write.method === "DELETE").map((write) => write.path.split("/").at(-1)), [armyDuplicateId]);
    equal(h.resources().find((row) => row.discord_id === armyDuplicateId)?.enabled, false);
    equal(h.resources().filter((row) => row.enabled === true).length, 8);
  }));

Deno.test("hosted advancement replaces only each due rolling activity and preserves completed provider history without a second reserve", async () => {
  for (const [key, now, nextDate] of [
    ["breaking-army", "2026-10-13T00:00:00+08:00", "2026-10-14"],
    ["showdown", "2026-10-14T00:00:00+08:00", "2026-10-15"],
  ]) await withHarness(async (h) => {
    h.deps.now = new Date("2026-10-12T21:00:00+08:00");
    await sync(h.deps);
    const prior = h.resources().find((row) => (row.metadata as JsonRecord).siteEventKey === key)!;
    const history = h.events().find((event) => event.id === prior.discord_id)!;
    history.status = 3;
    const before = structuredClone(history);
    const writes = h.writes.length;
    const reserves = h.rpcCalls.filter((name) => name === "reaper_reserve_event_sync").length;
    await sync(reserveHosted(h, [key], new Date(now)));
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal(h.rpcCalls.filter((name) => name === "reaper_reserve_event_sync").length, reserves);
    equal(h.writes.slice(writes).map((write) => write.method), ["POST"]);
    equal(h.writes.at(-1)?.body.scheduled_start_time, `${nextDate}T14:00:00.000Z`);
    equal(h.writes.at(-1)?.body.recurrence_rule, null);
    equal(h.events().find((event) => event.id === prior.discord_id), before);
    equal(h.resources().find((row) => row.discord_id === prior.discord_id)?.enabled, false);
    const enabled = h.resources().filter((row) => row.enabled === true && (row.metadata as JsonRecord).siteEventKey === key);
    equal(enabled.length, 1);
    assert(enabled[0].discord_id !== prior.discord_id);
    equal(h.resources().filter((row) => row.enabled === true).length, 8);
  });
});

Deno.test("absent rolling provider IDs require exact completed direct-read proof before any replacement", async () => {
  for (const proof of ["completed", "404", "500", "null", "array", "network", "wrong-id", "wrong-guild", "wrong-type", "active", "canceled", "native", "missing-recurrence", "changed-start", "changed-end", "missing-recorded-start", "malformed-recorded-start", "missing-provider-start", "malformed-provider-start", "reversed-recorded-window", "zero-recorded-window"]) await withHarness(async (h) => {
    h.deps.now = new Date("2026-10-12T21:00:00+08:00");
    await sync(h.deps);
    const armyRow = h.resources().find((row) => (row.metadata as JsonRecord).siteEventKey === "breaking-army")!;
    const showdownRow = h.resources().find((row) => (row.metadata as JsonRecord).siteEventKey === "showdown")!;
    const army = h.events().find((event) => event.id === armyRow.discord_id)!;
    const showdown = h.events().find((event) => event.id === showdownRow.discord_id)!;
    army.status = showdown.status = 3;
    const completedArmy = structuredClone(army);
    const completedShowdown = structuredClone(showdown);
    h.setExisting(h.events().filter((event) => event.id !== showdown.id));
    const readback = structuredClone(showdown);
    if (proof === "wrong-id") readback.id = "923456789012345678";
    if (proof === "wrong-guild") readback.guild_id = "923456789012345678";
    if (proof === "wrong-type") readback.entity_type = 2;
    if (proof === "active") readback.status = 2;
    if (proof === "canceled") readback.status = 4;
    if (proof === "native") readback.recurrence_rule = { start: readback.scheduled_start_time, frequency: 2, interval: 1, by_weekday: [1] };
    if (proof === "missing-recurrence") delete readback.recurrence_rule;
    if (proof === "changed-start") readback.scheduled_start_time = "2026-10-13T14:01:00.000Z";
    if (proof === "changed-end") readback.scheduled_end_time = "2026-10-13T16:01:00.000Z";
    const recorded = showdownRow.metadata as JsonRecord;
    if (proof === "missing-recorded-start") {
      delete recorded.startIso;
      delete readback.scheduled_start_time;
    }
    if (proof === "malformed-recorded-start") recorded.startIso = readback.scheduled_start_time = "invalid";
    if (proof === "missing-provider-start") delete readback.scheduled_start_time;
    if (proof === "malformed-provider-start") readback.scheduled_start_time = "invalid";
    if (proof === "reversed-recorded-window") recorded.endIso = readback.scheduled_end_time = "2026-10-13T13:59:00.000Z";
    if (proof === "zero-recorded-window") recorded.endIso = readback.scheduled_end_time = recorded.startIso;
    const expectedReadback = structuredClone(readback);
    const originalApi = h.deps.discordApi;
    const directReads: string[] = [];
    h.deps.discordApi = async (path, init = {}, beforeAttempt) => {
      if ((init.method || "GET") === "GET" && path.endsWith(`/${showdown.id}`)) {
        directReads.push(path);
        if (proof === "network") throw new Error("Unconfirmed direct event read");
        return { ok: !["404", "500"].includes(proof), status: proof === "404" ? 404 : proof === "500" ? 500 : 200,
          data: proof === "null" ? null : proof === "array" ? [readback] : readback };
      }
      return await originalApi(path, init, beforeAttempt);
    };
    const writes = h.writes.length, registryWrites = h.registryWrites.length, covers = h.coverCount();
    const reserves = h.rpcCalls.filter((name) => name === "reaper_reserve_event_sync").length;
    await sync(reserveHosted(h, ["breaking-army", "showdown"], new Date("2026-10-14T00:00:00+08:00")));
    const invalidRecordedWindow = ["missing-recorded-start", "malformed-recorded-start", "reversed-recorded-window", "zero-recorded-window"].includes(proof);
    equal(directReads, invalidRecordedWindow ? [] : [`/guilds/${guildId}/scheduled-events/${showdown.id}`]);
    equal(h.rpcCalls.filter((name) => name === "reaper_reserve_event_sync").length, reserves);
    equal(h.events().find((event) => event.id === army.id), completedArmy);
    equal(readback, expectedReadback);
    if (proof === "completed") {
      equal(readback, completedShowdown);
      equal(h.runs.get(nextInteractionId)?.state, "completed");
      equal(h.writes.slice(writes).map((write) => write.method), ["POST", "POST"]);
      equal(h.resources().find((row) => row.discord_id === army.id)?.enabled, false);
      equal(h.resources().find((row) => row.discord_id === showdown.id)?.enabled, false);
      equal(h.resources().filter((row) => row.enabled === true).length, 8);
    } else {
      equal(h.runs.get(nextInteractionId)?.state, "rejected");
      equal(h.writes.length, writes);
      equal(h.registryWrites.length, registryWrites);
      equal(h.coverCount(), covers);
      equal(h.resources().find((row) => row.discord_id === army.id)?.enabled, true);
      equal(h.resources().find((row) => row.discord_id === showdown.id)?.enabled, true);
      assert(!h.messages.at(-1)?.includes("Event sync finished"));
    }
  });
});

Deno.test("premature, active, canceled, native and legacy advancement scopes fail closed before any new write", async () => {
  for (const invalid of ["premature", "active", "canceled", "native", "legacy-key", "legacy-row", "mixed-not-due"]) await withHarness(async (h) => {
    h.deps.now = new Date("2026-10-12T21:00:00+08:00");
    await sync(h.deps);
    const armyRow = h.resources().find((row) => (row.metadata as JsonRecord).siteEventKey === "breaking-army")!;
    const army = h.events().find((event) => event.id === armyRow.discord_id)!;
    army.status = invalid === "active" ? 2 : invalid === "canceled" ? 4 : 3;
    if (invalid === "legacy-row") (armyRow.metadata as JsonRecord).siteEventKey = "breaking-army-1";
    const keys = invalid === "native" ? ["guild-party"] : invalid === "legacy-key" ? ["breaking-army-1"]
      : invalid === "mixed-not-due" ? ["breaking-army", "showdown"] : ["breaking-army"];
    const now = new Date(invalid === "premature" ? "2026-10-12T23:59:59.999+08:00" : "2026-10-13T00:00:00+08:00");
    const writes = h.writes.length, registryWrites = h.registryWrites.length;
    const reserves = h.rpcCalls.filter((name) => name === "reaper_reserve_event_sync").length;
    await sync(reserveHosted(h, keys, now));
    equal(h.writes.length, writes);
    equal(h.registryWrites.length, registryWrites);
    equal(h.rpcCalls.filter((name) => name === "reaper_reserve_event_sync").length, reserves);
    equal(h.runs.get(nextInteractionId)?.state, "rejected");
    assert(!h.messages.at(-1)?.includes("Event sync finished"));
  });
});

Deno.test("native series keep valid original anchors across later days and months without repeated PATCH", () =>
  withHarness(async (h) => {
    h.deps.now = new Date("2026-11-01T12:00:00+08:00");
    await sync(h.deps);
    const gatheringRow = h.resources().find((row) => (row.metadata as JsonRecord).siteEventKey === "monthly-gathering")!;
    const gathering = h.events().find((event) => event.id === gatheringRow.discord_id)!;
    const originalAnchor = (gathering.recurrence_rule as JsonRecord).start;
    // Discord can advance its displayed occurrence while retaining the native
    // series anchor. Reconcile the registry without resetting that series.
    gathering.scheduled_start_time = "2026-12-06T16:00:00.000Z";
    gathering.scheduled_end_time = "2026-12-06T17:00:00.000Z";
    const before = structuredClone(h.events());
    const writes = h.writes.length;
    const priorRegistryWrites = h.registryWrites.length;
    await sync({ ...h.deps, now: new Date("2026-12-08T12:00:00+08:00"), interactionId: nextInteractionId });
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    const changed = h.writes.slice(writes);
    equal(changed.length, 2);
    const rollingIds = h.resources().filter((row) => ["breaking-army", "showdown"].includes(String((row.metadata as JsonRecord).siteEventKey))).map((row) => row.discord_id);
    assert(changed.every((write) => write.method === "PATCH" && rollingIds.includes(write.path.split("/").at(-1)!)));
    for (const prior of before.filter((event) => event.recurrence_rule)) equal(h.events().find((event) => event.id === prior.id), prior);
    equal(h.registryWrites.length, priorRegistryWrites + 3);
    const gatheringMetadata = h.resources().find((row) => row.discord_id === gathering.id)!.metadata as JsonRecord;
    equal(gatheringMetadata.startIso, "2026-12-06T16:00:00.000Z");
    equal((gatheringMetadata.recurrenceRule as JsonRecord).start, originalAnchor);
    const registryWrites = h.registryWrites.length;
    await sync({ ...h.deps, now: new Date("2026-12-08T12:00:00+08:00"), interactionId: "723456789012345678" });
    equal(h.writes.length, writes + 2);
    equal(h.registryWrites.length, registryWrites);
    equal(h.runs.get("723456789012345678")?.state, "completed");
  }));

Deno.test("native anchor preservation rejects wrong clocks, durations, selectors and off-rule monthly anchors", async () => {
  for (const drift of ["clock", "duration", "selectors", "monthly-anchor", "weekly-anchor"]) await withHarness(async (h) => {
    h.deps.now = new Date("2026-10-10T12:00:00+08:00");
    await sync(h.deps);
    const key = drift === "monthly-anchor" ? "monthly-gathering" : drift === "weekly-anchor" ? "guild-wars" : "guild-party";
    const row = h.resources().find((resource) => (resource.metadata as JsonRecord).siteEventKey === key)!;
    const event = h.events().find((provider) => provider.id === row.discord_id)!;
    if (drift === "clock") {
      event.scheduled_start_time = new Date(Date.parse(String(event.scheduled_start_time)) + 3_600_000).toISOString();
      event.scheduled_end_time = new Date(Date.parse(String(event.scheduled_end_time)) + 3_600_000).toISOString();
    }
    if (drift === "duration") event.scheduled_end_time = new Date(Date.parse(String(event.scheduled_end_time)) + 60_000).toISOString();
    if (drift === "selectors") (event.recurrence_rule as JsonRecord).by_weekday = [0, 1, 2, 3, 4];
    if (drift === "monthly-anchor") (event.recurrence_rule as JsonRecord).start = "2026-10-11T16:00:00.000Z";
    if (drift === "weekly-anchor") (event.recurrence_rule as JsonRecord).start = "2026-10-05T12:30:00.000Z";
    const writes = h.writes.length;
    const now = new Date("2026-10-11T12:00:00+08:00");
    await sync({ ...h.deps, now, interactionId: nextInteractionId });
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal(h.writes.slice(writes).map((write) => [write.method, write.path.split("/").at(-1)]), [["PATCH", row.discord_id]]);
    const desired = desiredEventsFromSchedule(h.schedule, now).find((item) => item.key === key)!;
    equal(h.writes.at(-1)?.body.scheduled_start_time, desired.startIso);
    equal((h.writes.at(-1)?.body.recurrence_rule as JsonRecord).start, desired.startIso);
  });
});

Deno.test("concurrent actual workflows serialize per guild before any Discord write", () =>
  withHarness(async (h) => {
    await Promise.all([
      sync(h.deps),
      sync({ ...h.deps, interactionId: nextInteractionId }),
    ]);
    equal(h.writes.length, 8);
    equal(h.registryWrites.length, 8);
    equal(h.runs.size, 1);
    equal(h.runs.get(interactionId)?.state, "completed");
    assert(
      h.messages.some((message) => message.includes("active or unresolved")),
    );
  }));

Deno.test("duplicate interaction is deduped before writes and stays consumed after completion", () =>
  withHarness(async (h) => {
    await Promise.all([sync(h.deps), sync(h.deps)]);
    await sync(h.deps);
    equal(h.writes.length, 8);
    equal(
      h.messages.filter((message) => message.includes("already handled"))
        .length,
      2,
    );
  }));

Deno.test("preview preflights all covers and identities without reservation or provider/registry writes", () =>
  withHarness(async (h) => {
    await sync(h.deps, "preview");
    equal(h.rpcCalls, []);
    equal(h.writes, []);
    equal(h.registryWrites, []);
    assert(h.messages[0].includes("Would create"));
  }));

Deno.test("late cover failure releases only a pre-write reservation and prevents every provider mutation", () =>
  withHarness(async (h) => {
    h.failCover(8);
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.registryWrites, []);
    equal(h.runs.get(interactionId)?.state, "rejected");
    await sync(h.deps);
    equal(h.writes, []);
    assert(h.messages.at(-1)?.includes("already handled"));
  }));

Deno.test("unregistered apparent match cannot be adopted and blocks the whole apply", () =>
  withHarness(async (h) => {
    const desired = desiredEventsFromSchedule(h.schedule)[0];
    h.setExisting([{
      id: "623456789012345678",
      name: desired.title,
      scheduled_start_time: desired.startIso,
      entity_type: 3,
      entity_metadata: { location: desired.location },
    }]);
    await sync(h.deps);
    equal(h.coverCount(), 0);
    equal(h.writes, []);
    equal(h.registryWrites, []);
    equal(h.runs.get(interactionId)?.state, "rejected");
    assert(h.messages[0].includes("explicit adoption"));
  }));

Deno.test("explicit canonical or enabled managed identity is required for PATCH", () =>
  withHarness(async (h) => {
    const desired = desiredEventsFromSchedule(h.schedule)[0];
    const event = {
      id: "623456789012345678",
      guild_id: guildId,
      status: 1,
      name: desired.title,
      scheduled_start_time: desired.startIso,
      entity_type: 3,
      entity_metadata: { location: desired.location },
    };
    const resource = {
      discord_id: event.id,
      enabled: true,
      metadata: { managedBy: "reaper-event-sync", siteEventKey: desired.key },
    };
    equal(
      selectExistingScheduledEvent([event], {
        ...desired,
        canonicalEventId: event.id,
      }, undefined),
      event,
    );
    equal(selectExistingScheduledEvent([event], desired, resource), event);
    for (
      const invalid of [{ ...resource, enabled: false }, {
        ...resource,
        metadata: { managedBy: "other", siteEventKey: desired.key },
      }, {
        ...resource,
        metadata: { managedBy: "reaper-event-sync", siteEventKey: "other" },
      }]
    ) {
      let rejected = false;
      try {
        selectExistingScheduledEvent([event], desired, invalid);
      } catch {
        rejected = true;
      }
      assert(rejected);
    }
    h.setExisting([event]);
    h.setResources([resource]);
    await sync(h.deps);
    equal(h.writes[0].method, "PATCH");
    equal(h.writes.length, 8);
  }));

Deno.test("generated schedule key collisions reject preview and apply before covers or writes", async () => {
  for (const mode of ["preview", "apply"]) {
    await withHarness(async (h) => {
      h.schedule.monthly.gathering.id = "guild-party";
      await sync(h.deps, mode);
      equal(h.coverCount(), 0);
      equal(h.writes, []);
      equal(h.registryWrites, []);
      equal(
        h.runs.get(interactionId)?.state,
        mode === "apply" ? "rejected" : undefined,
      );
    });
  }
});

Deno.test("two managed schedule keys cannot PATCH the same Discord target", async () => {
  for (const mode of ["preview", "apply"]) {
    await withHarness(async (h) => {
      const desired = desiredEventsFromSchedule(h.schedule).slice(0, 2);
      const event = {
        id: "623456789012345678",
        guild_id: guildId,
        status: 1,
        name: "Existing managed event",
        entity_type: 3,
      };
      h.setExisting([event]);
      h.setResources(desired.map((item) => ({
        discord_id: event.id,
        enabled: true,
        metadata: { managedBy: "reaper-event-sync", siteEventKey: item.key },
      })));
      await sync(h.deps, mode);
      equal(h.coverCount(), 0);
      equal(h.writes, []);
      equal(h.registryWrites, []);
      equal(
        h.runs.get(interactionId)?.state,
        mode === "apply" ? "rejected" : undefined,
      );
    });
  }
});

Deno.test("a managed target cannot overlap another event's explicit duplicate removal", async () => {
  for (const mode of ["preview", "apply"]) {
    await withHarness(async (h) => {
      const desired = desiredEventsFromSchedule(h.schedule)[0];
      const event = {
        id: h.schedule.monthly.raffle.discordDuplicateEventIds[0],
        guild_id: guildId,
        status: 1,
        name: "Existing managed event",
        entity_type: 3,
      };
      h.setExisting([event]);
      h.setResources([{
        discord_id: event.id,
        enabled: true,
        metadata: { managedBy: "reaper-event-sync", siteEventKey: desired.key },
      }]);
      await sync(h.deps, mode);
      equal(h.coverCount(), 0);
      equal(h.writes, []);
      equal(h.registryWrites, []);
      equal(
        h.runs.get(interactionId)?.state,
        mode === "apply" ? "rejected" : undefined,
      );
    });
  }
});

Deno.test("weekly canonical and duplicate IDs reject before Discord or registry writes", async () => {
  for (const mode of ["preview", "apply"]) {
    for (
      const identity of [{ discordEventId: "723456789012345678" }, {
        discordDuplicateEventIds: ["723456789012345678"],
      }]
    ) {
      await withHarness(async (h) => {
        Object.assign(h.schedule.weekly[0], identity);
        await sync(h.deps, mode);
        equal(h.coverCount(), 0);
        equal(h.writes, []);
        equal(h.registryWrites, []);
        equal(
          h.runs.get(interactionId)?.state,
          mode === "apply" ? "rejected" : undefined,
        );
      });
    }
  }
});

for (const failure of ["network", "500", "registry"]) {
  Deno.test(`${failure} uncertainty blocks the guild without replay or automatic takeover`, () =>
    withHarness(async (h) => {
      if (failure === "registry") h.failRegistry();
      else h.failProvider(failure);
      await sync(h.deps);
      equal(h.writes.length, 1);
      equal(h.runs.get(interactionId)?.state, "blocked");
      assert(h.messages[0].includes("Do not retry apply"));
      await sync({ ...h.deps, interactionId: nextInteractionId });
      equal(h.writes.length, 1);
      equal(h.runs.size, 1);
    }));
}

Deno.test("lost reservation ownership prevents the first provider mutation", () =>
  withHarness(async (h) => {
    h.loseOwnership();
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.runs.get(interactionId)?.state, "blocked");
  }));

Deno.test("invalid signed-payload interaction ID fails before reservation, fetch or Discord writes", () =>
  withHarness(async (h) => {
    for (const id of ["invalid", "123", "1".repeat(22)]) {
      await sync({ ...h.deps, interactionId: id });
    }
    equal(h.rpcCalls, []);
    equal(h.writes, []);
    equal(h.runs.size, 0);
  }));

Deno.test("ownership is verified again before registry mutation after a provider write", () =>
  withHarness(async (h) => {
    h.loseOwnershipAfterWrite();
    await sync(h.deps);
    equal(h.writes.length, 1);
    equal(h.registryWrites, []);
    equal(h.runs.get(interactionId)?.state, "blocked");
  }));

Deno.test("ambiguous reservation RPC is safely rejected when no provider write began", () =>
  withHarness(async (h) => {
    h.failRpc("reaper_reserve_event_sync");
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.runs.get(interactionId)?.state, "rejected");
  }));

Deno.test("ambiguous begin-write RPC cannot be released through the preflight path", () =>
  withHarness(async (h) => {
    h.failRpc("reaper_begin_event_sync_write");
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.runs.get(interactionId)?.state, "blocked");
    assert(h.messages[0].includes("Do not retry apply"));
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(h.writes, []);
    equal(h.runs.size, 1);
  }));

Deno.test("malformed successful Discord list cannot be treated as an empty guild", () =>
  withHarness(async (h) => {
    h.setExisting({ events: [] });
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.runs.get(interactionId)?.state, "rejected");
  }));

Deno.test("unsafe runtime schedule URL override fails before Discord writes and releases preflight", () =>
  withHarness(async (h) => {
    Deno.env.set("GUILD_SCHEDULE_URL", "https://127.0.0.1/private");
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.runs.get(interactionId)?.state, "rejected");
  }));

Deno.test("provider field comparison normalizes instants and recurrence without coercing types", async () => {
  const desired = desiredEventsFromSchedule(scheduleData)[0];
  const body = await scheduledEventBody(desired, false);
  const event: JsonRecord = { ...body, id: "623456789012345678", guild_id: guildId, entity_id: null, status: 1 };
  event.scheduled_start_time = String(body.scheduled_start_time).replace("Z", "+00:00");
  event.scheduled_end_time = String(body.scheduled_end_time).replace("Z", "+00:00");
  event.recurrence_rule = { ...body.recurrence_rule as JsonRecord, end: null, count: null, by_weekday: null, by_month: null, by_month_day: null, by_year_day: null };
  assert(scheduledEventFieldsMatch(event, body, guildId));
  for (const drift of [
    { status: 2 }, { guild_id: "923456789012345678" }, { privacy_level: "2" }, { entity_type: "3" },
    { channel_id: "623456789012345678" }, { entity_id: "623456789012345678" }, { description: null },
    { scheduled_start_time: "2026-02-30T00:00:00Z" }, { entity_metadata: { location: "other" } },
    { recurrence_rule: { ...body.recurrence_rule as JsonRecord, interval: "1" } },
    { recurrence_rule: { ...body.recurrence_rule as JsonRecord, by_weekday: "null" } },
    { recurrence_rule: { ...body.recurrence_rule as JsonRecord, extra: null } },
  ]) assert(!scheduledEventFieldsMatch({ ...event, ...drift }, body, guildId), JSON.stringify(drift));
});

Deno.test("fresh manual interaction skips converged provider and receipt with no registry writes", () =>
  withHarness(async (h) => {
    await sync(h.deps);
    const count = h.writes.length;
    const registryCount = h.registryWrites.length;
    assert(h.resources().every((row) => /^[A-F0-9]{64}$/.test(String((row.metadata as JsonRecord).coverImageSha256))));
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(h.writes.length, count);
    equal(h.registryWrites.length, registryCount);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    assert(h.messages.at(-1)?.includes("Unchanged:"));
  }));

Deno.test("recurrence arrays compare as sets while malformed and changed values fail closed", async () => {
  const desired = desiredEventsFromSchedule(scheduleData)[0];
  const body = await scheduledEventBody(desired, false);
  body.recurrence_rule = { start: desired.startIso, frequency: 2, interval: 1, by_weekday: [0, 4], by_n_weekday: [{ n: 1, day: 0 }, { n: 2, day: 4 }] };
  const rule = body.recurrence_rule as JsonRecord;
  const event: JsonRecord = { ...body, id: "623456789012345678", guild_id: guildId, entity_id: null, status: 1,
    recurrence_rule: { ...rule, by_weekday: [4, 0], by_n_weekday: [{ day: 4, n: 2 }, { day: 0, n: 1 }] } };
  assert(scheduledEventFieldsMatch(event, body, guildId));
  for (const drift of [
    { by_weekday: [0, "4"] }, { by_weekday: [0, 0, 4] }, { by_weekday: [0, 3] },
    { by_n_weekday: [{ n: "1", day: 0 }, { n: 2, day: 4 }] },
    { by_n_weekday: [{ n: 1, day: 0, extra: null }, { n: 2, day: 4 }] },
    { by_n_weekday: [{ n: 1, day: 0 }, { n: 3, day: 4 }] },
  ]) assert(!scheduledEventFieldsMatch({ ...event, recurrence_rule: { ...rule, ...drift } }, body, guildId), JSON.stringify(drift));
});

Deno.test("provider convergence and receipt allow registry URL repair without image PATCH", () =>
  withHarness(async (h) => {
    await sync(h.deps);
    const count = h.writes.length;
    const registryCount = h.registryWrites.length;
    h.schedule.discordCoverVersion += "-new-url-same-bytes";
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(h.writes.length, count);
    equal(h.registryWrites.length, registryCount + 8);
    assert(h.messages.at(-1)?.includes("Registry repaired:"));
  }));

for (const drift of ["url-only", "source-bytes", "actual-image", "provider-field"]) {
  Deno.test(`${drift} cannot be hidden by matching URL or stored schedule metadata`, () =>
    withHarness(async (h) => {
      await sync(h.deps);
      if (drift === "url-only") h.setResources(h.resources().map((row) => {
        const metadata = { ...row.metadata as JsonRecord };
        delete metadata.coverImageSha256;
        delete metadata.discordImageHash;
        return { ...row, metadata };
      }));
      if (drift === "source-bytes") h.setCoverBytes(new Uint8Array([...png, 1]));
      if (drift === "actual-image") h.events()[0].image = "b".repeat(32);
      if (drift === "provider-field") h.events()[0].description = "Provider drift despite registry agreement";
      const count = h.writes.length;
      await sync({ ...h.deps, interactionId: nextInteractionId });
      equal(h.writes.length - count, ["url-only", "source-bytes"].includes(drift) ? 8 : 1);
      equal(h.runs.get(nextInteractionId)?.state, "completed");
    }));
}

for (const reason of ["rate_limit", "deadline"] as const) {
  Deno.test(`${reason} pauses after five acknowledged checkpoints without replay or success claims`, () =>
    withHarness(async (h) => {
      h.pauseAfter(5, reason);
      await sync(h.deps);
      equal(h.writes.length, 5);
      equal(h.registryWrites.length, 5);
      equal(h.runs.get(interactionId)?.state, "paused");
      const reply = h.messages.at(-1)!;
      assert(reply.includes("incomplete and paused") && reply.includes(reason));
      const retry = new Date(Date.parse(h.runs.get(interactionId)!.retryNotBefore!) + 480 * 60_000).toISOString().replace("T", " ").replace("Z", " UTC+8");
      assert(reply.includes(`Retry not before ${retry}`));
      equal((reply.match(/Created:/g) || []).length, 5);
      assert(!reply.includes("Event sync finished"));
      await sync(h.deps);
      assert(h.messages.at(-1)?.includes("already handled"));
      await sync({ ...h.deps, interactionId: nextInteractionId });
      assert(h.messages.at(-1)?.includes("cooling down"));
      equal(h.runs.size, 1);
      h.expireCooldown();
      await sync({ ...h.deps, interactionId: nextInteractionId });
      equal(h.writes.length, 8);
      equal(h.registryWrites.length, 8);
      equal(h.runs.get(nextInteractionId)?.state, "completed");
      assert(h.messages.at(-1)?.includes("Unchanged:"));
    }));
}

Deno.test("pause waits until replacement registration and superseded retirement are acknowledged", () =>
  withHarness(async (h) => {
    const desired = desiredEventsFromSchedule(h.schedule)[0];
    h.setResources([{ id: "old-row", kind: "scheduled_event", discord_id: "623456789012345678", enabled: true,
      metadata: { managedBy: "reaper-event-sync", siteEventKey: desired.key } }]);
    h.pauseAfter(1);
    await sync(h.deps);
    equal(h.writes.length, 1);
    equal(h.registryWrites.length, 2);
    equal(h.resources().find((row) => row.id === "old-row")?.enabled, false);
    equal(h.runs.get(interactionId)?.state, "paused");
  }));

Deno.test("superseded registry retirement failure blocks before a later pause", () =>
  withHarness(async (h) => {
    const desired = desiredEventsFromSchedule(h.schedule)[0];
    h.setResources([{ id: "old-row", kind: "scheduled_event", discord_id: "623456789012345678", enabled: true,
      metadata: { managedBy: "reaper-event-sync", siteEventKey: desired.key } }]);
    h.failRegistryUpdate();
    h.pauseAfter(1);
    await sync(h.deps);
    equal(h.writes.length, 1);
    equal(h.runs.get(interactionId)?.state, "blocked");
    assert(!h.rpcCalls.includes("reaper_pause_event_sync"));
    assert(!h.messages.at(-1)?.includes("Created:"));
  }));

Deno.test("apply preflight deadline pauses without provider or registry writes", () =>
  withHarness(async (h) => {
    h.failProvider("pause-get");
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.registryWrites, []);
    equal(h.runs.get(interactionId)?.state, "paused");
    assert(!h.rpcCalls.includes("reaper_begin_event_sync_write"));
    assert(h.messages.at(-1)?.includes("incomplete and paused"));
  }));

Deno.test("malformed successful create remains blocked and unregistered", () =>
  withHarness(async (h) => {
    h.malformedResponse("fields");
    await sync(h.deps);
    equal(h.writes.length, 1);
    equal(h.writes[0].method, "POST");
    equal(h.registryWrites, []);
    equal(h.runs.get(interactionId)?.state, "blocked");
  }));

Deno.test("duplicate rate limit never claims removal before provider and registry acknowledgement", () =>
  withHarness(async (h) => {
    h.setExisting([{ id: h.schedule.monthly.raffle.discordDuplicateEventIds[0], status: 1, guild_id: guildId, entity_type: 3 }]);
    h.pauseAfter(2);
    await sync(h.deps);
    equal(h.writes.length, 2);
    equal(h.runs.get(interactionId)?.state, "paused");
    assert(!h.messages.at(-1)?.includes("Removed duplicate:"));
  }));

Deno.test("late configured duplicate with non-external type rejects all work before covers", async () => {
  for (const entity_type of [1, 2]) await withHarness(async (h) => {
    h.setExisting([{ id: h.schedule.monthly.raffle.discordDuplicateEventIds[0], status: 1, guild_id: guildId, entity_type }]);
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.registryWrites, []);
    equal(h.coverCount(), 0);
    equal(h.runs.get(interactionId)?.state, "rejected");
  });
});

Deno.test("actual transport 429 checkpoints five writes then a fresh approved invocation skips them", () =>
  withHarness(async (h) => {
    const originalApi = h.deps.discordApi;
    const now = Date.now();
    let firstInvocation = true;
    let wireMutations = 0;
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname.slice("/api/v10".length);
      if (init.method !== "GET") {
        wireMutations++;
        assert(h.rpcCalls.at(-1) === "reaper_begin_event_sync_write", "Transport must fence immediately before the wire attempt");
        if (firstInvocation && h.writes.length === 5) return Response.json({ retry_after: 60 }, {
          status: 429, headers: { "Retry-After": "120.5", "X-RateLimit-Reset-After": "180.25" },
        });
      }
      const result = await originalApi(path, init, async () => {});
      return result.status === 204 ? new Response(null, { status: 204 }) : Response.json(result.data, { status: result.status });
    };
    h.deps.discordApi = createEventSyncDiscordApi("https://discord.com/api/v10", { fetch: fetcher, monotonicNow: () => 0, wallNow: () => now });
    await sync(h.deps);
    equal(wireMutations, 6);
    equal(h.writes.length, 5);
    equal(h.registryWrites.length, 5);
    equal(h.runs.get(interactionId)?.state, "paused");
    equal(h.runs.get(interactionId)?.retryNotBefore, new Date(now + 180_250).toISOString());
    equal((h.messages.at(-1)!.match(/Created:/g) || []).length, 5);
    assert(!h.messages.at(-1)?.includes("Event sync finished"));
    firstInvocation = false;
    h.expireCooldown();
    h.deps.discordApi = createEventSyncDiscordApi("https://discord.com/api/v10", { fetch: fetcher, monotonicNow: () => 0, wallNow: () => now + 180_251 });
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(wireMutations, 9);
    equal(h.writes.length, 8);
    equal(h.registryWrites.length, 8);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal((h.messages.at(-1)!.match(/Unchanged:/g) || []).length, 5);
  }));

Deno.test("actual read-bucket exhaustion completes six cover updates and two creates, then no-ops all eight activities", () =>
  withHarness(async (h) => {
    await seedPartialScheduledEvents(h);
    const originalApi = h.deps.discordApi;
    let wireMutations = 0;
    let waits = 0;
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname.slice("/api/v10".length);
      if (init.method !== "GET") {
        wireMutations++;
        equal(h.rpcCalls.at(-1), "reaper_begin_event_sync_write");
      }
      const result = await originalApi(path, init, async () => {});
      return Response.json(result.data, {
        status: result.status,
        headers: init.method === "GET"
          ? { "X-RateLimit-Bucket": "scheduled-events-read", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "10.787" }
          : { "X-RateLimit-Bucket": "scheduled-events-write", "X-RateLimit-Remaining": "1" },
      });
    };
    const newApi = () => createEventSyncDiscordApi("https://discord.com/api/v10", {
      fetch: fetcher,
      monotonicNow: () => 0,
      wallNow: () => Date.now(),
      wait: () => { waits++; return Promise.resolve(); },
    });
    h.deps.discordApi = newApi();
    await sync(h.deps);
    equal(wireMutations, 8);
    equal(h.writes.filter((write) => write.method === "PATCH").length, 6);
    equal(h.writes.filter((write) => write.method === "POST").length, 2);
    equal(h.registryWrites.length, 8);
    equal(h.runs.get(interactionId)?.state, "completed");
    equal(waits, 0);
    const receipts = structuredClone(h.resources());
    assert(receipts.every((row) => /^[A-F0-9]{64}$/.test(String((row.metadata as JsonRecord).coverImageSha256)) && (row.metadata as JsonRecord).discordImageHash === "a".repeat(32)));
    h.deps.discordApi = newApi();
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(wireMutations, 8);
    equal(h.registryWrites.length, 8);
    equal(h.resources(), receipts);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal((h.messages.at(-1)!.match(/Unchanged:/g) || []).length, 8);
    equal(waits, 0);
  }));

Deno.test("actual known write-bucket wait preserves the prior receipt and refences before the next wire", () =>
  withHarness(async (h) => {
    await seedPartialScheduledEvents(h);
    const originalApi = h.deps.discordApi;
    const wall = Date.now();
    let clock = 0;
    let wireMutations = 0;
    let fencesBeforeWait: number | null = null;
    const waits: number[] = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname.slice("/api/v10".length);
      if (init.method !== "GET") {
        wireMutations++;
        equal(h.rpcCalls.at(-1), "reaper_begin_event_sync_write");
        if (fencesBeforeWait !== null) {
          equal(h.rpcCalls.filter((name) => name === "reaper_begin_event_sync_write").length, fencesBeforeWait + 1);
          fencesBeforeWait = null;
        }
      }
      const result = await originalApi(path, init, async () => {});
      return Response.json(result.data, { status: result.status, headers: wireMutations === 1 && init.method === "PATCH"
        ? { "X-RateLimit-Bucket": "scheduled-events-patch", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "0.025" }
        : { "X-RateLimit-Bucket": init.method === "GET" ? "scheduled-events-read" : "scheduled-events-patch", "X-RateLimit-Remaining": "1" } });
    };
    h.deps.discordApi = createEventSyncDiscordApi("https://discord.com/api/v10", {
      fetch: fetcher, monotonicNow: () => clock, wallNow: () => wall + clock,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        equal(wireMutations, 1);
        equal(h.registryWrites.length, 1);
        const metadata = h.resources().find((row) => row.discord_id === h.writes[0].path.split("/").at(-1))!.metadata as JsonRecord;
        assert(/^[A-F0-9]{64}$/.test(String(metadata.coverImageSha256)));
        equal(metadata.discordImageHash, "a".repeat(32));
        fencesBeforeWait = h.rpcCalls.filter((name) => name === "reaper_begin_event_sync_write").length;
        clock += milliseconds;
        return Promise.resolve();
      },
    });
    await sync(h.deps);
    equal(waits, [25]);
    equal(wireMutations, 8);
    equal(h.writes.length, 8);
    equal(h.registryWrites.length, 8);
    equal(h.runs.get(interactionId)?.state, "completed");
    assert(!h.rpcCalls.includes("reaper_pause_event_sync"));
  }));

Deno.test("actual write-bucket cooldown beyond the request budget safely pauses after its durable receipt", () =>
  withHarness(async (h) => {
    await seedPartialScheduledEvents(h);
    const originalApi = h.deps.discordApi;
    const wall = Date.now();
    let wireMutations = 0;
    let waits = 0;
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname.slice("/api/v10".length);
      if (init.method !== "GET") wireMutations++;
      const result = await originalApi(path, init, async () => {});
      return Response.json(result.data, { status: result.status, headers: init.method === "PATCH"
        ? { "X-RateLimit-Bucket": "scheduled-events-patch", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "100.25" }
        : { "X-RateLimit-Bucket": "scheduled-events-read", "X-RateLimit-Remaining": "1" } });
    };
    h.deps.discordApi = createEventSyncDiscordApi("https://discord.com/api/v10", {
      fetch: fetcher, monotonicNow: () => 0, wallNow: () => wall,
      wait: () => { waits++; return Promise.resolve(); },
    });
    await sync(h.deps);
    equal(wireMutations, 1);
    equal(h.writes.length, 1);
    equal(h.registryWrites.length, 1);
    equal(waits, 0);
    equal(h.runs.get(interactionId)?.state, "paused");
    equal(h.runs.get(interactionId)?.retryNotBefore, new Date(wall + 100_250).toISOString());
    const updated = h.resources().find((row) => row.discord_id === h.writes[0].path.split("/").at(-1))!;
    equal((updated.metadata as JsonRecord).discordImageHash, "a".repeat(32));
    assert(/^[A-F0-9]{64}$/.test(String((updated.metadata as JsonRecord).coverImageSha256)));
    equal((h.messages.at(-1)!.match(/Updated:/g) || []).length, 1);
    assert(!h.messages.at(-1)?.includes("Event sync finished"));
  }));

Deno.test("actual owner fence lost during a write-bucket wait prevents another wire and preserves the checkpoint", () =>
  withHarness(async (h) => {
    await seedPartialScheduledEvents(h);
    const originalApi = h.deps.discordApi;
    let clock = 0;
    let wireMutations = 0;
    let checkpoint: JsonRecord[] = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname.slice("/api/v10".length);
      if (init.method !== "GET") wireMutations++;
      const result = await originalApi(path, init, async () => {});
      return Response.json(result.data, { status: result.status, headers: init.method === "PATCH"
        ? { "X-RateLimit-Bucket": "scheduled-events-patch", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "0.025" }
        : { "X-RateLimit-Bucket": "scheduled-events-read", "X-RateLimit-Remaining": "1" } });
    };
    h.deps.discordApi = createEventSyncDiscordApi("https://discord.com/api/v10", {
      fetch: fetcher, monotonicNow: () => clock,
      wait: (milliseconds) => {
        checkpoint = structuredClone(h.resources());
        clock += milliseconds;
        h.loseOwnership();
        return Promise.resolve();
      },
    });
    await sync(h.deps);
    equal(wireMutations, 1);
    equal(h.registryWrites.length, 1);
    equal(h.resources(), checkpoint);
    equal(h.runs.get(interactionId)?.state, "blocked");
    assert(!h.rpcCalls.includes("reaper_pause_event_sync"));
    assert(h.messages.at(-1)?.includes("Do not retry apply"));
  }));

for (const beforeCommit of [true, false]) {
  Deno.test(`pause RPC ${beforeCommit ? "before-commit failure blocks" : "lost acknowledgement requires terminal readback"}`, () =>
    withHarness(async (h) => {
      h.pauseAfter(5);
      h.failRpc("reaper_pause_event_sync", beforeCommit);
      await sync(h.deps);
      equal(h.writes.length, 5);
      equal(h.runs.get(interactionId)?.state, beforeCommit ? "blocked" : "paused");
      assert(h.messages.at(-1)?.includes("Do not retry apply"));
      assert(!h.messages.at(-1)?.includes("incomplete and paused"));
    }));
}

Deno.test("preview typed pause remains reserve-free", () =>
  withHarness(async (h) => {
    h.failProvider("pause-get");
    await sync(h.deps, "preview");
    equal(h.rpcCalls, []);
    equal(h.writes, []);
    assert(h.messages.at(-1)?.includes("preview is incomplete and paused"));
  }));

Deno.test("actual wire fence and ordinary pause-shaped errors stay blocked", async () => {
  for (const kind of ["fence", "lookalike"]) await withHarness(async (h) => {
    if (kind === "fence") h.failWireFence();
    else h.failProvider("pause-lookalike");
    await sync(h.deps);
    equal(h.writes.length, kind === "fence" ? 0 : 1);
    equal(h.runs.get(interactionId)?.state, "blocked");
    assert(!h.rpcCalls.includes("reaper_pause_event_sync"));
  });
});

for (const malformed of ["id", "guild", "fields", "image"]) {
  Deno.test(`malformed successful PATCH ${malformed} remains blocked and unregistered`, () =>
    withHarness(async (h) => {
      const desired = desiredEventsFromSchedule(h.schedule)[0];
      h.setExisting([{ id: "623456789012345678", guild_id: guildId, status: 1, entity_type: 3 }]);
      h.setResources([{ discord_id: "623456789012345678", enabled: true, metadata: { managedBy: "reaper-event-sync", siteEventKey: desired.key } }]);
      h.malformedResponse(malformed);
      await sync(h.deps);
      equal(h.writes.length, 1);
      equal(h.registryWrites.length, 0);
      equal(h.runs.get(interactionId)?.state, "blocked");
    }));
}

Deno.test("late non-scheduled managed event fails full preflight before any writes", () =>
  withHarness(async (h) => {
    const desired = desiredEventsFromSchedule(h.schedule).at(-1)!;
    h.setExisting([{ id: "623456789012345678", guild_id: guildId, status: 2, entity_type: 3 }]);
    h.setResources([{ discord_id: "623456789012345678", enabled: true, metadata: { managedBy: "reaper-event-sync", siteEventKey: desired.key } }]);
    await sync(h.deps);
    equal(h.writes.length, 0);
    equal(h.coverCount(), 0);
    equal(h.runs.get(interactionId)?.state, "rejected");
  }));

Deno.test("JSONB recurrence key order does not cause redundant registry writes", () =>
  withHarness(async (h) => {
    await sync(h.deps);
    h.setResources(h.resources().map((row) => {
      const metadata = { ...row.metadata as JsonRecord };
      if (metadata.recurrenceRule) metadata.recurrenceRule = Object.fromEntries(Object.entries(metadata.recurrenceRule as JsonRecord).sort(([a], [b]) => a.localeCompare(b)));
      return { ...row, metadata };
    }));
    const writes = h.writes.length;
    const registry = h.registryWrites.length;
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(h.writes.length, writes);
    equal(h.registryWrites.length, registry);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
  }));

Deno.test("equivalent ISO formatting cannot evade unmanaged adoption preflight", () =>
  withHarness(async (h) => {
    const desired = desiredEventsFromSchedule(h.schedule)[0];
    h.setExisting([{ id: "623456789012345678", name: desired.title,
      scheduled_start_time: desired.startIso.replace(".000Z", "+00:00"),
      entity_type: 3, entity_metadata: { location: desired.location } }]);
    await sync(h.deps);
    equal(h.writes, []);
    equal(h.coverCount(), 0);
    assert(h.messages.at(-1)?.includes("explicit adoption"));
  }));
