import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createGalleryModerationProcessor } from "./moderation-processor.ts";
import { processGalleryImage } from "./process-image.ts";
import { verifyGalleryMedia } from "../../../../packages/gallery-media/proof.ts";

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
function fixture({ accessChange, sourceChange, publishChange, processImage = processGalleryImage }: {
  accessChange?: (payload: Record<string, unknown>) => void;
  sourceChange?: (result: Response) => Response;
  publishChange?: (url: string) => Response;
  processImage?: typeof processGalleryImage;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let decodes = 0;
  const run = createGalleryModerationProcessor({
    processImage: async (...args) => { decodes++; return processImage(...args); },
    fetchImpl: async (url, init) => {
      const target = String(url);
      calls.push({ url: target, init: init! });
      assert.equal(init?.redirect, "manual");
      if (target.endsWith("/list-gallery-review-queue")) {
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
  return { run, calls, decodes: () => decodes };
}

test("actual server consumer freshly authorizes, decodes, binds proof and publishes only bounded images", async () => {
  const f = fixture();
  assert.equal((await f.run(input, config)).ok, true);
  assert.equal(f.calls.length, 3);
  assert.equal(f.decodes(), 1);
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
    assert.equal((await f.run(input, config)).ok, false); assert.equal(f.decodes(), 0); assert.equal(f.calls.length, 2);
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
});
test("approved retry reconciles the exact row without another original download or publish", async () => {
  const f = fixture({ accessChange: (payload) => {
    const row = (payload.data as { submission: Record<string, unknown> }).submission;
    row.status = "approved"; row.viewer_revision_id = actor;
  } });
  assert.equal((await f.run(input, config)).code, "already_published");
  assert.equal(f.calls.length, 1); assert.equal(f.decodes(), 0);
});
