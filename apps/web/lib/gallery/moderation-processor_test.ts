import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createGalleryModerationProcessor } from "./moderation-processor.ts";
import { processGalleryImage } from "./process-image.ts";
import { verifyGalleryMedia } from "../../../../packages/gallery-media/proof.ts";
import { readFile } from "node:fs/promises";

const actor = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const owner = "10000000-0000-4000-8000-000000000003";
const origin = "https://gallery.example";
const config = { supabaseUrl: origin, publishableKey: "test-public-key", processorSecret: "a".repeat(64) };
const input = { accessToken: "test.test.test", submissionId: id, action: "approved" as const };
const sourceUrl = origin + "/storage/v1/object/sign/member-gallery/" + owner + "/input.png?token=test";
function response(body: BodyInit, url: string, status = 200, headers: HeadersInit = { "content-type": "application/json" }) {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
const original = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 4, background: "#8040aa80" } }).png().toBuffer());
type LeaseStore = { lease: { actor: string; submission: string; token: string; stale: boolean } | null; retired: Set<string> };
const leaseStore = (): LeaseStore => ({ lease: null, retired: new Set() });
function fixture({ accessChange, sourceChange, publishChange, processImage = processGalleryImage,
  leases = leaseStore(), admissionFault, maximumMs }: {
  accessChange?: (payload: Record<string, unknown>) => void;
  sourceChange?: (result: Response) => Response;
  publishChange?: (url: string) => Response;
  processImage?: typeof processGalleryImage;
  leases?: LeaseStore;
  admissionFault?: "lost_acquire" | "late_acquire" | "failed_release" | "malformed_acquire";
  maximumMs?: number;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let decodes = 0;
  let deferredAcquire: (() => void) | undefined;
  const run = createGalleryModerationProcessor({
    maximumMs,
    processImage: async (...args) => { decodes++; return processImage(...args); },
    fetchImpl: async (url, init) => {
      const target = String(url);
      calls.push({ url: target, init: init! });
      assert.equal(init?.redirect, "manual");
      if (target.endsWith("/list-gallery-review-queue")) {
        const request = JSON.parse(String(init?.body));
        if (request.processingAdmission) {
          const admission = request.processingAdmission;
          assert.equal(admission.protocol, "gallery-admission-v1");
          assert.equal(admission.actor_id, actor); assert.equal(admission.submission_id, id);
          assert.match(admission.lease_id, /^[0-9a-f-]{36}$/);
          const signature = new Headers(init?.headers).get("x-mochirii-gallery-admission-proof")!;
          assert(await verifyGalleryMedia("gallery-processing-admission-v1\n" + String(init?.body), signature, config.processorSecret));
          assert.equal(await verifyGalleryMedia(String(init?.body), signature, config.processorSecret), false);
          let code = "not_owner", acquired = false;
          if (admission.operation === "acquire") {
            if (admissionFault === "late_acquire") {
              deferredAcquire = () => { leases.lease = { actor, submission: id, token: admission.lease_id, stale: false }; };
              throw new Error("private-sentinel");
            }
            if (leases.lease) {
              code = leases.lease.stale ? "stale" : "busy";
            } else if (!leases.retired.has(admission.lease_id)) {
              leases.lease = { actor, submission: id, token: admission.lease_id, stale: false };
              acquired = true; code = "acquired";
            }
            if (admissionFault === "lost_acquire") throw new Error("private-sentinel");
            if (admissionFault === "malformed_acquire") return response('{"ok":true,"data":{"acquired":true,"code":"busy"}}', target);
          } else {
            assert.equal(admission.operation, "release");
            if (admissionFault === "failed_release") return response('{"error":"private-sentinel"}', target, 503);
            if (leases.lease?.token === admission.lease_id && leases.lease.actor === admission.actor_id
              && leases.lease.submission === admission.submission_id) {
              leases.retired.add(admission.lease_id); leases.lease = null; code = "released";
            }
          }
          return response(JSON.stringify({ ok: true, data: { acquired, code } }), target);
        }
        const payload = { ok: true, data: { hasAccess: true, moderatorId: actor, signedOriginalUrl: sourceUrl,
          submission: { id, user_id: owner, status: "pending", storage_bucket: "member-gallery", storage_path: owner + "/input.png",
            mime_type: "image/png", size_bytes: original.length, thumbnail_revision_id: null } } };
        accessChange?.(payload);
        return response(JSON.stringify(payload), target);
      }
      if (target === sourceUrl) {
        const result = response(original, target, 200, { "content-type": "image/png", etag: '"' + "1".repeat(32) + '"' });
        return sourceChange ? sourceChange(result) : result;
      }
      assert.equal(target, origin + "/functions/v1/moderate-gallery-submission");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.actor_id, actor);
      assert.equal(body.submission_id, id);
      assert.equal(body.source.storage_path, owner + "/input.png");
      assert.ok(await verifyGalleryMedia(String(init?.body), new Headers(init?.headers).get("x-mochirii-gallery-proof")!, config.processorSecret));
      return publishChange ? publishChange(target) : response('{"ok":true}', target);
    },
  });
  return { run, calls, leases, decodes: () => decodes, commitDeferredAcquire: () => deferredAcquire?.() };
}

test("actual server consumer freshly authorizes, decodes, binds proof and publishes only bounded images", async () => {
  const f = fixture();
  assert.equal((await f.run(input, config)).ok, true);
  assert.equal(f.calls.length, 5);
  assert.equal(f.decodes(), 1);
  assert.equal(f.leases.lease, null);
});
test("invalid credentials/configuration or denied moderator never download or decode the original", async () => {
  for (const bad of [{ ...input, accessToken: "private-sentinel" }, { ...input, submissionId: "bad" }]) {
    const f = fixture();
    assert.equal((await f.run(bad, config)).ok, false); assert.equal(f.calls.length, 0);
  }
  const badConfig = fixture();
  assert.equal((await badConfig.run(input, { ...config, supabaseUrl: "https://user:private-sentinel@gallery.example" })).ok, false);
  assert.equal(badConfig.calls.length, 0);
  const f = fixture({ accessChange: (payload) => { payload.ok = false; } });
  assert.equal((await f.run(input, config)).ok, false); assert.equal(f.calls.length, 1); assert.equal(f.decodes(), 0);
});
test("signed-source drift, off-origin, redirects, declared oversize and ETag absence fail before decoding", async () => {
  for (const source of ["https://outside.example/input?token=private-sentinel", sourceUrl + "&extra=private-sentinel"]) {
    const f = fixture({ accessChange: (payload) => { (payload.data as Record<string, unknown>).signedOriginalUrl = source; } });
    const result = await f.run(input, config);
    assert.equal(result.ok, false); assert.equal(f.calls.length, 1); assert.equal(f.decodes(), 0);
    assert.ok(!JSON.stringify(result).includes("private-sentinel"));
  }
  for (const change of [
    () => response(original, "https://outside.example/private-sentinel"),
    () => response("", sourceUrl, 302, { location: "https://outside.example/private-sentinel" }),
    () => response(original, sourceUrl, 200, { "content-length": "104857601", etag: "1".repeat(32) }),
    () => response(original, sourceUrl),
  ]) {
    const f = fixture({ sourceChange: change });
    assert.equal((await f.run(input, config)).ok, false); assert.equal(f.decodes(), 0); assert.equal(f.calls.length, 4);
    assert.equal(f.leases.lease, null);
  }
});
test("one decode slot is released after success/failure; concurrent requests are not buffered", async () => {
  let unblock: () => void = () => {};
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const f = fixture({ processImage: async (...args) => { await gate; return processGalleryImage(...args); } });
  const first = f.run(input, config);
  while (f.decodes() === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal((await f.run(input, config)).code, "processing_busy");
  unblock();
  assert.equal((await first).ok, true); assert.equal((await f.run(input, config)).ok, true);
  const failed = fixture({ processImage: async () => { throw new Error("private-sentinel"); } });
  for (let i = 0; i < 2; i++) {
    const result = await failed.run(input, config);
    assert.equal(result.code, "image_processor_unavailable");
    assert.ok(!JSON.stringify(result).includes("private-sentinel"));
  }
  assert.equal(failed.decodes(), 2);
  assert.equal(failed.leases.lease, null);
});
test("approved retry reconciles the exact row without another original download or publish", async () => {
  const f = fixture({ accessChange: (payload) => {
    const row = (payload.data as { submission: Record<string, unknown> }).submission;
    row.status = "approved"; row.viewer_revision_id = actor;
  } });
  assert.equal((await f.run(input, config)).code, "already_published");
  assert.equal(f.calls.length, 1); assert.equal(f.decodes(), 0);
});

test("independent instances share one backend lease; expiry is diagnostic and never admits overlapping decoding", async () => {
  const leases = leaseStore();
  let unblock: () => void = () => {};
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const first = fixture({ leases, processImage: async (...args) => { await gate; return processGalleryImage(...args); } });
  const second = fixture({ leases });
  const pending = first.run(input, config);
  while (first.decodes() === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal((await second.run(input, config)).code, "processing_busy");
  assert.equal(second.decodes(), 0);
  leases.lease!.stale = true;
  assert.equal((await second.run(input, config)).code, "processing_recovery_required");
  assert.equal(second.decodes(), 0);
  assert.equal(first.calls.filter((call) => String(call.init.body).includes('"operation":"release"')).length, 0);
  unblock(); assert.equal((await pending).ok, true);
  assert.equal(leases.lease, null);
  assert.equal((await second.run(input, config)).ok, true);
  assert.equal(second.decodes(), 1);
});

test("lost or inconsistent acquisition is never decode authority and reconciles only the exact owner token", async () => {
  for (const admissionFault of ["lost_acquire", "malformed_acquire"] as const) {
    const f = fixture({ admissionFault });
    const result = await f.run(input, config);
    assert.equal(result.ok, false); assert.equal(f.decodes(), 0);
    assert.equal(f.calls.length, 3); assert.equal(f.leases.lease, null);
    assert(!JSON.stringify(result).includes("private-sentinel"));
    const acquire = JSON.parse(String(f.calls[1].init.body)).processingAdmission;
    const release = JSON.parse(String(f.calls[2].init.body)).processingAdmission;
    assert.equal(release.lease_id, acquire.lease_id);
  }
});

test("failed release preserves the shared gate and reports a bounded recovery category", async () => {
  const leases = leaseStore();
  const first = fixture({ leases, admissionFault: "failed_release" });
  const result = await first.run(input, config);
  assert.equal(result.code, "processing_recovery_required");
  assert(!JSON.stringify(result).includes("private-sentinel"));
  assert(leases.lease);
  const second = fixture({ leases });
  assert.equal((await second.run(input, config)).code, "processing_busy");
  assert.equal(second.decodes(), 0);
});

test("an unknown-token release cannot prove cleanup of an acquisition that commits later", async () => {
  const f = fixture({ admissionFault: "late_acquire" });
  const result = await f.run(input, config);
  assert.equal(result.code, "processing_recovery_required");
  assert.equal(f.calls.length, 3); assert.equal(f.decodes(), 0);
  assert.equal(f.leases.lease, null);
  f.commitDeferredAcquire();
  assert(f.leases.lease);
  assert.equal(f.decodes(), 0);
  assert(!JSON.stringify(result).includes("private-sentinel"));
});

test("ambiguous publication completion releases decode admission but never performs object cleanup", async () => {
  const f = fixture({ publishChange: () => { throw new Error("private-sentinel"); } });
  const result = await f.run(input, config);
  assert.equal(result.ok, false); assert(!JSON.stringify(result).includes("private-sentinel"));
  assert.equal(f.decodes(), 1); assert.equal(f.leases.lease, null);
  assert.equal(f.calls.length, 5);
  assert(f.calls.every((call) => !call.url.includes("/object/remove") && call.init.method !== "DELETE"));
});

test("overall abort reaches the real decode seam but never releases while native settlement is outstanding", async () => {
  const leases = leaseStore();
  let unblock: () => void = () => {}, observedAbort: () => void = () => {};
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const aborted = new Promise<void>((resolve) => { observedAbort = resolve; });
  const first = fixture({ leases, maximumMs: 20, processImage: async (bytes, options) => {
    assert(options?.signal);
    options.signal.addEventListener("abort", observedAbort, { once: true });
    await gate;
    return processGalleryImage(bytes, options);
  } });
  const pending = first.run(input, config);
  // The production deadline is deliberately unref'ed. Keep this isolated test
  // alive while its synthetic native operation waits without I/O handles.
  await new Promise((resolve) => setTimeout(resolve, 30));
  await aborted;
  assert(leases.lease);
  assert.equal(first.calls.filter((call) => String(call.init.body).includes('"operation":"release"')).length, 0);
  const second = fixture({ leases });
  assert.equal((await second.run(input, config)).code, "processing_busy");
  assert.equal(second.decodes(), 0);
  unblock(); assert.equal((await pending).code, "image_processing_timeout");
  assert.equal(leases.lease, null);
});

test("overall abort cancels a stalled source body before releasing admission", async () => {
  let cancelled = false;
  const f = fixture({ maximumMs: 20, sourceChange: () => response(new ReadableStream({
    cancel() { cancelled = true; },
  }), sourceUrl, 200, { etag: '"' + "1".repeat(32) + '"' }) });
  const pending = f.run(input, config);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = await pending;
  assert.equal(result.code, "image_processing_timeout"); assert(cancelled);
  assert.equal(f.decodes(), 0); assert.equal(f.leases.lease, null);
});

test("the owning Server Action page source pins the hosted 60-second duration ceiling", async () => {
  const source = await readFile(new URL("../../app/leader-dashboard/page.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/export const maxDuration = 60;/g) || []).length, 1);
  assert.throws(() => createGalleryModerationProcessor({ maximumMs: 50_001 }));
});
