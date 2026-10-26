import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";

const argument = process.argv.indexOf("--base-url");
assert(argument >= 0 && process.argv[argument + 1], "Supply an explicit loopback --base-url");
const base = new URL(process.argv[argument + 1]);
assert(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname));
const outputArgument = process.argv.indexOf("--output-dir");
const evidenceRoot = path.resolve(".artifacts/operations/homepage-preview-4");
const output = path.resolve(outputArgument < 0 ? path.join(evidenceRoot, "browser-fixtures") : process.argv[outputArgument + 1]);
assert(output.startsWith(evidenceRoot + path.sep), "Keep generated evidence inside the ignored Preview 4 directory");
await fs.mkdir(output, { recursive: true });
const key = "mochirii.decorative-motion.v1";
const results = [];
const teardown = new WeakMap();
const engineArgument = process.argv.indexOf("--browser");
const selected = engineArgument < 0 ? null : process.argv[engineArgument + 1];
assert(selected === null || ["chromium", "firefox", "webkit"].includes(selected));
const workerMedia = new URL("../apps/web/.next/static/media/", import.meta.url);
const workerFiles = (await fs.readdir(workerMedia)).filter(file => /^home-scene-worker\.[A-Za-z0-9_-]+\.js$/.test(file));
assert.equal(workerFiles.length, 1, "Require exactly one emitted Home worker");
const workerSource = await fs.readFile(new URL("../apps/web/components/home-scene-worker.js", import.meta.url));
const workerAsset = await fs.readFile(new URL(workerFiles[0], workerMedia));
assert(workerAsset.equals(workerSource), "Emitted Home worker must equal the reviewed standalone source");
const workerPath = "/_next/static/media/" + workerFiles[0];
const buildId = (await fs.readFile(new URL("../apps/web/.next/BUILD_ID", import.meta.url), "utf8")).trim();

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
    ctx.setDefaultTimeout(15000);
    const forwarded = new WeakMap();
    const pending = new Map();
    const canceled = new WeakSet();
    const bridgeErrors = [];
    const workerFixtureEvidence = { buildId, pathname: workerPath, bytes: workerAsset.length, prefixFulfillments: 0 };
    teardown.set(ctx, async () => {
      // Cancel only this context's outstanding read-only bridge requests before
      // awaiting route teardown. Runtime errors are asserted before this point.
      for (const [request, controller] of pending) { canceled.add(request); controller.abort(); }
      let timer;
      let stage = "close pages";
      try {
        await Promise.race([
          (async () => {
            // Close pages before the context, keeping routes installed until no
            // page can issue a request. WebKit can stall in a redundant unroute
            // wait even after every bridged request has finished.
            await Promise.all(ctx.pages().map(page => page.close()));
            stage = "close context";
            await ctx.close();
            stage = "drain canceled bridge reads";
            while (pending.size) await new Promise(resolve => setTimeout(resolve, 16));
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name}: ${stage} exceeded 15 seconds; ${pending.size} bridge request(s) remain`)), 15000); }),
        ]);
      } finally { clearTimeout(timer); }
    });
    ctx.on("requestfailed", request => {
      if (["net::ERR_ABORTED", "NS_BINDING_ABORTED", "cancelled", "Load request cancelled"].includes(request.failure()?.errorText)) {
        canceled.add(request); forwarded.get(request)?.abort();
      }
    });
    await ctx.addInitScript(({ key, options }) => {
      if (options.storageFailure) Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Unavailable", "SecurityError"); } });
      else if (localStorage.getItem(key) === null) localStorage.setItem(key, options.off ? "off" : "on");
      if (options.noWorker) Object.defineProperty(window, "Worker", { value: undefined });
      if (options.noOffscreen) Object.defineProperty(window, "OffscreenCanvas", { value: undefined });
      if (options.noObserver) delete window.IntersectionObserver;
    }, { key, options });
    await ctx.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) return route.abort();
      if (url.pathname.startsWith("/_vercel/")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      if (options.assetFailure && /backdrop-1280|hair-fabric-alpha|branch-alpha-1280/.test(url.pathname)) return route.abort();
      // Patch only this context's initial dedicated-worker script. The fixture
      // stays in the routed response; production code has no graphics hooks.
      const workerScript = url.pathname === workerPath && request.method() === "GET";
      if (origin !== base.origin || workerScript) {
        url.protocol = base.protocol;
        const controller = new AbortController(); forwarded.set(request, controller); pending.set(request, controller);
        try {
          const headers = request.headers(); delete headers.host; delete headers.connection;
          const response = await fetch(url, { method: request.method(), headers, redirect: "manual",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
          const workerFixture = workerScript ? Buffer.from(`(() => {
            if (typeof OffscreenCanvas !== "function") return;
            const original = OffscreenCanvas.prototype.getContext;
            OffscreenCanvas.prototype.getContext = function (type, ...args) {
              if (type === "webgl" && ${options.noGraphics === true}) return null;
              const context = original.call(this, type, ...args);
              if (type === "webgl") globalThis.__mochiriiFixtureContext = context;
              return context;
            };
          })();\n`) : null;
          const chunks = workerFixture ? [workerFixture] : []; let bytes = workerFixture?.length || 0;
          if (response.body) for await (const chunk of response.body) {
            bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error("Local bridge response bound");
            chunks.push(chunk);
          }
          const responseHeaders = Object.fromEntries(response.headers);
          delete responseHeaders["content-encoding"]; delete responseHeaders["content-length"];
          if (workerScript && (response.status !== 200 || !/(?:java|ecma)script/i.test(responseHeaders["content-type"] || ""))) throw new Error("Local worker bootstrap must be JavaScript");
          if (!canceled.has(request)) {
            await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.concat(chunks) });
            if (workerScript) workerFixtureEvidence.prefixFulfillments++;
          }
        } catch (error) {
          // Forwarded reads follow browser cancellation; unexpected timeouts,
          // protocol failures and response errors remain failures.
          await new Promise(resolve => setTimeout(resolve, 0));
          if (!canceled.has(request)) {
            bridgeErrors.push(`${request.method()} ${url.pathname}: ${error.name}: ${error.message}`);
            await route.abort("failed").catch(() => {});
          }
        } finally { forwarded.delete(request); pending.delete(request); }
        return;
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    const errors = bridgeErrors; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForTimeout(400);
    return { ctx, page, errors, workerFixture: workerFixtureEvidence };
  }
  try {
    for (const [width, height] of [[320,800],[375,812],[390,844],[768,1024],[844,390],[1024,768],[1100,800],[1180,757],[1200,800],[1280,900],[1440,900],[1920,1080]]) {
      const { ctx, page, errors, workerFixture } = await context(width, height, { off: true });
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal((await page.locator("#heroDescriptor").innerText()).trim(), "Mōchirīī is a Southeast Asia guild. Join teams, events and community activities.");
      assert.equal(await page.locator("#heroBadges > span").count(), 3);
      assert(await page.locator("#heroBadges > span").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === "none")), "Hero badges retain static borders");
      assert.equal(await page.locator("#pvp-highlights-heading").count(), 1);
      assert.equal(await page.locator(".home-pvp video").count(), 0);
      assert.equal(await page.locator(".home-sword-duel").getAttribute("aria-hidden"), "true");
      assert.equal(await page.locator(".home-sword-duel :is(a,button)").count(), 0);
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
      results.push({ engine: name, version: browser.version(), scenario: "layout/menu/keyboard/footer", width, height, status: "passed", spotlightNavigation: [390,1440].includes(width) ? "pointer and SPA navigation" : "not exercised", workerFixture: { ...workerFixture } });
      console.log(JSON.stringify({engine:name,width,height,status:"passed"}));
      await teardown.get(ctx)();
    }
    for (const options of [{ noJS: true }, { off: true }, { reduced: true }, { storageFailure: true }, { noGraphics: true }, { assetFailure: true }, { noObserver: true }, { noWorker: true }, { noOffscreen: true }]) {
      const { ctx, page, errors, workerFixture } = await context(390, 844, options);
      await page.waitForTimeout(1000);
      assert(await page.locator("#heroJoinCta").isVisible());
      assert(await page.locator("#heroImage").evaluate(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.locator("canvas.home-scene-canvas").count(), 0);
      assert(await page.locator(".home-section").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity !== "0" && getComputedStyle(node).visibility !== "hidden")));
      let nativeGraphicsAPIs;
      let graphicsAPIsAvailable;
      if (options.noGraphics) {
        nativeGraphicsAPIs = await page.evaluate(() => ({
          worker: typeof Worker === "function",
          offscreen: typeof OffscreenCanvas === "function",
          transfer: typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function",
          mask: typeof CSS !== "undefined" && CSS.supports("mask-image", "linear-gradient(#000,#000)"),
        }));
        graphicsAPIsAvailable = Object.values(nativeGraphicsAPIs).every(Boolean);
        if (graphicsAPIsAvailable) assert(workerFixture.prefixFulfillments >= 1, "No-graphics case must inject the reviewed worker fixture");
      }
      if (options.noJS || options.off || options.reduced || options.storageFailure || options.noObserver) {
        await page.locator(".home-sword-duel").scrollIntoViewIfNeeded();
        const timeline = await page.locator(".home-sword-duel").evaluate(node => ({ supported: CSS.supports("animation-timeline: view()"), name: getComputedStyle(node).viewTimelineName }));
        if (timeline.supported) assert.equal(timeline.name, "none", "Static fallback must not register a view timeline, including when visible");
      }
      assert.deepEqual(errors, []);
      results.push({ engine: name, scenario: "static fallback", options,
        status: options.noGraphics && !graphicsAPIsAvailable ? "native worker graphics APIs unavailable; complete poster verified" : "passed",
        nativeGraphicsAPIs, workerFixture: { ...workerFixture } }); await teardown.get(ctx)();
    }
    const { ctx, page, errors, workerFixture } = await context(1440, 900);
    const scene = page.locator("[data-home-scene]");
    const supported = await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null, undefined, { timeout: 6000 }).then(() => true, () => false);
    if (supported) {
      assert(workerFixture.prefixFulfillments >= 1, "Scene lifecycle must inject the reviewed worker fixture");
      const nativeTimeline = await page.evaluate(() => CSS.supports("animation-timeline: view()"));
      const samples = [];
      for (const progress of [.42,.55,.7,.55,.42]) {
        await page.evaluate(progress => {
          const box = document.querySelector(".home-sword-duel").getBoundingClientRect();
          scrollTo(0, scrollY + box.top - innerHeight + progress * (innerHeight + box.height));
        }, progress);
        await page.waitForTimeout(150);
        if (nativeTimeline) assert.equal(await page.locator(".home-sword-duel").evaluate(node => getComputedStyle(node).viewTimelineName), "--home-duel", "Visible Motion On registers its timeline");
        samples.push(await page.locator(".home-sword").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).transform)));
      }
      assert.notDeepEqual(samples[0], samples[2], "Swords respond to native scroll");
      assert.deepEqual(samples[1], samples[3], "Swords retrace the same positions upward");
      assert.deepEqual(samples[0], samples[4], "Swords return to the same approach pose");
      results.push({ engine:name, scenario:"sword approach/clash/separation and exact reverse", nativeTimeline, samples, status:"passed" });
      await page.locator("#resources-heading").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector("[data-home-scene]").dataset.sceneActive === "false");
      if (nativeTimeline) await page.waitForFunction(() => getComputedStyle(document.querySelector(".home-sword-duel")).viewTimelineName === "none");
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => document.querySelector("[data-home-scene]").dataset.sceneActive === "true");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => !document.querySelector("canvas.home-scene-canvas"));
      if (nativeTimeline) assert.equal(await page.locator(".home-sword-duel").evaluate(node => getComputedStyle(node).viewTimelineName), "none");
      assert.deepEqual(await page.locator(".motion-toggle").allTextContents(), ["Motion off", "Motion off"]);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null);
      await page.locator(".home-hero__motion .motion-toggle").click();
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), "off");
      assert.equal(await page.locator("canvas.home-scene-canvas").count(), 0);
      if (nativeTimeline) assert.equal(await page.locator(".home-sword-duel").evaluate(node => getComputedStyle(node).viewTimelineName), "none");
      await page.locator(".home-hero__motion .motion-toggle").click();
      await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null);
      const renderingWorkers = [];
      for (const worker of page.workers()) {
        if (await worker.evaluate(() => Boolean(globalThis.__mochiriiFixtureContext))) renderingWorkers.push(worker);
      }
      assert.equal(renderingWorkers.length, 1, "One owned worker exposes the fixture-only rendering context");
      await renderingWorkers[0].evaluate(() => {
        const extension = globalThis.__mochiriiFixtureContext.getExtension("WEBGL_lose_context");
        if (!extension) throw new Error("Fixture context-loss extension unavailable");
        extension.loseContext();
      });
      await page.waitForFunction(() => !document.querySelector("canvas.home-scene-canvas"));
      assert(await page.locator("#heroImage").isVisible());
    }
    const ids = await page.locator(".motion-toggle").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-describedby")));
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual(errors, []);
    results.push({ engine: name, scenario: "scene lifecycle, OS, persistent Off, context loss", status: supported ? "passed" : "graphics unavailable; complete poster verified", workerFixture: { ...workerFixture } });
    await teardown.get(ctx)();
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, (selected || name) + ".json"), JSON.stringify(results, null, 2));
  }
}
console.log(JSON.stringify(results));
