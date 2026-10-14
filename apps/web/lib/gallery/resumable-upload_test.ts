import { test } from "node:test";
import assert from "node:assert/strict";
import { galleryUploadEndpoint, uploadGalleryOriginal } from "./resumable-upload.ts";
import type { HttpRequest } from "tus-js-client";

const file = new File(["png-fixture"], "screen.png", { type: "image/png" });
const base = { endpoint: "https://gallery.example/storage/v1/upload/resumable", objectName: "owner/id.png",
  mimeType: "image/png", token: async () => "test-credential" };
test("TUS targets the configured project, including isolated Preview, never a hardcoded production ref", () => {
  for (const project of ["a".repeat(20), "b".repeat(20)]) {
    assert.equal(galleryUploadEndpoint(`https://${project}.supabase.co`),
      `https://${project}.storage.supabase.co/storage/v1/upload/resumable`);
  }
  for (const invalid of ["https://outside.example", "http://" + "a".repeat(20) + ".supabase.co",
    "https://user:secret@" + "a".repeat(20) + ".supabase.co", "https://" + "a".repeat(20) + ".supabase.co/path",
    "https://" + "a".repeat(20) + ".supabase.co?token=secret"]) assert.throws(() => galleryUploadEndpoint(invalid));
});
test("actual upload seam uses private non-upsert 6 MiB chunks and refreshed credentials with progress", async () => {
  let progress = 0;
  const headers = new Map<string, string>();
  await uploadGalleryOriginal(file, { ...base, onProgress: ({ uploaded }) => { progress = uploaded; },
    createUpload: (_, settings) => ({ abort: async () => {}, start: () => {
      assert.equal(settings.chunkSize, 6 * 1024 * 1024);
      assert.equal(settings.headers?.["x-upsert"], "false");
      assert.equal(settings.metadata?.bucketName, "member-gallery");
      assert.equal(settings.storeFingerprintForResuming, false);
      void Promise.resolve(settings.onBeforeRequest?.({ getURL: () => base.endpoint, setHeader: (k: string, v: string) => headers.set(k, v) } as unknown as HttpRequest)).then(() => {
        settings.onProgress?.(file.size, file.size); settings.onSuccess?.({} as never);
      });
    } }),
  });
  assert.equal(progress, file.size); assert.equal(headers.get("authorization"), "Bearer test-credential");
});
test("cancellation contains abort failure, never terminates stored originals, and permits retry", async () => {
  const controller = new AbortController();
  let terminate: boolean | undefined = true;
  const createUpload = () => ({
    start: () => controller.abort(),
    abort: async (shouldTerminate?: boolean) => { terminate = shouldTerminate; throw new Error("private-sentinel"); },
  });
  await assert.rejects(uploadGalleryOriginal(file, { ...base, signal: controller.signal, createUpload }), { name: "AbortError" });
  assert.equal(terminate, false);
  await uploadGalleryOriginal(file, { ...base, createUpload: (_, settings) => ({
    start: () => settings.onSuccess?.({} as never), abort: async () => {},
  }) });
});
test("network failure exposes only a bounded product message, not raw transport details", async () => {
  await assert.rejects(uploadGalleryOriginal(file, { ...base, createUpload: (_, settings) => ({
    start: () => settings.onError?.(new Error("https://private-sentinel.invalid/token")),
    abort: async () => {},
  }) }), (error: Error) => !error.message.includes("private-sentinel") && error.message.includes("Retry"));
});
test("manual retry resumes the same in-memory upload while account/object changes do not reuse its URL", async () => {
  const uploadUrl = base.endpoint + "/test-upload";
  await assert.rejects(uploadGalleryOriginal(file, { ...base, createUpload: (_, settings) => ({
    url: uploadUrl,
    start: () => { settings.onUploadUrlAvailable?.(); settings.onError?.(new Error("network")); },
    abort: async () => {},
  }) }));
  await uploadGalleryOriginal(file, { ...base, objectName: "other-owner/id.png", createUpload: (_, settings) => ({
    start: () => { assert.equal(settings.uploadUrl, null); settings.onError?.(new Error("network")); },
    abort: async () => {},
  }) }).catch(() => {});
  await uploadGalleryOriginal(file, { ...base, createUpload: (_, settings) => ({
    start: () => { assert.equal(settings.uploadUrl, uploadUrl); settings.onSuccess?.({} as never); },
    abort: async () => {},
  }) });
});
test("off-origin or credentialed TUS targets are rejected before attaching a bearer", async () => {
  for (const target of ["https://outside.example/upload", "https://user:private-sentinel@gallery.example/storage/v1/upload/resumable/test"]) {
    let tokenRead = false;
    await assert.rejects(uploadGalleryOriginal(file, { ...base, token: async () => { tokenRead = true; return "test"; },
      createUpload: (_, settings) => ({ abort: async () => {}, start: () => {
        void Promise.resolve(settings.onBeforeRequest?.({ getURL: () => target, setHeader: () => assert.fail("must not attach bearer") } as unknown as HttpRequest))
          .catch((error) => settings.onError?.(error));
      } }),
    }));
    assert.equal(tokenRead, false);
  }
});
