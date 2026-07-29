import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { enforceProductionGalleryMatrixGuard } from "./lib/live-gallery-media-smoke-guard.mjs";
import { SITE_ORIGIN, SUPABASE_PROJECT_URL } from "./lib/public-urls.mjs";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8765";
enforceProductionGalleryMatrixGuard({ baseUrl, siteOrigin: SITE_ORIGIN });
const screenshotDirectory = path.resolve(
  process.env.SMOKE_SCREENSHOT_DIR || ".artifacts/operations/universal-lightbox",
);

const viewportMatrix = [
  { label: "400-percent short-height stress", width: 320, height: 256 },
  { label: "320px reflow", width: 320, height: 568 },
  { label: "compact Android portrait", width: 360, height: 800 },
  { label: "compact iPhone portrait", width: 375, height: 812 },
  { label: "modern iPhone portrait", width: 390, height: 844 },
  { label: "modern iPhone alternate", width: 393, height: 852 },
  { label: "large Android portrait", width: 412, height: 915 },
  { label: "large phone portrait", width: 430, height: 932 },
  { label: "200-percent reflow", width: 640, height: 360 },
  { label: "phone landscape", width: 844, height: 390 },
  { label: "tablet portrait", width: 768, height: 1024 },
  { label: "tablet landscape", width: 1024, height: 768 },
  { label: "compact desktop", width: 1280, height: 720 },
  { label: "common laptop", width: 1366, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
  { label: "large laptop", width: 1536, height: 864 },
  { label: "full HD desktop", width: 1920, height: 1080 },
  { label: "ultrawide desktop", width: 2560, height: 1080 },
  { label: "QHD desktop", width: 2560, height: 1440 },
];

const crossEngineViewportLabels = new Set([
  "400-percent short-height stress",
  "modern iPhone portrait",
  "phone landscape",
  "tablet portrait",
  "desktop",
  "ultrawide desktop",
]);
const interactionViewportLabels = new Set(["modern iPhone portrait", "desktop"]);
const syntheticShapeViewportLabels = new Set([
  "400-percent short-height stress",
  "320px reflow",
  "phone landscape",
  "desktop",
]);
const longCaptionViewportLabels = new Set([
  "400-percent short-height stress",
  "320px reflow",
]);
const screenshotViewportLabels = new Set([
  "modern iPhone portrait",
  "phone landscape",
  "desktop",
  "QHD desktop",
]);
const touchViewports = viewportMatrix.filter(({ label }) =>
  ["modern iPhone portrait", "phone landscape"].includes(label),
);
const syntheticSafeAreaViewport = { label: "synthetic notched phone landscape", width: 844, height: 390 };
const syntheticSafeAreaCases = [
  { label: "notch left", top: 18, right: 21, bottom: 21, left: 59 },
  { label: "notch right", top: 18, right: 59, bottom: 21, left: 21 },
];

const surfaces = [
  {
    key: "home",
    label: "Home Screenshot Spotlight",
    path: "/",
    trigger: "#galleryGrid .home-thumb",
    minimumTriggers: 4,
    dialog: "#modalRoot",
    shell: "#modalRoot .lightbox-shell",
    card: "#modalRoot .lightbox-card",
    media: "#modalRoot .lightbox-media",
    image: "#modalImage",
    preview: "#modalRoot .lightbox-img--preview",
    status: "#modalRoot .lightbox-image-status",
    caption: "#modalCaption",
    close: "#modalClose",
    backdrop: "#modalBackdrop",
  },
  {
    key: "gallery",
    label: "Gallery",
    path: "/gallery?sort=newest",
    trigger: "#galleryGrid .gallery-thumb",
    minimumTriggers: 1,
    dialog: "#lightbox",
    shell: "#lightbox .lightbox-shell",
    card: "#lightbox .lightbox-card",
    media: "#lightbox .lightbox-media",
    image: "#lightboxImg",
    preview: "#lightbox .lightbox-img--preview",
    status: "#lightbox .lightbox-image-status",
    caption: "#lightboxCaption",
    close: "#lightboxClose",
    backdrop: "#lightboxBackdrop",
  },
];

const geometryTolerance = 1.5;
const triggerMarker = "data-lightbox-smoke-trigger";
const vercelAnalyticsScriptPaths = new Set([
  "/_vercel/insights/script.js",
  "/_vercel/speed-insights/script.js",
]);
const approvedGalleryFeedFixturePattern = "**/functions/v1/list-approved-gallery-submissions*";
const approvedGalleryFixtureId = "11111111-1111-4111-8111-111111111111";
const approvedGalleryThumbnailUrl = `${SUPABASE_PROJECT_URL}/functions/v1/list-approved-gallery-submissions?asset=thumbnail&id=${approvedGalleryFixtureId}`;
const approvedGalleryFullUrl = `${SUPABASE_PROJECT_URL}/functions/v1/list-approved-gallery-submissions?asset=full&id=${approvedGalleryFixtureId}`;
const approvedGalleryThumbnailBody = await readFile(new URL("../apps/web/public/assets/img/gallery/thumbs/shot-05.webp", import.meta.url));
const approvedGalleryFullBody = await readFile(new URL("../apps/web/public/assets/img/gallery/shot-05.webp", import.meta.url));
const approvedGalleryFixtureFacets = {
  "member-submissions": 1,
  portraits: 1,
  gatherings: 0,
  action: 0,
  scenery: 0,
  companions: 0,
};
const approvedGalleryFixtureHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error("Playwright is required for this smoke test.");
  console.error("Install the locked dependencies and run npm run setup:playwright.");
  process.exit(1);
}

const engines = [
  { key: "chromium", label: "Chromium", launcher: playwright.chromium, fullMatrix: true },
  { key: "firefox", label: "Firefox", launcher: playwright.firefox, fullMatrix: false },
  { key: "webkit", label: "WebKit", launcher: playwright.webkit, fullMatrix: false },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function within(value, minimum, maximum, tolerance = geometryTolerance) {
  return value >= minimum - tolerance && value <= maximum + tolerance;
}

function engineViewports(engine) {
  return engine.fullMatrix
    ? viewportMatrix
    : viewportMatrix.filter(({ label }) => crossEngineViewportLabels.has(label));
}

function viewportSize({ width, height }) {
  return { width, height };
}

async function stubVercelAnalyticsScripts(context, appBaseUrl = baseUrl) {
  const appOrigin = new URL(appBaseUrl).origin;
  await context.route(
    (url) => url.origin === appOrigin && vercelAnalyticsScriptPaths.has(url.pathname),
    (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
}

async function stubEmptyApprovedGalleryFeed(context) {
  await context.route(approvedGalleryFeedFixturePattern, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: approvedGalleryFixtureHeaders, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: approvedGalleryFixtureHeaders,
      body: JSON.stringify({
        ok: true,
        data: {
          schemaVersion: 2,
          items: [],
          count: 0,
          totalEligible: 0,
          facets: Object.fromEntries(Object.keys(approvedGalleryFixtureFacets).map((key) => [key, 0])),
          hasMore: false,
          nextCursor: null,
          partial: false,
          complete: true,
          deliveryFailures: 0,
          delivery: "bounded-edge-media",
          cacheSeconds: 15,
        },
        message: "Deterministic universal-lightbox smoke fixture.",
      }),
    });
  });
}

async function stubApprovedGalleryFeedSuccess(context, requests) {
  await context.route(approvedGalleryFeedFixturePattern, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: approvedGalleryFixtureHeaders, body: "" });
      return;
    }

    if (request.method() === "GET") {
      const url = new URL(request.url());
      const asset = url.searchParams.get("asset");
      assert(
        url.origin === SUPABASE_PROJECT_URL
          && url.pathname === "/functions/v1/list-approved-gallery-submissions"
          && [...url.searchParams.keys()].sort().join(",") === "asset,id"
          && url.searchParams.get("id") === approvedGalleryFixtureId
          && (asset === "full" || asset === "thumbnail"),
        "Schema-v2 Gallery media request drifted from the exact bounded Edge URL.",
      );
      requests.push({ action: asset, id: approvedGalleryFixtureId, method: "GET" });
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        headers: {
          "cache-control": "private, max-age=300, stale-while-revalidate=60",
          "x-content-type-options": "nosniff",
        },
        body: asset === "thumbnail" ? approvedGalleryThumbnailBody : approvedGalleryFullBody,
      });
      return;
    }

    assert(request.method() === "POST", `Schema-v2 Gallery fixture received ${request.method()}.`);
    let body;
    try {
      body = JSON.parse(request.postData() || "null");
    } catch {
      throw new Error("Schema-v2 Gallery request body was not valid JSON.");
    }
    assert(body && typeof body === "object" && !Array.isArray(body), "Schema-v2 Gallery request body was not an object.");
    requests.push(body);

    assert(
      JSON.stringify(Object.keys(body).sort())
        === JSON.stringify(["action", "category", "cursor", "pageSize", "query", "sort"]),
      "Schema-v2 Gallery list request shape drifted.",
    );
    assert(
      body.action === "list"
        && body.category === "member-submissions"
        && body.cursor === null
        && body.pageSize === 24
        && body.query === null
        && body.sort === "newest",
      "Schema-v2 Gallery list request context drifted.",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: approvedGalleryFixtureHeaders,
      body: JSON.stringify({
        ok: true,
        data: {
          schemaVersion: 2,
          items: [{
            id: approvedGalleryFixtureId,
            title: "Cross-browser approved Gallery fixture",
            caption: "A reviewed member image used only for browser verification.",
            category: "portraits",
            categories: ["member-submissions", "portraits"],
            mime_type: "image/webp",
            size_bytes: 27890,
            created_at: "2030-01-01T03:04:05.000Z",
            reviewed_at: "2030-01-01T04:04:05.000Z",
            thumbnail_url: approvedGalleryThumbnailUrl,
            thumbnail_size_bytes: 6626,
            thumbnail_width: 640,
            thumbnail_height: 400,
          }],
          count: 1,
          totalEligible: 1,
          facets: approvedGalleryFixtureFacets,
          hasMore: false,
          nextCursor: null,
          partial: false,
          complete: true,
          deliveryFailures: 0,
          delivery: "bounded-edge-media",
          cacheSeconds: 15,
        },
        message: "Member-submitted images loaded.",
      }),
    });
  });

  return { thumbnailUrl: approvedGalleryThumbnailUrl, fullUrl: approvedGalleryFullUrl };
}

function navigationBaseUrl(engine) {
  if (engine.key !== "webkit") return baseUrl;

  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return baseUrl;
  }

  url.protocol = "https:";
  return url.href.replace(/\/$/, "");
}

async function bridgeWebKitLocalHttps(context, secureBaseUrl) {
  if (secureBaseUrl === baseUrl) return;

  const secureOrigin = new URL(secureBaseUrl).origin;
  await context.route(`${secureOrigin}/**`, async (route) => {
    const localUrl = new URL(route.request().url());
    localUrl.protocol = "http:";
    const response = await route.fetch({ url: localUrl.href });
    await route.fulfill({ response });
  });
}

function watchBrowserErrors(page, surfaceLabel, engineLabel) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${surfaceLabel} page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${surfaceLabel} console error: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText || "unknown error";
    const appRouterPrefetchWasCanceled = request.method() === "GET"
      && request.resourceType() === "fetch"
      && url.host === new URL(baseUrl).host
      && url.searchParams.has("_rsc")
      && ["net::ERR_ABORTED", "NS_BINDING_ABORTED", "cancelled"].includes(failure);
    if (appRouterPrefetchWasCanceled) return;
    errors.push(
      `${surfaceLabel} failed request: ${request.method()} ${request.url()} (${failure})`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`${surfaceLabel} HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  });
  return () => {
    assert(errors.length === 0, `${engineLabel} browser errors:\n${errors.join("\n")}`);
  };
}

function normalizeAccessibleText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertComputedAccessibleName(page, locator, role, expectedName, context, exact = true) {
  assert(await locator.count() === 1, `${context}: expected one target element.`);
  assert(await locator.getAttribute("aria-label") === null, `${context}: aria-label must not override rendered content.`);

  const expected = normalizeAccessibleText(expectedName);
  const name = exact
    ? expected
    : new RegExp(escapeRegExp(expected).replace(/ /g, "\\s+"), "i");
  const namedLocator = locator.and(page.getByRole(role, { name, exact }));
  assert(await namedLocator.count() === 1, `${context}: computed accessible name did not match rendered content: ${expected}.`);
}

async function verifyAccessibleNames(page, surface) {
  if (surface.key === "gallery") {
    const filters = page.locator("#galleryFilters .gallery-filter");
    for (let index = 0; index < await filters.count(); index += 1) {
      const filter = filters.nth(index);
      await assertComputedAccessibleName(
        page,
        filter,
        "button",
        await filter.textContent(),
        `Gallery filter ${index + 1}`,
      );
    }
    return;
  }

  const brandName = "Mōchirīī Asia Pacific Guild";
  await assertComputedAccessibleName(
    page,
    page.locator("#site-header .header-wrap > .brand"),
    "link",
    brandName,
    "Desktop header brand",
  );
  await assertComputedAccessibleName(
    page,
    page.locator(".footer-brand-link"),
    "link",
    brandName,
    "Footer brand",
  );

  const featured = page.locator("#featuredBulletin");
  await assertComputedAccessibleName(
    page,
    featured,
    "link",
    await featured.innerText(),
    "Featured bulletin",
    false,
  );

  await page.locator("#menu-btn").click();
  await page.locator("#mobile-menu").waitFor({ state: "visible" });
  await assertComputedAccessibleName(
    page,
    page.locator("#mobile-menu .brand--mobile"),
    "link",
    brandName,
    "Mobile header brand",
  );
  await page.locator('#mobile-menu [aria-label="Close menu"]').click();
  await page.locator("#mobile-menu").waitFor({ state: "hidden" });
}

async function triggerSignature(page, surface) {
  return page.locator(surface.trigger).evaluateAll((elements) =>
    elements
      .map((element) => {
        const image = element.querySelector("img");
        return element.getAttribute("data-full") || image?.getAttribute("data-full") || "";
      })
      .join("|"),
  );
}

async function waitForStableTriggers(page, surface) {
  let previous = "";
  let stablePolls = 0;

  for (let poll = 0; poll < 60; poll += 1) {
    const signature = await triggerSignature(page, surface);
    if (signature && signature === previous) stablePolls += 1;
    else stablePolls = 0;

    if (stablePolls >= 3) return;
    previous = signature;
    await page.waitForTimeout(100);
  }

  throw new Error(`${surface.label}: trigger sources did not settle after hydration.`);
}

async function assertResponsiveThumbnailGeometry(page, surface, engineLabel, viewport) {
  const measurements = await page.locator(surface.trigger).evaluateAll((triggers) =>
    triggers.slice(0, 24).map((trigger) => {
      const media = trigger.querySelector(".responsive-gallery-media");
      const image = trigger.querySelector(".responsive-gallery-media__image");
      if (!(media instanceof HTMLElement) || !(image instanceof HTMLImageElement)) return null;

      const triggerRect = trigger.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const triggerStyle = getComputedStyle(trigger);
      const imageStyle = getComputedStyle(image);

      return {
        trigger: { width: triggerRect.width, height: triggerRect.height },
        border: {
          horizontal: (Number.parseFloat(triggerStyle.borderLeftWidth) || 0)
            + (Number.parseFloat(triggerStyle.borderRightWidth) || 0),
          vertical: (Number.parseFloat(triggerStyle.borderTopWidth) || 0)
            + (Number.parseFloat(triggerStyle.borderBottomWidth) || 0),
        },
        media: { width: mediaRect.width, height: mediaRect.height },
        image: { width: imageRect.width, height: imageRect.height },
        objectFit: imageStyle.objectFit,
      };
    }),
  );

  const context = `${engineLabel} ${surface.label} thumbnail grid at ${viewport.width}x${viewport.height}`;
  assert(measurements.length > 0, `${context}: no thumbnails were measured.`);
  assert(measurements.every(Boolean), `${context}: a trigger bypassed the shared responsive media component.`);

  for (const [index, measurement] of measurements.entries()) {
    const usableWidth = measurement.trigger.width - measurement.border.horizontal;
    const usableHeight = measurement.trigger.height - measurement.border.vertical;
    assert(measurement.trigger.width > 16 && measurement.trigger.height > 10, `${context}: trigger ${index + 1} collapsed.`);
    assert(
      Math.abs((measurement.trigger.width / measurement.trigger.height) - 1.6) <= 0.03,
      `${context}: trigger ${index + 1} did not preserve the 16:10 card ratio.`,
    );
    assert(
      Math.abs(measurement.media.width - usableWidth) <= geometryTolerance
        && Math.abs(measurement.media.height - usableHeight) <= geometryTolerance,
      `${context}: media ${index + 1} did not fill its trigger.`,
    );
    assert(
      measurement.image.width >= usableWidth - geometryTolerance
        && measurement.image.height >= usableHeight - geometryTolerance
        && measurement.image.width <= (usableWidth * 1.05) + geometryTolerance
        && measurement.image.height <= (usableHeight * 1.05) + geometryTolerance,
      `${context}: image ${index + 1} did not fill its trigger.`,
    );
    assert(measurement.objectFit === "cover", `${context}: image ${index + 1} does not use object-fit cover.`);
  }

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(pageOverflow <= geometryTolerance, `${context}: page has horizontal overflow.`);
}

async function selectLandscapeTriggerIndex(page, surface) {
  const triggers = page.locator(surface.trigger);
  const count = await triggers.count();

  for (let index = 0; index < count; index += 1) {
    const image = triggers.nth(index).locator("img").first();
    if (await image.count() === 0) continue;

    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => new Promise((resolve) => {
      if (element.complete && element.naturalWidth > 0) {
        resolve();
        return;
      }

      const finish = () => resolve();
      element.addEventListener("load", finish, { once: true });
      element.addEventListener("error", finish, { once: true });
      window.setTimeout(finish, 5_000);
    }));

    const dimensions = await image.evaluate((element) => ({
      width: element.naturalWidth,
      height: element.naturalHeight,
    }));
    if (dimensions.width > dimensions.height) return index;
  }

  throw new Error(`${surface.label}: no loaded live landscape image is available for the lightbox contract.`);
}

async function waitForImage(page, surface) {
  await page.waitForFunction(
    ({ imageSelector, mediaSelector }) => {
      const image = document.querySelector(imageSelector);
      const media = document.querySelector(mediaSelector);
      return image instanceof HTMLImageElement
        && image.complete
        && image.naturalWidth > 0
        && image.naturalHeight > 0
        && media?.getAttribute("data-image-state") === "ready";
    },
    { imageSelector: surface.image, mediaSelector: surface.media },
  );
  await page.locator(surface.image).evaluate(async (image) => {
    if (typeof image.decode === "function") await image.decode();
  });
}

async function waitForOpen(page, surface) {
  await page.waitForSelector(surface.dialog, { state: "visible" });
  await waitForImage(page, surface);
  await page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    surface.close,
  );
}

async function waitForProbeClosed(page, surface) {
  await page.waitForFunction(
    (selector) => {
      const dialog = document.querySelector(selector);
      return !dialog
        || dialog.hidden
        || dialog.getAttribute("aria-hidden") === "true"
        || getComputedStyle(dialog).display === "none";
    },
    surface.dialog,
  );
  await page.waitForFunction(
    () => document.body.style.overflow !== "hidden" && document.body.style.position !== "fixed",
  );
}

async function waitUntilInteractive(page, surface) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (await page.locator(surface.dialog).isVisible().catch(() => false)) {
      await waitForOpen(page, surface);
      await page.keyboard.press("Escape");
      await waitForProbeClosed(page, surface);
      return;
    }

    const trigger = page.locator(surface.trigger).first();
    await trigger.evaluate((element, marker) => element.setAttribute(marker, "true"), triggerMarker);
    await trigger.focus();
    await trigger.click();

    try {
      await page.waitForSelector(surface.dialog, { state: "visible", timeout: 2_000 });
      await waitForOpen(page, surface);
      await page.keyboard.press("Escape");
      await waitForProbeClosed(page, surface);
      return;
    } catch {
      await page.waitForTimeout(100);
    }
  }

  throw new Error(`${surface.label}: controls never became interactive after hydration.`);
}

async function prepareSurfacePage(context, surface, engineLabel, resolvedBaseUrl = baseUrl) {
  const page = await context.newPage();
  const assertNoBrowserErrors = watchBrowserErrors(page, surface.label, engineLabel);
  const approvedFeedRequest = surface.key === "gallery"
    ? page.waitForRequest((request) =>
        new URL(request.url()).pathname.endsWith("/functions/v1/list-approved-gallery-submissions"),
      )
    : null;
  await page.goto(`${resolvedBaseUrl}${surface.path}`, { waitUntil: "domcontentloaded" });
  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute("content");
  assert(
    viewportContent?.toLowerCase().split(",").map((value) => value.trim()).includes("viewport-fit=cover"),
    `${engineLabel} ${surface.label}: emitted viewport metadata is missing viewport-fit=cover.`,
  );
  if (approvedFeedRequest) await approvedFeedRequest;
  await page.waitForFunction(
    ({ selector, minimum }) => document.querySelectorAll(selector).length >= minimum,
    { selector: surface.trigger, minimum: surface.minimumTriggers },
  );
  await waitUntilInteractive(page, surface);
  await waitForStableTriggers(page, surface);
  await verifyAccessibleNames(page, surface);
  const triggerIndex = await selectLandscapeTriggerIndex(page, surface);
  return { page, surface, triggerIndex, assertNoBrowserErrors };
}

async function bodyState(page) {
  return page.evaluate(() => {
    const reference = document.querySelector(".site-header__inner") || document.querySelector("main .container");
    const referenceRect = reference?.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      paddingRight: document.body.style.paddingRight,
      computedPaddingRight: Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0,
      scrollbarWidth: Math.max(0, window.innerWidth - document.documentElement.clientWidth),
      modalManagedBackgroundCount: Array.from(document.body.children).filter((element) =>
        element.inert === true && element.getAttribute("aria-hidden") === "true"
      ).length,
      reference: referenceRect
        ? { left: referenceRect.left, right: referenceRect.right, width: referenceRect.width }
        : null,
    };
  });
}

async function assertScrollbarCompensation(page, before, context) {
  const after = await bodyState(page);
  const expectedPadding = before.scrollbarWidth > 0
    ? before.computedPaddingRight + before.scrollbarWidth
    : before.computedPaddingRight;
  assert(
    Math.abs(after.computedPaddingRight - expectedPadding) <= 1,
    `${context}: body padding did not compensate for the ${before.scrollbarWidth}px scrollbar.`,
  );
  if (before.reference && after.reference) {
    for (const field of ["left", "right", "width"]) {
      assert(
        Math.abs(after.reference[field] - before.reference[field]) <= 1.5,
        `${context}: page content shifted at ${field} while the lightbox locked scrolling.`,
      );
    }
  }
}

async function waitForScrollSettled(page) {
  let previous = await page.evaluate(() => window.scrollY);
  let stablePolls = 0;

  for (let poll = 0; poll < 40; poll += 1) {
    await page.waitForTimeout(50);
    const current = await page.evaluate(() => window.scrollY);
    if (Math.abs(current - previous) <= 0.5) stablePolls += 1;
    else stablePolls = 0;
    if (stablePolls >= 3) return;
    previous = current;
  }

  throw new Error("Page scroll did not settle before the lightbox opened.");
}

async function positionTriggerAtNonzeroScroll(page, surface, triggerIndex) {
  const target = await page.locator(surface.trigger).nth(triggerIndex).evaluate((trigger) => {
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    const rect = trigger.getBoundingClientRect();
    const absoluteCenter = window.scrollY + rect.top + rect.height / 2;
    const maximum = Math.max(0, root.scrollHeight - window.innerHeight);
    const next = Math.min(maximum, Math.max(1, absoluteCenter - window.innerHeight / 2));
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, next);
    root.style.scrollBehavior = previousScrollBehavior;
    return next;
  });

  assert(target > 0, `${surface.label}: page is not tall enough to exercise nonzero scroll restoration.`);
  await waitForScrollSettled(page);
}

async function selectedTriggerState(page, surface, triggerIndex = 0) {
  const trigger = page.locator(surface.trigger).nth(triggerIndex);
  await page.locator(`[${triggerMarker}]`).evaluateAll((elements, marker) => {
    elements.forEach((element) => element.removeAttribute(marker));
  }, triggerMarker);
  await trigger.evaluate((element, marker) => element.setAttribute(marker, "true"), triggerMarker);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await waitForScrollSettled(page);

  const source = await trigger.evaluate((element) => {
    const image = element.querySelector("img");
    const full = element.getAttribute("data-full") || image?.getAttribute("data-full") || "";
    const thumbnail = image?.getAttribute("src") || "";
    const resolve = (value) => value ? new URL(value, document.baseURI).href : "";
    return { full: resolve(full), thumbnail: resolve(thumbnail) };
  });

  assert(source.full, `${surface.label}: selected trigger is missing its full-image source.`);
  assert(source.thumbnail.includes("/thumbs/"), `${surface.label}: grid image is not a thumbnail.`);
  return { trigger, source, before: await bodyState(page) };
}

async function openFromTrigger(page, surface, method = "keyboard", triggerIndex = 0) {
  const state = await selectedTriggerState(page, surface, triggerIndex);

  if (method === "keyboard") await page.keyboard.press("Enter");
  else if (method === "touch") await state.trigger.tap();
  else await state.trigger.click();

  await waitForOpen(page, surface);
  await assertScrollbarCompensation(page, state.before, `${surface.label} scroll lock`);
  state.before.triggerScrollY = state.before.scrollY;
  state.before.scrollY = await page.evaluate(() => {
    const lockedTop = Number.parseFloat(document.body.style.top);
    return Number.isFinite(lockedTop) ? Math.abs(lockedTop) : window.scrollY;
  });
  return state;
}

async function waitForClosed(page, surface, before, context = surface.label) {
  const argumentsForPage = { selector: surface.dialog, marker: triggerMarker, previous: before };
  const readRestorationState = ({ selector, marker, previous }) => {
    const dialog = document.querySelector(selector);
    const style = document.body.style;
    const actualBody = {
      overflow: style.overflow,
      position: style.position,
      top: style.top,
      left: style.left,
      right: style.right,
      paddingRight: style.paddingRight,
    };
    const closed = !dialog
      || dialog.hidden
      || dialog.getAttribute("aria-hidden") === "true"
      || getComputedStyle(dialog).display === "none";
    const bodyRestored = Object.keys(actualBody).every((key) => actualBody[key] === previous[key]);
    const focusRestored = document.activeElement?.getAttribute(marker) === "true";
    const scrollRestored = Math.abs(window.scrollY - previous.scrollY) <= 1;
    const modalBackgroundRestored = Array.from(document.body.children).filter((element) =>
      element.inert === true && element.getAttribute("aria-hidden") === "true"
    ).length === previous.modalManagedBackgroundCount;
    return {
      ready: closed && bodyRestored && focusRestored && scrollRestored && modalBackgroundRestored,
      closed,
      bodyRestored,
      focusRestored,
      scrollRestored,
      modalBackgroundRestored,
      actualBody,
      expectedScrollY: previous.scrollY,
      actualScrollY: window.scrollY,
      activeElement: document.activeElement?.outerHTML || "",
    };
  };

  try {
    await page.waitForFunction(
      ({ selector, marker, previous }) => {
        const dialog = document.querySelector(selector);
        const style = document.body.style;
        const closed = !dialog
          || dialog.hidden
          || dialog.getAttribute("aria-hidden") === "true"
          || getComputedStyle(dialog).display === "none";
        const bodyRestored = style.overflow === previous.overflow
          && style.position === previous.position
          && style.top === previous.top
          && style.left === previous.left
          && style.right === previous.right
          && style.paddingRight === previous.paddingRight;
        const focusRestored = document.activeElement?.getAttribute(marker) === "true";
        const scrollRestored = Math.abs(window.scrollY - previous.scrollY) <= 1;
        const modalBackgroundRestored = Array.from(document.body.children).filter((element) =>
          element.inert === true && element.getAttribute("aria-hidden") === "true"
        ).length === previous.modalManagedBackgroundCount;
        return closed && bodyRestored && focusRestored && scrollRestored && modalBackgroundRestored;
      },
      argumentsForPage,
    );
  } catch (error) {
    const state = await page.evaluate(readRestorationState, argumentsForPage);
    throw new Error(`${context}: close restoration timed out: ${JSON.stringify(state)}. ${error.message}`);
  }
}

async function measure(page, surface) {
  return page.evaluate((selectors) => {
    const dialog = document.querySelector(selectors.dialog);
    const shell = document.querySelector(selectors.shell);
    const card = document.querySelector(selectors.card);
    const image = document.querySelector(selectors.image);
    const caption = document.querySelector(selectors.caption);
    const close = document.querySelector(selectors.close);

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };

    const dialogStyle = getComputedStyle(dialog);
    const shellStyle = getComputedStyle(shell);
    const cardStyle = getComputedStyle(card);
    const imageStyle = getComputedStyle(image);
    const closeStyle = getComputedStyle(close);
    const backgroundSiblings = Array.from(document.body.children).filter((element) => element !== dialog);

    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialog: rect(dialog),
      card: {
        ...rect(card),
        clientWidth: card.clientWidth,
        clientHeight: card.clientHeight,
        scrollWidth: card.scrollWidth,
        scrollHeight: card.scrollHeight,
        padding: {
          top: Number.parseFloat(cardStyle.paddingTop) || 0,
          right: Number.parseFloat(cardStyle.paddingRight) || 0,
          bottom: Number.parseFloat(cardStyle.paddingBottom) || 0,
          left: Number.parseFloat(cardStyle.paddingLeft) || 0,
        },
      },
      image: rect(image),
      caption: {
        ...rect(caption),
        clientWidth: caption.clientWidth,
        scrollWidth: caption.scrollWidth,
      },
      close: rect(close),
      natural: { width: image.naturalWidth, height: image.naturalHeight },
      semantics: {
        role: dialog.getAttribute("role"),
        ariaModal: dialog.getAttribute("aria-modal"),
        backgroundSiblingCount: backgroundSiblings.length,
        backgroundInert: backgroundSiblings.every((element) => element.inert === true),
        backgroundAriaHidden: backgroundSiblings.every((element) => element.getAttribute("aria-hidden") === "true"),
      },
      contract: {
        dialogPadding: [
          dialogStyle.paddingTop,
          dialogStyle.paddingRight,
          dialogStyle.paddingBottom,
          dialogStyle.paddingLeft,
        ],
        shellPadding: [
          shellStyle.paddingTop,
          shellStyle.paddingRight,
          shellStyle.paddingBottom,
          shellStyle.paddingLeft,
        ],
        cardMaxWidth: cardStyle.maxWidth,
        cardMaxHeight: cardStyle.maxHeight,
        cardOverflowX: cardStyle.overflowX,
        cardOverflowY: cardStyle.overflowY,
        cardOverscrollBehavior: cardStyle.getPropertyValue("overscroll-behavior"),
        cardOverscrollBehaviorSupported: CSS.supports("overscroll-behavior", "contain"),
        imageMaxWidth: imageStyle.maxWidth,
        imageMaxHeight: imageStyle.maxHeight,
        imageObjectFit: imageStyle.objectFit,
        imageFlexShrink: imageStyle.flexShrink,
        closeWidth: closeStyle.width,
        closeHeight: closeStyle.height,
      },
      body: {
        overflow: getComputedStyle(document.body).overflow,
        position: document.body.style.position,
      },
      pageScrollWidth: document.documentElement.scrollWidth,
      imageSource: image.currentSrc || image.src || "",
    };
  }, surface);
}

function assertGeometry(engineLabel, surface, viewport, state) {
  const context = `${engineLabel} ${surface.label} at ${viewport.width}x${viewport.height}`;
  const { card, caption, close, dialog, image, natural, contract } = state;

  assert(Math.abs(dialog.left) <= geometryTolerance, `${context}: overlay does not start at the left viewport edge.`);
  assert(Math.abs(dialog.top) <= geometryTolerance, `${context}: overlay does not start at the top viewport edge.`);
  assert(Math.abs(dialog.width - viewport.width) <= geometryTolerance, `${context}: overlay width differs from the viewport.`);
  assert(Math.abs(dialog.height - viewport.height) <= geometryTolerance, `${context}: overlay height differs from the viewport.`);

  assert(within(card.left, 0, viewport.width), `${context}: card starts outside the viewport.`);
  assert(within(card.right, 0, viewport.width), `${context}: card ends outside the viewport.`);
  assert(within(card.top, 0, viewport.height), `${context}: card starts outside the viewport height.`);
  assert(within(card.bottom, 0, viewport.height), `${context}: card ends outside the viewport height.`);
  assert(card.width <= 1160 + geometryTolerance, `${context}: card exceeded the 1160px cap.`);
  assert(card.scrollWidth <= card.clientWidth + geometryTolerance, `${context}: card has horizontal overflow.`);

  assert(image.width > 0 && image.height > 0, `${context}: image collapsed to zero size.`);
  assert(within(image.left, card.left, card.right), `${context}: image starts outside the card.`);
  assert(within(image.right, card.left, card.right), `${context}: image ends outside the card.`);
  assert(within(image.top, card.top, card.bottom), `${context}: image starts outside the card height.`);
  assert(within(image.bottom, card.top, card.bottom), `${context}: image ends outside the card height.`);
  assert(contract.imageObjectFit === "contain", `${context}: expected object-fit contain.`);
  assert(contract.imageFlexShrink === "0", `${context}: image is allowed to collapse under flex pressure.`);
  assert(contract.cardOverflowX === "hidden", `${context}: horizontal card overflow is not contained.`);
  assert(contract.cardOverflowY === "auto", `${context}: vertical card overflow is not scrollable.`);
  assert(
    !contract.cardOverscrollBehaviorSupported || contract.cardOverscrollBehavior.includes("contain"),
    `${context}: card overscroll is not contained in an engine that supports overscroll-behavior.`,
  );
  assert(contract.cardMaxWidth === "100%", `${context}: expected card max-width 100%.`);
  assert(contract.imageMaxWidth === "100%", `${context}: expected image max-width 100%.`);

  const renderedRatio = image.width / image.height;
  const naturalRatio = natural.width / natural.height;
  assert(
    Math.abs(renderedRatio - naturalRatio) / naturalRatio < 0.005,
    `${context}: rendered ratio ${renderedRatio.toFixed(4)} differs from natural ratio ${naturalRatio.toFixed(4)}.`,
  );

  const availableWidth = card.clientWidth - card.padding.left - card.padding.right;
  const imageMaxHeight = Number.parseFloat(contract.imageMaxHeight);
  assert(Number.isFinite(imageMaxHeight), `${context}: image max-height did not resolve to pixels.`);
  const expectedScale = Math.min(1, availableWidth / natural.width, imageMaxHeight / natural.height);
  const expectedWidth = natural.width * expectedScale;
  const expectedHeight = natural.height * expectedScale;
  assert(
    Math.abs(image.width - expectedWidth) <= 2.5 && Math.abs(image.height - expectedHeight) <= 2.5,
    `${context}: image did not reach its intended contain size (${image.width.toFixed(1)}x${image.height.toFixed(1)} vs ${expectedWidth.toFixed(1)}x${expectedHeight.toFixed(1)}).`,
  );

  assert(caption.scrollWidth <= caption.clientWidth + geometryTolerance, `${context}: caption has horizontal overflow.`);
  assert(within(caption.left, card.left, card.right), `${context}: caption starts outside the card.`);
  assert(within(caption.right, card.left, card.right), `${context}: caption ends outside the card.`);
  assert(
    close.width >= 44 - geometryTolerance && close.height >= 44 - geometryTolerance,
    `${context}: close target is smaller than the 44x44px CSS contract (${close.width.toFixed(2)}x${close.height.toFixed(2)}).`,
  );
  assert(within(close.left, 0, viewport.width), `${context}: close target starts outside the viewport.`);
  assert(within(close.right, 0, viewport.width), `${context}: close target ends outside the viewport.`);
  assert(within(close.top, 0, viewport.height), `${context}: close target starts outside the viewport height.`);
  assert(within(close.bottom, 0, viewport.height), `${context}: close target ends outside the viewport height.`);
  const overlapWidth = Math.max(0, Math.min(close.right, image.right) - Math.max(close.left, image.left));
  const overlapHeight = Math.max(0, Math.min(close.bottom, image.bottom) - Math.max(close.top, image.top));
  assert(overlapWidth * overlapHeight <= 0.5, `${context}: close target overlaps the image.`);
  assert(state.semantics.role === "dialog", `${context}: dialog role is missing.`);
  assert(state.semantics.ariaModal === "true", `${context}: aria-modal is not true.`);
  assert(state.semantics.backgroundSiblingCount > 0, `${context}: no modal background siblings were found.`);
  assert(state.semantics.backgroundInert, `${context}: modal background content is not inert.`);
  assert(state.semantics.backgroundAriaHidden, `${context}: modal background content is not hidden from assistive technology.`);
  assert(state.body.overflow === "hidden", `${context}: body scroll was not locked.`);
  assert(state.body.position === "fixed", `${context}: body position was not fixed during scroll lock.`);
  assert(state.pageScrollWidth <= viewport.width + geometryTolerance, `${context}: page has horizontal overflow.`);
}

async function assertCaptionReachable(page, surface, context) {
  const result = await page.evaluate(({ cardSelector, captionSelector }) => {
    const card = document.querySelector(cardSelector);
    const caption = document.querySelector(captionSelector);

    card.scrollTop = 0;
    const initialCardRect = card.getBoundingClientRect();
    const initialCaptionRect = caption.getBoundingClientRect();
    card.scrollTop = Math.max(0, initialCaptionRect.top - initialCardRect.top);
    const startCardRect = card.getBoundingClientRect();
    const startCaptionRect = caption.getBoundingClientRect();
    const startReachable = startCaptionRect.top >= startCardRect.top - 1
      && startCaptionRect.top <= startCardRect.bottom + 1;

    card.scrollTop = card.scrollHeight;
    const endCardRect = card.getBoundingClientRect();
    const endCaptionRect = caption.getBoundingClientRect();
    const endReachable = endCaptionRect.bottom <= endCardRect.bottom + 1
      && endCaptionRect.bottom >= endCardRect.top - 1;
    card.scrollTop = 0;
    return {
      reachable: startReachable && endReachable,
      startReachable,
      endReachable,
      clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight,
    };
  }, { cardSelector: surface.card, captionSelector: surface.caption });

  assert(
    result.reachable,
    `${context}: caption cannot be reached by vertical scrolling (start=${result.startReachable}, end=${result.endReachable}).`,
  );
  return result;
}

async function assertKeyboardCaptionScroll(page, surface, context) {
  const card = page.locator(surface.card);
  await card.evaluate((element) => {
    element.scrollTop = 0;
  });
  await card.focus();
  assert(
    await card.evaluate((element) => document.activeElement === element),
    `${context}: scrollable image card is not keyboard focusable.`,
  );

  await page.keyboard.press("PageDown");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.scrollTop > 0,
    surface.card,
  );
  const pageDownScrollTop = await card.evaluate((element) => element.scrollTop);
  assert(pageDownScrollTop > 0, `${context}: PageDown did not scroll the focused image card.`);

  await page.keyboard.press("End");
  await page.waitForFunction(
    (selector) => {
      const element = document.querySelector(selector);
      return element && element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
    },
    surface.card,
  );
  const endState = await card.evaluate((element) => ({
    scrollTop: element.scrollTop,
    maximum: element.scrollHeight - element.clientHeight,
  }));
  assert(
    endState.scrollTop >= endState.maximum - 2,
    `${context}: End did not make the full caption keyboard reachable.`,
  );
}

function assertSameContract(engineLabel, viewport, homeState, galleryState) {
  const context = `${engineLabel} at ${viewport.width}x${viewport.height}`;
  assert(
    Math.abs(homeState.card.width - galleryState.card.width) <= geometryTolerance,
    `${context}: Home and Gallery card widths diverged (${homeState.card.width}px vs ${galleryState.card.width}px).`,
  );

  for (const property of Object.keys(homeState.contract)) {
    const homeValue = JSON.stringify(homeState.contract[property]);
    const galleryValue = JSON.stringify(galleryState.contract[property]);
    assert(homeValue === galleryValue, `${context}: shared ${property} contract diverged (${homeValue} vs ${galleryValue}).`);
  }
}

function syntheticImageSource(width, height) {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#203040"/></svg>`,
  )}`;
}

async function setSyntheticImage(page, surface, width, height) {
  const source = syntheticImageSource(width, height);
  await page.locator(surface.image).evaluate((image, nextSource) => {
    image.src = nextSource;
  }, source);
  await page.waitForFunction(
    ({ selector, expectedWidth, expectedHeight }) => {
      const image = document.querySelector(selector);
      return image instanceof HTMLImageElement
        && image.complete
        && image.naturalWidth === expectedWidth
        && image.naturalHeight === expectedHeight;
    },
    { selector: surface.image, expectedWidth: width, expectedHeight: height },
  );
}

async function verifySyntheticShapes(page, engineLabel, surface, viewport) {
  const shapes = [
    { label: "portrait", width: 600, height: 900 },
    { label: "square", width: 800, height: 800 },
  ];

  for (const shape of shapes) {
    await setSyntheticImage(page, surface, shape.width, shape.height);
    const state = await measure(page, surface);
    const fixtureSurface = { ...surface, label: `${surface.label} ${shape.label} fixture` };
    assertGeometry(engineLabel, fixtureSurface, viewport, state);
    await assertCaptionReachable(
      page,
      surface,
      `${engineLabel} ${fixtureSurface.label} at ${viewport.width}x${viewport.height}`,
    );
  }
}

async function verifyLongCaption(page, engineLabel, surface, viewport) {
  const style = await page.addStyleTag({ content: ":root{font-size:200% !important;}" });
  const longCaption = "A deliberately long descriptive caption verifies that enlarged text and narrow viewports do not clip important guild image context or force horizontal scrolling. ".repeat(4);

  try {
    await setSyntheticImage(page, surface, 600, 900);
    await page.locator(surface.caption).evaluate((caption, text) => {
      caption.textContent = text;
    }, longCaption);
    const state = await measure(page, surface);
    const fixtureSurface = { ...surface, label: `${surface.label} long-caption fixture` };
    assertGeometry(engineLabel, fixtureSurface, viewport, state);
    const scrollState = await assertCaptionReachable(
      page,
      surface,
      `${engineLabel} ${fixtureSurface.label} at ${viewport.width}x${viewport.height}`,
    );
    assert(
      scrollState.scrollHeight > scrollState.clientHeight,
      `${engineLabel} ${fixtureSurface.label}: stress fixture did not exercise vertical scrolling.`,
    );
    await assertKeyboardCaptionScroll(
      page,
      surface,
      `${engineLabel} ${fixtureSurface.label} at ${viewport.width}x${viewport.height}`,
    );
  } finally {
    await style.evaluate((element) => element.remove());
  }
}

async function verifyFocusTrap(page, surface, context) {
  await page.keyboard.press("Tab");
  assert(
    await page.locator(surface.card).evaluate((element) => document.activeElement === element),
    `${context}: Tab did not reach the keyboard-scrollable image card.`,
  );
  await page.keyboard.press("Tab");
  assert(
    await page.locator(surface.close).evaluate((element) => document.activeElement === element),
    `${context}: forward Tab escaped the dialog.`,
  );
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.locator(surface.card).evaluate((element) => document.activeElement === element),
    `${context}: reverse Tab did not reach the keyboard-scrollable image card.`,
  );
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.locator(surface.close).evaluate((element) => document.activeElement === element),
    `${context}: reverse Tab escaped the dialog.`,
  );
}

async function closeWithEscape(page, surface, opened, context) {
  await page.keyboard.press("Escape");
  await waitForClosed(page, surface, opened.before, `${context} Escape close`);
}

async function verifyAlternativeClosures(page, surface, context, triggerIndex) {
  const backdropOpen = await openFromTrigger(page, surface, "pointer", triggerIndex);
  await page.locator(surface.backdrop).click({ position: { x: 4, y: 4 } });
  await waitForClosed(page, surface, backdropOpen.before, `${context} backdrop close`);

  const buttonOpen = await openFromTrigger(page, surface, "pointer", triggerIndex);
  await page.locator(surface.close).click();
  await waitForClosed(page, surface, buttonOpen.before, `${context} close button`);
  console.log(`${context}: Escape, backdrop, and close-button behavior OK.`);
}

async function captureScreenshot(page, engine, surface, viewport) {
  if (engine.key !== "chromium" || !screenshotViewportLabels.has(viewport.label)) return;
  await mkdir(screenshotDirectory, { recursive: true });
  const fileName = `${surface.key}-${viewport.width}x${viewport.height}.png`;
  await page.screenshot({ path: path.join(screenshotDirectory, fileName) });
}

function assertInsideSafeRectangle(rect, safeArea, viewport, context) {
  assert(
    within(rect.left, safeArea.left, viewport.width - safeArea.right),
    `${context}: left edge is outside the synthetic safe area.`,
  );
  assert(
    within(rect.right, safeArea.left, viewport.width - safeArea.right),
    `${context}: right edge is outside the synthetic safe area.`,
  );
  assert(
    within(rect.top, safeArea.top, viewport.height - safeArea.bottom),
    `${context}: top edge is outside the synthetic safe area.`,
  );
  assert(
    within(rect.bottom, safeArea.top, viewport.height - safeArea.bottom),
    `${context}: bottom edge is outside the synthetic safe area.`,
  );
}

async function setSyntheticSafeArea(page, safeArea) {
  await page.evaluate((insets) => {
    const root = document.documentElement.style;
    for (const edge of ["top", "right", "bottom", "left"]) {
      root.setProperty(`--safe-area-${edge}`, `${insets[edge]}px`);
    }
  }, safeArea);
}

async function clearSyntheticSafeArea(page) {
  await page.evaluate(() => {
    const root = document.documentElement.style;
    for (const edge of ["top", "right", "bottom", "left"]) {
      root.removeProperty(`--safe-area-${edge}`);
    }
  });
}

async function resetPreparedPagesToTop(prepared) {
  await Promise.all(prepared.map(async ({ page }) => {
    await page.evaluate(() => {
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
      root.style.scrollBehavior = previousScrollBehavior;
    });
    await waitForScrollSettled(page);
  }));
}

async function measureSafeAreaConsumers(page) {
  const skipLink = page.locator(".skip-link");
  await skipLink.evaluate((element) => {
    element.style.transition = "none";
    element.style.transform = "translateY(0)";
  });
  await skipLink.focus();

  const geometry = await page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const contentRect = (element) => {
      const box = rect(element);
      const style = getComputedStyle(element);
      const padding = {
        top: Number.parseFloat(style.paddingTop) || 0,
        right: Number.parseFloat(style.paddingRight) || 0,
        bottom: Number.parseFloat(style.paddingBottom) || 0,
        left: Number.parseFloat(style.paddingLeft) || 0,
      };
      return {
        top: box.top + padding.top,
        right: box.right - padding.right,
        bottom: box.bottom - padding.bottom,
        left: box.left + padding.left,
        padding,
      };
    };

    const header = document.querySelector(".site-header");
    const container = document.querySelector("main .container");
    const footer = document.querySelector(".site-footer");
    const skip = document.querySelector(".skip-link");
    return {
      header: contentRect(header),
      container: contentRect(container),
      footer: contentRect(footer),
      skip: rect(skip),
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  });

  await skipLink.evaluate((element) => {
    element.style.removeProperty("transition");
    element.style.removeProperty("transform");
  });
  return geometry;
}

async function measureMobileSheetSafeArea(page) {
  await page.locator("#menu-btn").click();
  await page.locator("#mobile-menu").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const shell = document.querySelector("#mobile-menu");
    const sheet = shell?.querySelector(".mobile-sheet");
    if (!sheet || shell.dataset.open !== "true") return false;
    const style = getComputedStyle(sheet);
    const transform = new DOMMatrixReadOnly(style.transform);
    return style.opacity === "1"
      && Math.abs(transform.m41) < 0.1
      && Math.abs(transform.m42) < 0.1;
  });
  const geometry = await page.locator("#mobile-menu .mobile-sheet").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const padding = {
      top: Number.parseFloat(style.paddingTop) || 0,
      right: Number.parseFloat(style.paddingRight) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
      left: Number.parseFloat(style.paddingLeft) || 0,
    };
    return {
      content: {
        top: box.top + padding.top,
        right: box.right - padding.right,
        bottom: box.bottom - padding.bottom,
        left: box.left + padding.left,
      },
      padding,
    };
  });
  await page.locator('#mobile-menu [aria-label="Close menu"]').click();
  await page.locator("#mobile-menu").waitFor({ state: "hidden" });
  return geometry;
}

async function measureBirthdaySafeArea(page) {
  return page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "synthetic-safe-area-birthday";
    fixture.className = "birthday-splash";
    fixture.setAttribute("aria-hidden", "true");
    fixture.innerHTML = `
      <section class="birthday-splash__panel">
        <button class="birthday-splash__close" type="button">Close</button>
        <p class="birthday-splash__kicker">A lantern-bright wish</p>
        <h2 class="birthday-splash__title">Happy Birthday Sinbell!!</h2>
        <p class="birthday-splash__message">Mochi spirits love you!!</p>
      </section>
    `;
    document.body.append(fixture);
    const style = getComputedStyle(fixture);
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
      };
    };
    const padding = {
      top: Number.parseFloat(style.paddingTop) || 0,
      right: Number.parseFloat(style.paddingRight) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
      left: Number.parseFloat(style.paddingLeft) || 0,
    };
    const panel = rect(fixture.querySelector(".birthday-splash__panel"));
    const close = rect(fixture.querySelector(".birthday-splash__close"));
    fixture.remove();
    return { padding, panel, close };
  });
}

async function verifyStickyHeader(page, context) {
  const targetScroll = await page.evaluate(() => {
    const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const target = Math.min(500, maximum);
    window.scrollTo(0, target);
    return target;
  });
  assert(targetScroll > 0, `${context}: page is not tall enough to verify sticky header behavior.`);
  await waitForScrollSettled(page);
  const top = await page.locator(".site-header").evaluate((element) => element.getBoundingClientRect().top);
  assert(Math.abs(top) <= geometryTolerance, `${context}: sticky header left the viewport at scrollY ${targetScroll}.`);
  await resetPreparedPagesToTop([{ page }]);
}

async function verifySyntheticSafeAreas(prepared, engineLabel) {
  const viewport = syntheticSafeAreaViewport;
  await Promise.all(prepared.map(({ page }) => page.setViewportSize(viewportSize(viewport))));

  for (const safeArea of syntheticSafeAreaCases) {
    const context = `${engineLabel} ${safeArea.label} at ${viewport.width}x${viewport.height}`;
    await Promise.all(prepared.map(({ page }) => setSyntheticSafeArea(page, safeArea)));
    await resetPreparedPagesToTop(prepared);

    try {
      const home = prepared.find(({ surface }) => surface.key === "home");
      await verifyStickyHeader(home.page, context);
      const shell = await measureSafeAreaConsumers(home.page);
      assert(shell.pageScrollWidth <= viewport.width + geometryTolerance, `${context}: page shell has horizontal overflow.`);
      assert(shell.header.left >= safeArea.left - geometryTolerance, `${context}: header content enters the unsafe left inset.`);
      assert(shell.header.right <= viewport.width - safeArea.right + geometryTolerance, `${context}: header content enters the unsafe right inset.`);
      assert(shell.header.top >= safeArea.top - geometryTolerance, `${context}: header content enters the unsafe top inset.`);
      assert(shell.container.left >= safeArea.left - geometryTolerance, `${context}: page content enters the unsafe left inset.`);
      assert(shell.container.right <= viewport.width - safeArea.right + geometryTolerance, `${context}: page content enters the unsafe right inset.`);
      assert(shell.footer.left >= safeArea.left - geometryTolerance, `${context}: footer content enters the unsafe left inset.`);
      assert(shell.footer.right <= viewport.width - safeArea.right + geometryTolerance, `${context}: footer content enters the unsafe right inset.`);
      assert(shell.footer.padding.bottom >= safeArea.bottom, `${context}: footer padding does not reserve the bottom inset.`);
      assert(shell.skip.top >= safeArea.top - geometryTolerance, `${context}: focused skip link enters the unsafe top inset.`);
      assert(shell.skip.left >= safeArea.left - geometryTolerance, `${context}: focused skip link enters the unsafe left inset.`);

      const mobile = await measureMobileSheetSafeArea(home.page);
      assertInsideSafeRectangle(mobile.content, safeArea, viewport, `${context} mobile-sheet content`);
      for (const edge of ["top", "right", "bottom", "left"]) {
        assert(mobile.padding[edge] >= safeArea[edge], `${context}: mobile-sheet ${edge} padding does not reserve the inset.`);
      }

      const birthday = await measureBirthdaySafeArea(home.page);
      for (const edge of ["top", "right", "bottom", "left"]) {
        assert(birthday.padding[edge] >= safeArea[edge], `${context}: birthday dialog ${edge} padding does not reserve the inset.`);
      }
      assertInsideSafeRectangle(birthday.panel, safeArea, viewport, `${context} birthday panel`);
      assertInsideSafeRectangle(birthday.close, safeArea, viewport, `${context} birthday close control`);

      for (const { page, surface, triggerIndex } of prepared) {
        const opened = await openFromTrigger(page, surface, "keyboard", triggerIndex);
        const state = await measure(page, surface);
        assertInsideSafeRectangle(state.card, safeArea, viewport, `${context} ${surface.label} card`);
        assertInsideSafeRectangle(state.close, safeArea, viewport, `${context} ${surface.label} close control`);
        assert(
          state.pageScrollWidth <= viewport.width + geometryTolerance,
          `${context} ${surface.label}: document has horizontal overflow.`,
        );
        const shellPadding = state.contract.shellPadding.map((value) => Number.parseFloat(value) || 0);
        const expectedMinimums = [safeArea.top, safeArea.right, safeArea.bottom, safeArea.left];
        shellPadding.forEach((value, index) => {
          assert(value >= expectedMinimums[index], `${context} ${surface.label}: lightbox shell does not reserve every inset.`);
        });
        await closeWithEscape(page, surface, opened, `${context} ${surface.label}`);
      }

      console.log(`${context}: shared safe-area consumers OK.`);
    } finally {
      await Promise.all(prepared.map(({ page }) => clearSyntheticSafeArea(page)));
    }
  }
}

async function waitForViewerShell(page, surface) {
  await page.waitForSelector(surface.dialog, { state: "visible" });
  await page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    surface.close,
  );
}

async function prepareLoadingLifecyclePage(context, surface) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}${surface.path}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    ({ selector, minimum }) => document.querySelectorAll(selector).length >= minimum,
    { selector: surface.trigger, minimum: surface.minimumTriggers },
  );
  await waitUntilInteractive(page, surface);
  await waitForStableTriggers(page, surface);
  assert(
    await page.locator(surface.trigger).count() >= 4,
    `${surface.label}: loading lifecycle needs four distinct image triggers.`,
  );
  return page;
}

async function inspectLoadingState(page, surface) {
  return page.evaluate((selectors) => {
    const media = document.querySelector(selectors.media);
    const preview = document.querySelector(selectors.preview);
    const full = document.querySelector(selectors.image);
    const status = document.querySelector(selectors.status);
    return {
      state: media?.getAttribute("data-image-state") || "",
      busy: media?.getAttribute("aria-busy") || "",
      previewComplete: preview instanceof HTMLImageElement && preview.complete && preview.naturalWidth > 0,
      previewOpacity: preview ? getComputedStyle(preview).opacity : "",
      previewTransition: preview ? getComputedStyle(preview).transitionDuration : "",
      fullOpacity: full ? getComputedStyle(full).opacity : "",
      fullTransition: full ? getComputedStyle(full).transitionDuration : "",
      statusRole: status?.getAttribute("role") || "",
      statusLive: status?.getAttribute("aria-live") || "",
      statusText: status?.textContent?.trim() || "",
    };
  }, surface);
}

function hasOnlyNegligibleDurations(value) {
  return value
    .split(",")
    .map((duration) => Number.parseFloat(duration.trim()))
    .every((duration) => Number.isFinite(duration) && duration <= 0.000001);
}

async function verifyLoadingLifecycle(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await stubVercelAnalyticsScripts(context);
  await stubEmptyApprovedGalleryFeed(context);

  try {
    for (const surface of surfaces) {
      const page = await prepareLoadingLifecyclePage(context, surface);

      try {
        const successful = await selectedTriggerState(page, surface, 1);
        let successfulRequests = 0;
        let releaseSuccessful;
        let markSuccessfulStarted;
        let markSuccessfulFinished;
        const successfulGate = new Promise((resolve) => { releaseSuccessful = resolve; });
        const successfulStarted = new Promise((resolve) => { markSuccessfulStarted = resolve; });
        const successfulFinished = new Promise((resolve) => { markSuccessfulFinished = resolve; });

        await page.route(successful.source.full, async (route) => {
          successfulRequests += 1;
          markSuccessfulStarted();
          await successfulGate;
          try {
            const response = await route.fetch();
            await route.fulfill({ response });
          } catch {
            // Closing the viewer is allowed to cancel an in-flight image request.
          } finally {
            markSuccessfulFinished();
          }
        });

        await page.waitForTimeout(100);
        assert(successfulRequests === 0, `${surface.label}: full image requested before the viewer opened.`);
        await page.keyboard.press("Enter");
        await successfulStarted;
        await waitForViewerShell(page, surface);

        const loading = await inspectLoadingState(page, surface);
        assert(loading.state === "loading", `${surface.label}: delayed full image did not expose loading state.`);
        assert(loading.busy === "true", `${surface.label}: loading image was not marked busy.`);
        assert(loading.previewComplete, `${surface.label}: cached thumbnail placeholder was not visible while loading.`);
        assert(loading.previewOpacity === "1", `${surface.label}: thumbnail placeholder was hidden before decode.`);
        assert(loading.fullOpacity === "0", `${surface.label}: undecoded full image was exposed.`);
        assert(loading.statusRole === "status" && loading.statusLive === "polite", `${surface.label}: loading status is not accessible.`);
        assert(loading.statusText === "Loading full image…", `${surface.label}: loading status copy drifted.`);
        assert(
          hasOnlyNegligibleDurations(loading.previewTransition)
            && hasOnlyNegligibleDurations(loading.fullTransition),
          `${surface.label}: reduced-motion loading state animates (preview=${loading.previewTransition}, full=${loading.fullTransition}).`,
        );
        assert(successfulRequests === 1, `${surface.label}: opening should request the full image exactly once.`);

        releaseSuccessful();
        await successfulFinished;
        await waitForImage(page, surface);
        const ready = await inspectLoadingState(page, surface);
        assert(ready.state === "ready" && ready.busy === "false", `${surface.label}: decoded image did not become ready.`);
        assert(ready.previewOpacity === "0" && ready.fullOpacity === "1", `${surface.label}: decoded image did not replace its thumbnail.`);
        assert(!ready.statusText, `${surface.label}: ready image retained loading copy.`);
        await page.locator(surface.close).click();
        await waitForClosed(page, surface, successful.before, `${surface.label} delayed-success close`);
        await page.unroute(successful.source.full);

        const canceled = await selectedTriggerState(page, surface, 2);
        let releaseCanceled;
        let markCanceledStarted;
        let markCanceledFinished;
        const canceledGate = new Promise((resolve) => { releaseCanceled = resolve; });
        const canceledStarted = new Promise((resolve) => { markCanceledStarted = resolve; });
        const canceledFinished = new Promise((resolve) => { markCanceledFinished = resolve; });

        await page.route(canceled.source.full, async (route) => {
          markCanceledStarted();
          await canceledGate;
          try {
            const response = await route.fetch();
            await route.fulfill({ response });
          } catch {
            // An unmounted image can cancel cleanly without delaying viewer dismissal.
          } finally {
            markCanceledFinished();
          }
        });

        await page.keyboard.press("Enter");
        await canceledStarted;
        await waitForViewerShell(page, surface);
        const closeStartedAt = Date.now();
        await page.locator(surface.close).click();
        await waitForClosed(page, surface, canceled.before, `${surface.label} in-flight close`);
        const closeDuration = Date.now() - closeStartedAt;
        assert(closeDuration < 750, `${surface.label}: in-flight close took ${closeDuration}ms.`);
        releaseCanceled();
        await canceledFinished;
        await page.unroute(canceled.source.full);

        const failed = await selectedTriggerState(page, surface, 3);
        await page.route(failed.source.full, (route) =>
          route.fulfill({
            status: 200,
            contentType: "image/webp",
            body: "not-a-decodable-image",
          }),
        );
        await page.keyboard.press("Enter");
        await waitForViewerShell(page, surface);
        await page.waitForFunction(
          (selector) => document.querySelector(selector)?.getAttribute("data-image-state") === "error",
          surface.media,
        );
        const failedState = await inspectLoadingState(page, surface);
        assert(failedState.previewComplete && failedState.previewOpacity === "1", `${surface.label}: failed full image did not retain its thumbnail.`);
        assert(failedState.statusText === "The full image could not be loaded.", `${surface.label}: error status copy drifted.`);
        await page.locator(surface.close).click();
        await waitForClosed(page, surface, failed.before, `${surface.label} decode-error close`);
        await page.unroute(failed.source.full);

        console.log(`${surface.label} deferred full-image loading, cancellation, and error states OK.`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
}

async function verifyApprovedSchemaV2Success(browser, engine, resolvedBaseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const requests = [];
  await bridgeWebKitLocalHttps(context, resolvedBaseUrl);
  await stubVercelAnalyticsScripts(context, resolvedBaseUrl);
  const fixture = await stubApprovedGalleryFeedSuccess(context, requests);

  try {
    const surface = surfaces.find(({ key }) => key === "gallery");
    assert(surface, "Gallery surface is missing from the universal lightbox matrix.");
    const page = await context.newPage();
    const assertNoBrowserErrors = watchBrowserErrors(page, "Gallery schema v2", engine.label);
    try {
      await page.goto(
        `${resolvedBaseUrl}/gallery?category=member-submissions&sort=newest`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForSelector('.gallery-feed-state[data-state="ready"]');
      const trigger = page.locator(surface.trigger);
      await trigger.waitFor({ state: "visible" });
      assert(await trigger.count() === 1, `${engine.label} schema-v2 Gallery did not render exactly one approved item.`);
      const source = await trigger.evaluate((element) => ({
        full: element.getAttribute("data-full") || "",
        thumbnail: element.querySelector("img")?.getAttribute("src") || "",
        alt: element.querySelector("img")?.getAttribute("alt") || "",
      }));
      assert(!source.full, `${engine.label} schema-v2 approved card exposed data-full before viewer opening.`);
      assert(source.thumbnail === fixture.thumbnailUrl, `${engine.label} schema-v2 approved card did not use its thumbnail URL.`);
      assert(source.alt === "Cross-browser approved Gallery fixture", `${engine.label} schema-v2 approved card lost its title alt text.`);
      assert(requests.filter(({ action }) => action === "list").length === 1, `${engine.label} schema-v2 Gallery made an unexpected list request count.`);
      assert(requests.every(({ action }) => action !== "full"), `${engine.label} schema-v2 Gallery requested a display image before opening.`);

      await trigger.evaluate((element, marker) => element.setAttribute(marker, "true"), triggerMarker);
      await trigger.focus();
      await trigger.click();
      await waitForOpen(page, surface);
      assert(requests.filter(({ action }) => action === "full").length === 1, `${engine.label} schema-v2 Gallery did not make exactly one full request.`);
      assert((await page.locator(surface.image).getAttribute("src"))?.startsWith("blob:"), `${engine.label} schema-v2 viewer did not render the validated display blob.`);
      await page.keyboard.press("Escape");
      await waitForProbeClosed(page, surface);
      await page.waitForFunction(
        ({ selector, marker }) => document.activeElement === document.querySelector(`${selector}[${marker}="true"]`),
        { selector: surface.trigger, marker: triggerMarker },
      );
      assertNoBrowserErrors();
      console.log(`${engine.label} schema-v2 approved Gallery success path OK.`);
    } finally {
      await page.close();
    }
  } finally {
    await context.close();
  }
}

async function verifyEngine(engine) {
  let browser;
  try {
    browser = await engine.launcher.launch({ headless: true });
  } catch (error) {
    throw new Error(`${engine.label} could not launch. Run npm run setup:playwright. ${error.message}`);
  }

  const viewports = engineViewports(engine);
  const resolvedBaseUrl = navigationBaseUrl(engine);
  if (engine.key === "chromium") await verifyLoadingLifecycle(browser);
  await verifyApprovedSchemaV2Success(browser, engine, resolvedBaseUrl);
  const context = await browser.newContext({ viewport: viewportSize(viewports[0]) });
  await bridgeWebKitLocalHttps(context, resolvedBaseUrl);
  await stubVercelAnalyticsScripts(context, resolvedBaseUrl);
  await stubEmptyApprovedGalleryFeed(context);

  try {
    const prepared = [];
    const selectedSources = new Map();
    for (const surface of surfaces) {
      prepared.push(await prepareSurfacePage(context, surface, engine.label, resolvedBaseUrl));
    }

    for (const viewport of viewports) {
      await Promise.all(prepared.map(({ page }) => page.setViewportSize(viewportSize(viewport))));
      const states = [];

      for (const entry of prepared) {
        const { page, surface, triggerIndex } = entry;
        await assertResponsiveThumbnailGeometry(page, surface, engine.label, viewport);
        const interactionViewport = interactionViewportLabels.has(viewport.label);
        if (interactionViewport) {
          await positionTriggerAtNonzeroScroll(page, surface, triggerIndex);
        }

        const opened = await openFromTrigger(page, surface, "keyboard", triggerIndex);
        const selectedSource = selectedSources.get(surface.key);
        if (selectedSource) {
          assert(
            opened.source.full === selectedSource,
            `${engine.label} ${surface.label}: selected image changed during the viewport matrix.`,
          );
        } else {
          selectedSources.set(surface.key, opened.source.full);
        }
        if (interactionViewport) {
          assert(
            opened.before.scrollY > 0,
            `${engine.label} ${surface.label} at ${viewport.width}x${viewport.height}: scroll restoration fixture did not start from a nonzero scroll position.`,
          );
        }
        const state = await measure(page, surface);
        assertGeometry(engine.label, surface, viewport, state);
        assert(
          state.natural.width > state.natural.height,
          `${engine.label} ${surface.label}: selected live image is not landscape (${state.natural.width}x${state.natural.height}).`,
        );
        await assertCaptionReachable(
          page,
          surface,
          `${engine.label} ${surface.label} at ${viewport.width}x${viewport.height}`,
        );
        assert(
          state.imageSource === opened.source.full,
          `${engine.label} ${surface.label}: expected ${opened.source.full}, got ${state.imageSource}.`,
        );
        assert(!state.imageSource.includes("/thumbs/"), `${engine.label} ${surface.label}: lightbox rendered a thumbnail.`);

        if (interactionViewport) {
          await verifyFocusTrap(
            page,
            surface,
            `${engine.label} ${surface.label} at ${viewport.width}x${viewport.height}`,
          );
        }

        await captureScreenshot(page, engine, surface, viewport);

        if (syntheticShapeViewportLabels.has(viewport.label)) {
          await verifySyntheticShapes(page, engine.label, surface, viewport);
        }
        if (longCaptionViewportLabels.has(viewport.label)) {
          await verifyLongCaption(page, engine.label, surface, viewport);
        }

        await closeWithEscape(
          page,
          surface,
          opened,
          `${engine.label} ${surface.label} at ${viewport.width}x${viewport.height}`,
        );

        if (interactionViewport) {
          await verifyAlternativeClosures(
            page,
            surface,
            `${engine.label} ${surface.label} at ${viewport.width}x${viewport.height}`,
            triggerIndex,
          );
        }

        states.push(state);
      }

      assertSameContract(engine.label, viewport, states[0], states[1]);
      console.log(`${engine.label} lightbox viewport OK: ${viewport.label} (${viewport.width}x${viewport.height}).`);
    }

    if (engine.key === "chromium") {
      await verifySyntheticSafeAreas(prepared, engine.label);
    }

    prepared.forEach(({ assertNoBrowserErrors }) => assertNoBrowserErrors());
  } finally {
    await context.close();
    await browser.close();
  }
}

async function verifyTouch(browser) {
  const context = await browser.newContext({
    viewport: viewportSize(touchViewports[0]),
    hasTouch: true,
    isMobile: true,
  });
  await stubVercelAnalyticsScripts(context);
  await stubEmptyApprovedGalleryFeed(context);

  try {
    const prepared = [];
    for (const surface of surfaces) {
      prepared.push(await prepareSurfacePage(context, surface, "Chromium touch"));
    }

    for (const viewport of touchViewports) {
      await Promise.all(prepared.map(({ page }) => page.setViewportSize(viewportSize(viewport))));

      for (const { page, surface, triggerIndex } of prepared) {
        const opened = await openFromTrigger(page, surface, "touch", triggerIndex);
        const state = await measure(page, surface);
        assertGeometry("Chromium touch", surface, viewport, state);
        assert(
          state.natural.width > state.natural.height,
          `Chromium touch ${surface.label}: selected live image is not landscape (${state.natural.width}x${state.natural.height}).`,
        );
        await page.locator(surface.close).tap();
        await waitForClosed(
          page,
          surface,
          opened.before,
          `Chromium touch ${surface.label} at ${viewport.width}x${viewport.height} close button`,
        );
      }

      console.log(`Chromium touch lightbox OK: ${viewport.label} (${viewport.width}x${viewport.height}).`);
    }

    prepared.forEach(({ assertNoBrowserErrors }) => assertNoBrowserErrors());
  } finally {
    await context.close();
  }
}

for (const engine of engines) {
  await verifyEngine(engine);
}

let touchBrowser;
try {
  touchBrowser = await playwright.chromium.launch({ headless: true });
  await verifyTouch(touchBrowser);
} finally {
  await touchBrowser?.close();
}

console.log(
  `Universal Home/Gallery lightbox smoke OK across ${viewportMatrix.length} Chromium viewports, representative Firefox/WebKit viewports, and touch orientations.`,
);
