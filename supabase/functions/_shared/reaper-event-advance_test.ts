import { EVENT_ADVANCE_PATH, EVENT_ADVANCE_PROJECT, handleEventAdvance } from "./reaper-event-advance.ts";
import { desiredEventsFromSchedule, scheduledEventBody } from "./reaper-discord-events.ts";
import { EventSyncPause } from "./reaper-event-sync-transport.ts";
import type { JsonRecord } from "./discord-interaction-helpers.ts";
import scheduleData from "../../../apps/web/public/data/guild-schedule.json" with { type: "json" };

const guildId = "1078630751077142608";
const dispatchId = "12345678-1234-4123-8123-123456789abc";
const interactionId = "90000000000000000001";
// Local synthetic capability: never read a runtime secret or call a provider.
const capability = "a".repeat(64);
const capabilityHeader = "x-mochirii-event-advance-capability";
const now = new Date("2026-10-09T16:00:00.000Z");
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
let fixtureId = 0;

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
type HandlerDependencies = Parameters<typeof handleEventAdvance>[1];
type Call = { name: string; args: JsonRecord };

function request(options: { method?: string; path?: string; headers?: Record<string, string>; body?: BodyInit | null } = {}) {
  const method = options.method || "POST";
  return new Request(`${EVENT_ADVANCE_PROJECT}${options.path || EVENT_ADVANCE_PATH}`, {
    method,
    headers: { "content-type": "application/json", [capabilityHeader]: capability, ...options.headers },
    ...(method === "GET" || method === "HEAD" ? {} : { body: options.body === undefined ? JSON.stringify({ dispatchId }) : options.body }),
  });
}

async function harness(keys = ["breaking-army"]) {
  const schedule = structuredClone(scheduleData);
  schedule.discordCoverVersion = `advance-test-${++fixtureId}`;
  const rpcCalls: Call[] = [];
  const tasks: Promise<unknown>[] = [];
  const fetches: string[] = [];
  const providerReads: string[] = [];
  const writes: Array<{ path: string; method: string; body: JsonRecord }> = [];
  const registryWrites: JsonRecord[] = [];
  const logs: unknown[][] = [];
  const resources: JsonRecord[] = [];
  const existing: JsonRecord[] = [];
  let claim: unknown = { guildId, interactionId, activityKeys: keys };
  let claimed = false;
  let owner = "";
  let state = "";
  let claimError = false;
  let claimThrows = false;
  let adminThrows = false;
  let finishFails = false;
  let fenceFails = false;
  let registryFails = false;
  let pause = false;
  let directResponse: { ok: boolean; status: number; data: unknown } | undefined;
  let scheduleGate: Promise<void> | undefined;
  let releaseSchedule: (() => void) | undefined;
  const prior = desiredEventsFromSchedule(schedule, new Date("2026-10-05T00:00:00.000Z"));
  for (const [index, key] of ["breaking-army", "showdown"].entries()) {
    const desired = prior.find((event) => event.key === key)!;
    assert(desired && desired.recurrenceRule === null);
    const id = String(623456789012345678n + BigInt(index));
    existing.push({ ...await scheduledEventBody(desired, false), recurrence_rule: null, id, guild_id: guildId, status: 3, entity_id: null, image: "b".repeat(32) });
    resources.push({ id: `old-${key}`, kind: "scheduled_event", enabled: true, discord_id: id, discord_parent_id: guildId,
      metadata: { managedBy: "reaper-event-sync", siteEventKey: key, startIso: desired.startIso, endIso: desired.endIso, recurrenceRule: null } });
  }
  // An unrelated event must never become an advancement target.
  existing.push({ id: "723456789012345678", guild_id: guildId, status: 1, entity_type: 3, name: "Unrelated owner event" });
  const admin = {
    from(table: string) {
      equal(table, "discord_resources");
      const filters: JsonRecord = {};
      let update: JsonRecord | undefined;
      const query = {
        select(_fields: string) { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        update(value: JsonRecord) { update = value; return query; },
        then(resolve: (value: unknown) => void) {
          if (update) {
            assert(state === "writing", "Registry retirement requires the claimed writer fence");
            registryWrites.push(update);
            if (!registryFails) for (const row of resources) if (Object.entries(filters).every(([key, value]) => row[key] === value)) Object.assign(row, update);
          } else {
            equal(filters, { kind: "scheduled_event", discord_parent_id: guildId, enabled: true });
          }
          return Promise.resolve({ data: resources.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value)), error: update && registryFails ? { code: "TEST_REGISTRY" } : null }).then(resolve);
        },
        upsert(value: JsonRecord) {
          assert(state === "writing", "Registry registration requires the claimed writer fence");
          registryWrites.push(value);
          if (!registryFails) resources.push({ id: `new-${value.discord_id}`, ...value });
          return Promise.resolve({ data: null, error: registryFails ? { code: "TEST_REGISTRY" } : null });
        },
      };
      return query;
    },
    rpc(name: string, args: JsonRecord) {
      rpcCalls.push({ name, args });
      if (name === "reaper_claim_event_advance") {
        equal(args.p_dispatch_id, dispatchId);
        equal(args.p_capability, capability);
        assert(typeof args.p_owner_id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(args.p_owner_id));
        if (claimThrows) throw new Error("Synthetic private claim failure");
        if (claimError) return Promise.resolve({ data: null, error: { code: "TEST_CLAIM" } });
        if (claimed) return Promise.resolve({ data: null, error: null });
        claimed = true;
        owner = args.p_owner_id;
        state = "reserved";
        return Promise.resolve({ data: claim, error: null });
      }
      equal(args.p_owner_id, owner);
      if (name === "reaper_finish_event_advance") {
        equal(args.p_dispatch_id, dispatchId);
        return Promise.resolve({ data: !finishFails && state === "completed", error: finishFails ? { code: "TEST_FINISH" } : null });
      }
      equal(args.p_guild_id, guildId);
      equal(args.p_interaction_id, interactionId);
      assert(name !== "reaper_reserve_event_sync", "The capability claim already owns the reservation; do not reserve again");
      let data = false;
      if (name === "reaper_begin_event_sync_write" && !fenceFails && ["reserved", "writing"].includes(state)) { state = "writing"; data = true; }
      if (name === "reaper_pause_event_sync" && ["reserved", "writing"].includes(state)) { state = "paused"; data = true; }
      if (name === "reaper_finish_event_sync" && ["reserved", "writing"].includes(state)) { state = String(args.p_outcome); data = true; }
      return Promise.resolve({ data, error: null });
    },
  };
  const deps: HandlerDependencies = {
    projectUrl: EVENT_ADVANCE_PROJECT, configuredGuildId: guildId, expectedGuildId: guildId, botConfigured: true,
    guildScheduleUrl: "https://mochirii.com/data/guild-schedule.json", discordApiUserAgent: "local-test", now,
    discordApiHeaders: () => new Headers(),
    serviceAdminClient: () => { if (adminThrows) throw new Error("Synthetic private configuration failure"); return admin; },
    waitUntil: (task) => { tasks.push(task); },
    async discordApi(path, init = {}, beforeAttempt) {
      assert(claimed, "Discord access must follow a successful capability claim");
      assert(path.startsWith(`/guilds/${guildId}/scheduled-events`), "Provider access escaped the production guild");
      const method = init.method || "GET";
      if (method === "GET") {
        providerReads.push(path);
        if (path !== `/guilds/${guildId}/scheduled-events`) {
          equal(path, `/guilds/${guildId}/scheduled-events/623456789012345678`);
          assert(directResponse, "Unexpected individual provider request");
          return directResponse;
        }
        return { ok: true, status: 200, data: existing };
      }
      assert(beforeAttempt, "Actual wire attempts require the exact claimed writer fence");
      await beforeAttempt();
      assert(state === "writing");
      if (pause) throw new EventSyncPause("rate_limit", "2026-10-09T16:01:00.000Z");
      const body = JSON.parse(String(init.body));
      writes.push({ path, method, body });
      const id = String(823456789012345678n + BigInt(writes.length));
      const event = { ...body, id, guild_id: guildId, status: 1, entity_id: null, image: "c".repeat(32) };
      existing.push(event);
      return { ok: true, status: 200, data: event };
    },
  };
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetches.push(url);
    assert(claimed, "Website access must follow a successful capability claim");
    if (url === deps.guildScheduleUrl) { await scheduleGate; return Response.json(schedule); }
    assert(/^https:\/\/mochirii\.com\/assets\/img\/discord-events\/[a-z0-9-]+\.(?:png|jpg|webp)\?v=advance-test-\d+$/.test(url), "Unapproved network request");
    return new Response(png, { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  return {
    deps, rpcCalls, tasks, fetches, providerReads, writes, registryWrites, logs, resources, existing, fetcher,
    drain: () => Promise.all(tasks), state: () => state,
    setClaim: (value: unknown) => { claim = value; },
    failClaim: (throws = false) => { claimError = !throws; claimThrows = throws; },
    failAdmin: () => { adminThrows = true; },
    failFinish: () => { finishFails = true; },
    failFence: () => { fenceFails = true; },
    failRegistry: () => { registryFails = true; },
    pause: () => { pause = true; },
    setDirectResponse: (data: unknown, status = 200) => { directResponse = { ok: status >= 200 && status < 300, status, data }; },
    blockSchedule: () => { scheduleGate = new Promise<void>((resolve) => { releaseSchedule = resolve; }); },
    releaseSchedule: () => releaseSchedule?.(),
  };
}
type Harness = Awaited<ReturnType<typeof harness>>;

async function withHarness(test: (h: Harness) => Promise<void>, keys?: string[]) {
  const h = await harness(keys);
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const oldToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const oldOverride = Deno.env.get("GUILD_SCHEDULE_URL");
  globalThis.fetch = h.fetcher;
  console.error = (...args: unknown[]) => { h.logs.push(args); };
  Deno.env.set("DISCORD_BOT_TOKEN", "local-test-placeholder");
  Deno.env.delete("GUILD_SCHEDULE_URL");
  try { await test(h); } finally {
    h.releaseSchedule();
    await h.drain();
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (oldToken === undefined) Deno.env.delete("DISCORD_BOT_TOKEN"); else Deno.env.set("DISCORD_BOT_TOKEN", oldToken);
    if (oldOverride === undefined) Deno.env.delete("GUILD_SCHEDULE_URL"); else Deno.env.set("GUILD_SCHEDULE_URL", oldOverride);
  }
}
function untouched(h: Harness) {
  equal(h.rpcCalls.length, 0);
  equal(h.tasks.length, 0);
  equal(h.fetches.length, 0);
  equal(h.providerReads.length, 0);
  equal(h.writes.length, 0);
  equal(h.registryWrites.length, 0);
}

Deno.test("advance route rejects other paths, queries and methods before capability or provider access", () => withHarness(async (h) => {
  for (const path of ["/reaper-discord-interactions", `${EVENT_ADVANCE_PATH}/`, "/advance", "/reaper-discord-interactions/%61dvance", `${EVENT_ADVANCE_PATH}?dispatchId=${dispatchId}`]) {
    equal((await handleEventAdvance(request({ path }), h.deps)).status, 404);
  }
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) equal((await handleEventAdvance(request({ method }), h.deps)).status, 404);
  untouched(h);
}));

Deno.test("advance route is pinned to the production runtime project, both guild identities and bot configuration", () => withHarness(async (h) => {
  for (const patch of [
    { projectUrl: "https://preview.supabase.co" }, { projectUrl: `${EVENT_ADVANCE_PROJECT}/` }, { projectUrl: EVENT_ADVANCE_PROJECT.replace("https:", "http:") },
    { configuredGuildId: "1078630751077142609" }, { configuredGuildId: "" }, { expectedGuildId: "1078630751077142609" }, { botConfigured: false },
  ]) equal((await handleEventAdvance(request(), { ...h.deps, ...patch })).status, 503);
  untouched(h);
}));

Deno.test("advance requires the exact dispatch header and a bounded lowercase capability, not Discord auth or the retired header", () => withHarness(async (h) => {
  for (const value of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), `Bearer ${capability}`]) {
    equal((await handleEventAdvance(request({ headers: { [capabilityHeader]: value } }), h.deps)).status, 401);
  }
  for (const header of ["authorization", "x-mochirii-event-capability", "x-signature-ed25519"]) {
    equal((await handleEventAdvance(request({ headers: { [capabilityHeader]: "", [header]: capability } }), h.deps)).status, 401);
  }
  for (const type of ["", "text/plain", "application/json; charset=utf-8"]) equal((await handleEventAdvance(request({ headers: { "content-type": type } }), h.deps)).status, 401);
  untouched(h);
}));

Deno.test("advance rejects malformed, oversized and non-v4 dispatch bodies before claiming ownership", () => withHarness(async (h) => {
  for (const body of ["", "{", "null", "[]", "true", JSON.stringify({ dispatchId, extra: true }), JSON.stringify({ dispatchId: 7 }), JSON.stringify({}),
    JSON.stringify({ dispatchId: dispatchId.toUpperCase() }), JSON.stringify({ dispatchId: dispatchId.replace("-4123-", "-5123-") }),
    JSON.stringify({ dispatchId: dispatchId.replace("-8123-", "-7123-") }), JSON.stringify({ dispatchId: ` ${dispatchId}` }), " ".repeat(129), new Uint8Array([0xc3, 0x28])]) {
    equal((await handleEventAdvance(request({ body }), h.deps)).status, 400);
  }
  equal((await handleEventAdvance(request({ body: null }), h.deps)).status, 400);
  for (const length of ["129", "-1", "1.5", "1e2", "abc", "9999999999999999999999999999999999999"]) {
    equal((await handleEventAdvance(request({ headers: { "content-length": length } }), h.deps)).status, 400);
  }
  equal((await handleEventAdvance(request({ headers: { "content-length": "1" }, body: " ".repeat(129) }), h.deps)).status, 400);
  untouched(h);
}));

Deno.test("advance counts actual fragmented bytes and cancels an oversized stream", () => withHarness(async (h) => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(64)); controller.enqueue(new Uint8Array(65)); }, cancel() { cancelled = true; } });
  equal((await handleEventAdvance(request({ body, headers: { "content-length": "64" } }), h.deps)).status, 400);
  assert(cancelled);
  untouched(h);
}));

Deno.test("advance bounds a stalled body read and cancels it without any claim", () => withHarness(async (h) => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const started = performance.now();
  equal((await handleEventAdvance(request({ body }), h.deps)).status, 400);
  assert(performance.now() - started < 4_000, "Stalled body was not bounded");
  assert(cancelled);
  untouched(h);
}));

Deno.test("advance body deadline also bounds an underlying cancel promise that never settles", () => withHarness(async (h) => {
  let cancelled = false;
  let releaseCancel: (() => void) | undefined;
  const pendingCancel = new Promise<void>((resolve) => { releaseCancel = resolve; });
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return pendingCancel; } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      handleEventAdvance(request({ body }), h.deps),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Body cancellation defeated the dispatch deadline")), 4_000); }),
    ]);
    equal(response.status, 400);
    assert(cancelled);
    untouched(h);
  } finally { clearTimeout(timer); releaseCancel?.(); }
}));

Deno.test("advance claim errors and missing service configuration fail closed without starting a worker", async () => {
  for (const mode of ["rpc", "throw", "admin"]) await withHarness(async (h) => {
    if (mode === "admin") h.failAdmin(); else h.failClaim(mode === "throw");
    equal((await handleEventAdvance(request(), h.deps)).status, 503);
    equal(h.tasks.length, 0); equal(h.fetches.length, 0); equal(h.providerReads.length, 0); equal(h.writes.length, 0);
  });
});

Deno.test("advance rejects foreign, malformed or non-rolling claimed scopes before accessing schedule or Discord", async () => {
  const base = { guildId, interactionId, activityKeys: ["breaking-army"] };
  for (const claim of [null, false, [], {}, { ...base, guildId: "1078630751077142609" }, { ...base, interactionId: 90000000000000000001n },
    { ...base, interactionId: "80000000000000000001" }, { ...base, interactionId: "9000000000000000001" }, { ...base, interactionId: `${interactionId}1` },
    ...[null, [], ["guild-party"], ["breaking-army", "breaking-army"], ["breaking-army", "showdown", "guild-party"], [1], ["SHOWDOWN"],
      [{ toString() { return "breaking-army"; } }]].map((activityKeys) => ({ ...base, activityKeys }))]) {
    await withHarness(async (h) => {
      h.setClaim(claim);
      equal((await handleEventAdvance(request(), h.deps)).status, 401);
      equal(h.rpcCalls.map((call) => call.name), ["reaper_claim_event_advance"]);
      equal(h.tasks.length, 0); equal(h.fetches.length, 0); equal(h.providerReads.length, 0); equal(h.writes.length, 0);
    });
  }
});

Deno.test("advance accepts a fragmented 128-byte body, hands off the one claimed owner and finishes only the selected rolling activity", () => withHarness(async (h) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ dispatchId }).padEnd(128, " "));
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 17)); controller.enqueue(bytes.slice(17)); controller.close(); } });
  const beforeEvents = structuredClone(h.existing);
  h.blockSchedule();
  const response = await handleEventAdvance(request({ body, headers: { "content-length": "128" } }), h.deps);
  equal(response.status, 202); equal(await response.text(), "Accepted.");
  equal(h.tasks.length, 1); equal(h.rpcCalls.map((call) => call.name), ["reaper_claim_event_advance"]);
  equal(h.writes.length, 0);
  h.releaseSchedule(); await h.drain();
  equal(h.state(), "completed"); equal(h.writes.length, 1);
  equal(h.writes[0].method, "POST"); equal(h.writes[0].path, `/guilds/${guildId}/scheduled-events`);
  const desired = desiredEventsFromSchedule(scheduleData, now).find((event) => event.key === "breaking-army")!;
  equal(h.writes[0].body.name, desired.title); equal(h.writes[0].body.scheduled_start_time, desired.startIso); equal(h.writes[0].body.recurrence_rule, null);
  equal(h.existing.slice(0, beforeEvents.length), beforeEvents);
  const enabled = h.resources.filter((row) => row.enabled);
  equal(enabled.length, 2); equal(h.resources.find((row) => row.id === "old-breaking-army")?.enabled, false);
  equal(h.resources.find((row) => row.id === "old-showdown")?.enabled, true);
  assert(h.registryWrites.some((row) => typeof (row.metadata as JsonRecord)?.coverImageSha256 === "string" && (row.metadata as JsonRecord).discordImageHash === "c".repeat(32)));
  const claimedOwner = h.rpcCalls[0].args.p_owner_id;
  assert(h.rpcCalls.every((call) => call.args.p_owner_id === claimedOwner));
  equal(h.rpcCalls.at(-1)?.name, "reaper_finish_event_advance");
  assert(h.rpcCalls.some((call) => call.name === "reaper_finish_event_sync" && call.args.p_outcome === "completed"));
  equal(h.logs, []);
}));

Deno.test("advance can finish both approved rolling keys without touching unrelated activities", () => withHarness(async (h) => {
  equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
  equal(h.state(), "completed"); equal(h.writes.length, 2);
  const desired = desiredEventsFromSchedule(scheduleData, now).filter((event) => ["breaking-army", "showdown"].includes(event.key));
  equal(h.writes.map((write) => write.body.name), desired.map((event) => event.title));
  assert(h.writes.every((write) => write.method === "POST" && write.body.recurrence_rule === null));
  equal(h.existing.filter((event) => event.name === "Unrelated owner event").length, 1);
  equal(h.resources.filter((row) => row.enabled).length, 2);
}, ["breaking-army", "showdown"]));

Deno.test("advance does not replay a consumed capability even while its accepted worker is pending", () => withHarness(async (h) => {
  h.blockSchedule();
  equal((await handleEventAdvance(request(), h.deps)).status, 202);
  equal((await handleEventAdvance(request(), h.deps)).status, 401);
  equal(h.tasks.length, 1);
  h.releaseSchedule(); await h.drain();
  equal((await handleEventAdvance(request(), h.deps)).status, 401);
  equal(h.tasks.length, 1); equal(h.writes.length, 1); equal(h.state(), "completed");
  equal(h.rpcCalls.filter((call) => call.name === "reaper_finish_event_advance").length, 1);
}));

Deno.test("advance rejects still-running, cancelled, missing-owned or foreign completed events before covers or writes", async () => {
  for (const kind of ["scheduled", "active", "cancelled", "foreign", "wrong-type", "not-ended", "missing-owned", "legacy-owned"]) await withHarness(async (h) => {
    const event = h.existing[0];
    if (kind === "scheduled") event.status = 1;
    if (kind === "active") event.status = 2;
    if (kind === "cancelled") event.status = 4;
    if (kind === "foreign") event.guild_id = "1078630751077142609";
    if (kind === "wrong-type") event.entity_type = 2;
    if (kind === "not-ended") (h.resources[0].metadata as JsonRecord).endIso = "2026-10-10T16:00:00.000Z";
    if (kind === "missing-owned") h.resources.splice(0, 1);
    if (kind === "legacy-owned") (h.resources[0].metadata as JsonRecord).siteEventKey = "breaking-army-1";
    equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
    equal(h.writes.length, 0); equal(h.registryWrites.length, 0); equal(h.fetches, [h.deps.guildScheduleUrl]);
    equal(h.state(), "rejected"); equal(h.rpcCalls.at(-1)?.name, "reaper_finish_event_advance");
  });
});

Deno.test("advance verifies an omitted owned event by exact ID before creating the next occurrence", () => withHarness(async (h) => {
  const completed = h.existing.shift()!;
  h.setDirectResponse(completed);
  equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
  equal(h.providerReads, [`/guilds/${guildId}/scheduled-events`, `/guilds/${guildId}/scheduled-events/${completed.id}`]);
  equal(h.state(), "completed"); equal(h.writes.length, 1);
  equal(h.writes[0].method, "POST"); equal(h.resources.find((row) => row.id === "old-breaking-army")?.enabled, false);
}));

Deno.test("advance refuses omitted provider history unless the exact completed identity and recorded times are verified", async () => {
  for (const kind of ["404", "500", "null", "array", "other-id", "foreign", "wrong-type", "active", "cancelled", "recurring", "wrong-start", "wrong-end"]) await withHarness(async (h) => {
    const completed = h.existing.shift()!;
    let data: unknown = completed;
    let status = 200;
    if (kind === "404") status = 404;
    if (kind === "500") status = 500;
    if (kind === "null") data = null;
    if (kind === "array") data = [completed];
    if (kind === "other-id") completed.id = "623456789012345679";
    if (kind === "foreign") completed.guild_id = "1078630751077142609";
    if (kind === "wrong-type") completed.entity_type = 2;
    if (kind === "active") completed.status = 2;
    if (kind === "cancelled") completed.status = 4;
    if (kind === "recurring") completed.recurrence_rule = { start: completed.scheduled_start_time, frequency: 3, interval: 1 };
    if (kind === "wrong-start") completed.scheduled_start_time = "2026-10-05T13:59:00.000Z";
    if (kind === "wrong-end") completed.scheduled_end_time = "2026-10-05T15:59:00.000Z";
    h.setDirectResponse(data, status);
    equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
    equal(h.state(), "rejected"); equal(h.writes.length, 0); equal(h.registryWrites.length, 0);
    equal(h.fetches, [h.deps.guildScheduleUrl]);
    equal(h.providerReads.length, 2);
  });
});

Deno.test("advance loses its claimed fence without a provider wire write and records reconciliation", () => withHarness(async (h) => {
  h.failFence(); equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
  equal(h.writes.length, 0); equal(h.registryWrites.length, 0); equal(h.state(), "blocked");
  assert(h.rpcCalls.some((call) => call.name === "reaper_finish_event_sync" && call.args.p_outcome === "blocked"));
  assert(h.logs.some((line) => line.includes("Hosted event advancement requires reconciliation.")));
}));

Deno.test("advance preserves a safe paused checkpoint and never retries the provider or falsely finishes the dispatch", () => withHarness(async (h) => {
  h.pause(); equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
  equal(h.state(), "paused"); equal(h.writes.length, 0); equal(h.registryWrites.length, 0);
  equal(h.rpcCalls.filter((call) => call.name === "reaper_pause_event_sync").length, 1);
  assert(!h.rpcCalls.some((call) => call.name === "reaper_finish_event_sync"));
  equal(h.rpcCalls.at(-1)?.name, "reaper_finish_event_advance");
  assert(h.logs.some((line) => line.includes("Hosted event advancement requires reconciliation.")));
}));

Deno.test("advance finalization ambiguity logs reconciliation without leaking the capability or starting another worker", () => withHarness(async (h) => {
  h.failFinish(); equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
  equal(h.state(), "completed"); equal(h.writes.length, 1); equal(h.tasks.length, 1);
  equal(h.rpcCalls.filter((call) => call.name === "reaper_finish_event_advance").length, 1);
  equal(h.logs, [["Hosted event advancement requires reconciliation."]]);
  assert(!JSON.stringify(h.logs).includes(capability));
}));

Deno.test("advance registry failure after an acknowledged create stays blocked and cannot report completion", () => withHarness(async (h) => {
  h.failRegistry(); equal((await handleEventAdvance(request(), h.deps)).status, 202); await h.drain();
  equal(h.writes.length, 1); equal(h.state(), "blocked");
  assert(!h.rpcCalls.some((call) => call.name === "reaper_finish_event_sync" && call.args.p_outcome === "completed"));
  equal(h.rpcCalls.at(-1)?.name, "reaper_finish_event_advance");
}));
