import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  enforceProductionGalleryMatrixGuard,
  isProductionWebsiteOrigin,
  isReviewedWebsiteVercelPreviewOrigin,
  LIVE_GALLERY_MEDIA_SMOKE_OPT_IN,
  resolveGalleryAuditTarget,
} from "./live-gallery-media-smoke-guard.mjs";

const siteOrigin = "https://mochirii.com";

test("recognizes only the canonical production Website origins", () => {
  assert.equal(isProductionWebsiteOrigin("https://mochirii.com/gallery", siteOrigin), true);
  assert.equal(isProductionWebsiteOrigin("https://www.mochirii.com/gallery", siteOrigin), true);
  assert.equal(isProductionWebsiteOrigin("http://127.0.0.1:8765/gallery", siteOrigin), false);
  assert.equal(isProductionWebsiteOrigin("http://localhost:8765/gallery", siteOrigin), false);
  assert.equal(isProductionWebsiteOrigin("https://mochirii-git-gallery-egress-mochirii.vercel.app/gallery", siteOrigin), false);
});

test("recognizes only immutable Mōchirīī Vercel deployment origins", () => {
  assert.equal(
    isReviewedWebsiteVercelPreviewOrigin(
      "https://mochirii-abc123def-mochirii.vercel.app",
    ),
    true,
  );
  for (const origin of [
    "https://reviewed-preview.vercel.app",
    "https://mochirii.vercel.app",
    "https://mochirii-mochirii.vercel.app",
    "https://mochirii-short-mochirii.vercel.app",
    "https://mochirii-git-main-mochirii.vercel.app",
    "https://mochirii-git-gallery-egress-mochirii.vercel.app",
    "https://example-mochirii-preview.vercel.app",
    "http://mochirii-abc123def-mochirii.vercel.app",
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
    "https://mochirii-abc123def-mochirii.vercel.app",
  ]) {
    assert.doesNotThrow(() => enforceProductionGalleryMatrixGuard({
      baseUrl,
      siteOrigin,
      environment: {},
    }));
  }
});

test("resolves exact local, immutable Preview, and production audit targets", () => {
  assert.deepEqual(resolveGalleryAuditTarget({
    baseUrl: "http://127.0.0.1:8765",
    siteOrigin,
    environment: {},
  }), {
    kind: "local",
    normalizedOrigin: "http://127.0.0.1:8765",
    url: "http://127.0.0.1:8765/gallery",
  });
  assert.deepEqual(resolveGalleryAuditTarget({
    baseUrl: "http://localhost:8765/",
    siteOrigin,
    environment: {},
  }), {
    kind: "local",
    normalizedOrigin: "http://127.0.0.1:8765",
    url: "http://127.0.0.1:8765/gallery",
  });
  assert.deepEqual(resolveGalleryAuditTarget({
    baseUrl: "https://mochirii-abc123def-mochirii.vercel.app",
    siteOrigin,
    environment: { [LIVE_GALLERY_MEDIA_SMOKE_OPT_IN]: "true" },
  }), {
    kind: "preview",
    normalizedOrigin: "https://mochirii-abc123def-mochirii.vercel.app",
    url: "https://mochirii-abc123def-mochirii.vercel.app/gallery",
  });
  assert.deepEqual(resolveGalleryAuditTarget({
    baseUrl: siteOrigin,
    siteOrigin,
    environment: { [LIVE_GALLERY_MEDIA_SMOKE_OPT_IN]: "true" },
  }), {
    kind: "production",
    normalizedOrigin: siteOrigin,
    url: `${siteOrigin}/gallery`,
  });

  for (const baseUrl of [
    "https://mochirii-abc123def-mochirii.vercel.app",
    siteOrigin,
  ]) {
    assert.throws(
      () => resolveGalleryAuditTarget({ baseUrl, siteOrigin, environment: {} }),
      /Refusing a live Gallery Lighthouse audit/,
    );
    assert.throws(
      () => resolveGalleryAuditTarget({
        baseUrl,
        siteOrigin,
        environment: { [LIVE_GALLERY_MEDIA_SMOKE_OPT_IN]: "TRUE" },
      }),
      /Refusing a live Gallery Lighthouse audit/,
    );
  }
});

test("rejects ambiguous, credentialed, path-bearing, and alternate local audit targets", () => {
  for (const baseUrl of [
    "https://example.com",
    "https://reviewed-preview.vercel.app",
    "https://mochirii-git-main-mochirii.vercel.app",
    "http://127.0.0.1:3000",
    "https://127.0.0.1:8765",
    "http://localhost:8765/not-an-origin",
    "http://localhost:8765/?query=1",
    "http://localhost:8765/#fragment",
    "http://user:password@localhost:8765",
  ]) {
    assert.throws(
      () => resolveGalleryAuditTarget({ baseUrl, siteOrigin, environment: {} }),
      /Gallery Lighthouse/,
    );
  }
});

test("manual Lighthouse keeps its deterministic local intercept outside production code", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/manual-lighthouse.yml", import.meta.url),
    "utf8",
  );
  const resolver = await readFile(
    new URL("../resolve-gallery-lighthouse-url.mjs", import.meta.url),
    "utf8",
  );
  const nextConfig = await readFile(
    new URL("../../apps/web/next.config.ts", import.meta.url),
    "utf8",
  );
  const approvedFeed = await readFile(
    new URL("../../apps/web/lib/gallery/approved-feed.ts", import.meta.url),
    "utf8",
  );
  const fixture = await readFile(
    new URL("../gallery-lighthouse-local-fixture.mjs", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /gallery_origin:[\s\S]*default: http:\/\/127\.0\.0\.1:8765/);
  assert.match(workflow, /allow_live_gallery_media_smoke_once:[\s\S]*default: false/);
  assert.match(
    workflow,
    /MOCHIRII_ALLOW_LIVE_GALLERY_MEDIA_SMOKE_ONCE: \$\{\{ inputs\.allow_live_gallery_media_smoke_once \}\}/,
  );
  assert.match(workflow, /node scripts\/resolve-gallery-lighthouse-url\.mjs/);
  assert.match(workflow, /npm ci --prefix apps\/web/);
  assert.match(workflow, /steps\.gallery-target\.outputs\.kind == 'local'/);
  assert.match(workflow, /GALLERY_AUDIT_KIND: \$\{\{ steps\.gallery-target\.outputs\.kind \}\}/);
  assert.match(workflow, /GALLERY_AUDIT_ORIGIN: \$\{\{ steps\.gallery-target\.outputs\.normalized_origin \}\}/);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_MOCHIRII_GALLERY_AUDIT_MODE/);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(workflow, /npm --prefix apps\/web run start -- --hostname 127\.0\.0\.1 --port 8766/);
  assert.match(workflow, /gallery-lighthouse-local-fixture\.mjs serve/);
  assert.match(workflow, /http:\/\/127\.0\.0\.1:8766 8765/);
  assert.match(workflow, /gallery-lighthouse-local-fixture\.mjs verify/);
  assert.match(workflow, /--disable-background-networking/);
  assert.match(workflow, /--host-resolver-rules=/);
  assert.match(workflow, /lighthouse "\$GALLERY_AUDIT_ORIGIN\/"/);
  assert.match(workflow, /lighthouse "\$GALLERY_AUDIT_ORIGIN\/recruitment"/);
  assert.match(workflow, /\.\/node_modules\/\.bin\/lighthouse "\$GALLERY_AUDIT_URL"/);
  assert.doesNotMatch(workflow, /https:\/\/mochirii\.com/);
  assert.doesNotMatch(workflow, /\bnpx\s+lighthouse\b/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.match(resolver, /resolveGalleryAuditTarget/);
  assert.doesNotMatch(resolver, /\bfetch\s*\(/);
  assert.doesNotMatch(nextConfig, /localGalleryAuditFixture/);
  assert.doesNotMatch(nextConfig, /127\.0\.0\.1/);
  assert.doesNotMatch(approvedFeed, /NEXT_PUBLIC_MOCHIRII_GALLERY_AUDIT_MODE/);
  assert.doesNotMatch(approvedFeed, /local-fixture-v1/);
  assert.doesNotMatch(approvedFeed, /127\.0\.0\.1/);
  assert.match(fixture, /data-mochirii-gallery-audit-interceptor/);
  assert.match(fixture, /const fixturePath = "\/__mochirii_gallery_lighthouse_fixture"/);
  assert.match(fixture, /proxyToNext/);
  assert.match(fixture, /u\.href===t&&m==="POST"/);
  assert.match(fixture, /zero hosted\/provider HTTP requests/);
  assert.match(fixture, /supabase/);
  assert.match(fixture, /parsed\.action === "list" && parsed\.pageSize === 24/);
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
