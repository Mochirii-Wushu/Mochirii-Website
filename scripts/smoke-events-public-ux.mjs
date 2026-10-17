import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import publicUrls from "../apps/web/config/public-urls.json" with { type: "json" };

export const PUBLIC_UX_TIMEOUT_MS = 30_000;

// DOMContentLoaded is navigation readiness, not proof of the route's render.
// Keep this browser predicate self-contained so the exact live condition is testable.
export function publicPageReady({ route, javaScriptEnabled }) {
  const visible = (element) => Boolean(element && element.getClientRects().length
    && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
  const headings = document.querySelectorAll("h1");
  if (document.readyState === "loading" || headings.length !== 1 || !headings[0].textContent.trim()) return false;
  if (route === "/") {
    const links = [...document.querySelectorAll('a[href="/events"] .home-link')]
      .filter((element) => element.textContent.trim() === "View All Events");
    return document.body?.dataset.page === "home" && links.length === 1 && visible(links[0]);
  }
  if (route !== "/events" || headings[0].textContent !== "Events"
    || document.querySelectorAll("#eventsUpcoming .events-list__item").length !== 7
    || document.querySelector("#eventsCount")?.textContent.trim() !== "Upcoming: 7 events") return false;
  for (const [filter, pressed] of [["upcoming", "true"], ["past", "false"], ["all", "false"]]) {
    const buttons = document.querySelectorAll(`[data-events-filter="${filter}"]`);
    if (buttons.length !== 1 || buttons[0].getAttribute("aria-pressed") !== pressed) return false;
  }
  const filters = document.querySelector(".events-filters");
  if (javaScriptEnabled) return document.body?.dataset.page === "events" && visible(filters);
  const fallback = [...document.querySelectorAll("noscript p")]
    .find((element) => element.textContent === "Upcoming times are shown below. Reload this page for the latest schedule.");
  return document.body?.dataset.page === "home" && filters !== null && !visible(filters) && visible(fallback);
}

export async function openPublicPage(browser, baseUrl, route, options = {}, errors = []) {
  assert.ok(route === "/events" || route === "/", "Events public UX smoke received an unsupported route.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  try {
    await context.route("**/*", (request) => new URL(request.request().url()).origin === baseUrl.origin
      ? request.continue()
      : request.abort());
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/hydration|hydrated|did not match|server rendered|Minified React error/i.test(message.text())) errors.push(message.text());
    });
    const url = new URL(route, baseUrl).href;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PUBLIC_UX_TIMEOUT_MS });
    assert.equal(response?.status(), 200, `${route}: application response was not successful`);
    assert.ok(response.url() === url && page.url() === url && response.request().redirectedFrom() === null,
      `${route}: navigation did not retain the exact requested route`);
    // Events' body marker is set by a client effect; its initial board must also
    // be complete. The existing keyboard/filter assertions prove its handlers.
    // Home's link and the no-JavaScript Events fallback are SSR contracts.
    await page.waitForFunction(publicPageReady, { route, javaScriptEnabled: options.javaScriptEnabled !== false },
      { timeout: PUBLIC_UX_TIMEOUT_MS });
    assert.ok(page.url() === url, `${route}: render left the exact requested route`);
    return { context, page };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function imageMeasurement(image) {
  await image.scrollIntoViewIfNeeded();
  await image.evaluate((element) => element.decode());
  return image.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const candidates = element.sizes.split(/,(?![^()]*\))/);
    const selectedSize = candidates.find((candidate) => {
      const media = candidate.trim().match(/^(\([^)]*\))\s+/);
      return !media || matchMedia(media[1]).matches;
    }).trim().replace(/^\([^)]*\)\s+/, "");
    const probe = document.createElement("div");
    probe.style.cssText = `position:fixed;visibility:hidden;width:${selectedSize}`;
    document.body.append(probe);
    const declaredWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const source = new URL(element.currentSrc);
    return {
      width: rect.width,
      height: rect.height,
      declaredWidth,
      currentSrc: source.href,
      requestedWidth: Number(source.searchParams.get("w")),
      sourceWidths: element.srcset.split(",").map((candidate) => Number(candidate.trim().match(/\s(\d+)w$/)?.[1])).filter(Boolean),
      dpr: devicePixelRatio,
      objectPosition: getComputedStyle(element).objectPosition,
    };
  });
}

async function inspectPublicUx(browser, baseUrl) {
  const errors = [];
  const measurements = [];
  const open = (route, options) => openPublicPage(browser, baseUrl, route, options, errors);
  for (const javaScriptEnabled of [true, false]) {
    for (const width of [360, 390, 768, 1024, 1440]) {
      const { context, page } = await open("/events", { javaScriptEnabled, viewport: { width, height: 900 } });
      try {
        assert.equal(await page.locator("h1").count(), 1);
        assert.equal(await page.locator("h1").textContent(), "Events");
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://mochirii.com/events");
        assert.equal(await page.locator('meta[property="og:url"]').getAttribute("content"), "https://mochirii.com/events");
        assert.match(await page.title(), /Events/);
        const items = page.locator("#eventsUpcoming .events-list__item");
        assert.equal(await items.count(), 7);
        for (const item of await items.all()) {
          assert.match(await item.locator(".kicker").textContent(), /UTC\+8/);
          const link = item.getByRole("link", { name: "RSVP & details in Discord", exact: true });
          assert.equal(await link.getAttribute("href"), publicUrls.discordInviteUrl);
          assert.equal(await item.getByRole("heading", { level: 3 }).count(), 1);
        }
        assert.equal(await page.locator("#featuredCard").getByRole("link", { name: "RSVP & details in Discord", exact: true }).getAttribute("href"), publicUrls.discordInviteUrl);
        assert.equal(await page.getByRole("complementary", { name: "Event Board", exact: true }).count(), 1);
        assert.equal(await page.getByRole("complementary", { name: "Participation", exact: true }).count(), 1);
        const results = page.getByRole("group", { name: "Event Board results", exact: true });
        assert.equal(await results.getAttribute("tabindex"), "0");
        assert.equal(await results.getAttribute("aria-live"), null);
        const status = page.locator("#eventsCount");
        assert.equal(await status.getAttribute("role"), "status");
        assert.equal(await status.getAttribute("aria-atomic"), "true");
        const layout = await page.evaluate(() => {
          const board = document.querySelector(".events-board-card");
          const results = document.querySelector("#eventsUpcoming");
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            boardHeight: board.getBoundingClientRect().height,
            maxHeight: Number.parseFloat(getComputedStyle(board).maxHeight),
            overflowY: getComputedStyle(results).overflowY,
          };
        });
        assert.ok(layout.scrollWidth <= width, JSON.stringify(layout));
        assert.ok(layout.boardHeight <= layout.maxHeight + 1, JSON.stringify(layout));
        assert.equal(layout.overflowY, "auto");
        if (javaScriptEnabled) {
          assert.equal(await page.locator("body").getAttribute("data-page"), "events");
          for (const button of await page.locator(".events-filter").all()) {
            const label = await button.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const lines = [...range.getClientRects()];
              const bounds = element.getBoundingClientRect();
              return { text: element.textContent, lines: lines.length, fits: lines.every((line) => line.left >= bounds.left && line.right <= bounds.right) };
            });
            assert.equal(label.lines, 1, JSON.stringify({ width, label }));
            assert.ok(label.fits, JSON.stringify({ width, label }));
          }
          const past = page.getByRole("button", { name: "Past", exact: true });
          await past.focus();
          await page.keyboard.press("Enter");
          assert.equal(await past.getAttribute("aria-pressed"), "true");
          assert.equal(await items.count(), 0);
          assert.match(await status.textContent(), /^Past: none posted$/);
          assert.equal(await page.locator(":focus").getAttribute("data-events-filter"), "past");
          await page.getByRole("button", { name: "Upcoming", exact: true }).click();
          assert.equal(await items.count(), 7);
          await results.focus();
          const scrollBefore = await results.evaluate((element) => element.scrollTop);
          await page.keyboard.press("PageDown");
          await page.waitForFunction((previous) => document.querySelector("#eventsUpcoming").scrollTop > previous, scrollBefore);
          assert.notEqual(await results.evaluate((element) => getComputedStyle(element).outlineStyle), "none");
        } else {
          assert.equal(await page.locator(".events-filters").isVisible(), false);
          assert.equal(await page.getByText("Upcoming times are shown below. Reload this page for the latest schedule.", { exact: true }).isVisible(), true);
          assert.equal(await page.locator("body").getAttribute("data-page"), "home");
        }
        const featured = await imageMeasurement(page.locator(".events-featured__img"));
        const board = await imageMeasurement(page.locator(".events-list__image").first());
        for (const image of [featured, board]) {
          assert.ok(Math.abs(image.width / image.height - 2.5) < 0.01, JSON.stringify(image));
          assert.ok(Math.abs(image.declaredWidth - image.width) <= 2, JSON.stringify(image));
          assert.equal(image.objectPosition, "50% 50%");
          const maximumNeeded = image.sourceWidths.find((candidate) => candidate >= Math.ceil(image.width * image.dpr));
          // A remounted board image may reuse its already loaded featured rendition.
          // Accept that only when it is the exact measured URL, with no new oversized source.
          image.reusesFeaturedSource = image === board && image.currentSrc === featured.currentSrc;
          assert.ok(image.requestedWidth <= maximumNeeded || image.reusesFeaturedSource, JSON.stringify(image));
        }
        const hero = page.locator(".page-hero__img");
        assert.equal(await hero.getAttribute("loading"), "eager");
        assert.equal(await hero.getAttribute("fetchpriority"), "high");
        measurements.push({ route: "/events", width, javaScriptEnabled, featured, board });
      } finally {
        await context.close();
      }
    }
  }
  const { context, page } = await open("/events", { deviceScaleFactor: 2, viewport: { width: 1024, height: 900 } });
  try {
    const featured = await imageMeasurement(page.locator(".events-featured__img"));
    assert.ok(Math.abs(featured.declaredWidth - featured.width) <= 2, JSON.stringify(featured));
    const maximumNeeded = featured.sourceWidths.find((candidate) => candidate >= Math.ceil(featured.width * 2));
    assert.ok(featured.requestedWidth <= maximumNeeded, JSON.stringify(featured));
    measurements.push({ route: "/events", width: 1024, dpr: 2, featured });
  } finally {
    await context.close();
  }
  for (const javaScriptEnabled of [true, false]) {
    const { context, page } = await open("/", { javaScriptEnabled });
    try {
      const events = page.getByRole("link", { name: /View All Events/ });
      assert.equal(await events.count(), 1);
      assert.equal(await events.getAttribute("href"), "/events");
      assert.equal(await events.locator(".home-link").isVisible(), true);
      measurements.push({ route: "/", javaScriptEnabled, accessibleNameIncludes: "View All Events" });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", observations: measurements.length, runtimeAndHydrationErrors: errors, measurements }, null, 2));
}

export async function runEventsPublicUxSmoke({ argv = process.argv, browserType = chromium, inspect = inspectPublicUx } = {}) {
  const argument = argv.find((value) => value.startsWith("--base-url="));
  const baseUrl = new URL(argument?.slice("--base-url=".length) || "http://127.0.0.1:8765");
  if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname)) {
    throw new Error("Events public UX smoke requires a local HTTP application server.");
  }
  const browser = await browserType.launch({ headless: true });
  let inspectionFailed = false;
  try {
    await inspect(browser, baseUrl);
  } catch (error) {
    inspectionFailed = true;
    throw error;
  } finally {
    try {
      await browser.close();
    } catch (error) {
      if (!inspectionFailed) throw error;
    }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runEventsPublicUxSmoke();
