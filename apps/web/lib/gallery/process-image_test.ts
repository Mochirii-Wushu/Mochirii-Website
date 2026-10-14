import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { processGalleryImage } from "./process-image.ts";
import {
  GALLERY_INPUT_MAX_BYTES, GALLERY_PROCESSING_MAX_RSS, GalleryImageError,
  inspectGalleryInput, readBoundedGalleryBody, validateGalleryDimensions, validateGalleryInputSize,
} from "../../../../packages/gallery-media/policy.ts";
import { signGalleryMedia, verifyGalleryMedia } from "../../../../packages/gallery-media/proof.ts";
import { inspectGalleryFileHeader } from "../gallery-thumbnail.ts";

const rgba = { create: { width: 480, height: 640, channels: 4 as const, background: { r: 40, g: 100, b: 160, alpha: 0.4 } } };
const imageError = (code: string) => (error: unknown) => error instanceof GalleryImageError && error.code === code;

test("JPEG, PNG, and WebP are really decoded and encoded; proportions, alpha, and no-upscale survive", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const input = await sharp(rgba)[format]().toBuffer();
    const result = await processGalleryImage(input);
    for (const [kind, payload] of [["full", result.full], ["thumbnail", result.thumbnail]] as const) {
      const bytes = Buffer.from(payload.base64, "base64");
      const metadata = await sharp(bytes).metadata();
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(metadata.format, "webp");
      assert.equal(payload.size_bytes, bytes.length);
      assert.equal(payload.width, 480); assert.equal(payload.height, 640);
      assert(bytes.length <= (kind === "full" ? 3 * 1024 * 1024 : 80 * 1024));
      assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
      assert.equal(metadata.orientation, undefined);
      if (format !== "jpeg") assert(decoded.data[3] > 0 && decoded.data[3] < 255);
      else assert.equal(decoded.data[3], 255);
    }
  }
});

test("rotated JPEGs normalize their orientation and remove the metadata", async () => {
  const input = await sharp(rgba).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await processGalleryImage(input);
  assert.equal(result.full.width, 640); assert.equal(result.full.height, 480);
  const decoded = await sharp(Buffer.from(result.full.base64, "base64")).metadata();
  assert.equal(decoded.orientation, undefined); assert.equal(decoded.exif, undefined);
});

test("an actual 8K screenshot fits the decoded policy and is resized before publication", async () => {
  const input = await sharp({ create: { width: 7680, height: 4320, channels: 3, background: "#345678" } }).png().toBuffer();
  const result = await processGalleryImage(input);
  assert.equal(result.full.width, 2560); assert.equal(result.full.height, 1440);
  assert.equal(result.thumbnail.width, 720); assert.equal(result.thumbnail.height, 405);
  assert(result.full.size_bytes <= 3 * 1024 * 1024);
});

test("input, decoded-pixel, edge, and output targets are independent hard limits", async () => {
  validateGalleryInputSize(GALLERY_INPUT_MAX_BYTES);
  assert.throws(() => validateGalleryInputSize(GALLERY_INPUT_MAX_BYTES + 1), imageError("image_size_rejected"));
  validateGalleryDimensions(8000, 5000);
  assert.throws(() => validateGalleryDimensions(8000, 5001), imageError("image_dimensions_rejected"));
  assert.throws(() => validateGalleryDimensions(16385, 1), imageError("image_dimensions_rejected"));
  const input = await sharp(rgba).png().toBuffer();
  await assert.rejects(processGalleryImage(input, { fullMaximumEdge: 2561 }), imageError("image_target_rejected"));
  const smaller = await processGalleryImage(input, { fullMaximumEdge: 256, fullMaximumBytes: 32 * 1024 });
  assert.equal(smaller.full.height, 256);
  assert(smaller.full.size_bytes <= 32 * 1024);
});

test("corrupt content, unsupported formats, and animation declarations fail before publication", async () => {
  for (const bytes of [Buffer.from("not an image"), Buffer.from("GIF89a"), Buffer.from([0xff, 0xd8, 0xff, 0xd9])]) {
    await assert.rejects(processGalleryImage(bytes), imageError("image_content_rejected"));
  }
  const valid = await sharp(rgba).png().toBuffer();
  const corrupt = Buffer.from(valid); corrupt[60] ^= 0xff;
  await assert.rejects(processGalleryImage(corrupt), imageError("image_content_rejected"));
  const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8, 0); chunk.write("acTL", 4); chunk.writeUInt32BE(2, 8);
  const animated = Buffer.concat([valid.subarray(0, 33), chunk, valid.subarray(33)]);
  assert.throws(() => inspectGalleryInput(animated), imageError("image_animation_rejected"));
});

test("cancellation and the RSS ceiling reject actual processing and leave a later retry usable", async () => {
  const input = await sharp(rgba).png().toBuffer();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(processGalleryImage(input, { signal: controller.signal }), imageError("image_processing_cancelled"));
  const usage = process.memoryUsage;
  try {
    process.memoryUsage = Object.assign(() => ({ ...usage(), rss: GALLERY_PROCESSING_MAX_RSS + 1 }), { rss: usage.rss });
    await assert.rejects(processGalleryImage(input), imageError("image_memory_rejected"));
  } finally { process.memoryUsage = usage; }
  assert((await processGalleryImage(input)).full.size_bytes > 0);
});

test("streamed input accepts the exact boundary and cancels before retaining an excess chunk", async () => {
  for (const extra of [false, true]) {
    let cancelled = false, offset = 0;
    const response = new Response(new ReadableStream({
      pull(controller) {
        if (offset++ < 2) controller.enqueue(new Uint8Array(16));
        else if (extra && offset === 3) controller.enqueue(new Uint8Array(1));
        else controller.close();
      },
      cancel() { cancelled = true; },
    }));
    if (extra) { await assert.rejects(readBoundedGalleryBody(response, 32), imageError("image_size_rejected")); assert(cancelled); }
    else assert.equal((await readBoundedGalleryBody(response, 32)).length, 32);
  }
  let read = false, cancelled = false;
  const body = { cancel: async () => { cancelled = true; }, getReader: () => { read = true; throw new Error("must not read"); } };
  await assert.rejects(readBoundedGalleryBody({ headers: new Headers({ "content-length": "33" }), body } as unknown as Response, 32));
  assert(cancelled); assert.equal(read, false);
});

test("the server proof binds the exact media bytes and context without exposing the key", async () => {
  const secret = "a5".repeat(32), body = JSON.stringify({ actor: "one", source: "original", full: "encoded-image" });
  const signature = await signGalleryMedia(body, secret);
  assert(await verifyGalleryMedia(body, signature, secret));
  assert.equal(await verifyGalleryMedia(body.replace("encoded-image", "changed"), signature, secret), false);
  assert.equal(await verifyGalleryMedia(body, signature, "b6".repeat(32)), false);
  assert.equal(await verifyGalleryMedia(body, "invalid", secret), false);
});

test("browser preflight inspects real MIME and bounded dimensions before decoding, not the filename or file type", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const bytes = await sharp(rgba)[format]().toBuffer();
    const checked = await inspectGalleryFileHeader(new File([bytes], "wrong.heic", { type: "application/octet-stream" }));
    assert.equal(checked.mimeType, "image/" + format);
    assert.equal(checked.width, 480); assert.equal(checked.height, 640);
    if (format === "jpeg") {
      const marker = bytes.indexOf(Buffer.from([0xff, 0xda]));
      await assert.rejects(inspectGalleryFileHeader(new File([bytes.subarray(0, marker)], "incomplete.jpg")));
    }
  }
});
