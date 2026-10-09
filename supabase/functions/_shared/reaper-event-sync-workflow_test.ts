import {
  processEventSync,
  type ReaperEventSyncDependencies,
  selectExistingScheduledEvent,
} from "./reaper-event-sync-workflow.ts";
import { desiredEventsFromSchedule } from "./reaper-discord-events.ts";
import type { JsonRecord } from "./discord-interaction-helpers.ts";
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
type Run = { owner: unknown; state: string };

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
          if (update) registryWrites.push(update);
          else {
            equal(filters.discord_parent_id, guildId);
            equal(filters.enabled, true);
          }
          return Promise.resolve({ data: resources, error: null }).then(
            resolve,
          );
        },
        upsert(value: JsonRecord) {
          registryWrites.push(value);
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
      let data: unknown = false;
      if (name === "reaper_reserve_event_sync") {
        if (run) data = "duplicate";
        else if (
          [...runs.values()].some((entry) =>
            ["reserved", "writing", "blocked"].includes(entry.state)
          )
        ) data = "busy";
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
    discordApi(path, init = {}) {
      const method = init.method || "GET";
      if (method === "GET") {
        return Promise.resolve({ ok: true, status: 200, data: existing });
      }
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
      const id = method === "PATCH"
        ? path.split("/").at(-1)!
        : String(nextId++);
      return Promise.resolve({ ok: true, status: 200, data: { id } });
    },
  };
  const fetcher = ((url: unknown) => {
    if (String(url).includes("guild-schedule.json")) {
      return Promise.resolve(Response.json(schedule));
    }
    covers++;
    return Promise.resolve(
      new Response(coverFailureAt === covers ? "invalid" : png, {
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
    failRpc(name: string) {
      rpcFailure = name;
    },
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
    equal(h.runs.get(interactionId)?.state, "rejected");
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
    equal(h.runs.get(interactionId)?.state, "writing");
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
