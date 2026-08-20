import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  enforceProductionGalleryMatrixGuard,
  isProductionWebsiteOrigin,
  isReviewedWebsiteVercelPreviewOrigin,
  LIVE_GALLERY_MEDIA_SMOKE_OPT_IN,
  resolveGalleryAuditUrl,
} from "./live-gallery-media-smoke-guard.mjs";

const siteOrigin = "https://mochirii.com";

test("recognizes only the canonical production Website origins", () => {
  assert.equal(isProductionWebsiteOrigin("https://mochirii.com/gallery", siteOrigin), true);
  assert.equal(isProductionWebsiteOrigin("https://www.mochirii.com/gallery", siteOrigin), true);
  assert.equal(isProductionWebsiteOrigin("http://127.0.0.1:8765/gallery", siteOrigin), false);
  assert.equal(isProductionWebsiteOrigin("http://localhost:8765/gallery", siteOrigin), false);
  assert.equal(isProductionWebsiteOrigin("https://mochirii-git-gallery-egress-mochirii.vercel.app/gallery", siteOrigin), false);
});

test("recognizes only the Mōchirīī non-main branch Preview alias contract", () => {
  assert.equal(
    isReviewedWebsiteVercelPreviewOrigin(
      "https://mochirii-git-gallery-egress-mochirii.vercel.app",
    ),
    true,
  );
  for (const origin of [
    "https://reviewed-preview.vercel.app",
    "https://mochirii.vercel.app",
    "https://mochirii-mochirii.vercel.app",
    "https://mochirii-git-main-mochirii.vercel.app",
    "https://example-mochirii-preview.vercel.app",
    "http://mochirii-git-gallery-egress-mochirii.vercel.app",
  ]) {
    assert.equal(isReviewedWebsiteVercelPreviewOrigin(origin), false);
  }
});

test("blocks production matrices unless the exact process-scoped opt-in is present", () => {
  assert.throws(
    () => enforceProductionGalleryMatrixGuard({ baseUrl: siteOrigin, siteOrigin, environment: {} }),
    /Refusing a broad gallery\/browser matrix/,
  );
  assert.throws(
    () => enforceProductionGalleryMatrixGuard({
      baseUrl: siteOrigin,
      siteOrigin,
      environment: { [LIVE_GALLERY_MEDIA_SMOKE_OPT_IN]: "TRUE" },
    }),
    /Refusing a broad gallery\/browser matrix/,
  );
  assert.doesNotThrow(() => enforceProductionGalleryMatrixGuard({
    baseUrl: siteOrigin,
    siteOrigin,
    environment: { [LIVE_GALLERY_MEDIA_SMOKE_OPT_IN]: "true" },
  }));
});

test("allows fixture-based local and Preview matrices without an opt-in", () => {
  for (const baseUrl of [
    "http://127.0.0.1:8765",
    "http://localhost:8765",
    "https://mochirii-git-gallery-egress-mochirii.vercel.app",
  ]) {
    assert.doesNotThrow(() => enforceProductionGalleryMatrixGuard({
      baseUrl,
      siteOrigin,
      environment: {},
    }));
  }
});

test("resolves only exact local, reviewed Preview, or approved production Gallery audits", () => {
  assert.equal(resolveGalleryAuditUrl({
    baseUrl: "http://127.0.0.1:8765",
    siteOrigin,
    environment: {},
  }), "http://127.0.0.1:8765/gallery");
  assert.equal(resolveGalleryAuditUrl({
    baseUrl: "https://mochirii-git-gallery-egress-mochirii.vercel.app",
    siteOrigin,
    environment: {},
  }), "https://mochirii-git-gallery-egress-mochirii.vercel.app/gallery");
  assert.equal(resolveGalleryAuditUrl({
    baseUrl: siteOrigin,
    siteOrigin,
    environment: { [LIVE_GALLERY_MEDIA_SMOKE_OPT_IN]: "true" },
  }), `${siteOrigin}/gallery`);

  for (const baseUrl of [
    "https://example.com",
    "https://reviewed-preview.vercel.app",
    "https://mochirii-git-main-mochirii.vercel.app",
    "http://127.0.0.1:3000",
    "https://mochirii-git-gallery-egress-mochirii.vercel.app/not-an-origin",
    "https://user:password@mochirii-git-gallery-egress-mochirii.vercel.app",
  ]) {
    assert.throws(
      () => resolveGalleryAuditUrl({ baseUrl, siteOrigin, environment: {} }),
      /Gallery Lighthouse (?:origin|audits)|Refusing a broad gallery\/browser matrix/,
    );
  }
  assert.throws(
    () => resolveGalleryAuditUrl({ baseUrl: siteOrigin, siteOrigin, environment: {} }),
    /Refusing a broad gallery\/browser matrix/,
  );
});

test("manual Lighthouse defaults Gallery to local and preserves the one-shot production gate", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/manual-lighthouse.yml", import.meta.url),
    "utf8",
  );
  const resolver = await readFile(
    new URL("../resolve-gallery-lighthouse-url.mjs", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /gallery_origin:[\s\S]*default: http:\/\/127\.0\.0\.1:8765/);
  assert.match(workflow, /allow_live_gallery_media_smoke_once:[\s\S]*default: false/);
  assert.match(
    workflow,
    /MOCHIRII_ALLOW_LIVE_GALLERY_MEDIA_SMOKE_ONCE: \$\{\{ inputs\.allow_live_gallery_media_smoke_once \}\}/,
  );
  assert.match(workflow, /node scripts\/resolve-gallery-lighthouse-url\.mjs/);
  assert.match(workflow, /npx lighthouse "\$GALLERY_AUDIT_URL"/);
  assert.doesNotMatch(workflow, /https:\/\/mochirii\.com\/gallery/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.match(resolver, /resolveGalleryAuditUrl/);
  assert.doesNotMatch(resolver, /\bfetch\s*\(/);
});

test("all broad gallery/browser entrypoints enforce the shared guard", async () => {
  const entrypoints = [
    new URL("../smoke-gallery-lightbox.mjs", import.meta.url),
    new URL("../smoke-gallery-approved-feed.mjs", import.meta.url),
    new URL("../check-browser-route-matrix.mjs", import.meta.url),
  ];

  for (const entrypoint of entrypoints) {
    const source = await readFile(entrypoint, "utf8");
    assert.match(source, /enforceProductionGalleryMatrixGuard\(\{ baseUrl, siteOrigin: SITE_ORIGIN \}\)/);
  }
});
