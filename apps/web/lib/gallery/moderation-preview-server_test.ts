import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  GALLERY_MODERATOR_PREVIEW_MAX_BYTES,
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
  GALLERY_MODERATOR_PREVIEW_VERSION,
  GALLERY_SOURCE_DECODE_VERSION,
  GalleryModerationPreviewError,
  prepareGalleryModerationPreview,
} from "./moderation-preview-server-core.ts";

const submissionId = "123e4567-e89b-42d3-a456-426614174000";
const expectedUpdatedAt = "2026-07-28T12:00:00.000Z";
const accessToken = "header.payload.signature";
const sentinel = "signed-token-must-not-survive";
const sanitizerAttestation =
  "vercel-header-segment.vercel-payload-segment.vercel-signature-segment";
const supabaseProjectRef = "abcdefghijklmnopqrst";
const supabaseUrl = `https://${supabaseProjectRef}.supabase.co`;

async function imageBytes(format: "jpeg" | "png" | "webp") {
  const canvas = createCanvas(48, 32);
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 48, 32);
  gradient.addColorStop(0, "#6ee7f0");
  gradient.addColorStop(1, "#9b5de5");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 48, 32);
  context.fillStyle = "#f7d774";
  context.fillRect(10, 8, 20, 12);
  return canvas.encode(format, 88);
}

function jpegWithComment(bytes: Uint8Array, comment: string) {
  const payload = Buffer.from(comment, "utf8");
  const length = payload.byteLength + 2;
  return Buffer.concat([
    Buffer.from(bytes.subarray(0, 2)),
    Buffer.from([0xff, 0xfe, length >> 8, length & 0xff]),
    payload,
    Buffer.from(bytes.subarray(2)),
  ]);
}

function upstreamResponse(bytes: Uint8Array, mimeType: string, headers: Record<string, string> = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Length": String(bytes.byteLength),
      "Content-Type": mimeType,
      "X-Gallery-Submission-Id": submissionId,
      "X-Gallery-Source-Width": "48",
      "X-Gallery-Source-Height": "32",
      "X-Gallery-Source-Validated-At": expectedUpdatedAt,
      "X-Gallery-Source-Decode-Version": GALLERY_SOURCE_DECODE_VERSION,
      ...headers,
    },
  });
}

async function prepareWithResponse(response: Response) {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const result = await prepareGalleryModerationPreview({
    accessToken,
    expectedUpdatedAt,
    publishableKey: "public-key",
    sanitizerAttestation,
    submissionId,
    supabaseProjectRef,
    supabaseUrl,
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return response;
    },
  });
  return { result, requestedUrl, requestedInit };
}

for (const [format, mimeType] of [
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
] as const) {
  test(`the server fully decodes and sanitizes ${format} sources`, async () => {
    const source = await imageBytes(format);
    const { result, requestedUrl, requestedInit } = await prepareWithResponse(
      upstreamResponse(source, mimeType),
    );
    assert.equal(requestedUrl, `${supabaseUrl}/functions/v1/list-gallery-review-queue`);
    assert.equal(requestedInit?.redirect, "error");
    assert.equal((requestedInit?.headers as Record<string, string>).Authorization, `Bearer ${accessToken}`);
    assert.equal(
      (requestedInit?.headers as Record<string, string>)["x-gallery-sanitizer-attestation"],
      sanitizerAttestation,
    );
    assert.equal(result.submissionId, submissionId);
    assert.equal(result.sourceWidth, 48);
    assert.equal(result.sourceHeight, 32);
    assert.equal(result.previewWidth, 48);
    assert.equal(result.previewHeight, 32);
    assert.equal(result.sourceDecodeVersion, GALLERY_SOURCE_DECODE_VERSION);
    assert.equal(result.previewVersion, GALLERY_MODERATOR_PREVIEW_VERSION);
    assert.ok(result.bytes.byteLength > 0);
    assert.ok(result.bytes.byteLength <= GALLERY_MODERATOR_PREVIEW_MAX_BYTES);
    const decoded = await loadImage(result.bytes);
    assert.equal(decoded.width, 48);
    assert.equal(decoded.height, 32);
  });
}

test("the fresh WebP derivative omits source metadata", async () => {
  const commented = jpegWithComment(await imageBytes("jpeg"), sentinel);
  assert.ok(commented.includes(Buffer.from(sentinel)));
  const { result } = await prepareWithResponse(upstreamResponse(commented, "image/jpeg"));
  const output = Buffer.from(result.bytes);
  assert.equal(output.includes(Buffer.from(sentinel)), false);
  for (const metadataChunk of ["ICCP", "EXIF", "XMP "]) {
    assert.equal(output.includes(Buffer.from(metadataChunk)), false);
  }
  assert.equal(GALLERY_MODERATOR_PREVIEW_MIME_TYPE, "image/webp");
});

test("the sanitizer fails closed when decoded dimensions differ from Edge evidence", async () => {
  const source = await imageBytes("jpeg");
  await assert.rejects(
    () => prepareWithResponse(upstreamResponse(source, "image/jpeg", {
      "X-Gallery-Source-Width": "49",
    })),
    (error: unknown) => error instanceof GalleryModerationPreviewError &&
      error.code === "preview_source_dimensions_mismatch" &&
      !error.message.includes(accessToken) &&
      !error.message.includes(sentinel),
  );
});

test("the sanitizer rejects mismatched, compressed, oversized, and truncated sources", async () => {
  const source = await imageBytes("webp");
  const cases = [
    upstreamResponse(source, "image/webp", { "X-Gallery-Submission-Id": crypto.randomUUID() }),
    upstreamResponse(source, "image/webp", { "Content-Encoding": "gzip" }),
    upstreamResponse(source, "image/webp", { "Content-Length": String(8 * 1024 * 1024 + 1) }),
    upstreamResponse(source, "image/webp", { "Content-Length": String(source.byteLength + 1) }),
    upstreamResponse(source, "text/html"),
    upstreamResponse(source, "image/webp", { "X-Gallery-Source-Decode-Version": "old" }),
  ];
  for (const response of cases) {
    await assert.rejects(
      () => prepareWithResponse(response),
      (error: unknown) => error instanceof GalleryModerationPreviewError,
    );
  }
});

test("the sanitizer accepts only the canonical hosted origin or exact HTTP loopback", async () => {
  const source = await imageBytes("webp");
  for (const candidateUrl of [
    "",
    "http://project.invalid",
    "http://127.0.0.1.example.com",
    "https://foreign.example.com",
    "https://uvwxyzabcdefghijklmn.supabase.co",
    `https://${supabaseProjectRef}.supabase.co.attacker.example`,
    `https://attacker.${supabaseProjectRef}.supabase.co`,
    `https://user:password@${supabaseProjectRef}.supabase.co`,
    `${supabaseUrl}/unexpected-path`,
    `${supabaseUrl}?redirect=https://attacker.example`,
    "ftp://localhost",
    "javascript:alert(1)",
  ]) {
    let fetched = false;
    let forwardedHeaders: HeadersInit | undefined;
    await assert.rejects(
      () => prepareGalleryModerationPreview({
        accessToken,
        expectedUpdatedAt,
        publishableKey: "public-key",
        sanitizerAttestation,
        submissionId,
        supabaseProjectRef,
        supabaseUrl: candidateUrl,
        fetchImpl: async (_input, init) => {
          fetched = true;
          forwardedHeaders = init?.headers;
          return upstreamResponse(source, "image/webp");
        },
      }),
      (error: unknown) => error instanceof GalleryModerationPreviewError &&
        error.code === "preview_upstream_unconfigured",
    );
    assert.equal(fetched, false);
    assert.equal(forwardedHeaders, undefined);
  }

  for (const localUrl of ["http://localhost:54321", "http://127.0.0.1:54321"]) {
    let requestedUrl = "";
    await prepareGalleryModerationPreview({
      accessToken,
      expectedUpdatedAt,
      publishableKey: "public-key",
      sanitizerAttestation,
      submissionId,
      supabaseProjectRef,
      supabaseUrl: localUrl,
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return upstreamResponse(source, "image/webp");
      },
    });
    assert.equal(
      requestedUrl,
      `${localUrl}/functions/v1/list-gallery-review-queue`,
    );
  }
});

test("the sanitizer cancels rejected upstream bodies before failing closed", async () => {
  for (const invalidHeaders of [
    { "Content-Encoding": "gzip" },
    { "Content-Type": "text/html" },
    { "Content-Length": String(8 * 1024 * 1024 + 1) },
    { "X-Gallery-Submission-Id": crypto.randomUUID() },
    { "X-Gallery-Source-Decode-Version": "old" },
  ]) {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        "Content-Length": "64",
        "Content-Type": "image/webp",
        "X-Gallery-Submission-Id": submissionId,
        "X-Gallery-Source-Width": "48",
        "X-Gallery-Source-Height": "32",
        "X-Gallery-Source-Validated-At": expectedUpdatedAt,
        "X-Gallery-Source-Decode-Version": GALLERY_SOURCE_DECODE_VERSION,
        ...invalidHeaders,
      },
    });
    await assert.rejects(
      () => prepareWithResponse(response),
      (error: unknown) => error instanceof GalleryModerationPreviewError,
    );
    assert.equal(canceled, true);
  }
});

test("the sanitizer bounds upstream time", async () => {
  await assert.rejects(
    () => prepareGalleryModerationPreview({
      accessToken,
      expectedUpdatedAt,
      publishableKey: "public-key",
      sanitizerAttestation,
      submissionId,
      supabaseProjectRef,
      supabaseUrl,
      timeoutMs: 1,
      fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    }),
    (error: unknown) => error instanceof GalleryModerationPreviewError &&
      error.code === "preview_upstream_unavailable",
  );
});
