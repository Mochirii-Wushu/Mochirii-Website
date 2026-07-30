import assert from "node:assert/strict";
import test from "node:test";
import { GALLERY_LOCAL_SANITIZER_ATTESTATION } from "./moderation-preview-contract.ts";
import {
  GALLERY_MODERATOR_PREVIEW_MIME_TYPE,
  GALLERY_MODERATOR_PREVIEW_VERSION,
  GALLERY_SOURCE_DECODE_VERSION,
  type GalleryModerationPreview,
} from "./moderation-preview-server-core.ts";
import {
  galleryPreviewRequestIsSameOrigin,
  handleGalleryModerationPreviewRequest,
  readGalleryPreviewBearer,
  readGalleryPreviewSanitizerAttestation,
} from "./moderation-preview-route.ts";

const submissionId = "123e4567-e89b-42d3-a456-426614174000";
const expectedUpdatedAt = "2026-07-28T12:00:00.000Z";
const accessToken = "header.payload.signature";
const sanitizerAttestation =
  "vercel-header-segment.vercel-payload-segment.vercel-signature-segment";
const supabaseProjectRef = "abcdefghijklmnopqrst";
const supabaseUrl = `https://${supabaseProjectRef}.supabase.co`;

function preview(): GalleryModerationPreview {
  return {
    bytes: new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x04, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]),
    submissionId,
    sourceWidth: 48,
    sourceHeight: 32,
    previewWidth: 48,
    previewHeight: 32,
    sourceValidatedAt: expectedUpdatedAt,
    sourceDecodeVersion: GALLERY_SOURCE_DECODE_VERSION,
    previewVersion: GALLERY_MODERATOR_PREVIEW_VERSION,
  };
}

function request(overrides: {
  method?: string;
  origin?: string;
  authorization?: string;
  body?: string;
  contentType?: string;
  url?: string;
  secFetchSite?: string;
  vercelOidcToken?: string | null;
} = {}) {
  const body = overrides.body ?? JSON.stringify({ submissionId, expectedUpdatedAt });
  return new Request(overrides.url || "https://mochirii.com/api/gallery/moderation-preview", {
    method: overrides.method || "POST",
    headers: {
      Authorization: overrides.authorization ?? `Bearer ${accessToken}`,
      "Content-Type": overrides.contentType || "application/json",
      Origin: overrides.origin || "https://mochirii.com",
      "Sec-Fetch-Site": overrides.secFetchSite || "same-origin",
      ...(overrides.vercelOidcToken === null
        ? {}
        : { "X-Vercel-OIDC-Token": overrides.vercelOidcToken || sanitizerAttestation }),
    },
    ...(overrides.method === "GET" ? {} : { body }),
  });
}

const dependencies = {
  publishableKey: "public-key",
  supabaseProjectRef,
  supabaseUrl,
  preparePreview: async () => preview(),
};

test("the route accepts only an explicit same-origin bearer request", async () => {
  assert.equal(galleryPreviewRequestIsSameOrigin(request()), true);
  assert.equal(readGalleryPreviewBearer(`Bearer ${accessToken}`), accessToken);
  assert.equal(
    readGalleryPreviewSanitizerAttestation(request(), supabaseUrl),
    sanitizerAttestation,
  );
  for (const candidate of [
    request({ method: "GET" }),
    request({ origin: "https://outside.invalid" }),
    request({ secFetchSite: "cross-site" }),
    request({ authorization: "Bearer invalid" }),
    request({ vercelOidcToken: null }),
    request({ contentType: "text/plain" }),
    request({ body: "{" }),
    request({ body: JSON.stringify({ submissionId, expectedUpdatedAt, extra: true }) }),
    request({ body: "x".repeat(1025) }),
    request({ url: "https://mochirii.com/api/gallery/moderation-preview?raw=1" }),
  ]) {
    const response = await handleGalleryModerationPreviewRequest(candidate, dependencies);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("x-robots-tag") || "", /noindex/u);
  }
});

test("the development marker is available only to an exact loopback pair", () => {
  assert.equal(
    readGalleryPreviewSanitizerAttestation(
      request({
        url: "http://localhost:3000/api/gallery/moderation-preview",
        origin: "http://localhost:3000",
        vercelOidcToken: null,
      }),
      "http://127.0.0.1:54321",
    ),
    GALLERY_LOCAL_SANITIZER_ATTESTATION,
  );
  for (const [url, upstream] of [
    ["https://mochirii.com/api/gallery/moderation-preview", supabaseUrl],
    ["http://localhost.example.com:3000/api/gallery/moderation-preview", "http://127.0.0.1:54321"],
    ["http://localhost:3000/api/gallery/moderation-preview", "https://project.supabase.co"],
  ]) {
    assert.equal(
      readGalleryPreviewSanitizerAttestation(
        request({ url, origin: new URL(url).origin, vercelOidcToken: null }),
        upstream,
      ),
      null,
    );
  }
});

test("the route returns only the bounded same-origin WebP and safe evidence headers", async () => {
  let received: Record<string, unknown> | null = null;
  const previewRequest = request();
  const response = await handleGalleryModerationPreviewRequest(previewRequest, {
    ...dependencies,
    preparePreview: async (options) => {
      received = options;
      return preview();
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), GALLERY_MODERATOR_PREVIEW_MIME_TYPE);
  assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-length"), "12");
  assert.equal(response.headers.get("x-gallery-submission-id"), submissionId);
  assert.equal(response.headers.get("x-gallery-source-decode-version"), GALLERY_SOURCE_DECODE_VERSION);
  assert.equal(response.headers.get("x-gallery-preview-version"), GALLERY_MODERATOR_PREVIEW_VERSION);
  assert.equal(response.headers.get("x-gallery-preview-width"), "48");
  assert.equal(response.headers.get("x-gallery-preview-height"), "32");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [
      0x52, 0x49, 0x46, 0x46,
      0x04, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ],
  );
  assert.equal(received?.accessToken, accessToken);
  assert.equal(received?.sanitizerAttestation, sanitizerAttestation);
  assert.equal(received?.submissionId, submissionId);
  assert.equal(received?.expectedUpdatedAt, expectedUpdatedAt);
  assert.equal(received?.supabaseProjectRef, supabaseProjectRef);
  assert.equal(received?.signal, previewRequest.signal);
});

test("route failures remain opaque and never serialize credentials", async () => {
  const response = await handleGalleryModerationPreviewRequest(request(), {
    ...dependencies,
    preparePreview: async () => {
      throw new Error(`upstream ${accessToken} ${sanitizerAttestation}`);
    },
  });
  assert.equal(response.status, 404);
  const raw = await response.text();
  assert.equal(raw, "");
  assert.equal(raw.includes(accessToken), false);
  assert.equal(raw.includes(sanitizerAttestation), false);
});
