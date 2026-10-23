import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";

const argument = process.argv.indexOf("--base-url");
assert(argument >= 0 && process.argv[argument + 1], "Supply an explicit loopback --base-url");
const base = new URL(process.argv[argument + 1]);
assert(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname));
const output = path.resolve(".artifacts/operations/homepage-preview-3/browser-fixtures");
await fs.mkdir(output, { recursive: true });
const key = "mochirii.decorative-motion.v1";
const results = [];
const engineArgument = process.argv.indexOf("--browser");
const selected = engineArgument < 0 ? null : process.argv[engineArgument + 1];
assert(selected === null || ["chromium", "firefox", "webkit"].includes(selected));

for (const engine of [chromium, firefox, webkit]) {
  const name = engine.name();
  if (selected && selected !== name) continue;
  let browser;
  try { browser = await engine.launch(); }
  catch (error) { results.push({ engine: name, status: "unavailable", reason: error.message.split("\n")[0] }); continue; }
  async function context(width, height, options = {}) {
    const origin = name === "webkit" ? base.origin.replace(/^http:/, "https:") : base.origin;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 500 ? 3 : 1,
      isMobile: width < 500 && name !== "firefox", hasTouch: width < 500, serviceWorkers: "block",
      reducedMotion: options.reduced ? "reduce" : "no-preference", javaScriptEnabled: !options.noJS });
    const forwarded = new WeakMap();
    const canceled = new WeakSet();
    ctx.on("requestfailed", request => {
      if (["net::ERR_ABORTED", "NS_BINDING_ABORTED", "cancelled", "Load request cancelled"].includes(request.failure()?.errorText)) {
        canceled.add(request); forwarded.get(request)?.abort();
      }
    });
    await ctx.addInitScript(({ key, options }) => {
      if (options.storageFailure) Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Unavailable", "SecurityError"); } });
      else if (localStorage.getItem(key) === null) localStorage.setItem(key, options.off ? "off" : "on");
      if (options.noGraphics) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === "webgl" ? null : original.call(this, type, ...args); };
      }
      if (options.noObserver) delete window.IntersectionObserver;
    }, { key, options });
    await ctx.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) return route.abort();
      if (url.pathname.startsWith("/_vercel/")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      if (options.assetFailure && /(?:clean-plate|branch-alpha)-1280/.test(url.pathname)) return route.abort();
      if (origin !== base.origin) {
        url.protocol = base.protocol;
        const controller = new AbortController(); forwarded.set(request, controller);
        try {
          const headers = request.headers(); delete headers.host; delete headers.connection;
          const response = await fetch(url, { method: request.method(), headers, redirect: "manual",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
          const chunks = []; let bytes = 0;
          if (response.body) for await (const chunk of response.body) {
            bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error("Local bridge response bound");
            chunks.push(chunk);
          }
          const responseHeaders = Object.fromEntries(response.headers);
          delete responseHeaders["content-encoding"]; delete responseHeaders["content-length"];
          if (!canceled.has(request)) await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.concat(chunks) });
        } catch (error) {
          // Forwarded reads follow browser cancellation; unexpected timeouts,
          // protocol failures and response errors remain failures.
          await new Promise(resolve => setTimeout(resolve, 0));
          if (!canceled.has(request)) throw error;
        } finally { forwarded.delete(request); }
        return;
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForTimeout(400);
    return { ctx, page, errors };
  }
  try {
    for (const [width, height] of [[320,800],[375,812],[390,844],[768,1024],[844,390],[1024,768],[1100,800],[1180,757],[1200,800],[1280,900],[1440,900],[1920,1080]]) {
      const { ctx, page, errors } = await context(width, height, { off: true });
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal((await page.locator("#heroDescriptor").innerText()).trim(), "Mōchirīī is a Southeast Asia guild. Join teams, events and community activities.");
      assert.equal(await page.locator("#heroBadges > span").count(), 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if ([390,1440].includes(width)) assert((await page.locator("#heroJoinCta").boundingBox()).y + (await page.locator("#heroJoinCta").boundingBox()).height <= height);
      await page.locator("a[href='#main']").first().focus(); await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "main");
      await page.locator(".site-footer").scrollIntoViewIfNeeded();
      const footer = await page.locator(".site-footer").evaluate(el => {
        const brand = el.querySelector(".footer-brand-link").getBoundingClientRect();
        const intro = el.querySelector(".footer-desc").getBoundingClientRect();
        return { gap: intro.top - brand.bottom, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert(footer.gap >= 10); assert.equal(footer.overflow, false);
      if (width > 980) {
        const trigger = page.locator("#site-header").getByRole("button", { name: /^Resources\b/ });
        await trigger.click();
        const surfaces = await page.locator("#nav-menu-resources").evaluate(el => ({ panel: getComputedStyle(el).backgroundColor, header: getComputedStyle(document.querySelector("#site-header")).backgroundColor }));
        assert.equal(surfaces.panel, "rgb(16, 28, 32)"); assert.equal(surfaces.header, "rgb(11, 20, 24)");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("[aria-controls='nav-menu-resources']").getAttribute("aria-expanded") === "false");
      } else {
        const trigger = page.locator("#menu-btn"); await trigger.click();
        await page.waitForFunction(() => document.querySelector("#mobile-menu").contains(document.activeElement));
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("#menu-btn").getAttribute("aria-expanded") === "false");
        await page.waitForFunction(() => document.activeElement.id === "menu-btn");
      }
      if ([390,1440].includes(width)) {
        const spotlight = page.locator('.home-supporting-card #spotlightCard a[href="/spotlight"]');
        assert.equal(await spotlight.evaluate(el => getComputedStyle(el).pointerEvents), "auto");
        await spotlight.click();
        await page.waitForURL(url => url.pathname === "/spotlight");
        await page.waitForLoadState("load");
        assert.equal(new URL(page.url()).origin, name === "webkit" ? base.origin.replace(/^http:/, "https:") : base.origin);
      }
      assert.deepEqual(errors, []);
      results.push({ engine: name, version: browser.version(), scenario: "layout/menu/keyboard/footer", width, height, status: "passed", spotlightNavigation: [390,1440].includes(width) ? "pointer and SPA navigation" : "not exercised" });
      await ctx.unrouteAll({ behavior: "wait" }); await ctx.close();
    }
    for (const options of [{ noJS: true }, { off: true }, { reduced: true }, { storageFailure: true }, { noGraphics: true }, { assetFailure: true }, { noObserver: true }]) {
      const { ctx, page, errors } = await context(390, 844, options);
      await page.waitForTimeout(1000);
      assert(await page.locator("#heroJoinCta").isVisible());
      assert(await page.locator("#heroImage").evaluate(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.locator("canvas.home-scene-canvas").count(), 0);
      assert(await page.locator(".home-section").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity !== "0" && getComputedStyle(node).visibility !== "hidden")));
      assert.deepEqual(errors, []);
      results.push({ engine: name, scenario: "static fallback", options, status: "passed" }); await ctx.unrouteAll({ behavior: "wait" }); await ctx.close();
    }
    const { ctx, page, errors } = await context(1440, 900);
    const scene = page.locator("[data-home-scene]");
    const supported = await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null, undefined, { timeout: 6000 }).then(() => true, () => false);
    if (supported) {
      await page.locator("#resources-heading").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector("[data-home-scene]").dataset.sceneActive === "false");
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => document.querySelector("[data-home-scene]").dataset.sceneActive === "true");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => !document.querySelector("canvas.home-scene-canvas"));
      assert.deepEqual(await page.locator(".motion-toggle").allTextContents(), ["Motion off", "Motion off"]);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null);
      await page.locator(".home-hero__motion .motion-toggle").click();
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), "off");
      assert.equal(await page.locator("canvas.home-scene-canvas").count(), 0);
      await page.locator(".home-hero__motion .motion-toggle").click();
      await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null);
      await page.evaluate(() => document.querySelector("canvas.home-scene-canvas").getContext("webgl").getExtension("WEBGL_lose_context").loseContext());
      await page.waitForFunction(() => !document.querySelector("canvas.home-scene-canvas"));
      assert(await page.locator("#heroImage").isVisible());
    }
    const ids = await page.locator(".motion-toggle").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-describedby")));
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual(errors, []);
    results.push({ engine: name, scenario: "scene lifecycle, OS, persistent Off, context loss", status: supported ? "passed" : "graphics unavailable; complete poster verified" });
    await ctx.unrouteAll({ behavior: "wait" }); await ctx.close();
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, (selected || name) + ".json"), JSON.stringify(results, null, 2));
  }
}
console.log(JSON.stringify(results));
