import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GallerySubmissionError, submitGalleryOriginal } from "./submission-operation.ts";

const userId = "11000000-0000-4000-8000-000000000001";
const uploadId = "11000000-0000-4000-8000-000000000002";
const storagePath = `${userId}/${uploadId}.png`;
const file = new File([new Uint8Array(12)], "test.png", { type: "image/png" });

function fixture(onSession?: (read: number) => Promise<void>) {
  const calls: string[] = [];
  let member = userId;
  let stored = false;
  let submitted = false;
  let failCompletion = false;
  let deny = "";
  let changedPath = false;
  let sessionReads = 0;
  const row = { id: uploadId, user_id: userId, storage_path: storagePath, mime_type: "image/png", size_bytes: file.size };
  const client = {
    auth: { getSession: async () => {
      await onSession?.(++sessionReads);
      return { data: { session: { user: { id: member }, access_token: "synthetic-token" } }, error: null };
    } },
    storage: { from: () => ({ list: async () => {
      calls.push("list");
      return { error: null, data: stored ? [{ name: `${uploadId}.png`, metadata: { size: file.size, mimetype: "image/png" } }] : [] };
    } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      assert.equal(args.p_upload_id, uploadId);
      if (name === "gallery_reserve_upload") return { error: null, data: deny ? { ok: false, code: deny } : {
        ok: true, upload_id: uploadId, storage_path: changedPath ? "other/original.png" : storagePath,
        state: submitted ? "submitted" : "reserved",
      } };
      assert.equal(name, "gallery_complete_upload");
      assert.deepEqual(Object.keys(args).sort(), ["p_metadata", "p_upload_id"]);
      submitted = true;
      return failCompletion ? { data: null, error: { message: "PRIVATE_SENTINEL" } } : { error: null, data: { ok: true, submission: row } };
    },
  } as unknown as SupabaseClient;
  const run = (signal?: AbortSignal, uploadOverride?: Parameters<typeof submitGalleryOriginal>[0]["upload"]) => submitGalleryOriginal({
    client, file, userId, uploadId, mimeType: "image/png", supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    metadata: { original_filename: "test.png", title: "Synthetic fixture", instagram_opt_in: false }, signal,
    upload: uploadOverride || (async (_file, options) => { calls.push("upload"); await options.token(); stored = true; }),
  });
  return { calls, run, member: (value: string) => { member = value; },
    fail: (value: boolean) => { failCompletion = value; }, deny: (value: string) => { deny = value; },
    changePath: () => { changedPath = true; }, stored: () => stored };
}

test("actual upload operation reserves before direct Storage and completes through only the atomic RPC", async () => {
  const f = fixture();
  assert.equal((await f.run()).id, uploadId);
  assert.deepEqual(f.calls, ["gallery_reserve_upload", "list", "upload", "gallery_complete_upload"]);
});

test("same-ID replay does not upload another original or create another logical reservation", async () => {
  const f = fixture(); await f.run(); f.calls.length = 0;
  await f.run();
  assert.deepEqual(f.calls, ["gallery_reserve_upload", "gallery_complete_upload"]);
});

test("ambiguous completion preserves the original and reconciles the same ID without another upload", async () => {
  const f = fixture(); f.fail(true);
  await assert.rejects(f.run(), (error: unknown) => error instanceof GallerySubmissionError
    && error.code === "upload_unconfirmed" && !error.message.includes("PRIVATE_SENTINEL"));
  assert(f.stored()); f.fail(false); f.calls.length = 0;
  await f.run();
  assert.deepEqual(f.calls, ["gallery_reserve_upload", "gallery_complete_upload"]);
});

test("server quota denials and conflicting reservation paths never reach Storage", async () => {
  for (const code of ["upload_daily_limit", "upload_pending_limit", "upload_storage_limit", "upload_project_limit"]) {
    const f = fixture(); f.deny(code);
    await assert.rejects(f.run(), (error: unknown) => error instanceof GallerySubmissionError && error.code === code);
    assert.deepEqual(f.calls, ["gallery_reserve_upload"]);
  }
  const f = fixture(); f.changePath();
  await assert.rejects(f.run(), (error: unknown) => error instanceof GallerySubmissionError && error.code === "upload_conflict");
  assert.deepEqual(f.calls, ["gallery_reserve_upload"]);
});

test("account switching during upload prevents finalization", async () => {
  const f = fixture();
  await assert.rejects(f.run(undefined, async () => { f.member("22000000-0000-4000-8000-000000000001"); }),
    (error: unknown) => error instanceof GallerySubmissionError && error.code === "upload_account_changed");
  assert(!f.calls.includes("gallery_complete_upload"));
});

test("cancellation retains the durable reservation and never removes or finalizes an uncertain original", async () => {
  const f = fixture(); const controller = new AbortController();
  await assert.rejects(f.run(controller.signal, async () => { controller.abort(); }), { name: "AbortError" });
  assert.deepEqual(f.calls, ["gallery_reserve_upload", "list"]);
});

test("cancellation during awaited session reads fences every later mutation and returned result", async () => {
  for (const phase of [1, 2, 3, 4]) {
    const controller = new AbortController();
    const f = fixture(async (read) => { await Promise.resolve(); if (read === phase) controller.abort(); });
    await assert.rejects(f.run(controller.signal, async () => {}), { name: "AbortError" });
    assert.deepEqual(f.calls, phase === 1 ? [] : phase === 2 ? ["gallery_reserve_upload"]
      : phase === 3 ? ["gallery_reserve_upload", "list"]
        : ["gallery_reserve_upload", "list", "gallery_complete_upload"]);
  }
  const controller = new AbortController();
  const f = fixture(async (read) => { await Promise.resolve(); if (read === 3) controller.abort(); });
  await assert.rejects(f.run(controller.signal), { name: "AbortError" });
  assert.equal(f.stored(), false);
  assert(!f.calls.includes("gallery_complete_upload"));
});
