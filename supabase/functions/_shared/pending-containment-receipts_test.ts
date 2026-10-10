import { containmentReceipt, ContainmentRequest, readContainmentJson, readContainmentReceipt } from "./pending-containment-receipts.ts";
import type { SupabaseAdminClient } from "./pending-verification-containment.ts";

function assert(value: unknown): asserts value { if (!value) throw new Error("Assertion failed"); }
async function rejects(task: () => unknown) { let rejected = false; try { await task(); } catch { rejected = true; } assert(rejected); }
const result = { discordWrites: 1, dbWrites: 2, staleRecordsCleared: 0 };

Deno.test("receipt validates exact terminal fields and bounded safe counts", async () => {
  assert(containmentReceipt({ state: "completed", result }).result?.discordWrites === 1);
  for (const value of [null, {}, { state: "applied", result }, { state: "writing", result }, { state: "completed", result: null },
    { state: "completed", result, owner: "private" }, { state: "completed", result: { ...result, extra: 0 } },
    ...[-1, 1.5, "1", 10001, Number.MAX_SAFE_INTEGER].map((dbWrites) => ({ state: "completed", result: { ...result, dbWrites } }))]) {
    await rejects(() => containmentReceipt(value));
  }
});

Deno.test("lost fence acknowledgment blocks rather than claiming preflight rejection", async () => {
  const calls: string[] = [];
  const admin: SupabaseAdminClient = { from() { throw new Error("Unexpected registry"); }, rpc(name, args) {
    calls.push(`${name}:${args.p_outcome || ""}`);
    if (name === "reaper_reserve_pending_containment") return Promise.resolve({ data: "acquired", error: null });
    if (name === "reaper_begin_pending_containment_write") return Promise.reject(new Error("Lost acknowledgment"));
    return Promise.resolve({ data: true, error: null });
  } };
  const request = new ContainmentRequest(admin, "gateway:11111111-1111-4111-8111-111111111111");
  await request.reserve("11111111111111111", "a".repeat(64));
  await rejects(request.beforeWrite);
  await request.fail();
  assert(calls.at(-1) === "reaper_finish_pending_containment:blocked");
});

Deno.test("duplicate or busy invocation never obtains write ownership", async () => {
  for (const status of ["duplicate", "busy", "disabled", "identity_conflict"]) {
    let calls = 0;
    const admin: SupabaseAdminClient = { from() { throw new Error("Unexpected registry"); }, rpc() { calls++; return Promise.resolve({ data: status, error: null }); } };
    const request = new ContainmentRequest(admin, "discord:22222222222222222");
    await request.reserve("*", "a".repeat(64)); await rejects(request.beforeWrite); await request.fail();
    assert(calls === 1);
  }
});

Deno.test("completion receipt survives lost response and is read without a new reservation", async () => {
  let completed = false;
  const admin: SupabaseAdminClient = { from() { throw new Error("Unexpected registry"); }, rpc(name) {
    if (name === "reaper_reserve_pending_containment") return Promise.resolve({ data: "acquired", error: null });
    if (name === "reaper_finish_pending_containment" && !completed) { completed = true; return Promise.reject(new Error("Lost completion acknowledgment")); }
    if (name === "reaper_pending_containment_status") return Promise.resolve({ data: { state: "completed", result }, error: null });
    return Promise.resolve({ data: false, error: null });
  } };
  const request = new ContainmentRequest(admin, "discord:22222222222222222"); await request.reserve("*", "a".repeat(64));
  await rejects(() => request.complete(result)); await rejects(() => request.fail());
  assert((await readContainmentReceipt(admin, request.requestKey)).state === "completed");
});

Deno.test("bounded request reader rejects duplicated escaped keys, UTF8 errors and oversized bodies", async () => {
  for (const body of ['{"request_id":"a","request_id":"b"}', '{"request_id":"a","request_\\u0069d":"b"}', "x".repeat(8193)]) {
    await rejects(() => readContainmentJson(new Request("https://member-sync.test", { method: "POST", body })));
  }
  await rejects(() => readContainmentJson(new Request("https://member-sync.test", { method: "POST", body: new Uint8Array([0xff]) })));
  assert((await readContainmentJson(new Request("https://member-sync.test", { method: "POST", body: '{"roles":["1"],"request_id":"a"}' })) as { request_id: string }).request_id === "a");
});
