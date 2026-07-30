import assert from "node:assert/strict";
import test from "node:test";
import { startGalleryPreviewRequest } from "./safe-preview.ts";

test("a safe preview downloads once and revokes its object URL exactly once", async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  let loads = 0;
  const created: Blob[] = [];
  const revoked: string[] = [];
  const request = startGalleryPreviewRequest(
    async (signal) => {
      loads += 1;
      assert.equal(signal.aborted, false);
      return blob;
    },
    {
      createObjectURL: (value) => {
        created.push(value);
        return "blob:gallery-safe-preview";
      },
      revokeObjectURL: (value) => revoked.push(value),
    },
  );

  const lease = await request.ready;
  assert.ok(lease);
  assert.equal(lease.blob, blob);
  assert.equal(lease.objectUrl, "blob:gallery-safe-preview");
  assert.equal(loads, 1);
  assert.deepEqual(created, [blob]);

  lease.release();
  request.dispose();
  request.dispose();
  assert.deepEqual(revoked, ["blob:gallery-safe-preview"]);
});

test("disposing an in-flight preview aborts it and prevents an object URL", async () => {
  let resolveSource: ((blob: Blob) => void) | null = null;
  let observedSignal: AbortSignal | null = null;
  let created = 0;
  const request = startGalleryPreviewRequest(
    (signal) => {
      observedSignal = signal;
      return new Promise<Blob>((resolve) => {
        resolveSource = resolve;
      });
    },
    {
      createObjectURL: () => {
        created += 1;
        return "blob:unexpected";
      },
      revokeObjectURL: () => undefined,
    },
  );

  request.dispose();
  assert.equal(observedSignal?.aborted, true);
  resolveSource?.(new Blob([new Uint8Array([1])], { type: "image/png" }));
  assert.equal(await request.ready, null);
  assert.equal(created, 0);
});

test("disposing a ready preview revokes its object URL without an explicit release", async () => {
  const revoked: string[] = [];
  const request = startGalleryPreviewRequest(
    async () => new Blob([new Uint8Array([4, 5, 6])], { type: "image/webp" }),
    {
      createObjectURL: () => "blob:gallery-ready-preview",
      revokeObjectURL: (value) => revoked.push(value),
    },
  );

  const lease = await request.ready;
  assert.ok(lease);
  request.dispose();
  request.dispose();
  lease.release();
  assert.deepEqual(revoked, ["blob:gallery-ready-preview"]);
});
