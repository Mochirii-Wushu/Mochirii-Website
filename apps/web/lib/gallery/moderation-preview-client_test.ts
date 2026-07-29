import assert from "node:assert/strict";
import test from "node:test";
import {
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
  GALLERY_MODERATOR_PREVIEW_VERSION,
  GALLERY_SOURCE_DECODE_VERSION,
} from "./moderation-preview-contract.ts";
import {
  fetchGalleryModerationPreview,
  parseGalleryModerationPreviewResponse,
} from "./moderation-preview-client.ts";

const submissionId = "123e4567-e89b-42d3-a456-426614174000";
const expectedUpdatedAt = "2026-07-28T12:00:00.000Z";
const accessToken = "header.payload.signature";

const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);

function response(overrides: Record<string, string> = {}, bytes = webpBytes) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Length": String(bytes.byteLength),
      "Content-Type": GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
      "X-Gallery-Submission-Id": submissionId,
      "X-Gallery-Source-Width": "48",
      "X-Gallery-Source-Height": "32",
      "X-Gallery-Preview-Width": "48",
      "X-Gallery-Preview-Height": "32",
      "X-Gallery-Source-Validated-At": expectedUpdatedAt,
      "X-Gallery-Source-Decode-Version": GALLERY_SOURCE_DECODE_VERSION,
      "X-Gallery-Preview-Version": GALLERY_MODERATOR_PREVIEW_VERSION,
      ...overrides,
    },
  });
}

test("the client accepts only the exact sanitized preview contract", async () => {
  const parsed = await parseGalleryModerationPreviewResponse(response(), submissionId);
  assert.ok(parsed);
  assert.equal(parsed.blob.type, GALLERY_MODERATOR_PREVIEW_MIME_TYPE);
  assert.equal(parsed.blob.size, webpBytes.byteLength);
  assert.equal(parsed.previewVersion, GALLERY_MODERATOR_PREVIEW_VERSION);

  for (const invalid of [
    response({ "Content-Type": "image/jpeg" }),
    response({ "Content-Length": "4" }),
    response({ "X-Gallery-Submission-Id": crypto.randomUUID() }),
    response({ "X-Gallery-Preview-Width": "0" }),
    response({ "X-Gallery-Source-Validated-At": "invalid" }),
    response({ "X-Gallery-Source-Decode-Version": "old" }),
    response({ "X-Gallery-Preview-Version": "old" }),
    response({ "Cache-Control": "public, max-age=3600" }),
    response({ "Content-Encoding": "gzip" }),
    response({ "X-Content-Type-Options": "" }),
    response({}, new Uint8Array(webpBytes.byteLength)),
  ]) {
    assert.equal(await parseGalleryModerationPreviewResponse(invalid, submissionId), null);
  }
});

test("the browser requests only the fixed same-origin sanitizer route", async () => {
  Object.assign(globalThis, { window: globalThis });
  let input = "";
  let init: RequestInit | undefined;
  const result = await fetchGalleryModerationPreview({
    accessToken,
    expectedUpdatedAt,
    submissionId,
    fetchImpl: async (candidate, candidateInit) => {
      input = String(candidate);
      init = candidateInit;
      return response();
    },
  });
  assert.ok(result);
  assert.equal(input, "/api/gallery/moderation-preview");
  assert.equal(init?.credentials, "same-origin");
  assert.equal(init?.redirect, "error");
  assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${accessToken}`);
  assert.equal(String(init?.body).includes("supabase.co"), false);
  assert.deepEqual(JSON.parse(String(init?.body)), { submissionId, expectedUpdatedAt });
});
