import { handleMemberSync, writePendingDiscordOverwrite, type MemberSyncDependencies } from "./index.ts";
import type { PendingContainmentChange, SupabaseAdminClient } from "../_shared/pending-verification-containment.ts";

function assert(value: unknown): asserts value { if (!value) throw new Error("Assertion failed"); }
const id = "11111111-1111-4111-8111-111111111111";
const user = "11111111111111111";
const secret = "synthetic-test-secret";
const payload = { request_id: id, event_type: "guildMemberUpdate", guild_id: "1078630751077142608", discord_user_id: user, roles: ["1468659807736299520"], gateway_sequence: null, occurred_at: "2026-10-10T18:00:00.000Z" };
function request(body: unknown = payload, path = "", method = "POST", auth = secret) {
  return new Request(`https://member-sync.test/reaper-discord-member-sync${path}`, { method, headers: { "content-type": "application/json", "x-mochirii-reaper-member-sync-secret": auth }, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}
function fixture() {
  type Row = { state: string; result: unknown; owner: unknown; subject: unknown; hash: unknown };
  const rows = new Map<string, Row>(); const calls: string[] = [];
  let enabled = true; let failWrite = false; let failLog = false; let loseCompletion = false; let rejectFence = false;
  const admin: SupabaseAdminClient = {
    rpc(name, args) {
      calls.push(name);
      const key = String(args.p_request_key); const row = rows.get(key);
      if (name === "reaper_reserve_pending_containment") {
        let data: string;
        if (row) data = row.subject !== args.p_subject_id || row.hash !== args.p_input_sha256 ? "identity_conflict" : "duplicate";
        else if ([...rows.values()].some((r) => ["reserved", "writing", "blocked"].includes(r.state))) data = "busy";
        else if (!enabled) data = "disabled";
        else { rows.set(key, { state: "reserved", owner: args.p_owner_id, subject: args.p_subject_id, hash: args.p_input_sha256, result: null }); data = "acquired"; }
        return Promise.resolve({ data, error: null });
      }
      if (name === "reaper_pending_containment_status") return Promise.resolve({ data: row ? { state: row.state, result: row.result } : { state: "missing", result: null }, error: null });
      if (!row || row.owner !== args.p_owner_id || !["reserved", "writing"].includes(row.state)) return Promise.resolve({ data: false, error: null });
      if (name === "reaper_begin_pending_containment_write") {
        if (rejectFence) return Promise.resolve({ data: false, error: null });
        row.state = "writing"; return Promise.resolve({ data: true, error: null });
      }
      if (name === "reaper_finish_pending_containment") {
        if (args.p_outcome === "rejected" && row.state === "writing") return Promise.resolve({ data: false, error: null });
        row.state = String(args.p_outcome); row.result = args.p_result;
        if (loseCompletion && row.state === "completed") return Promise.reject(new Error("Lost completion response"));
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error("Unexpected RPC");
    },
    from() {
      const query = { select: () => query, eq: () => query, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
      return { ...query, upsert() { calls.push("registry-write"); return Promise.resolve({ error: null }); } };
    },
  };
  const deps: MemberSyncDependencies = {
    secret, botConfigured: true, admin: () => { calls.push("admin"); return admin; },
    channels: () => { calls.push("channels"); return Promise.resolve([
      { id: "1468658915594997760", name: "pending", permission_overwrites: [] },
      { id: "1480143854014300335", name: "apply", permission_overwrites: [{ id: payload.guild_id, type: 0, allow: "1024", deny: "0" }] },
    ]); },
    roles: () => Promise.resolve([]), member: () => Promise.resolve({ user: { id: user }, roles: ["1468659807736299520"] }),
    write: () => { calls.push("discord-write"); if (failWrite) throw new TypeError("Ambiguous provider failure"); return Promise.resolve(); },
    log: () => { calls.push("log"); if (failLog) throw new Error("Log failed"); return Promise.resolve(); },
  };
  return { deps, rows, calls, disable: () => enabled = false, failWrite: () => failWrite = true, failLog: () => failLog = true, loseCompletion: () => loseCompletion = true, rejectFence: () => rejectFence = true };
}

Deno.test("authenticated request completes once with exact durable receipt before logging", async () => {
  const f = fixture(); f.failLog();
  const first = await handleMemberSync(request(), f.deps); const body = await first.json();
  assert(first.status === 200 && body.status === "completed");
  assert(Object.keys(body).sort().join(",") === "ok,request_id,result,status");
  assert(body.result.discordWrites === 1 && body.result.dbWrites === 1 && body.result.staleRecordsCleared === 0);
  assert(f.calls.indexOf("reaper_finish_pending_containment") < f.calls.indexOf("log"));
  const writes = f.calls.filter((c) => c.endsWith("-write")).length;
  const duplicate = await handleMemberSync(request(), f.deps);
  assert(duplicate.status === 200 && (await duplicate.json()).status === "completed");
  assert(f.calls.filter((c) => c.endsWith("-write")).length === writes);
});

Deno.test("lost completion acknowledgment resolves completed receipt without duplicate writes", async () => {
  const f = fixture(); f.loseCompletion();
  const response = await handleMemberSync(request(), f.deps);
  assert(response.status === 200 && (await response.json()).status === "completed");
  const count = f.calls.filter((c) => c === "discord-write").length;
  await handleMemberSync(request(), f.deps); assert(f.calls.filter((c) => c === "discord-write").length === count);
});

Deno.test("ambiguous write blocks permanently and prevents another member and bulk writer", async () => {
  const f = fixture(); f.failWrite();
  const response = await handleMemberSync(request(), f.deps); assert(response.status === 409 && (await response.json()).status === "blocked");
  const writes = f.calls.filter((c) => c.endsWith("-write")).length;
  await handleMemberSync(request(), f.deps);
  const busy = await handleMemberSync(request({ ...payload, request_id: "22222222-2222-4222-8222-222222222222", discord_user_id: "22222222222222222" }), f.deps);
  assert((await busy.json()).status === "busy" && f.calls.filter((c) => c.endsWith("-write")).length === writes);
});

Deno.test("fence rejection produces zero registry and provider writes", async () => {
  const f = fixture(); f.rejectFence();
  const response = await handleMemberSync(request(), f.deps); assert((await response.json()).status === "blocked");
  assert(!f.calls.some((c) => c.endsWith("-write")));
});

Deno.test("known no-write preflight failure is terminal rejected, never replayed", async () => {
  const f = fixture(); f.deps.channels = () => Promise.reject(new Error("Read unavailable"));
  const response = await handleMemberSync(request(), f.deps); assert((await response.json()).status === "rejected");
  assert(!f.calls.some((c) => c.endsWith("-write")));
  assert((await (await handleMemberSync(request(), f.deps)).json()).status === "rejected");
});

Deno.test("disabled is explicit no-attempt and UUID can acquire after later authorized enable", async () => {
  const f = fixture(); f.disable(); const response = await handleMemberSync(request(), f.deps); const body = await response.json();
  assert(response.status === 409 && body.status === "disabled" && body.retry_after_ms === 1000 && f.rows.size === 0);
  assert(!f.calls.includes("channels"));
});

Deno.test("same UUID cannot be rebound to another member or changed immutable body", async () => {
  const f = fixture(); await handleMemberSync(request(), f.deps);
  for (const value of [{ ...payload, discord_user_id: "22222222222222222" }, { ...payload, occurred_at: "2026-10-10T18:00:01.000Z" }]) {
    const response = await handleMemberSync(request(value), f.deps); assert((await response.json()).status === "identity_conflict");
  }
  assert(f.calls.filter((c) => c === "discord-write").length === 1);
});

Deno.test("status lookup is authenticated read-only, strict URI and no private receipt data", async () => {
  const f = fixture(); await handleMemberSync(request(), f.deps); f.calls.length = 0;
  const response = await handleMemberSync(request(null, `/status?request_id=${id}`, "GET"), f.deps); const body = await response.json();
  assert(response.status === 200 && body.status === "completed" && Object.keys(body).sort().join(",") === "ok,request_id,result,status");
  assert(f.calls.join(",") === "admin,reaper_pending_containment_status");
  f.calls.length = 0;
  assert((await handleMemberSync(request(null, `/status?request_id=${id}`, "GET", "wrong"), f.deps)).status === 401 && f.calls.length === 0);
  assert((await handleMemberSync(request(null, `/status?request_id=${id}&request_id=${id}`, "GET"), f.deps)).status === 400);
});

Deno.test("malformed identity, duplicate keys, oversized and wrong-route requests access no providers", async () => {
  const invalid = [{ ...payload, request_id: "bad" }, { ...payload, extra: true }, { ...payload, roles: ["bad"] }, { ...payload, gateway_sequence: -1 }, { ...payload, occurred_at: "invalid" }, `{"request_id":"bad",${JSON.stringify(payload).slice(1)}`, "x".repeat(8193)];
  for (const value of invalid) { const f = fixture(); assert((await handleMemberSync(request(value), f.deps)).status === 400); assert(f.calls.length === 0); }
  const f = fixture(); assert((await handleMemberSync(request(payload, "/other"), f.deps)).status === 404 && f.calls.length === 0);
});

Deno.test("pending duplicate and missing status never start another provider operation", async () => {
  const f = fixture(); f.rows.set(`gateway:${id}`, { state: "writing", result: null, owner: "old-owner", subject: user, hash: "different" });
  const response = await handleMemberSync(request(null, `/status?request_id=${id}`, "GET"), f.deps);
  assert(response.status === 200 && (await response.json()).status === "writing");
  const missing = await handleMemberSync(request(null, "/status?request_id=22222222-2222-4222-8222-222222222222", "GET"), f.deps);
  assert(missing.status === 200 && (await missing.json()).status === "missing");
  assert(!f.calls.includes("channels") && !f.calls.some((c) => c.endsWith("-write")));
});

Deno.test("runtime permission transport accepts only204, never redirects or retries ambiguous writes", async () => {
  const original = globalThis.fetch;
  const change = { channelId: "11111111111111111", userId: user, nextAllow: 0n, nextDeny: 0n } as PendingContainmentChange;
  try {
    for (const outcome of [204, 200, 429, 500, "network"]) {
      let calls = 0;
      globalThis.fetch = ((_input: unknown, init: RequestInit) => {
        calls++; assert(init.redirect === "error" && init.signal instanceof AbortSignal && init.method === "DELETE");
        if (outcome === "network") return Promise.reject(new TypeError("Unknown completion"));
        return Promise.resolve(new Response(null, { status: Number(outcome) }));
      }) as typeof fetch;
      let succeeded = false; try { await writePendingDiscordOverwrite(change); succeeded = true; } catch { /* Expected unsafe response. */ }
      assert(succeeded === (outcome === 204) && calls === 1);
    }
  } finally { globalThis.fetch = original; }
});

Deno.test("external proxy prefix and status aliases are rejected rather than broadening routing", async () => {
  const f = fixture();
  for (const path of ["/functions/v1/reaper-discord-member-sync/status", "/reaper-discord-member-sync/status/", "/reaper-discord-member-sync/other"]) {
    const req = new Request(`https://member-sync.test${path}?request_id=${id}`, { headers: { "x-mochirii-reaper-member-sync-secret": secret } });
    assert((await handleMemberSync(req, f.deps)).status === 404);
  }
  assert(f.calls.length === 0);
});
