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
          return Promise.resolve({ data: resources, error: update && registryUpdateFailure ? { code: "TEST_UPDATE" } : null }).then(
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
  equal(desired.map((event) => event.key), ["monthly-gathering", "monthly-raffle", "guild-party-0", "guild-party-1", "guild-party-2", "guild-party-3"]);
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

Deno.test("concurrent actual workflows serialize per guild before any Discord write", () =>
  withHarness(async (h) => {
    await Promise.all([
      sync(h.deps),
      sync({ ...h.deps, interactionId: nextInteractionId }),
    ]);
    equal(h.writes.length, 17);
    equal(h.registryWrites.length, 17);
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
    equal(h.writes.length, 17);
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
    equal(h.writes.length, 17);
  }));

Deno.test("generated schedule key collisions reject preview and apply before covers or writes", async () => {
  for (const mode of ["preview", "apply"]) {
    await withHarness(async (h) => {
      h.schedule.monthly.gathering.id = "guild-party-1";
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
      const desired = desiredEventsFromSchedule(h.schedule).filter((event) =>
        event.key.startsWith("guild-party-")
      ).slice(0, 2);
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
    equal(h.registryWrites.length, registryCount + 17);
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
      equal(h.writes.length - count, ["url-only", "source-bytes"].includes(drift) ? 17 : 1);
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
      equal(h.writes.length, 17);
      equal(h.registryWrites.length, 17);
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
    equal(wireMutations, 18);
    equal(h.writes.length, 17);
    equal(h.registryWrites.length, 17);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal((h.messages.at(-1)!.match(/Unchanged:/g) || []).length, 5);
  }));

Deno.test("actual read-bucket exhaustion completes six cover updates and eleven creates, then no-ops all seventeen", () =>
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
    equal(wireMutations, 17);
    equal(h.writes.filter((write) => write.method === "PATCH").length, 6);
    equal(h.writes.filter((write) => write.method === "POST").length, 11);
    equal(h.registryWrites.length, 17);
    equal(h.runs.get(interactionId)?.state, "completed");
    equal(waits, 0);
    const receipts = structuredClone(h.resources());
    assert(receipts.every((row) => /^[A-F0-9]{64}$/.test(String((row.metadata as JsonRecord).coverImageSha256)) && (row.metadata as JsonRecord).discordImageHash === "a".repeat(32)));
    h.deps.discordApi = newApi();
    await sync({ ...h.deps, interactionId: nextInteractionId });
    equal(wireMutations, 17);
    equal(h.registryWrites.length, 17);
    equal(h.resources(), receipts);
    equal(h.runs.get(nextInteractionId)?.state, "completed");
    equal((h.messages.at(-1)!.match(/Unchanged:/g) || []).length, 17);
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
    equal(wireMutations, 17);
    equal(h.writes.length, 17);
    equal(h.registryWrites.length, 17);
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
