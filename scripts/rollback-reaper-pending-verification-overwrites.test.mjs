import { test } from "node:test";
import assert from "node:assert/strict";
import { createRollbackRequest } from "./rollback-reaper-pending-verification-overwrites.mjs";

const id = "11111111-1111-4111-8111-111111111111";
test("rollback requires retained UUIDv4 before any provider operation", () => {
  for (const bad of ["", "invalid", "11111111-1111-1111-8111-111111111111"]) assert.throws(() => createRollbackRequest(() => { throw new Error("Unreachable"); }, bad));
});
test("duplicate and busy rollbacks cannot issue another write or finish", async () => {
  for (const state of ["duplicate", "busy", "disabled", "identity_conflict"]) {
    let calls = 0; const request = createRollbackRequest(async () => { calls++; return state; }, id);
    await assert.rejects(request.reserve()); await assert.rejects(request.beforeWrite()); await request.fail(); assert.equal(calls, 1);
  }
});
test("lost rollback fence acknowledgment blocks instead of releasing uncertainty", async () => {
  const calls = []; const request = createRollbackRequest(async (name, args) => {
    calls.push([name, args]); if (name === "reaper_reserve_pending_containment") return "acquired";
    if (name === "reaper_begin_pending_containment_write") throw new TypeError("Lost acknowledgment"); return true;
  }, id);
  await request.reserve(); await assert.rejects(request.beforeWrite()); await request.fail();
  assert.equal(calls.at(-1)[1].p_outcome, "blocked");
  assert.equal(calls[0][1].p_request_key, `rollback:${id}`);
  assert.equal(calls[0][1].p_subject_id, "*");
});
test("rollback persists completed receipt and diagnostic failure cannot downgrade it", async () => {
  const calls = []; const request = createRollbackRequest(async (name, args) => { calls.push([name, args]); return name === "reaper_reserve_pending_containment" ? "acquired" : true; }, id);
  await request.reserve(); await request.beforeWrite(); await request.complete({ discordWrites: 1, dbWrites: 1, staleRecordsCleared: 0 }); await request.fail();
  assert.equal(calls.at(-1)[1].p_outcome, "completed"); await assert.rejects(request.beforeWrite());
});
