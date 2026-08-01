import { readFile } from "node:fs/promises";
import { enforceProductionGalleryMatrixGuard } from "./lib/live-gallery-media-smoke-guard.mjs";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
enforceProductionGalleryMatrixGuard({ baseUrl, siteOrigin: SITE_ORIGIN });
const galleryDataUrl = new URL("../apps/web/public/data/gallery.json", import.meta.url);
const galleryData = JSON.parse(await readFile(galleryDataUrl, "utf8"));
const publicUrls = JSON.parse(
  await readFile(new URL("../apps/web/config/public-urls.json", import.meta.url), "utf8"),
);
const staticItems = (Array.isArray(galleryData?.albums) ? galleryData.albums : []).flatMap((album) =>
  Array.isArray(album?.items) ? album.items : [],
);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is required for this optional smoke test.");
  console.error("Start a local server, then run this in an environment with Playwright available.");
  process.exit(1);
}

const normalizeSlug = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getCategories = (item) => {
  const values = Array.isArray(item?.categories) && item.categories.length ? item.categories : [item?.category];
  return [...new Set(values.map(normalizeSlug).filter(Boolean))];
};

const text = (value, fallback = "") => {
  const clean = String(value ?? "").trim();
  return clean || fallback;
};

const sortTime = (item) => {
  const time = Date.parse(text(item?.galleryAddedAt));
  return Number.isFinite(time) ? time : 0;
};

const extractNumericSequence = (value) => {
  const clean = text(value);
  if (!clean) return null;

  const named = clean.match(/(?:^|[\\/_-])(?:shot|image|img)[-_]?(\d+)(?=$|[.\\/_-])/i);
  if (named) return Number.parseInt(named[1], 10);

  const matches = [...clean.matchAll(/(\d+)/g)];
  const fallback = matches.at(-1)?.[1];
  return fallback ? Number.parseInt(fallback, 10) : null;
};

const stableSequence = (item, originalIndex) => {
  for (const candidate of [item?.id, item?.full, item?.src, item?.thumb]) {
    const sequence = extractNumericSequence(candidate);
    if (sequence !== null && Number.isFinite(sequence)) return sequence;
  }

  return originalIndex + 1;
};

const stableKey = (item, originalIndex) =>
  text(item?.id || item?.full || item?.src || item?.thumb, `gallery-${originalIndex}`);

const orderItems = (items, mode) =>
  items
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

const publicPath = (value) => {
  const raw = text(value);
  if (!raw) return "";
  if (/^(https?:|\/)/i.test(raw)) return raw;
  if (raw.startsWith("./")) return `/${raw.slice(2)}`;
  return `/${raw}`;
};

const fullPath = (item) => publicPath(item?.full || item?.src);
const staticTotal = staticItems.length;
const portraitsTotal = staticItems.filter((item) => getCategories(item).includes("portraits")).length;
const galleryBatchSize = 24;
const initialStaticCount = Math.min(staticTotal, galleryBatchSize);
const initialPortraitsCount = Math.min(portraitsTotal, galleryBatchSize);
const newestFirst = fullPath(orderItems(staticItems, "newest")[0]);
const oldestFirst = fullPath(orderItems(staticItems, "oldest")[0]);

const mockApprovedCount = galleryBatchSize;
const mockGalleryMediaEndpoint = `https://${publicUrls.supabaseProjectRef}.supabase.co/functions/v1/list-approved-gallery-submissions`;
const mockFullImageBytes = await readFile(
  new URL("../apps/web/public/assets/img/gallery/shot-24.webp", import.meta.url),
);
const mockThumbnailImageBytes = await readFile(
  new URL("../apps/web/public/assets/values/sweetness.webp", import.meta.url),
);
const mockGalleryMediaUrl = (asset, id) => {
  const url = new URL(mockGalleryMediaEndpoint);
  url.searchParams.set("asset", asset);
  url.searchParams.set("id", id);
  return url.toString();
};
const mockApprovedTitle = "Approved Smoke Submission";
const mockApprovedCaption = "Shared from smoke automation";
const mockApprovedRows = Array.from({ length: mockApprovedCount }, (_, index) => {
  const sequence = String(index + 1).padStart(2, "0");
  const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  return {
    id,
    title: index === 0 ? mockApprovedTitle : `${mockApprovedTitle} ${sequence}`,
    caption: mockApprovedCaption,
    category: "portraits",
    categories: ["member-submissions", "portraits"],
    mime_type: "image/webp",
    size_bytes: mockFullImageBytes.byteLength,
    created_at: new Date(Date.UTC(2030, 0, 31 - index, 3, 4, 5)).toISOString(),
    reviewed_at: new Date(Date.UTC(2030, 0, 31 - index, 4, 4, 5)).toISOString(),
    thumbnail_url: mockGalleryMediaUrl("thumbnail", id),
    thumbnail_size_bytes: mockThumbnailImageBytes.byteLength,
    thumbnail_width: 640,
    thumbnail_height: 640,
  };
});
const mockApprovedIds = new Set(mockApprovedRows.map((submission) => submission.id));
const mockFullMediaUrls = mockApprovedRows.map((submission) => mockGalleryMediaUrl("full", submission.id));
const mockThumbnailMediaUrls = mockApprovedRows.map((submission) => submission.thumbnail_url);
const mockFacets = {
  "member-submissions": mockApprovedCount,
  portraits: mockApprovedCount,
  gatherings: 0,
  action: 0,
  scenery: 0,
  companions: 0,
};
const approvedFeedPage = (items, facets = mockFacets) => ({
  schemaVersion: 2,
  items,
  count: items.length,
  totalEligible: items.length,
  facets,
  hasMore: false,
  nextCursor: null,
  partial: false,
  complete: true,
  deliveryFailures: 0,
  delivery: "bounded-edge-media",
  cacheSeconds: 15,
});

const feedFixtures = {
  empty: {
    ok: true,
    data: approvedFeedPage([], {
      "member-submissions": 0,
      portraits: 0,
      gatherings: 0,
      action: 0,
      scenery: 0,
      companions: 0,
    }),
  },
  success: {
    ok: true,
    data: approvedFeedPage(mockApprovedRows),
  },
  fail: {
    ok: false,
    data: null,
    message: "Mock approved feed failure.",
  },
};
const approvedFeedRoutePattern = "**/functions/v1/list-approved-gallery-submissions*";
const vercelAnalyticsScriptPaths = new Set([
  "/_vercel/insights/script.js",
  "/_vercel/speed-insights/script.js",
]);
const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
};

const approvedFeedRequestBody = ({ category = null, cursor = null, query = null, sort = "newest" } = {}) => ({
  action: "list",
  pageSize: galleryBatchSize,
  cursor,
  sort,
  category,
  query,
});
const defaultApprovedFeedRequestBody = approvedFeedRequestBody();

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function stubVercelAnalyticsScripts(context) {
  const appOrigin = new URL(baseUrl).origin;
  await context.route(
    (url) => url.origin === appOrigin && vercelAnalyticsScriptPaths.has(url.pathname),
    (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
}

async function stubApprovedGalleryFeedFixture(page, fixture, feedRequests, onHandled, waitForRelease) {
  await page.route(approvedFeedRoutePattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }

    const asset = url.searchParams.get("asset");
    const id = url.searchParams.get("id");
    if (request.method() === "GET" && (asset === "full" || asset === "thumbnail") && id && mockApprovedIds.has(id)) {
      const body = asset === "full" ? mockFullImageBytes : mockThumbnailImageBytes;
      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders,
          "cache-control": "public, max-age=3600",
          "content-encoding": "identity",
          "content-length": String(body.byteLength),
          "content-type": "image/webp",
          "timing-allow-origin": "*",
        },
        body,
      });
      return;
    }

    feedRequests.push({
      method: request.method(),
      postData: request.postData() || "",
      url: request.url(),
    });
    await waitForRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify(fixture),
    });
    onHandled();
  });
}

async function prepareContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await stubVercelAnalyticsScripts(context);
  return context;
}

async function newCheckedPage(context, feedMode = null, { holdFixture = false } = {}) {
  const page = await context.newPage();
  const errors = [];
  const feedRequests = [];
  const galleryAssetRequests = [];
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
  let resolveFixture;
  const fixtureHandled = new Promise((resolve) => {
    resolveFixture = resolve;
  });
  const fixture = feedFixtures[feedMode || "empty"];
  assert(fixture, `Unknown approved-feed fixture: ${feedMode}`);
  let releaseFixture;
  const fixtureRelease = holdFixture
    ? new Promise((resolve) => {
        releaseFixture = resolve;
      })
    : Promise.resolve();

  await stubApprovedGalleryFeedFixture(page, fixture, feedRequests, () => resolveFixture?.(), fixtureRelease);

  page.on("pageerror", (err) => errors.push(`Page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`Console error: ${msg.text()}`);
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
      `Failed request: ${request.method()} ${request.url()} (${failure})`,
    );
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.includes("/assets/img/gallery/") ||
      mockFullMediaUrls.includes(request.url()) ||
      mockThumbnailMediaUrls.includes(request.url())
    ) galleryAssetRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  });

  const waitForFeedFixture = async (label, expectedBodies = [defaultApprovedFeedRequestBody]) => {
    assert(feedMode, `${label}: no approved-feed fixture was configured.`);

    let timeout;
    try {
      await Promise.race([
        fixtureHandled,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`${label}: approved-feed request timed out.`)), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }

    assertFeedRequestContract(feedRequests, label, expectedBodies);
  };

  return {
    page,
    errors,
    feedRequests,
    galleryAssetRequests,
    releaseFeedFixture: () => releaseFixture?.(),
    waitForFeedFixture,
  };
}

async function assertGalleryPerformanceEnvelope(page, label, expectedAssetUrls = null) {
  await page.waitForTimeout(250);
  const metrics = await page.evaluate((expectedUrls) => {
    const expected = Array.isArray(expectedUrls) ? new Set(expectedUrls) : null;
    return {
      cls: Number(window.__galleryCls || 0),
      imageTransferBytes: performance
        .getEntriesByType("resource")
        .filter((entry) => expected ? expected.has(entry.name) : new URL(entry.name).pathname.includes("/assets/img/gallery/"))
        .reduce((total, entry) => total + Number(entry.transferSize || entry.encodedBodySize || 0), 0),
    };
  }, expectedAssetUrls);
  assert(metrics.cls <= 0.1, `${label}: Gallery CLS ${metrics.cls} exceeded 0.1.`);
  assert(metrics.imageTransferBytes < 2 * 1024 * 1024, `${label}: initial Gallery image transfer ${metrics.imageTransferBytes} bytes reached 2 MiB.`);
}

async function assertRepresentativeMemberThumbnailBatch(page, galleryAssetRequests) {
  const images = page.locator("#galleryGrid .gallery-thumb img");
  assert(await images.count() === mockApprovedCount, `Representative member batch expected ${mockApprovedCount} images.`);

  for (let index = 0; index < mockApprovedCount; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((node) => {
      if (!(node instanceof HTMLImageElement) || !node.complete || node.naturalWidth < 1) {
        return new Promise((resolve, reject) => {
          node.addEventListener("load", () => resolve(undefined), { once: true });
          node.addEventListener("error", () => reject(new Error("Member thumbnail failed to load.")), { once: true });
        });
      }
      return undefined;
    });
  }

  const requestedThumbnailUrls = new Set(
    galleryAssetRequests.filter((url) => mockThumbnailMediaUrls.includes(url)),
  );
  assert(
    requestedThumbnailUrls.size === mockApprovedCount,
    `Representative member batch requested ${requestedThumbnailUrls.size} of ${mockApprovedCount} thumbnails.`,
  );
  assert(
    mockFullMediaUrls.every((url) => !galleryAssetRequests.includes(url)),
    "Representative member batch requested an original before viewer opening.",
  );

  const transferBytes = await page.evaluate((expectedUrls) => {
    const expected = new Set(expectedUrls);
    return performance
      .getEntriesByType("resource")
      .filter((entry) => expected.has(entry.name))
      .reduce((total, entry) => total + Number(entry.transferSize || entry.encodedBodySize || 0), 0);
  }, mockThumbnailMediaUrls);
  assert(
    transferBytes < 2 * 1024 * 1024,
    `Representative 24-member thumbnail transfer ${transferBytes} bytes reached 2 MiB.`,
  );
}

function canonicalJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function assertFeedRequestContract(feedRequests, label, expectedBodies = [defaultApprovedFeedRequestBody]) {
  assert(feedRequests.length >= 1, `${label}: expected at least one approved-feed POST.`);
  const expected = new Set(expectedBodies.map(canonicalJson));
  const actual = [];

  for (const request of feedRequests) {
    assert(request.method === "POST", `${label}: expected approved-feed POST, got ${request.method}.`);
    assert(request.url === mockGalleryMediaEndpoint, `${label}: unexpected approved-feed URL ${request.url}.`);

    let body;
    try {
      body = JSON.parse(request.postData || "null");
    } catch {
      fail(`${label}: approved-feed request body was not valid JSON.`);
    }
    assert(body && typeof body === "object" && !Array.isArray(body), `${label}: approved-feed request body must be an object.`);
    const serialized = canonicalJson(body);
    assert(expected.has(serialized), `${label}: unexpected approved-feed request body ${serialized}.`);
    actual.push(serialized);
  }

  for (const expectedBody of expected) {
    assert(actual.includes(expectedBody), `${label}: missing approved-feed request body ${expectedBody}.`);
  }
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

async function waitForGalleryState(
  page,
  {
    activeCategory,
    expectedFirstFull = "",
    feedState = "",
    renderedCount,
    sortValue,
    totalCount,
  },
) {
  await page.waitForFunction(
    (expected) => {
      const thumbs = [...document.querySelectorAll("#galleryGrid .gallery-thumb")];
      const filters = [...document.querySelectorAll("#galleryFilters .gallery-filter")];
      const activeFilter = filters.find((filter) => filter.getAttribute("aria-pressed") === "true");
      const allFilter = filters.find((filter) => filter.dataset.category === "all");
      const allCount = Number.parseInt(allFilter?.textContent?.match(/(\d+)(?:\s+images?)?\s*$/)?.[1] || "", 10);
      const firstFull = thumbs[0]?.getAttribute("data-full") || "";
      const currentFeedState = document.querySelector(".gallery-feed-state")?.getAttribute("data-state") || "";
      const sort = document.querySelector("#gallerySort")?.value || "";
      const params = new URLSearchParams(window.location.search);
      const categoryParam = params.get("category") || "";
      const sortParam = params.get("sort") || "";
      const categoryUrlMatches = expected.activeCategory === "all"
        ? categoryParam === ""
        : categoryParam === expected.activeCategory;
      const sortUrlMatches = expected.sortValue === "random"
        ? sortParam === ""
        : sortParam === expected.sortValue;

      return thumbs.length === expected.renderedCount
        && allCount === expected.totalCount
        && sort === expected.sortValue
        && activeFilter?.dataset.category === expected.activeCategory
        && categoryUrlMatches
        && sortUrlMatches
        && (!expected.feedState || currentFeedState === expected.feedState)
        && (!expected.expectedFirstFull || firstFull === expected.expectedFirstFull);
    },
    { activeCategory, expectedFirstFull, feedState, renderedCount, sortValue, totalCount },
  );
  await assertGalleryFilterAccessibleNames(page);
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

async function visibleState(page) {
  return page.evaluate(() => {
    const thumbs = [...document.querySelectorAll("#galleryGrid .gallery-thumb")];
    const filters = [...document.querySelectorAll("#galleryFilters .gallery-filter")];

    return {
      count: thumbs.length,
      countText: document.querySelector("#galleryCount")?.textContent?.trim() || "",
      sortValue: document.querySelector("#gallerySort")?.value || "",
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

async function assertNoErrors(errors, label) {
  if (errors.length) fail(`${label} browser errors: ${errors.join(" | ")}`);
}

async function waitForLightboxOpen(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector("#lightbox");
    const img = document.querySelector("#lightboxImg");
    const close = document.querySelector("#lightboxClose");
    const rect = root?.getBoundingClientRect();

    return Boolean(
      root &&
        img instanceof HTMLImageElement &&
        img.getAttribute("src") &&
        img.complete &&
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        !root.classList.contains("hidden") &&
        !root.hasAttribute("aria-hidden") &&
        rect?.width &&
        rect?.height &&
        document.activeElement === close,
    );
  });
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await prepareContext(browser);

  {
    const { page, errors, feedRequests, galleryAssetRequests, waitForFeedFixture } = await newCheckedPage(context, "empty");
    await page.goto(`${baseUrl}/gallery`, { waitUntil: "domcontentloaded" });
    await waitForFeedFixture("static Gallery");
    await waitForGalleryState(page, {
      activeCategory: "all",
      feedState: "empty",
      renderedCount: initialStaticCount,
      sortValue: "random",
      totalCount: staticTotal,
    });

    let state = await visibleState(page);
    assert(state.count === initialStaticCount, `Static Gallery expected initial ${initialStaticCount} items, got ${state.count}.`);
    assert(state.countText === `Showing ${initialStaticCount} of ${staticTotal} images.`, `Unexpected static count text: ${state.countText}`);
    assert(state.sortValue === "random", `Expected default random sort, got ${state.sortValue}.`);
    assert(state.imageSrcs.every((src) => src.includes("/thumbs/")), "Static Gallery grid should use thumbnails.");
    assert(
      state.fulls.every((full) => !galleryAssetRequests.some((requestUrl) => requestUrl === new URL(full, baseUrl).href)),
      "Static Gallery requested a full image before the viewer opened.",
    );
    await assertGalleryPerformanceEnvelope(page, "static Gallery");

    await page.click("#galleryLoadMore");
    await page.waitForFunction(
      (expected) => document.querySelectorAll("#galleryGrid .gallery-thumb").length === expected,
      Math.min(staticTotal, galleryBatchSize * 2),
    );

    await page.selectOption("#gallerySort", "newest");
    await waitForGalleryState(page, {
      activeCategory: "all",
      expectedFirstFull: newestFirst,
      feedState: "empty",
      renderedCount: initialStaticCount,
      sortValue: "newest",
      totalCount: staticTotal,
    });
    state = await visibleState(page);
    assert(state.fulls[0] === newestFirst, `Newest sort first item mismatch. Expected ${newestFirst}, got ${state.fulls[0]}.`);

    await page.selectOption("#gallerySort", "oldest");
    await waitForGalleryState(page, {
      activeCategory: "all",
      expectedFirstFull: oldestFirst,
      feedState: "empty",
      renderedCount: initialStaticCount,
      sortValue: "oldest",
      totalCount: staticTotal,
    });
    state = await visibleState(page);
    assert(state.fulls[0] === oldestFirst, `Oldest sort first item mismatch. Expected ${oldestFirst}, got ${state.fulls[0]}.`);

    await page.click('#galleryFilters [data-category="portraits"]');
    await page.waitForURL(/category=portraits/);
    await waitForGalleryState(page, {
      activeCategory: "portraits",
      feedState: "empty",
      renderedCount: initialPortraitsCount,
      sortValue: "oldest",
      totalCount: staticTotal,
    });
    state = await visibleState(page);
    assert(state.count === initialPortraitsCount, `Portraits filter expected initial ${initialPortraitsCount} items, got ${state.count}.`);
    assert(state.filters.find((filter) => filter.slug === "portraits")?.pressed === "true", "Portraits filter was not active.");

    await page.click("#galleryGrid .gallery-thumb");
    await waitForLightboxOpen(page);
    const lightbox = await page.evaluate(() => ({
      src: document.querySelector("#lightboxImg")?.getAttribute("src") || "",
      focusId: document.activeElement?.id || "",
    }));
    assert(lightbox.src && !lightbox.src.includes("/thumbs/"), `Static lightbox should use full image path, got ${lightbox.src}.`);
    assert(lightbox.focusId === "lightboxClose", `Expected lightbox focus on close button, got ${lightbox.focusId}.`);

    assertFeedRequestContract(feedRequests, "static Gallery", [
      approvedFeedRequestBody(),
      approvedFeedRequestBody({ sort: "oldest" }),
      approvedFeedRequestBody({ category: "portraits", sort: "oldest" }),
    ]);
    await assertNoErrors(errors, "static Gallery");
    await page.close();
  }

  {
    const { page, errors, feedRequests, galleryAssetRequests, waitForFeedFixture } = await newCheckedPage(context, "success");
    await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest`, {
      waitUntil: "domcontentloaded",
    });
    const memberSubmissionsRequest = approvedFeedRequestBody({ category: "member-submissions" });
    await waitForFeedFixture("approved feed success", [memberSubmissionsRequest]);
    await waitForGalleryState(page, {
      activeCategory: "member-submissions",
      feedState: "ready",
      renderedCount: mockApprovedCount,
      sortValue: "newest",
      totalCount: staticTotal + mockApprovedCount,
    });

    let state = await visibleState(page);
    assert(state.count === mockApprovedCount, `Member Submissions filter expected ${mockApprovedCount} approved items, got ${state.count}.`);
    assert(state.countText === `Showing ${mockApprovedCount} of ${mockApprovedCount} images in Member Submissions.`, `Unexpected member count text: ${state.countText}`);
    const memberFilterText = state.filters.find((filter) => filter.slug === "member-submissions")?.text || "";
    assert(new RegExp(`^Member Submissions\\s+\\D\\s+${mockApprovedCount}\\s+images$`).test(memberFilterText), `Member filter count was not rendered: ${memberFilterText}`);
    const allFilterText = state.filters.find((filter) => filter.slug === "all")?.text || "";
    assert(new RegExp(`^All\\s+\\D\\s+${staticTotal + mockApprovedCount}\\s+images$`).test(allFilterText), `All filter did not include the approved items: ${allFilterText}`);
    assert(state.fulls.every((full) => full === ""), "Approved items must not expose original URLs in data-full.");
    assert(state.imageSrcs[0] === mockThumbnailMediaUrls[0], "Approved item did not use its bounded thumbnail URL.");
    assert(new Set(state.imageSrcs).size === mockApprovedCount, "Representative member batch rendered duplicate thumbnail URLs.");
    assert(
      state.imageSrcs.every((src) => mockThumbnailMediaUrls.includes(src)),
      "A representative member card did not bind its matching bounded thumbnail URL.",
    );
    assert(
      mockApprovedRows.reduce((total, submission) => total + Number(submission.thumbnail_size_bytes || 0), 0) < 2 * 1024 * 1024,
      "The representative 24-member thumbnail contract reached 2 MiB.",
    );
    assert(state.imageAlts[0] === mockApprovedTitle, "Approved item alt text did not use the submitted title.");
    assert(state.captions[0].includes(mockApprovedTitle), "Approved caption did not include submitted title.");
    assert(state.captions[0].includes(mockApprovedCaption), "Approved caption did not include submitted caption.");
    await assertRepresentativeMemberThumbnailBatch(page, galleryAssetRequests);
    await assertGalleryPerformanceEnvelope(page, "approved feed success", mockThumbnailMediaUrls);

    await page.click("#galleryGrid .gallery-thumb");
    await waitForLightboxOpen(page);
    const lightbox = await page.evaluate(() => ({
      src: document.querySelector("#lightboxImg")?.getAttribute("src") || "",
      caption: document.querySelector("#lightboxCaption")?.textContent?.trim() || "",
    }));
    assert(lightbox.src.startsWith("blob:"), `Approved lightbox should use a bounded blob URL, got ${lightbox.src}.`);
    assert(galleryAssetRequests.includes(mockFullMediaUrls[0]), "Approved original was not requested after the viewer opened.");
    assert(
      new Set(galleryAssetRequests.filter((url) => mockFullMediaUrls.includes(url))).size === 1,
      "Opening one approved item requested more than its selected original.",
    );
    assert(lightbox.caption.includes(mockApprovedTitle), "Approved lightbox caption missed title.");
    assert(lightbox.caption.includes(mockApprovedCaption), "Approved lightbox caption missed caption.");

    assertFeedRequestContract(feedRequests, "approved feed success", [memberSubmissionsRequest]);
    await assertNoErrors(errors, "approved feed success");
    await page.close();
  }

  {
    const {
      page,
      errors,
      feedRequests,
      galleryAssetRequests,
      releaseFeedFixture,
      waitForFeedFixture,
    } = await newCheckedPage(context, "success", { holdFixture: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/gallery`, { waitUntil: "domcontentloaded" });
    await waitForGalleryState(page, {
      activeCategory: "all",
      feedState: "loading",
      renderedCount: initialStaticCount,
      sortValue: "random",
      totalCount: staticTotal,
    });
    const beforeFeed = await visibleState(page);

    releaseFeedFixture();
    await waitForFeedFixture("delayed approved feed");
    await waitForGalleryState(page, {
      activeCategory: "all",
      feedState: "ready",
      renderedCount: initialStaticCount,
      sortValue: "random",
      totalCount: staticTotal + mockApprovedCount,
    });
    const afterFeed = await visibleState(page);

    assert(
      JSON.stringify(afterFeed.fulls) === JSON.stringify(beforeFeed.fulls),
      "A delayed approved feed response reshuffled or displaced the existing first Gallery batch.",
    );
    assert(
      mockFullMediaUrls.every((url) => !galleryAssetRequests.includes(url)),
      "Delayed feed requested an approved original before viewer opening.",
    );
    await assertGalleryPerformanceEnvelope(page, "delayed approved feed");
    await assertNoErrors(errors, "delayed approved feed");
    await page.close();
  }

  {
    const { page, errors, feedRequests, waitForFeedFixture } = await newCheckedPage(context, "fail");
    await page.goto(`${baseUrl}/gallery?sort=newest`, { waitUntil: "domcontentloaded" });
    await waitForFeedFixture("approved feed failure fallback");
    await waitForGalleryState(page, {
      activeCategory: "all",
      expectedFirstFull: newestFirst,
      feedState: "error",
      renderedCount: initialStaticCount,
      sortValue: "newest",
      totalCount: staticTotal,
    });

    const state = await visibleState(page);
    assert(state.count === initialStaticCount, `Approved-feed failure should fall back to initial ${initialStaticCount} static items, got ${state.count}.`);
    const failedMemberFilterText = state.filters.find((filter) => filter.slug === "member-submissions")?.text || "";
    assert(
      new RegExp("^Member Submissions\\s+\\D\\s+0\\s+images$").test(failedMemberFilterText),
      `Failed approved feed should retain a stable zero-count member filter: ${failedMemberFilterText}`,
    );
    assert(state.fulls[0] === newestFirst, "Approved-feed failure should preserve static newest sort.");

    assertFeedRequestContract(feedRequests, "approved feed failure fallback");
    await assertNoErrors(errors, "approved feed failure fallback");
    await page.close();
  }

  {
    const { page, errors, feedRequests } = await newCheckedPage(context);
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await waitForHomeGallery(page);

    const state = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("#galleryGrid .home-thumb")];
      return {
        count: buttons.length,
        srcs: buttons.map((button) => button.querySelector("img")?.getAttribute("src") || ""),
        fulls: buttons.map((button) => button.querySelector("img")?.getAttribute("data-full") || ""),
      };
    });

    assert(state.count === 4, `Home Gallery Spotlight expected 4 buttons, got ${state.count}.`);
    assert(new Set(state.srcs).size === 4, "Home Gallery Spotlight should not render duplicate images.");
    assert(new Set(state.fulls).size === 4, "Home Gallery Spotlight should not render duplicate full images.");
    assert(state.srcs.every((src) => src.includes("/thumbs/")), "Home Gallery Spotlight should use thumbnails.");
    assert(state.fulls.every((full) => full && !full.includes("/thumbs/")), "Home Gallery Spotlight should open full images.");
    assert(
      state.fulls.every((full) => !mockFullMediaUrls.includes(full)),
      "Home Gallery Spotlight should remain static-data based.",
    );
    assert(feedRequests.length === 0, "Home Gallery Spotlight should not request the approved member feed.");

    await assertNoErrors(errors, "Home Gallery Spotlight");
    await page.close();
  }

  await context.close();
  console.log("Gallery approved feed smoke OK.");
} finally {
  await browser.close();
}
