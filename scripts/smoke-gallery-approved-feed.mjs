import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { enforceProductionGalleryMatrixGuard } from "./lib/live-gallery-media-smoke-guard.mjs";
import { SITE_ORIGIN, SUPABASE_PROJECT_URL } from "./lib/public-urls.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
enforceProductionGalleryMatrixGuard({ baseUrl, siteOrigin: SITE_ORIGIN });

const galleryDataUrl = new URL("../apps/web/public/data/gallery.json", import.meta.url);
const axePath = resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const galleryData = JSON.parse(await readFile(galleryDataUrl, "utf8"));
const staticItems = (Array.isArray(galleryData?.albums) ? galleryData.albums : []).flatMap((album) =>
  Array.isArray(album?.items) ? album.items : [],
);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is required for this optional smoke test.");
  console.error("Start a local production server, then run this command with Playwright available.");
  process.exit(1);
}

const canonicalCategories = ["portraits", "gatherings", "action", "scenery", "companions"];
const publicFilterCategories = ["all", ...canonicalCategories, "member-submissions"];
const pageSize = 24;
const fixtureRowCount = 90;
const approvedFeedPath = "/functions/v1/list-approved-gallery-submissions";
const approvedFeedRoutePattern = `**${approvedFeedPath}*`;
const thumbnailAssetPath = "/assets/img/gallery/thumbs/shot-05.webp";
const displayAssetPath = "/assets/img/gallery/shot-05.webp";
const thumbnailAssetFile = new URL(`../apps/web/public${thumbnailAssetPath}`, import.meta.url);
const displayAssetFile = new URL(`../apps/web/public${displayAssetPath}`, import.meta.url);
const thumbnailAssetBytes = (await stat(thumbnailAssetFile)).size;
const displayAssetBytes = (await stat(displayAssetFile)).size;
const thumbnailAssetBody = await readFile(thumbnailAssetFile);
const displayAssetBody = await readFile(displayAssetFile);
const vercelAnalyticsScriptPaths = new Set([
  "/_vercel/insights/script.js",
  "/_vercel/speed-insights/script.js",
]);
const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function text(value, fallback = "") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

function normalizeSlug(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getStaticCategories(item) {
  const values = Array.isArray(item?.categories) && item.categories.length ? item.categories : [item?.category];
  return [...new Set(values.map(normalizeSlug).filter(Boolean))];
}

function sortTime(item) {
  const time = Date.parse(text(item?.galleryAddedAt));
  return Number.isFinite(time) ? time : 0;
}

function extractNumericSequence(value) {
  const clean = text(value);
  if (!clean) return null;
  const named = clean.match(/(?:^|[\\/_-])(?:shot|image|img)[-_]?(\d+)(?=$|[.\\/_-])/i);
  if (named) return Number.parseInt(named[1], 10);
  const matches = [...clean.matchAll(/(\d+)/g)];
  const fallback = matches.at(-1)?.[1];
  return fallback ? Number.parseInt(fallback, 10) : null;
}

function stableSequence(item, originalIndex) {
  for (const candidate of [item?.id, item?.full, item?.src, item?.thumb]) {
    const sequence = extractNumericSequence(candidate);
    if (sequence !== null && Number.isFinite(sequence)) return sequence;
  }
  return originalIndex + 1;
}

function stableKey(item, originalIndex) {
  return text(item?.id || item?.full || item?.src || item?.thumb, `gallery-${originalIndex}`);
}

function orderStaticItems(items, mode) {
  return items
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      sortTimestamp: sortTime(item),
      stableKey: stableKey(item, originalIndex),
      stableSequence: stableSequence(item, originalIndex),
    }))
    .sort((a, b) => {
      const direction = mode === "newest" ? -1 : 1;
      const timeDelta = a.sortTimestamp - b.sortTimestamp;
      if (timeDelta !== 0) return direction * timeDelta;
      const sequenceDelta = a.stableSequence - b.stableSequence;
      if (sequenceDelta !== 0) return direction * sequenceDelta;
      const indexDelta = a.originalIndex - b.originalIndex;
      if (indexDelta !== 0) return direction * indexDelta;
      return a.stableKey.localeCompare(b.stableKey);
    })
    .map(({ item }) => item);
}

function publicPath(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^(https?:|\/)/i.test(raw)) return raw;
  if (raw.startsWith("./")) return `/${raw.slice(2)}`;
  return `/${raw}`;
}

function fullPath(item) {
  return publicPath(item?.full || item?.src);
}

const staticTotal = staticItems.length;
const portraitsTotal = staticItems.filter((item) => getStaticCategories(item).includes("portraits")).length;
const initialStaticCount = Math.min(staticTotal, pageSize);
const initialPortraitsCount = Math.min(portraitsTotal, pageSize);
const newestStaticFull = fullPath(orderStaticItems(staticItems, "newest")[0]);
const oldestStaticFull = fullPath(orderStaticItems(staticItems, "oldest")[0]);

function fixtureUuid(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function thumbnailUrl(publicationId) {
  return `${SUPABASE_PROJECT_URL}${approvedFeedPath}?asset=thumbnail&id=${publicationId}`;
}

function displayUrl(publicationId) {
  return `${SUPABASE_PROJECT_URL}${approvedFeedPath}?asset=full&id=${publicationId}`;
}

function isFixtureThumbnailUrl(value) {
  const url = new URL(value);
  return url.origin === SUPABASE_PROJECT_URL
    && url.pathname === approvedFeedPath
    && [...url.searchParams.keys()].sort().join(",") === "asset,id"
    && url.searchParams.get("asset") === "thumbnail"
    && uuidV4Pattern.test(url.searchParams.get("id") || "");
}

function isFixtureDisplayUrl(value) {
  const url = new URL(value);
  return url.origin === SUPABASE_PROJECT_URL
    && url.pathname === approvedFeedPath
    && [...url.searchParams.keys()].sort().join(",") === "asset,id"
    && url.searchParams.get("asset") === "full"
    && uuidV4Pattern.test(url.searchParams.get("id") || "");
}

const fixtureRows = Array.from({ length: fixtureRowCount }, (_, index) => {
  const sequence = String(index + 1).padStart(3, "0");
  const id = fixtureUuid(index).replace(/^00000000-/, "10000000-");
  const category = canonicalCategories[index % canonicalCategories.length];
  const title = index >= fixtureRowCount - 2 ? null : `Approved Smoke Submission ${sequence}`;
  const caption = index === fixtureRowCount - 1
    ? "Caption-only approved Gallery image."
    : index === fixtureRowCount - 2
      ? null
      : index === 0
        ? "A deliberately long, factual member-gallery caption used to verify that the shared viewer keeps the full image visible, wraps readable text, and allows vertical scrolling at narrow widths and two-hundred-percent text sizing without horizontal drift."
        : `Reviewed member gallery fixture ${sequence}.`;
  return {
    id,
    title,
    caption,
    category,
    categories: ["member-submissions", category],
    mime_type: "image/webp",
    size_bytes: displayAssetBytes,
    created_at: new Date(Date.UTC(2030, 0, index + 1, 3, 4, 5)).toISOString(),
    reviewed_at: new Date(Date.UTC(2030, 1, index + 1, 4, 4, 5)).toISOString(),
    thumbnail_url: thumbnailUrl(id),
    thumbnail_size_bytes: thumbnailAssetBytes,
    thumbnail_width: 640,
    thumbnail_height: 400,
  };
});

assert(fixtureRows.length >= 85, "Gallery v2 fixture must contain at least 85 rows.");
assert(new Set(fixtureRows.map((item) => item.id)).size === fixtureRows.length, "Gallery v2 fixture IDs must be unique.");
assert(fixtureRows.every((item) => uuidV4Pattern.test(item.id)), "Gallery v2 fixture IDs must be valid UUID v4 shapes.");
assert(fixtureRows.every((item) => !("full_url" in item)), "Gallery v2 list fixtures must not contain display URLs.");
assert(fixtureRows.every((item) => !("uploader_display_name" in item)), "Gallery v2 list fixtures must not contain member identity attribution.");
assert(fixtureRows.every((item) => item.thumbnail_size_bytes <= 80 * 1024), "Gallery v2 fixture thumbnails exceed 80 KiB.");
assert(
  fixtureRows.every((item) => isFixtureThumbnailUrl(item.thumbnail_url)),
  "Gallery v2 fixture thumbnails must use only the exact opaque Edge-media URL.",
);
assert(
  fixtureRows.every((item) =>
    new URL(item.thumbnail_url).searchParams.get("id") === item.id
    && new URL(displayUrl(item.id)).searchParams.get("id") === item.id
  ),
  "Gallery v2 media URLs must expose only the opaque publication UUID.",
);

function normalizedQuery(value) {
  return text(value).normalize("NFKC").toLowerCase();
}

function rowsMatchingQuery(query) {
  const needle = normalizedQuery(query);
  if (!needle) return fixtureRows;
  return fixtureRows.filter((item) =>
    [item.title, item.caption, ...item.categories]
      .join(" ")
      .normalize("NFKC")
      .toLowerCase()
      .includes(needle),
  );
}

function rowsForListRequest(body) {
  const queryRows = rowsMatchingQuery(body.query);
  const category = body.category === "all" ? null : body.category;
  const categoryRows = category && category !== "member-submissions"
    ? queryRows.filter((item) => item.category === category)
    : queryRows;
  const direction = body.sort === "oldest" ? 1 : -1;
  return [...categoryRows].sort((a, b) => {
    const reviewedDelta = Date.parse(a.reviewed_at) - Date.parse(b.reviewed_at);
    if (reviewedDelta !== 0) return direction * reviewedDelta;
    const createdDelta = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (createdDelta !== 0) return direction * createdDelta;
    return direction * a.id.localeCompare(b.id);
  });
}

function facetsForQuery(query) {
  const rows = rowsMatchingQuery(query);
  return Object.fromEntries([
    ["member-submissions", rows.length],
    ...canonicalCategories.map((category) => [category, rows.filter((item) => item.category === category).length]),
  ]);
}

function encodeFixtureCursor(offset) {
  return `fixture_cursor_${String(offset).padStart(3, "0")}`;
}

function decodeFixtureCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return 0;
  const match = String(cursor).match(/^fixture_cursor_(\d{3})$/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function listResponse(body, options) {
  const rows = options.empty ? [] : rowsForListRequest(body);
  const offset = decodeFixtureCursor(body.cursor);
  if (offset < 0 || !Number.isSafeInteger(body.pageSize) || body.pageSize < 1 || body.pageSize > pageSize) {
    return {
      ok: false,
      data: null,
      message: "The Gallery request is invalid.",
    };
  }
  const sourcePage = rows.slice(offset, offset + body.pageSize);
  const items = sourcePage.map((item) => ({ ...item }));
  const nextOffset = offset + sourcePage.length;
  const hasMore = nextOffset < rows.length;
  return {
    ok: true,
    data: {
      schemaVersion: 2,
      items,
      count: items.length,
      totalEligible: rows.length,
      facets: options.empty ? facetsForQuery("no-fixture-can-match") : facetsForQuery(body.query),
      hasMore,
      nextCursor: hasMore ? encodeFixtureCursor(nextOffset) : null,
      partial: false,
      complete: !hasMore,
      deliveryFailures: 0,
      delivery: "bounded-edge-media",
      cacheSeconds: 15,
    },
    message: items.length
      ? "Member-submitted images loaded."
      : "No member-submitted images are available yet.",
  };
}

function parseRequestBody(request) {
  let body;
  try {
    body = JSON.parse(request.postData() || "null");
  } catch {
    fail("Gallery feed request body was not valid JSON.");
  }
  assert(body && typeof body === "object" && !Array.isArray(body), "Gallery feed request body must be an object.");
  return body;
}

function assertListRequestShape(body, label) {
  assert(body.action === "list", `${label}: expected list action.`);
  assert(
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["action", "category", "cursor", "pageSize", "query", "sort"]),
    `${label}: list request keys drifted.`,
  );
  assert(body.pageSize === pageSize, `${label}: expected pageSize ${pageSize}, got ${body.pageSize}.`);
  assert(body.cursor === null || /^[A-Za-z0-9_-]{1,512}$/.test(body.cursor), `${label}: cursor was not opaque and bounded.`);
  assert(["newest", "oldest"].includes(body.sort), `${label}: invalid sort ${body.sort}.`);
  assert(body.category === null || publicFilterCategories.includes(body.category), `${label}: invalid category ${body.category}.`);
  assert(body.query === null || (typeof body.query === "string" && body.query.length <= 80), `${label}: invalid query.`);
}

async function stubVercelAnalyticsScripts(context) {
  const appOrigin = new URL(baseUrl).origin;
  await context.route(
    (url) => url.origin === appOrigin && vercelAnalyticsScriptPaths.has(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
}

async function prepareContext(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await stubVercelAnalyticsScripts(context);
  return context;
}

async function newCheckedPage(context, options = {}) {
  const page = await context.newPage();
  const errors = [];
  const feedRequests = [];
  const galleryAssetRequests = [];
  const fullActionCounts = new Map();
  const thumbnailActionCounts = new Map();
  const corruptAssetAttempts = new Map();
  let listFailuresRemaining = Number(options.listFailures || 0);
  let listDeliveryFailuresRemaining = Number(options.listDeliveryFailures || 0);
  const allowedHttpFailures = new Map();
  let allowedResourceConsoleErrors = Number(options.listDeliveryFailures || 0);

  await page.addInitScript(() => {
    window.__galleryCls = 0;
    if (typeof PerformanceObserver !== "function") return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__galleryCls += entry.value;
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  });

  await page.route(approvedFeedRoutePattern, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }

    if (request.method() === "GET") {
      const requestUrl = request.url();
      const url = new URL(requestUrl);
      const asset = url.searchParams.get("asset");
      const id = url.searchParams.get("id") || "";
      assert(
        url.origin === SUPABASE_PROJECT_URL
          && url.pathname === approvedFeedPath
          && [...url.searchParams.keys()].sort().join(",") === "asset,id"
          && uuidV4Pattern.test(id)
          && (asset === "full" || asset === "thumbnail"),
        "Gallery media request drifted from the exact bounded Edge URL.",
      );
      const actionCounts = asset === "full" ? fullActionCounts : thumbnailActionCounts;
      actionCounts.set(id, (actionCounts.get(id) || 0) + 1);
      const corruptFixture = (asset === "thumbnail" && id === options.expireThumbnailId)
        || (asset === "full" && id === options.expireFullId);
      const attempt = corruptFixture ? (corruptAssetAttempts.get(requestUrl) || 0) + 1 : 1;
      if (corruptFixture) corruptAssetAttempts.set(requestUrl, attempt);
      if (corruptFixture && attempt === 1) {
        await route.fulfill({
          status: 200,
          contentType: "image/webp",
          headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
          body: "not-an-image",
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        headers: {
          "cache-control": "private, max-age=300, stale-while-revalidate=60",
          "x-content-type-options": "nosniff",
        },
        body: asset === "thumbnail" ? thumbnailAssetBody : displayAssetBody,
      });
      return;
    }

    assert(request.method() === "POST", `Gallery feed used unexpected ${request.method()} method.`);
    const body = parseRequestBody(request);
    feedRequests.push({ body, method: request.method(), url: request.url() });

    if ((body.action || "list") === "list") {
      assertListRequestShape(body, `list request ${feedRequests.length}`);
      if (listDeliveryFailuresRemaining > 0) {
        listDeliveryFailuresRemaining -= 1;
        const key = `503 ${request.method()} ${request.url()}`;
        allowedHttpFailures.set(key, (allowedHttpFailures.get(key) || 0) + 1);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: corsHeaders,
          body: JSON.stringify({
            ok: false,
            error: "approved_thumbnail_delivery_failed",
            message: "Member-submitted images are temporarily unavailable.",
          }),
        });
        return;
      }
      if (listFailuresRemaining > 0) {
        listFailuresRemaining -= 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, data: null, message: "Internal fixture detail must not render." }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify(listResponse(body, options)),
      });
      return;
    }

    throw new Error("Gallery browser attempted a forbidden POST media resolver request.");
  });

  page.on("pageerror", (error) => errors.push(`Page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      allowedResourceConsoleErrors > 0
      && text === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
    ) {
      allowedResourceConsoleErrors -= 1;
      return;
    }
    errors.push(`Console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText || "unknown error";
    const canceledAppRouterPrefetch = request.method() === "GET"
      && request.resourceType() === "fetch"
      && url.host === new URL(baseUrl).host
      && url.searchParams.has("_rsc")
      && ["net::ERR_ABORTED", "NS_BINDING_ABORTED", "cancelled"].includes(failure);
    if (canceledAppRouterPrefetch) return;
    errors.push(`Failed request: ${request.method()} ${request.url()} (${failure})`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.includes("/assets/img/gallery/")
      || (
        request.method() === "GET"
        && url.origin === SUPABASE_PROJECT_URL
        && url.pathname === approvedFeedPath
        && ["full", "thumbnail"].includes(url.searchParams.get("asset") || "")
      )
    ) {
      galleryAssetRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const key = `${response.status()} ${response.request().method()} ${response.url()}`;
      const allowed = allowedHttpFailures.get(key) || 0;
      if (allowed > 0) {
        if (allowed === 1) allowedHttpFailures.delete(key);
        else allowedHttpFailures.set(key, allowed - 1);
        return;
      }
      errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  });

  return {
    page,
    errors,
    feedRequests,
    galleryAssetRequests,
    fullActionCounts,
    thumbnailActionCounts,
    corruptAssetAttempts,
  };
}

async function waitUntil(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fail(`${label} timed out.`);
}

function requestsByAction(feedRequests, action) {
  return feedRequests.filter((request) => (request.body.action || "list") === action);
}

async function waitForMediaCount(actionCounts, id, count, label) {
  await waitUntil(() => (actionCounts.get(id) || 0) >= count, label);
}

function normalizeAccessibleText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

async function assertGalleryFilterAccessibleNames(page) {
  const filters = page.locator("#galleryFilters .gallery-filter");
  for (let index = 0; index < await filters.count(); index += 1) {
    const filter = filters.nth(index);
    const expectedName = normalizeAccessibleText(await filter.textContent());
    assert(await filter.getAttribute("aria-label") === null, `Gallery filter ${index + 1} must use rendered content.`);
    assert(
      await filter.and(page.getByRole("button", { name: expectedName, exact: true })).count() === 1,
      `Gallery filter ${index + 1} computed accessible name mismatch: ${expectedName}.`,
    );
  }
}

async function waitForReadyFeed(page) {
  try {
    await page.waitForSelector('.gallery-feed-state[data-state="ready"]');
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      state: document.querySelector(".gallery-feed-state")?.getAttribute("data-state") || "missing",
      status: document.querySelector("#galleryMemberFeedStatus")?.textContent?.trim() || "missing",
      body: document.body.innerText.slice(0, 500),
    })).catch(() => ({ state: "unavailable", status: "unavailable", body: "unavailable" }));
    throw new Error(`Gallery feed did not become ready (${JSON.stringify(diagnostic)}).`, { cause: error });
  }
  await assertGalleryFilterAccessibleNames(page);
}

async function waitForEmptyFeed(page) {
  await page.waitForSelector('.gallery-feed-state[data-state="empty"]');
  await assertGalleryFilterAccessibleNames(page);
  assert(
    (await page.locator("#galleryMemberFeedStatus").textContent())?.trim()
      === "No member-submitted images are available yet.",
    "Confirmed-empty member feed did not render its distinct empty-state copy.",
  );
  assert(
    await page.locator("#galleryMemberFeedStatus").getAttribute("aria-busy") === "false",
    "Confirmed-empty member feed remained marked busy.",
  );
}

async function visibleState(page) {
  return page.evaluate(() => {
    const thumbs = [...document.querySelectorAll("#galleryGrid .gallery-thumb")];
    const filters = [...document.querySelectorAll("#galleryFilters .gallery-filter")];
    return {
      count: thumbs.length,
      countText: document.querySelector("#galleryCount")?.textContent?.trim() || "",
      sortValue: document.querySelector("#gallerySort")?.value || "",
      queryValue: document.querySelector("#gallerySearch")?.value || "",
      bodyText: document.body.innerText,
      fulls: thumbs.map((button) => button.getAttribute("data-full") || ""),
      captions: thumbs.map((button) => button.getAttribute("data-caption") || ""),
      imageSrcs: thumbs.map((button) => button.querySelector("img")?.getAttribute("src") || ""),
      imageAlts: thumbs.map((button) => button.querySelector("img")?.getAttribute("alt") || ""),
      filters: filters.map((button) => ({
        slug: button.dataset.category || "",
        text: button.textContent.trim(),
        pressed: button.getAttribute("aria-pressed") || "",
      })),
    };
  });
}

async function waitForMemberCount(page, expected) {
  await page.waitForFunction(
    (count) => document.querySelectorAll("#galleryGrid .gallery-thumb").length === count,
    expected,
  );
}

async function assertNoErrors(errors, label) {
  if (errors.length) fail(`${label} browser errors: ${errors.join(" | ")}`);
}

async function assertNoSeriousAccessibilityViolations(page, label, scopeSelector = "main") {
  assert(existsSync(axePath), `${label}: axe-core is unavailable.`);
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async ({ selector }) => {
    const scope = document.querySelector(selector);
    if (!scope) return ["missing-accessibility-scope"];
    const result = await window.axe.run(scope, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact || ""))
      .map((violation) => violation.id);
  }, { selector: scopeSelector });
  assert(violations.length === 0, `${label}: serious accessibility findings: ${violations.join(", ")}.`);
}

const galleryViewerSelectors = {
  root: "#lightbox",
  image: "#lightboxImg",
  close: "#lightboxClose",
  card: "#lightbox .lightbox-card",
  shell: "#lightbox .lightbox-shell",
  caption: "#lightboxCaption",
};
const homeViewerSelectors = {
  root: "#modalRoot",
  image: "#modalImage",
  close: "#modalClose",
  card: "#modalRoot .lightbox-card",
  shell: "#modalRoot .lightbox-shell",
  caption: "#modalCaption",
};

async function waitForLightboxOpen(page, selectors = galleryViewerSelectors) {
  await page.waitForFunction((activeSelectors) => {
    const root = document.querySelector(activeSelectors.root);
    const image = document.querySelector(activeSelectors.image);
    const close = document.querySelector(activeSelectors.close);
    const rect = root?.getBoundingClientRect();
    return Boolean(
      root
      && image instanceof HTMLImageElement
      && image.getAttribute("src")
      && image.complete
      && image.naturalWidth > 0
      && image.naturalHeight > 0
      && !root.classList.contains("hidden")
      && root.getAttribute("aria-hidden") !== "true"
      && root.getAttribute("role") === "dialog"
      && root.getAttribute("aria-modal") === "true"
      && rect?.width
      && rect?.height
      && document.activeElement === close,
    );
  }, selectors);
}

async function assertSharedLightboxContract(
  page,
  label,
  expectedSourceFragment = "",
  selectors = galleryViewerSelectors,
) {
  await waitForLightboxOpen(page, selectors);
  const geometry = await page.evaluate((activeSelectors) => {
    const root = document.querySelector(activeSelectors.root);
    const shell = document.querySelector(activeSelectors.shell);
    const card = document.querySelector(activeSelectors.card);
    const image = document.querySelector(activeSelectors.image);
    const close = document.querySelector(activeSelectors.close);
    const caption = document.querySelector(activeSelectors.caption);
    const rootRect = root?.getBoundingClientRect();
    const shellRect = shell?.getBoundingClientRect();
    const imageRect = image?.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();
    return {
      rootWidth: rootRect?.width || 0,
      rootHeight: rootRect?.height || 0,
      shellWidth: shellRect?.width || 0,
      cardWidth: card?.getBoundingClientRect().width || 0,
      imageWidth: imageRect?.width || 0,
      imageHeight: imageRect?.height || 0,
      naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
      naturalHeight: image instanceof HTMLImageElement ? image.naturalHeight : 0,
      closeWidth: closeRect?.width || 0,
      closeHeight: closeRect?.height || 0,
      closeLeft: closeRect?.left || 0,
      closeRight: closeRect?.right || 0,
      closeTop: closeRect?.top || 0,
      captionScrollWidth: caption?.scrollWidth || 0,
      captionClientWidth: caption?.clientWidth || 0,
      src: image?.getAttribute("src") || "",
      bodyOverflow: getComputedStyle(document.body).overflow,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  }, selectors);
  assert(geometry.rootWidth > 0 && geometry.rootHeight > 0, `${label}: viewer root collapsed.`);
  assert(geometry.shellWidth <= geometry.rootWidth + 2, `${label}: viewer shell escaped the overlay.`);
  assert(geometry.cardWidth <= Math.min(1160, geometry.rootWidth) + 2, `${label}: viewer card exceeded its shared 1160px cap.`);
  assert(geometry.cardWidth > 0 && geometry.imageWidth > 0 && geometry.imageHeight > 0, `${label}: viewer image collapsed.`);
  assert(geometry.closeWidth >= 44 && geometry.closeHeight >= 44, `${label}: close control was smaller than 44x44.`);
  assert(
    geometry.closeLeft >= -1 && geometry.closeTop >= -1 && geometry.closeRight <= geometry.rootWidth + 1,
    `${label}: close control escaped the viewport.`,
  );
  assert(geometry.captionScrollWidth <= geometry.captionClientWidth + 1, `${label}: caption overflowed horizontally.`);
  assert(!geometry.horizontalOverflow, `${label}: viewer introduced horizontal page overflow.`);
  assert(geometry.bodyOverflow === "hidden", `${label}: viewer did not lock background scrolling.`);
  assert(
    Math.abs(geometry.imageWidth / geometry.imageHeight - geometry.naturalWidth / geometry.naturalHeight) <= 0.02,
    `${label}: full image aspect ratio drifted.`,
  );
  if (expectedSourceFragment) {
    assert(geometry.src.includes(expectedSourceFragment), `${label}: unexpected full source ${geometry.src}.`);
  }
}

async function assertCloseAndFocusReturn(page, trigger, label, selectors = galleryViewerSelectors) {
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.locator(selectors.card).evaluate((element) => document.activeElement === element),
    `${label}: Shift+Tab did not wrap to the last dialog control.`,
  );
  await page.keyboard.press("Tab");
  assert(
    await page.locator(selectors.close).evaluate((element) => document.activeElement === element),
    `${label}: Tab did not wrap to the first dialog control.`,
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction((rootSelector) => {
    const root = document.querySelector(rootSelector);
    return !root || root.classList.contains("hidden");
  }, selectors.root);
  await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), trigger);
  assert(
    await page.evaluate(() => getComputedStyle(document.body).overflow !== "hidden"),
    `${label}: closing did not restore background scrolling.`,
  );
}

async function assertGalleryPerformanceEnvelope(page, label, expectedAssetUrls) {
  await page.waitForTimeout(250);
  const metrics = await page.evaluate((expectedUrls) => {
    const expected = new Set(expectedUrls);
    return {
      cls: Number(window.__galleryCls || 0),
      transferBytes: performance
        .getEntriesByType("resource")
        .filter((entry) => expected.has(entry.name))
        .reduce((total, entry) => total + Number(entry.transferSize || entry.encodedBodySize || 0), 0),
    };
  }, expectedAssetUrls);
  assert(metrics.cls <= 0.1, `${label}: Gallery CLS ${metrics.cls} exceeded 0.1.`);
  assert(metrics.transferBytes < 2 * 1024 * 1024, `${label}: initial thumbnail transfer reached 2 MiB.`);
}

async function assertNarrowGalleryControlGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector(".gallery-toolbar");
    const controls = document.querySelector(".gallery-controls");
    const filters = document.querySelector(".gallery-filters");
    const orders = [...document.querySelectorAll(".gallery-order")];
    const fields = [...document.querySelectorAll(".gallery-order__select")];
    const shareLink = document.querySelector("#galleryShareLink");
    const copyLink = document.querySelector("#galleryCopyLink");

    if (
      !(toolbar instanceof HTMLElement)
      || !(controls instanceof HTMLElement)
      || !(filters instanceof HTMLElement)
      || !(shareLink instanceof HTMLElement)
      || !(copyLink instanceof HTMLElement)
      || orders.length !== 2
      || fields.length !== 2
      || orders.some((element) => !(element instanceof HTMLElement))
      || fields.some((element) => !(element instanceof HTMLElement))
    ) return null;

    const bounds = (element, name) => {
      const rect = element.getBoundingClientRect();
      return {
        name,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    };

    const toolbarRect = toolbar.getBoundingClientRect();
    const toolbarStyle = getComputedStyle(toolbar);

    return {
      viewportWidth: window.innerWidth,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      contentLeft: toolbarRect.left + Number.parseFloat(toolbarStyle.paddingLeft),
      contentRight: toolbarRect.right - Number.parseFloat(toolbarStyle.paddingRight),
      controls: bounds(controls, "controls"),
      filters: bounds(filters, "filters"),
      orders: orders.map((element, index) => bounds(element, `order ${index + 1}`)),
      fields: fields.map((element, index) => bounds(element, `field ${index + 1}`)),
      shareLink: bounds(shareLink, "Share gallery"),
      copyLink: bounds(copyLink, "Copy link"),
    };
  });

  assert(geometry, `${label}: required Gallery controls were missing.`);
  assert(Math.abs(geometry.viewportWidth - 320) <= 1, `${label}: viewport was not 320 CSS pixels.`);
  assert(geometry.rootFontSize >= 31, `${label}: 200% text sizing was not applied.`);

  const tolerance = 2;
  const all = [
    geometry.controls,
    geometry.filters,
    ...geometry.orders,
    ...geometry.fields,
    geometry.shareLink,
    geometry.copyLink,
  ];
  const fullWidth = [
    geometry.filters,
    ...geometry.orders,
    ...geometry.fields,
    geometry.shareLink,
    geometry.copyLink,
  ];
  const overflowSafe = [
    geometry.controls,
    geometry.filters,
    ...geometry.orders,
    geometry.shareLink,
    geometry.copyLink,
  ];

  assert(
    Math.abs(geometry.controls.left - geometry.contentLeft) <= tolerance
      && Math.abs(geometry.controls.right - geometry.contentRight) <= tolerance,
    `${label}: Gallery controls did not fill the usable toolbar width.`,
  );

  for (const item of all) {
    assert(item.width > 0 && item.height > 0, `${label}: ${item.name} collapsed.`);
    assert(
      item.left >= -tolerance && item.right <= geometry.viewportWidth + tolerance,
      `${label}: ${item.name} escaped the viewport.`,
    );
  }

  for (const item of overflowSafe) {
    assert(
      item.scrollWidth <= item.clientWidth + 1,
      `${label}: ${item.name} overflowed internally (${item.scrollWidth}px > ${item.clientWidth}px).`,
    );
  }

  for (const item of fullWidth) {
    assert(
      Math.abs(item.left - geometry.controls.left) <= tolerance
        && Math.abs(item.right - geometry.controls.right) <= tolerance,
      `${label}: ${item.name} did not reflow to the available width.`,
    );
  }

  for (const item of [...geometry.fields, geometry.shareLink, geometry.copyLink]) {
    assert(item.height >= 44, `${label}: ${item.name} was smaller than 44px.`);
  }

  const stack = [geometry.filters, ...geometry.orders, geometry.shareLink, geometry.copyLink];
  for (let index = 1; index < stack.length; index += 1) {
    assert(
      stack[index].top >= stack[index - 1].bottom - tolerance,
      `${label}: ${stack[index].name} overlapped ${stack[index - 1].name}.`,
    );
  }
}

async function waitForHomeGallery(page) {
  let previousSignature = "";
  let stablePolls = 0;
  for (let poll = 0; poll < 60; poll += 1) {
    const signature = await page.locator("#galleryGrid .home-thumb img[data-full]").evaluateAll((images) =>
      images.map((image) => `${image.getAttribute("src") || ""}|${image.getAttribute("data-full") || ""}`).join("||"),
    );
    if (signature && signature === previousSignature) stablePolls += 1;
    else stablePolls = 0;
    if (stablePolls >= 3 && signature.split("||").length === 4) return;
    previousSignature = signature;
    await page.waitForTimeout(100);
  }
  fail("Home Gallery Spotlight did not settle after hydration.");
}

const browser = await chromium.launch({ headless: true });
let hydratedHomeSignature = "";

try {
  const context = await prepareContext(browser);

  // Static/no-member state keeps the established Gallery and shared-lightbox behavior.
  {
    const checked = await newCheckedPage(context, { empty: true });
    const { page, errors, feedRequests, galleryAssetRequests } = checked;
    await page.goto(`${baseUrl}/gallery`, { waitUntil: "domcontentloaded" });
    await waitForEmptyFeed(page);
    await waitForMemberCount(page, initialStaticCount);
    await assertNoSeriousAccessibilityViolations(page, "static empty Gallery");
    let state = await visibleState(page);
    assert(state.countText === `Showing ${initialStaticCount} of ${staticTotal} images.`, `Unexpected static count: ${state.countText}`);
    assert(state.imageSrcs.every((src) => src.includes("/thumbs/")), "Static Gallery grid must use thumbnails.");
    assert(state.fulls.every(Boolean), "Static Gallery triggers must retain full paths.");
    assert(
      state.fulls.every((full) => !galleryAssetRequests.includes(new URL(full, baseUrl).href)),
      "Static Gallery requested an original before viewer opening.",
    );
    assert(requestsByAction(feedRequests, "list").length === 1, "Static Gallery should make one empty-feed list request.");

    await page.selectOption("#gallerySort", "newest");
    await waitUntil(
      async () => (await visibleState(page)).fulls[0] === newestStaticFull,
      "static newest sort",
    );
    await page.selectOption("#gallerySort", "oldest");
    await waitUntil(
      async () => (await visibleState(page)).fulls[0] === oldestStaticFull,
      "static oldest sort",
    );
    await page.click('#galleryFilters [data-category="portraits"]');
    await waitForMemberCount(page, initialPortraitsCount);
    state = await visibleState(page);
    assert(state.filters.find((filter) => filter.slug === "portraits")?.pressed === "true", "Portrait filter was not active.");

    const trigger = "#galleryGrid .gallery-thumb:first-child";
    await page.click(trigger);
    await assertSharedLightboxContract(page, "static Gallery");
    assert(!(await page.locator("#lightboxImg").getAttribute("src"))?.includes("/thumbs/"), "Static lightbox opened a thumbnail.");
    await assertCloseAndFocusReturn(page, trigger, "static Gallery");
    await assertNoErrors(errors, "static Gallery");
    await page.close();
  }

  // The schema-v2 feed traverses more than 80 items by sequential opaque cursors.
  {
    const checked = await newCheckedPage(context);
    const { page, errors, feedRequests, galleryAssetRequests, fullActionCounts } = checked;
    await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest`, { waitUntil: "domcontentloaded" });
    await waitForReadyFeed(page);
    await waitForMemberCount(page, pageSize);
    await assertNoSeriousAccessibilityViolations(page, "schema-v2 Gallery");
    let state = await visibleState(page);
    assert(state.countText === `Showing 24 of ${fixtureRowCount} images in Member Submissions.`, `Unexpected member count: ${state.countText}`);
    assert(state.fulls.every((full) => full === ""), "Approved cards exposed data-full before viewer opening.");
    assert(state.imageSrcs.every(isFixtureThumbnailUrl), "Approved list rendered a non-thumbnail Edge-media URL.");
    assert(
      state.imageAlts[0] === fixtureRows.at(-1).caption,
      "Approved Gallery alt text did not fall back from an absent title to the caption.",
    );
    assert(
      state.imageAlts[1] === "Gallery image",
      "Approved Gallery alt text did not use the generic fallback when title and caption were absent.",
    );
    assert(requestsByAction(feedRequests, "full").length === 0, "Approved list requested a display derivative before opening.");
    assert(galleryAssetRequests.every((url) => !isFixtureDisplayUrl(url)), "Approved list downloaded a display derivative before opening.");
    assert(
      state.filters.map((filter) => filter.slug).every((slug) => publicFilterCategories.includes(slug)),
      "Gallery rendered a noncanonical category filter.",
    );
    assert(!state.filters.some((filter) => filter.slug === "unknown"), "Historical unknown category became a public filter.");
    assert(
      state.filters.find((filter) => filter.slug === "member-submissions")?.text.includes(String(fixtureRowCount)),
      "Member Submissions facet did not represent the complete dataset.",
    );
    await assertGalleryPerformanceEnvelope(page, "schema-v2 first page", state.imageSrcs);

    for (const expected of [48, 72, 90]) {
      await page.click("#galleryLoadMore");
      await waitForMemberCount(page, expected);
    }
    state = await visibleState(page);
    assert(state.count === fixtureRowCount, `Sequential cursor traversal rendered ${state.count} of ${fixtureRowCount}.`);
    assert(new Set(state.imageAlts).size === fixtureRowCount, "Sequential pages rendered duplicate items.");
    const listRequests = requestsByAction(feedRequests, "list");
    assert(listRequests.length === 4, `Sequential traversal expected four list pages, got ${listRequests.length}.`);
    assert(
      JSON.stringify(listRequests.map((request) => request.body.cursor))
        === JSON.stringify([null, encodeFixtureCursor(24), encodeFixtureCursor(48), encodeFixtureCursor(72)]),
      "Sequential traversal did not preserve the opaque cursor chain.",
    );
    assert(!(await page.locator("#galleryLoadMore").count()), "Load-more control remained after the terminal page.");

    const normalTrigger = "#galleryGrid .gallery-thumb:first-child";
    const selectedId = fixtureRows.at(-1).id;
    await page.click(normalTrigger);
    await waitForMediaCount(fullActionCounts, selectedId, 1, "normal full-image request");
    await assertSharedLightboxContract(page, "approved Gallery", "blob:");
    await assertNoSeriousAccessibilityViolations(page, "approved Gallery viewer", "#lightbox");
    assert(requestsByAction(feedRequests, "full").length === 0, "Opening one approved item used a POST media resolver.");
    assert(fullActionCounts.get(selectedId) === 1, "Normal full request did not use the selected opaque ID exactly once.");
    assert(
      galleryAssetRequests.filter(isFixtureDisplayUrl).length === 1,
      "Opening one approved item downloaded more than its selected display derivative.",
    );
    await assertCloseAndFocusReturn(page, normalTrigger, "approved Gallery");
    await assertNoErrors(errors, "schema-v2 sequential Gallery");
    await page.close();
  }

  // One expired thumbnail is refreshed once and never loops.
  {
    const expiredId = fixtureRows.at(-1).id;
    const checked = await newCheckedPage(context, { expireThumbnailId: expiredId });
    const { page, errors, feedRequests, thumbnailActionCounts, corruptAssetAttempts } = checked;
    await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest`, { waitUntil: "domcontentloaded" });
    await waitForReadyFeed(page);
    await page.waitForFunction(
      () => document.querySelector("#galleryGrid .gallery-thumb:first-child .responsive-gallery-media")?.getAttribute("data-image-state") === "ready",
    );
    await waitForMediaCount(thumbnailActionCounts, expiredId, 2, "expired thumbnail refresh");
    await page.waitForTimeout(400);
    assert(thumbnailActionCounts.get(expiredId) === 2, "Expired thumbnail did not stop after one bounded refresh.");
    assert(requestsByAction(feedRequests, "thumbnail").length === 0, "Expired thumbnail used a POST media resolver.");
    assert(
      corruptAssetAttempts.get(thumbnailUrl(expiredId)) === 2,
      "Identical refreshed thumbnail URL was not requested exactly twice across its bounded retry.",
    );
    assert(requestsByAction(feedRequests, "full").length === 0, "Thumbnail refresh requested an original.");
    await assertNoErrors(errors, "expired thumbnail");
    await page.close();
  }

  // One expired full-image capability is resolved exactly once more, then stops.
  {
    const expiredId = fixtureRows.at(-1).id;
    const checked = await newCheckedPage(context, { expireFullId: expiredId });
    const { page, errors, feedRequests, fullActionCounts, corruptAssetAttempts } = checked;
    await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest`, { waitUntil: "domcontentloaded" });
    await waitForReadyFeed(page);
    await page.click("#galleryGrid .gallery-thumb:first-child");
    await waitForMediaCount(fullActionCounts, expiredId, 2, "expired full-image refresh");
    await assertSharedLightboxContract(page, "expired full image", "blob:");
    await page.waitForTimeout(400);
    assert(fullActionCounts.get(expiredId) === 2, "Expired full image did not stop after one bounded refresh.");
    assert(requestsByAction(feedRequests, "full").length === 0, "Expired full image used a POST media resolver.");
    assert(
      corruptAssetAttempts.get(displayUrl(expiredId)) === 2,
      "Identical refreshed full URL was not requested exactly twice across its bounded retry.",
    );
    await assertNoErrors(errors, "expired full image");
    await page.close();
  }

  // A list-delivery failure is all-or-nothing, exposes no cursor, and retries
  // only from the unchanged first-page boundary after user activation.
  {
    const checked = await newCheckedPage(context, { listDeliveryFailures: 1 });
    const { page, errors, feedRequests } = checked;
    await page.goto(`${baseUrl}/gallery?sort=newest`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.gallery-feed-state[data-state="error"]');
    await assertNoSeriousAccessibilityViolations(page, "Gallery delivery-error state");
    assert(
      (await page.locator("#galleryMemberFeedStatus").textContent())?.includes("Member-submitted images are temporarily unavailable."),
      "All-or-nothing delivery failure did not render customer-safe copy.",
    );
    assert(!(await page.locator("body").innerText()).includes("approved_thumbnail_delivery_failed"), "Delivery failure leaked an internal error code.");
    await page.waitForTimeout(300);
    let listRequests = requestsByAction(feedRequests, "list");
    assert(listRequests.length === 1, "Delivery failure retried without user activation.");
    assert(listRequests[0].body.cursor === null, "Failed first page unexpectedly carried a cursor.");
    await page.locator(".gallery-feed-retry").focus();
    await page.keyboard.press("Enter");
    await waitForReadyFeed(page);
    listRequests = requestsByAction(feedRequests, "list");
    assert(listRequests.length === 2, "User-activated delivery retry did not run exactly once.");
    assert(listRequests.every((request) => request.body.cursor === null), "Delivery failure advanced the cursor before retry.");
    assert(
      (await page.locator("#galleryMemberFeedStatus").textContent())?.includes("Member-submitted images loaded."),
      "Successful delivery retry did not restore the feed.",
    );
    await assertNoErrors(errors, "all-or-nothing Gallery delivery failure");
    await page.close();
  }

  // Search, category, and sort are URL-backed, with exactly five canonical
  // visual facets plus Member Submissions.
  {
    const checked = await newCheckedPage(context);
    const { page, errors, feedRequests } = checked;
    await page.addInitScript(() => {
      window.__galleryShareCalls = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.__galleryShareCalls.push(data);
        },
      });
    });
    await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest`, { waitUntil: "domcontentloaded" });
    await waitForReadyFeed(page);

    await page.selectOption("#gallerySort", "oldest");
    await page.waitForURL(/sort=oldest/);
    await waitUntil(
      () => requestsByAction(feedRequests, "list").some((request) => request.body.sort === "oldest"),
      "oldest list request",
    );

    await page.click('#galleryFilters [data-category="action"]');
    await page.waitForURL(/category=action/);
    await waitUntil(
      () => requestsByAction(feedRequests, "list").some((request) => request.body.category === "action"),
      "action category request",
    );
    await waitForReadyFeed(page);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.searchParams.get("category") === "member-submissions" && url.searchParams.get("sort") === "oldest");
    await waitForReadyFeed(page);
    await page.goForward({ waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.searchParams.get("category") === "action" && url.searchParams.get("sort") === "oldest");
    await waitForReadyFeed(page);

    await page.fill("#gallerySearch", "Approved Smoke Submission 003");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL(/q=Approved\+Smoke\+Submission\+003/);
    await waitForReadyFeed(page);
    await waitForMemberCount(page, 1);
    let state = await visibleState(page);
    assert(state.imageAlts[0] === "Approved Smoke Submission 003", "URL-backed search returned the wrong item.");

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has("q"));

    const portraitRow = fixtureRows.find((item) => item.category === "portraits");
    assert(portraitRow, "Fixture must include a portrait publication.");
    await page.click('#galleryFilters [data-category="portraits"]');
    await page.fill("#gallerySearch", portraitRow.title);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await waitForReadyFeed(page);
    await waitForMemberCount(page, 1);
    state = await visibleState(page);
    assert(state.imageAlts[0] === portraitRow.title, "Canonical category search returned the wrong publication.");

    const expectedShareUrl = page.url();
    await page.getByRole("button", { name: "Share gallery", exact: true }).click();
    await page.waitForFunction(() => window.__galleryShareCalls?.length === 1);
    const nativeShare = await page.evaluate(() => window.__galleryShareCalls[0]);
    assert(nativeShare.url === expectedShareUrl, "Native Gallery sharing did not preserve the canonical filter URL.");
    assert(nativeShare.title === "Mōchirīī Gallery", "Native Gallery sharing lost the public brand title.");
    assert(
      (await page.locator("#galleryShareStatus").textContent()) === "Gallery shared",
      "Native Gallery sharing did not announce success.",
    );

    await page.click('#galleryFilters [data-category="scenery"]');
    await waitForEmptyFeed(page);
    await page.waitForSelector("#galleryEmpty:not([hidden])");
    state = await visibleState(page);
    assert(state.count === 0, "A portrait publication leaked into the scenery category.");
    assert(state.bodyText.includes("No images match this search."), "Zero-result search state was not rendered.");
    assert(!state.filters.some((filter) => !publicFilterCategories.includes(filter.slug)), "Noncanonical filter leaked into the zero state.");
    await assertNoErrors(errors, "URL state and category contract");
    await page.close();
  }

  // Browsers without Web Share use the explicit copy fallback without adding
  // a provider request or changing the canonical Gallery URL.
  {
    const checked = await newCheckedPage(context);
    const { page, errors } = checked;
    await page.addInitScript(() => {
      window.__galleryCopiedValue = "";
      window.__galleryClipboardAttempts = 0;
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            window.__galleryClipboardAttempts += 1;
            throw new DOMException("Clipboard permission denied", "NotAllowedError");
          },
        },
      });
      document.execCommand = (command) => {
        if (command !== "copy") return false;
        window.__galleryCopiedValue = document.querySelector("textarea")?.value || "";
        return true;
      };
    });
    await page.goto(`${baseUrl}/gallery?category=scenery&sort=oldest`, { waitUntil: "domcontentloaded" });
    await waitForReadyFeed(page);
    const expectedCopyUrl = page.url();
    await page.getByRole("button", { name: "Share gallery", exact: true }).click();
    await page.waitForFunction(() => window.__galleryCopiedValue !== "");
    assert(
      await page.evaluate(() => window.__galleryCopiedValue) === expectedCopyUrl,
      "Gallery copy fallback did not preserve the canonical filter URL.",
    );
    assert(
      await page.evaluate(() => window.__galleryClipboardAttempts) === 1,
      "Gallery copy fallback did not exercise the rejected async Clipboard path exactly once.",
    );
    assert(
      (await page.locator("#galleryShareStatus").textContent()) === "Link copied",
      "Gallery copy fallback did not announce success.",
    );
    await assertNoErrors(errors, "Gallery share fallback");
    await page.close();
  }

  // Explicit feed error stays customer-safe and retries only after user activation.
  {
    const checked = await newCheckedPage(context, { listFailures: 1 });
    const { page, errors, feedRequests } = checked;
    await page.goto(`${baseUrl}/gallery?sort=newest`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.gallery-feed-state[data-state="error"]');
    await assertNoSeriousAccessibilityViolations(page, "Gallery feed-error state");
    assert(
      (await page.locator("#galleryMemberFeedStatus").textContent())?.includes("Member-submitted images are temporarily unavailable."),
      "Feed error did not render customer-safe copy.",
    );
    assert(!(await page.locator("body").innerText()).includes("Internal fixture detail"), "Feed error leaked internal response text.");
    await page.waitForTimeout(300);
    assert(requestsByAction(feedRequests, "list").length === 1, "Feed error retried without user action.");
    await page.locator(".gallery-feed-retry").focus();
    await page.keyboard.press("Enter");
    await waitForReadyFeed(page);
    assert(requestsByAction(feedRequests, "list").length === 2, "User-activated feed retry did not run exactly once.");
    await assertNoErrors(errors, "feed failure and retry");
    await page.close();
  }

  // WCAG reflow and the shared short-height viewer contract at 320 CSS px and 200% text.
  {
    const narrowContext = await prepareContext(browser, { width: 320, height: 256 });
    try {
      const checked = await newCheckedPage(narrowContext);
      const { page, errors, fullActionCounts } = checked;
      await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest&q=Approved%20Smoke%20Submission%20001`, {
        waitUntil: "domcontentloaded",
      });
      await page.addStyleTag({ content: "html{font-size:200%}" });
      await waitForReadyFeed(page);
      await waitForMemberCount(page, 1);
      await assertNoSeriousAccessibilityViolations(page, "320px and 200% Gallery");
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        "Gallery overflowed horizontally at 320px and 200% text.",
      );
      await assertNarrowGalleryControlGeometry(page, "320px and 200% Gallery");
      const card = await page.locator("#galleryGrid .gallery-thumb").boundingBox();
      assert(card && card.x >= -1 && card.x + card.width <= 321, "Gallery card escaped the 320px viewport.");
      await page.click("#galleryGrid .gallery-thumb");
      await waitForMediaCount(fullActionCounts, fixtureRows[0].id, 1, "narrow full-image request");
      await assertSharedLightboxContract(page, "320px/200% Gallery", "blob:");
      const reachable = await page.evaluate(() => {
        const root = document.querySelector("#lightbox");
        const card = document.querySelector("#lightbox .lightbox-card");
        const caption = document.querySelector("#lightboxCaption");
        if (!(root instanceof HTMLElement) || !(card instanceof HTMLElement) || !(caption instanceof HTMLElement)) return false;
        card.scrollTop = card.scrollHeight;
        const rootRect = root.getBoundingClientRect();
        const captionRect = caption.getBoundingClientRect();
        return captionRect.bottom <= rootRect.bottom + 2 && (card.scrollHeight <= card.clientHeight + 1 || card.scrollTop > 0);
      });
      assert(reachable, "Long lightbox caption was not reachable by vertical scrolling.");
      await page.click("#lightboxClose");
      await assertNoErrors(errors, "320px and 200% Gallery");
      await page.close();
    } finally {
      await narrowContext.close();
    }
  }

  // Home Screenshot Spotlight remains static and uses the same accessible viewer behavior.
  {
    const checked = await newCheckedPage(context);
    const { page, errors, feedRequests } = checked;
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await waitForHomeGallery(page);
    const home = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("#galleryGrid .home-thumb")];
      return {
        count: buttons.length,
        srcs: buttons.map((button) => button.querySelector("img")?.getAttribute("src") || ""),
        fulls: buttons.map((button) => button.querySelector("img")?.getAttribute("data-full") || ""),
      };
    });
    assert(home.count === 4, `Home Gallery Spotlight expected four images, got ${home.count}.`);
    assert(new Set(home.srcs).size === 4 && home.srcs.every((src) => src.includes("/thumbs/")), "Home Spotlight must use four distinct thumbnails.");
    assert(new Set(home.fulls).size === 4 && home.fulls.every((full) => full && !full.includes("/thumbs/")), "Home Spotlight must map to four distinct originals.");
    hydratedHomeSignature = JSON.stringify(home.fulls);
    await page.waitForTimeout(400);
    assert(
      JSON.stringify(await page.locator("#galleryGrid .home-thumb img[data-full]").evaluateAll((images) =>
        images.map((image) => image.getAttribute("data-full") || ""),
      )) === hydratedHomeSignature,
      "Home Spotlight reordered after hydration.",
    );
    assert(feedRequests.length === 0, "Home Spotlight requested the member Gallery feed.");
    const trigger = "#galleryGrid .home-thumb:first-child";
    await page.click(trigger);
    await assertSharedLightboxContract(page, "Home Spotlight", "", homeViewerSelectors);
    await assertNoSeriousAccessibilityViolations(page, "Home Spotlight viewer", "#modalRoot");
    await assertCloseAndFocusReturn(page, trigger, "Home Spotlight", homeViewerSelectors);
    await assertNoErrors(errors, "Home Spotlight");
    await page.close();
  }

  await context.close();

  // The server-rendered static Gallery remains useful without JavaScript or private requests.
  const noJavaScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    await stubVercelAnalyticsScripts(noJavaScriptContext);
    const page = await noJavaScriptContext.newPage();
    const errors = [];
    const noJavaScriptFeedRequests = [];
    page.on("pageerror", (error) => errors.push(`Page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`Console error: ${message.text()}`);
    });
    page.on("requestfailed", (request) => {
      if (request.resourceType() === "script") return;
      errors.push(`Failed request: ${request.method()} ${request.url()}`);
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(approvedFeedPath)) noJavaScriptFeedRequests.push(request.url());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    await page.goto(`${baseUrl}/gallery`, { waitUntil: "load" });
    const image = page.locator("#galleryGrid .gallery-thumb:first-child .responsive-gallery-media__image");
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => new Promise((resolve) => {
      if (element.complete) resolve();
      else {
        element.addEventListener("load", resolve, { once: true });
        element.addEventListener("error", resolve, { once: true });
      }
    }));
    const state = await image.evaluate((element) => {
      const routeRoot = document.querySelector(".gallery-page[data-gallery-page]");
      const grid = element.closest(".gallery-grid");
      const trigger = element.closest(".gallery-thumb");
      const routeStyles = routeRoot ? getComputedStyle(routeRoot) : null;
      const gridStyles = grid ? getComputedStyle(grid) : null;
      const gridRect = grid?.getBoundingClientRect();
      const triggerRect = trigger?.getBoundingClientRect();
      return {
        naturalWidth: element.naturalWidth,
        opacity: getComputedStyle(element).opacity,
        objectFit: getComputedStyle(element).objectFit,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        triggerTag: trigger?.tagName || "",
        triggerHref: trigger?.getAttribute("href") || "",
        noJavaScriptCopy: document.body.innerText.replace(/\s+/g, " ").trim(),
        routeRootPresent: Boolean(routeRoot),
        bodyPage: document.body.dataset.page || "",
        galleryThemeToken: routeStyles?.getPropertyValue("--gallery-frost").trim() || "",
        gridDisplay: gridStyles?.display || "",
        gridColumns: gridStyles?.gridTemplateColumns || "",
        gridWidth: gridRect?.width || 0,
        triggerWidth: triggerRect?.width || 0,
        triggerHeight: triggerRect?.height || 0,
        triggerLeft: triggerRect?.left || 0,
        triggerRight: triggerRect?.right || 0,
      };
    });
    assert(state.naturalWidth > 0, "JavaScript-disabled Gallery did not load its static thumbnail.");
    assert(state.opacity === "1" && state.objectFit === "cover", "JavaScript-disabled Gallery lost its shared thumbnail contract.");
    assert(!state.horizontalOverflow, "JavaScript-disabled Gallery overflowed horizontally.");
    assert(state.triggerTag === "A" && state.triggerHref && !state.triggerHref.includes("/thumbs/"), "JavaScript-disabled Gallery did not expose a direct original-image link.");
    assert(state.routeRootPresent, "JavaScript-disabled Gallery did not render its route style scope on the server.");
    assert(state.bodyPage !== "gallery", "No-JavaScript geometry test unexpectedly depended on the client body marker.");
    assert(state.galleryThemeToken, "JavaScript-disabled Gallery did not receive its route theme variables before hydration.");
    assert(state.gridDisplay === "grid", "JavaScript-disabled Gallery lost its grid layout before hydration.");
    assert(state.gridColumns.trim().split(/\s+/).length === 2, `JavaScript-disabled Gallery expected two columns at 390px, got ${state.gridColumns}.`);
    assert(
      state.gridWidth > 0 && state.triggerWidth > 100 && state.triggerHeight > 0
        && state.triggerLeft >= -1 && state.triggerRight <= 391,
      "JavaScript-disabled Gallery card geometry collapsed or escaped the viewport before hydration.",
    );
    assert(
      state.noJavaScriptCopy.includes("Interactive filters and member-submitted images require JavaScript.")
        && state.noJavaScriptCopy.includes("The published images below remain available as direct links."),
      "JavaScript-disabled Gallery did not explain its truthful static fallback.",
    );
    assert(noJavaScriptFeedRequests.length === 0, "JavaScript-disabled Gallery made a private member-feed request.");
    await assertNoErrors(errors, "JavaScript-disabled Gallery");

    await page.goto(`${baseUrl}/`, { waitUntil: "load" });
    const noJavaScriptHomeFulls = await page.locator("#galleryGrid .home-thumb img[data-full]").evaluateAll((images) =>
      images.map((image) => image.getAttribute("data-full") || ""),
    );
    assert(noJavaScriptHomeFulls.length === 4, "JavaScript-disabled Home did not server-render exactly four Spotlight images.");
    assert(
      JSON.stringify(noJavaScriptHomeFulls) === hydratedHomeSignature,
      "Home Spotlight server and hydrated image order diverged.",
    );
  } finally {
    await noJavaScriptContext.close();
  }

  console.log("Gallery approved feed schema-v2 smoke OK (90 immutable publications, bounded Edge media, cursor traversal, deferred display derivatives, bounded retries, and reflow).");
} finally {
  await browser.close();
}
