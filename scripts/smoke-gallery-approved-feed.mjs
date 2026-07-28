import { readFile, stat } from "node:fs/promises";
import { enforceProductionGalleryMatrixGuard } from "./lib/live-gallery-media-smoke-guard.mjs";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
enforceProductionGalleryMatrixGuard({ baseUrl, siteOrigin: SITE_ORIGIN });
const galleryDataUrl = new URL("../apps/web/public/data/gallery.json", import.meta.url);
const galleryData = JSON.parse(await readFile(galleryDataUrl, "utf8"));
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
const mockFullSignedUrl = `${baseUrl}/assets/img/gallery/shot-24.webp?mockSignedUrl=approved-member-full-01`;
const mockThumbnailSignedUrl = `${baseUrl}/assets/img/gallery/thumbs/shot-24.webp?mockSignedUrl=approved-member-thumbnail-01`;
const mockThumbnailSizeBytes = (await stat(new URL("../apps/web/public/assets/img/gallery/thumbs/shot-24.webp", import.meta.url))).size;
const mockApprovedTitle = "Approved Smoke Submission";
const mockApprovedCaption = "Shared from smoke automation";
const mockUploader = "QA Member";
const mockApprovedRows = Array.from({ length: mockApprovedCount }, (_, index) => {
  const sequence = String(index + 1).padStart(2, "0");
  return {
    id: `approved-smoke-submission-${sequence}`,
    status: "approved",
    full_signed_url: `${baseUrl}/assets/img/gallery/shot-24.webp?mockSignedUrl=approved-member-full-${sequence}`,
    thumbnail_signed_url: `${baseUrl}/assets/img/gallery/thumbs/shot-24.webp?mockSignedUrl=approved-member-thumbnail-${sequence}`,
    thumbnail_size_bytes: mockThumbnailSizeBytes,
    title: index === 0 ? mockApprovedTitle : `${mockApprovedTitle} ${sequence}`,
    caption: mockApprovedCaption,
    category: "portraits",
    uploader_display_name: mockUploader,
    created_at: new Date(Date.UTC(2030, 0, 31 - index, 3, 4, 5)).toISOString(),
    reviewed_at: new Date(Date.UTC(2030, 0, 31 - index, 4, 4, 5)).toISOString(),
  };
});
const mockFullSignedUrls = mockApprovedRows.map((submission) => submission.full_signed_url);
const mockThumbnailSignedUrls = mockApprovedRows.map((submission) => submission.thumbnail_signed_url);
const mockGalleryBackend = [
  ...mockApprovedRows,
  {
    id: "pending-smoke-submission",
    status: "pending",
    full_signed_url: "pending-full-should-not-render",
    thumbnail_signed_url: "pending-thumbnail-should-not-render",
    thumbnail_size_bytes: 1,
    title: "Pending Should Not Render",
    caption: "Pending hidden caption",
    category: "portraits",
    created_at: "2030-01-03T03:04:05.000Z",
  },
  {
    id: "rejected-smoke-submission",
    status: "rejected",
    full_signed_url: "rejected-full-should-not-render",
    thumbnail_signed_url: "rejected-thumbnail-should-not-render",
    thumbnail_size_bytes: 1,
    title: "Rejected Should Not Render",
    caption: "Rejected hidden caption",
    category: "portraits",
    created_at: "2030-01-04T03:04:05.000Z",
  },
];

const approvedSubmissions = mockGalleryBackend
  .filter((submission) => submission.status === "approved")
  .map(({ status: _status, ...submission }) => submission);

const feedFixtures = {
  empty: {
    ok: true,
    data: { submissions: [] },
    message: "Mock approved feed returned no submissions.",
  },
  success: {
    ok: true,
    data: { submissions: approvedSubmissions },
    message: "Mock approved feed returned approved submissions only.",
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
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "*",
};

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
  let requestIndex = 0;
  await page.route(approvedFeedRoutePattern, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }

    feedRequests.push({
      method: request.method(),
      postData: request.postData() || "",
      url: request.url(),
    });
    await waitForRelease;
    const selectedFixture = Array.isArray(fixture)
      ? fixture[Math.min(requestIndex, fixture.length - 1)]
      : fixture;
    requestIndex += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify(selectedFixture),
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
  const fixture = feedMode === "fail-then-success"
    ? [feedFixtures.fail, feedFixtures.success]
    : feedFixtures[feedMode || "empty"];
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
    if (url.pathname.includes("/assets/img/gallery/")) galleryAssetRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  });

  const waitForFeedFixture = async (label) => {
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

    assertFeedRequestContract(feedRequests, label);
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

async function assertSharedThumbnailLifecycle(page, label) {
  const trigger = page.locator("#galleryGrid .gallery-thumb").first();
  const media = trigger.locator(".responsive-gallery-media");
  const image = media.locator(".responsive-gallery-media__image");

  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute("data-image-state") === "ready",
    "#galleryGrid .gallery-thumb:first-child .responsive-gallery-media",
  );
  const before = await trigger.boundingBox();
  assert(before && before.width > 16 && before.height > 10, `${label}: shared thumbnail trigger collapsed before the error fixture.`);

  await image.evaluate((element) => {
    element.src = "data:image/webp;base64,AAAA";
  });
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute("data-image-state") === "error",
    "#galleryGrid .gallery-thumb:first-child .responsive-gallery-media",
  );

  const errorState = await media.evaluate((element) => {
    const imageElement = element.querySelector(".responsive-gallery-media__image");
    const fallbackElement = element.querySelector(".responsive-gallery-media__fallback");
    return {
      fallbackDisplay: fallbackElement ? getComputedStyle(fallbackElement).display : "",
      imageOpacity: imageElement ? getComputedStyle(imageElement).opacity : "",
      alt: imageElement?.getAttribute("alt") || "",
    };
  });
  const after = await trigger.boundingBox();
  assert(errorState.fallbackDisplay === "grid", `${label}: failed thumbnail did not expose its fallback.`);
  assert(errorState.imageOpacity === "0", `${label}: failed thumbnail remained visibly broken.`);
  assert(Boolean(errorState.alt), `${label}: failed thumbnail lost its accessible text.`);
  assert(
    before && after && Math.abs(before.width - after.width) <= 1 && Math.abs(before.height - after.height) <= 1,
    `${label}: failed thumbnail changed the stable card geometry.`,
  );
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
    galleryAssetRequests.filter((url) => mockThumbnailSignedUrls.includes(url)),
  );
  assert(
    requestedThumbnailUrls.size === mockApprovedCount,
    `Representative member batch requested ${requestedThumbnailUrls.size} of ${mockApprovedCount} thumbnails.`,
  );
  assert(
    mockFullSignedUrls.every((url) => !galleryAssetRequests.includes(url)),
    "Representative member batch requested an original before viewer opening.",
  );

  const transferBytes = await page.evaluate((expectedUrls) => {
    const expected = new Set(expectedUrls);
    return performance
      .getEntriesByType("resource")
      .filter((entry) => expected.has(entry.name))
      .reduce((total, entry) => total + Number(entry.transferSize || entry.encodedBodySize || 0), 0);
  }, mockThumbnailSignedUrls);
  assert(
    transferBytes < 2 * 1024 * 1024,
    `Representative 24-member thumbnail transfer ${transferBytes} bytes reached 2 MiB.`,
  );
}

function assertFeedRequestContract(feedRequests, label) {
  assert(feedRequests.length === 1, `${label}: expected exactly one approved-feed POST, got ${feedRequests.length}.`);
  const [request] = feedRequests;
  assert(request.method === "POST", `${label}: expected approved-feed POST, got ${request.method}.`);
  assert(
    request.url.includes("/functions/v1/list-approved-gallery-submissions"),
    `${label}: unexpected approved-feed URL ${request.url}.`,
  );

  let body;
  try {
    body = JSON.parse(request.postData || "null");
  } catch {
    fail(`${label}: approved-feed request body was not valid JSON.`);
  }
  assert(body && typeof body === "object" && !Array.isArray(body), `${label}: approved-feed request body must be an object.`);
  assert(Object.keys(body).length === 0, `${label}: approved-feed request body must remain empty.`);
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
        && (!expected.expectedFirstFull || firstFull === expected.expectedFirstFull);
    },
    { activeCategory, expectedFirstFull, renderedCount, sortValue, totalCount },
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
        root.getAttribute("aria-hidden") === "false" &&
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
      renderedCount: initialStaticCount,
      sortValue: "random",
      totalCount: staticTotal,
    });

    let state = await visibleState(page);
    assert(state.count === initialStaticCount, `Static Gallery expected initial ${initialStaticCount} items, got ${state.count}.`);
    assert(state.countText === `Showing ${initialStaticCount} of ${staticTotal} images.`, `Unexpected static count text: ${state.countText}`);
    const emptyMemberStatus = page.locator('.gallery-feed-state[data-state="ready"] .gallery-feed-status');
    assert(await emptyMemberStatus.count() === 1, "Successful empty feed did not expose a distinct ready state.");
    assert(
      (await emptyMemberStatus.textContent())?.includes("No member-submitted images are available yet."),
      "Successful empty feed did not expose the reviewed empty-state copy.",
    );
    assert(state.sortValue === "random", `Expected default random sort, got ${state.sortValue}.`);
    assert(state.imageSrcs.every((src) => src.includes("/thumbs/")), "Static Gallery grid should use thumbnails.");
    assert(
      state.fulls.every((full) => !galleryAssetRequests.some((requestUrl) => requestUrl === new URL(full, baseUrl).href)),
      "Static Gallery requested a full image before the viewer opened.",
    );
    await assertGalleryPerformanceEnvelope(page, "static Gallery");
    await assertSharedThumbnailLifecycle(page, "static Gallery");

    await page.click("#galleryLoadMore");
    await page.waitForFunction(
      (expected) => document.querySelectorAll("#galleryGrid .gallery-thumb").length === expected,
      Math.min(staticTotal, galleryBatchSize * 2),
    );

    await page.selectOption("#gallerySort", "newest");
    await waitForGalleryState(page, {
      activeCategory: "all",
      expectedFirstFull: newestFirst,
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

    assertFeedRequestContract(feedRequests, "static Gallery");
    await assertNoErrors(errors, "static Gallery");
    await page.close();
  }

  {
    const { page, errors, feedRequests, galleryAssetRequests, waitForFeedFixture } = await newCheckedPage(context, "success");
    await page.goto(`${baseUrl}/gallery?category=member-submissions&sort=newest`, {
      waitUntil: "domcontentloaded",
    });
    await waitForFeedFixture("approved feed success");
    await waitForGalleryState(page, {
      activeCategory: "member-submissions",
      expectedFirstFull: mockFullSignedUrl,
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
    assert(state.fulls[0] === mockFullSignedUrl, "Approved item did not use full_signed_url as data-full.");
    assert(state.imageSrcs[0] === mockThumbnailSignedUrl, "Approved item did not use thumbnail_signed_url as image source.");
    const renderedPairs = state.fulls.map((full, index) => `${full}|${state.imageSrcs[index] || ""}`);
    const expectedPairs = approvedSubmissions.map((submission) => `${submission.full_signed_url}|${submission.thumbnail_signed_url}`);
    assert(new Set(renderedPairs).size === mockApprovedCount, "Representative member batch rendered duplicate URL pairs.");
    assert(
      renderedPairs.every((pair) => expectedPairs.includes(pair)),
      "A representative member card did not bind its matching thumbnail and original URLs.",
    );
    assert(
      approvedSubmissions.reduce((total, submission) => total + Number(submission.thumbnail_size_bytes || 0), 0) < 2 * 1024 * 1024,
      "The representative 24-member thumbnail contract reached 2 MiB.",
    );
    assert(state.imageAlts[0] === mockApprovedTitle, "Approved item alt text did not use the submitted title.");
    assert(state.captions[0].includes(mockApprovedTitle), "Approved caption did not include submitted title.");
    assert(state.captions[0].includes(mockApprovedCaption), "Approved caption did not include submitted caption.");
    assert(state.captions[0].includes(mockUploader), "Approved caption did not include uploader display name.");
    assert(!state.bodyText.includes("Pending Should Not Render"), "Pending mock submission leaked into public Gallery text.");
    assert(!state.bodyText.includes("Rejected Should Not Render"), "Rejected mock submission leaked into public Gallery text.");
    await assertRepresentativeMemberThumbnailBatch(page, galleryAssetRequests);
    await assertGalleryPerformanceEnvelope(page, "approved feed success", mockThumbnailSignedUrls);

    await page.click("#galleryGrid .gallery-thumb");
    await waitForLightboxOpen(page);
    const lightbox = await page.evaluate(() => ({
      src: document.querySelector("#lightboxImg")?.getAttribute("src") || "",
      caption: document.querySelector("#lightboxCaption")?.textContent?.trim() || "",
    }));
    assert(lightbox.src === mockFullSignedUrl, "Approved lightbox did not use full_signed_url as image source.");
    assert(galleryAssetRequests.includes(mockFullSignedUrl), "Approved original was not requested after the viewer opened.");
    assert(
      new Set(galleryAssetRequests.filter((url) => mockFullSignedUrls.includes(url))).size === 1,
      "Opening one approved item requested more than its selected original.",
    );
    assert(lightbox.caption.includes(mockApprovedTitle), "Approved lightbox caption missed title.");
    assert(lightbox.caption.includes(mockApprovedCaption), "Approved lightbox caption missed caption.");
    assert(lightbox.caption.includes(mockUploader), "Approved lightbox caption missed uploader.");

    assertFeedRequestContract(feedRequests, "approved feed success");
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
      renderedCount: initialStaticCount,
      sortValue: "random",
      totalCount: staticTotal,
    });
    const beforeFeed = await visibleState(page);
    const loadingStatus = page.locator('.gallery-feed-state[data-state="loading"] .gallery-feed-status');
    const loadingState = await loadingStatus.textContent();
    assert(
      loadingState?.includes("Loading member-submitted images…"),
      "Delayed approved feed did not expose its customer-facing loading status.",
    );
    assert(await loadingStatus.getAttribute("aria-busy") === "true", "Delayed approved feed was not marked busy.");

    releaseFeedFixture();
    await waitForFeedFixture("delayed approved feed");
    await waitForGalleryState(page, {
      activeCategory: "all",
      renderedCount: initialStaticCount,
      sortValue: "random",
      totalCount: staticTotal + mockApprovedCount,
    });
    const afterFeed = await visibleState(page);
    const readyStatus = page.locator('.gallery-feed-state[data-state="ready"] .gallery-feed-status');
    assert(await readyStatus.count() === 1, "Successful approved feed did not enter the ready state.");
    assert((await readyStatus.textContent())?.includes("Member-submitted images loaded."), "Successful approved feed did not announce completion.");

    assert(
      JSON.stringify(afterFeed.fulls) === JSON.stringify(beforeFeed.fulls),
      "A delayed approved feed response reshuffled or displaced the existing first Gallery batch.",
    );
    assert(
      mockFullSignedUrls.every((url) => !galleryAssetRequests.includes(url)),
      "Delayed feed requested an approved original before viewer opening.",
    );
    await assertGalleryPerformanceEnvelope(page, "delayed approved feed");
    await assertNoErrors(errors, "delayed approved feed");
    await page.close();
  }

  {
    const { page, errors, feedRequests, waitForFeedFixture } = await newCheckedPage(context, "fail-then-success");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${baseUrl}/gallery?sort=newest`, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: "html{font-size:200%}" });
    await waitForFeedFixture("approved feed failure fallback");
    await waitForGalleryState(page, {
      activeCategory: "all",
      expectedFirstFull: newestFirst,
      renderedCount: initialStaticCount,
      sortValue: "newest",
      totalCount: staticTotal,
    });

    const state = await visibleState(page);
    assert(state.count === initialStaticCount, `Approved-feed failure should fall back to initial ${initialStaticCount} static items, got ${state.count}.`);
    assert(state.filters.every((filter) => filter.slug !== "member-submissions"), "Member Submissions filter should not render when approved feed fails.");
    assert(state.fulls[0] === newestFirst, "Approved-feed failure should preserve static newest sort.");
    const errorState = page.locator('.gallery-feed-state[data-state="error"]');
    const errorStatus = errorState.locator(".gallery-feed-status");
    assert(await errorStatus.count() === 1, "Approved-feed failure did not expose a visible error status.");
    assert(
      (await errorStatus.textContent())?.includes("Member-submitted images are temporarily unavailable. The rest of the gallery is still available."),
      "Approved-feed failure exposed incorrect customer-facing status copy.",
    );
    assert(!(await page.locator("body").innerText()).includes("Mock approved feed failure."), "Approved-feed failure leaked internal response copy.");
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      "Approved-feed failure status overflowed at 320px with 200% text.",
    );
    const retryResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && new URL(response.url()).pathname.endsWith("/functions/v1/list-approved-gallery-submissions"),
    );
    const retryButton = errorState.locator(".gallery-feed-retry");
    await retryButton.focus();
    assert(await retryButton.evaluate((element) => document.activeElement === element), "Approved-feed retry did not receive keyboard focus.");
    await page.keyboard.press("Enter");
    await retryResponse;
    await page.waitForFunction(() => document.querySelector('.gallery-feed-state[data-state="ready"]'));
    assert(feedRequests.length === 2, `Approved-feed retry expected two requests, got ${feedRequests.length}.`);
    await waitForGalleryState(page, {
      activeCategory: "all",
      expectedFirstFull: mockFullSignedUrl,
      renderedCount: initialStaticCount,
      sortValue: "newest",
      totalCount: staticTotal + mockApprovedCount,
    });
    assert(
      await page.locator('#galleryFilters [data-category="member-submissions"]').count() === 1,
      "Approved-feed retry success did not restore the member-submissions filter.",
    );

    feedRequests.forEach((request, index) => assertFeedRequestContract([request], `approved feed failure attempt ${index + 1}`));
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
      state.fulls.every((full) => !mockFullSignedUrls.includes(full)),
      "Home Gallery Spotlight should remain static-data based.",
    );
    assert(feedRequests.length === 0, "Home Gallery Spotlight should not request the approved member feed.");

    await assertNoErrors(errors, "Home Gallery Spotlight");
    await page.close();
  }

  await context.close();

  const noJavaScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await noJavaScriptContext.newPage();
    await page.goto(`${baseUrl}/gallery`, { waitUntil: "load" });
    const trigger = page.locator("#galleryGrid .gallery-thumb").first();
    await trigger.scrollIntoViewIfNeeded();
    const image = trigger.locator(".responsive-gallery-media__image");
    await image.evaluate((element) => new Promise((resolve) => {
      if (element.complete) {
        resolve();
        return;
      }
      element.addEventListener("load", resolve, { once: true });
      element.addEventListener("error", resolve, { once: true });
    }));
    const state = await image.evaluate((element) => {
      const imageRect = element.getBoundingClientRect();
      const triggerRect = element.closest(".gallery-thumb")?.getBoundingClientRect();
      return {
        naturalWidth: element.naturalWidth,
        opacity: getComputedStyle(element).opacity,
        objectFit: getComputedStyle(element).objectFit,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        triggerWidth: triggerRect?.width || 0,
        triggerHeight: triggerRect?.height || 0,
      };
    });
    assert(state.naturalWidth > 0, "JavaScript-disabled Gallery did not load its static thumbnail.");
    assert(state.opacity === "1", "JavaScript-disabled Gallery kept its loaded thumbnail transparent.");
    assert(state.objectFit === "cover", "JavaScript-disabled Gallery lost the shared cover contract.");
    assert(
      state.imageWidth >= state.triggerWidth - 3 && state.imageHeight >= state.triggerHeight - 3,
      "JavaScript-disabled Gallery thumbnail did not fill its stable card.",
    );
  } finally {
    await noJavaScriptContext.close();
  }

  console.log("Gallery approved feed smoke OK.");
} finally {
  await browser.close();
}
