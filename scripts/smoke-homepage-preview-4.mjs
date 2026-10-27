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
const noScriptPages = new WeakSet();
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

async function bounded(operation, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded 15 seconds`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

async function decorativeStructure(page) {
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll(".home-sword img")];
    return images.length === 4 && images.every(image => image.complete && image.naturalWidth > 0);
  });
  const state = await page.locator(".home-sword-duel").evaluate(stage => {
    const style = getComputedStyle(stage), bounds = stage.getBoundingClientRect();
    const photo = document.querySelector(".bg-photo"), image = photo.querySelector("img");
    const backgroundStyle = getComputedStyle(photo), imageStyle = getComputedStyle(image);
    return {
      weapons: stage.querySelectorAll(".home-sword").length,
      sparks: stage.querySelectorAll(".home-sword-contact > span").length,
      position: style.position, overflow: style.overflow, pointerEvents: style.pointerEvents,
      bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      viewport: { width: document.documentElement.clientWidth, height: innerHeight },
      sides: [...stage.querySelectorAll(".home-sword-side")].map(side => {
        const box = side.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, overflow: getComputedStyle(side).overflow };
      }),
      assets: [...new Set([...stage.querySelectorAll("img")].map(img => new URL(img.currentSrc || img.src, location.href).pathname))],
      background: { position: backgroundStyle.position, transform: backgroundStyle.transform, filter: backgroundStyle.filter,
        imageTransform: imageStyle.transform, imageFilter: imageStyle.filter, scale: imageStyle.getPropertyValue("scale") || "none",
        source: new URL(image.currentSrc || image.src, location.href).searchParams.get("url") || new URL(image.src, location.href).pathname },
      scenery: document.querySelectorAll(".home-scenery").length,
    };
  });
  assert.equal(state.weapons, 4); assert.equal(state.sparks, 10);
  assert.equal(state.position, "fixed"); assert.equal(state.overflow, "hidden"); assert.equal(state.pointerEvents, "none");
  assert(Math.abs(state.bounds.left) <= 1 && Math.abs(state.bounds.top) <= 1);
  assert(Math.abs(state.bounds.width - state.viewport.width) <= 1 && Math.abs(state.bounds.height - state.viewport.height) <= 1);
  assert.equal(state.sides.length, 2);
  assert(state.sides.every(side => side.left >= -1 && side.right <= state.viewport.width + 1 && side.width < state.viewport.width / 2 && side.overflow === "hidden"));
  assert(Math.abs(state.sides[0].left) <= 1 && Math.abs(state.sides[1].right - state.viewport.width) <= 1);
  assert.deepEqual(state.assets, ["/assets/home/transitions/sword-duel/forged-jian-1024.webp"], "Four weapons reuse one canonical image");
  assert.equal(state.scenery, 0);
  assert.equal(state.background.position, "fixed");
  assert.equal(state.background.source, "/assets/bg/wuxia-bg.webp", "The original global photograph remains the backdrop");
  for (const key of ["transform", "filter", "imageTransform", "imageFilter"]) assert.equal(state.background[key], "none", "Original backdrop stays unscaled and unfiltered");
  assert(["none", "1"].includes(state.background.scale));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  return state;
}

async function swordPose(page, progress) {
  const observations = [];
  const settle = async () => {
    // Disabled page JavaScript cannot provide animation-frame callbacks.
    if (!noScriptPages.has(page)) await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(80);
  };
  try {
    return await bounded((async () => {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      // Resize clamping can finish after setViewportSize resolves. Measure the
      // document only after layout settles, then reissue the exact target.
      await settle();
      for (let attempt = 1; attempt <= 12; attempt++) {
        const requested = await page.evaluate(progress => {
          const distance = document.documentElement.scrollHeight - innerHeight;
          const target = Math.round(progress * Math.max(1, distance));
          scrollTo({ top: target, left: 0, behavior: "instant" });
          return { target, distance };
        }, progress);
        await settle();
        const pose = await page.locator(".home-sword-duel").evaluate(stage => {
          // CSS transforms act around transform-origin. Express each reviewed
          // upper-blade anchor and the spark origin in their shared parent;
          // the right gutter's common reflection preserves these distances.
          const anchor = (node, x, y) => {
            const style = getComputedStyle(node);
            const [ox, oy] = style.transformOrigin.split(/\s+/).map(Number.parseFloat);
            const local = new DOMPoint(Number.parseFloat(style.width) * x - ox, Number.parseFloat(style.height) * y - oy);
            const transformed = local.matrixTransform(new DOMMatrixReadOnly(style.transform));
            return { x: Number.parseFloat(style.left) + ox + transformed.x, y: Number.parseFloat(style.top) + oy + transformed.y };
          };
          return {
            y: scrollY, distance: document.documentElement.scrollHeight - innerHeight,
            active: stage.dataset.swordsActive, ready: stage.dataset.swordsReady,
            nativeTimeline: CSS.supports("animation-timeline: scroll(root block)"),
            swords: [...stage.querySelectorAll(".home-sword")].map(node => ({ transform: getComputedStyle(node).transform, animation: getComputedStyle(node).animationName, timeline: getComputedStyle(node).animationTimeline })),
            sparks: [...stage.querySelectorAll(".home-sword-contact > span")].map(node => ({ opacity: Number(getComputedStyle(node).opacity), transform: getComputedStyle(node).transform })),
            contacts: [...stage.querySelectorAll(".home-sword-side")].map(side => ({
              anchors: [...side.querySelectorAll(":scope > .home-sword")].map(node => anchor(node, .68, .5)),
              sparkOrigin: anchor(side.querySelector(":scope > .home-sword-contact"), 0, 0),
            })),
          };
        });
        observations.push({ attempt, target: requested.target, requestedDistance: requested.distance, actual: pose.y, actualDistance: pose.distance });
        if (pose.y === requested.target && pose.distance === requested.distance) {
          if (pose.active === "true") {
            assert.deepEqual(pose.swords.map(sword => sword.animation), ["home-jian-jade", "home-jian-celadon", "home-jian-jade", "home-jian-celadon"], "Each active gutter retains two distinct sword animations");
            for (const index of [0, 2]) assert.notEqual(pose.swords[index].transform, pose.swords[index + 1].transform, "Each sword pair has distinct actual poses");
            if (progress === .32 || progress === .72) {
              assert.equal(pose.contacts.length, 2);
              for (const contact of pose.contacts) {
                assert.equal(contact.anchors.length, 2);
                const [a, b] = contact.anchors;
                const gap = Math.hypot(a.x - b.x, a.y - b.y);
                const sparkGap = Math.hypot((a.x + b.x) / 2 - contact.sparkOrigin.x, (a.y + b.y) / 2 - contact.sparkOrigin.y);
                assert(gap <= 3, `Upper-blade contact gap exceeds 3 CSS px: ${JSON.stringify({ gap, contact })}`);
                assert(sparkGap <= 1, `Spark origin misses the contact midpoint by over 1 CSS px: ${JSON.stringify({ sparkGap, contact })}`);
              }
            }
          }
          return pose;
        }
      }
      throw new Error("Exact target did not converge in 12 attempts");
    })(), "Sword pose convergence");
  } catch (error) {
    throw new Error(`Sword pose progress ${progress}: ${error.message}; observations=${JSON.stringify(observations)}`, { cause: error });
  }
}

async function startSwords(page) {
  await swordPose(page, .01);
  await page.waitForFunction(() => document.querySelector(".home-sword-duel")?.dataset.swordsReady === "true");
  await page.waitForFunction(() => document.querySelector(".home-sword-duel")?.dataset.swordsActive === "true");
}

async function documentSwordSequence(page) {
  await startSwords(page);
  const progress = [0, .32, .5, .72, 1, .72, .5, .32, 0], samples = [];
  for (const value of progress) {
    const pose = await swordPose(page, value);
    assert.equal(pose.active, "true"); assert.equal(pose.swords.length, 4); assert.equal(pose.sparks.length, 10);
    if (pose.nativeTimeline) assert(pose.swords.every(sword => sword.timeline.includes("scroll")), "Whole-document native timeline stays registered");
    else assert(pose.swords.every(sword => sword.animation !== "none"), "Fallback scrubs the same finite keyframes");
    const peak = Math.max(...pose.sparks.map(spark => spark.opacity));
    assert(peak <= .481, "Contact sparks retain bounded opacity");
    if (value === .32 || value === .72) assert(peak > 0, "Contact progress reveals the fixed spark pool");
    else assert(peak <= .001, "Sparks disappear outside contact windows");
    samples.push(pose);
  }
  assert.notDeepEqual(samples[0].swords, samples[4].swords, "Swords respond over the whole document");
  for (let index = 0; index < 4; index++) assert.deepEqual(samples[index], samples[8 - index], "Equal document positions reproduce exact sword and spark poses");
  await decorativeStructure(page);
  return samples;
}

async function contentZoomChecks(page, engine) {
  const finePointer = await page.evaluate(() => matchMedia("(hover:hover) and (pointer:fine)").matches);
  const samples = [];
  for (const [label, ownerSelector, imageSelector, keyboardSelector] of [
    ["hero", ".home-hero", ".home-hero__art", "#heroJoinCta"],
    ["event", ".home-featured", "#featuredBulletinImage", "#featuredBulletin"],
    ["activity", ".home-activity-card[href]", ".home-activity-card[href] > img", ".home-activity-card[href]"],
    ["gallery", ".home-thumb", ".home-thumb .responsive-gallery-media__image", ".home-thumb"],
    ["Spotlight", ".home-spotlight", ".home-spotlight__img", ".home-spotlight a[href]"],
    ["seal", ".home-guild-seal > img", ".home-guild-seal > img", null],
  ]) {
    console.log(JSON.stringify({ engine, phase: "content zoom", target: label, status: "started" }));
    const owner = page.locator(ownerSelector).first(), image = page.locator(imageSelector).first();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.mouse.move(0, 0);
    await owner.scrollIntoViewIfNeeded();
    const frame = await owner.boundingBox();
    if (finePointer) {
      await owner.hover();
      await page.waitForFunction(selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).a > 1.02, imageSelector);
      if (label !== "seal") assert.deepEqual(await owner.boundingBox(), frame, "Image zoom keeps its content frame stationary");
      await decorativeStructure(page);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(350);
    }
    if (keyboardSelector) {
      await page.keyboard.press("Tab");
      const target = page.locator(keyboardSelector).first();
      await target.focus();
      assert(await target.evaluate(node => node.matches(":focus-visible")));
      await page.waitForFunction(selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).a > 1.02, imageSelector);
      await decorativeStructure(page);
    }
    samples.push({ label, finePointerHover: finePointer ? "passed" : "unavailable; not forced", keyboard: keyboardSelector ? "passed" : "noninteractive image", transform: await image.evaluate(node => getComputedStyle(node).transform) });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    console.log(JSON.stringify({ engine, phase: "content zoom", target: label, status: "passed" }));
  }
  return samples;
}

async function staticContentZoomCheck(page) {
  await page.keyboard.press("Tab");
  await page.locator("#heroJoinCta").focus();
  if (await page.evaluate(() => matchMedia("(hover:hover) and (pointer:fine)").matches)) await page.locator(".home-hero").hover();
  const media = await page.locator(".home-hero__art,.home-featured__img,.home-activity-card[href] > img,.home-thumb .responsive-gallery-media__image,.home-spotlight__img,.home-guild-seal > img,.home-pvp-play img").evaluateAll(nodes => nodes.map(node => ({
    transform: getComputedStyle(node).transform, transition: getComputedStyle(node).transitionDuration,
  })));
  assert(media.length >= 6);
  assert(media.every(style => style.transform === "none" && style.transition.split(",").every(duration => Number.parseFloat(duration) === 0)), "Static preferences disable foreground zoom even during focus or applicable hover");
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.mouse.move(0, 0);
  return media;
}

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
    if (options.noJS) noScriptPages.add(page);
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
      const decoration = await decorativeStructure(page);
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
      if ([390,768,1920].includes(width)) {
        await page.locator(".home-hero__motion .motion-toggle").click();
        await page.waitForFunction(() => document.querySelector(".site-shell").dataset.decorativeMotion === "on");
        const samples = await documentSwordSequence(page);
        results.push({ engine: name, scenario: "responsive whole-document swords and exact reverse", width, height, samples, decoration: await decorativeStructure(page), status: "passed" });
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
      results.push({ engine: name, version: browser.version(), scenario: "layout/menu/keyboard/footer", width, height, status: "passed", spotlightNavigation: [390,1440].includes(width) ? "pointer and SPA navigation" : "not exercised", decoration, workerFixture: { ...workerFixture } });
      console.log(JSON.stringify({engine:name,width,height,status:"passed"}));
      await teardown.get(ctx)();
    }
    for (const options of [{ noJS: true }, { off: true }, { reduced: true }, { storageFailure: true }, { noGraphics: true }, { assetFailure: true }, { noObserver: true }, { noWorker: true }, { noOffscreen: true }]) {
      console.log(JSON.stringify({ engine: name, phase: "static fallback", options, status: "started" }));
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
      const staticSwords = options.noJS || options.off || options.reduced || options.storageFailure;
      let swordSamples;
      let staticMedia;
      if (staticSwords) {
        swordSamples = [await swordPose(page, 0), await swordPose(page, 1)];
        assert(swordSamples.every(pose => pose.swords.every(sword => sword.animation === "none") && pose.sparks.every(spark => spark.opacity === 0)));
        assert.deepEqual(swordSamples[0].swords, swordSamples[1].swords, "Static preferences never scrub weapons");
        staticMedia = await staticContentZoomCheck(page);
      } else {
        await startSwords(page);
        swordSamples = [await swordPose(page, .32), await swordPose(page, .72), await swordPose(page, .32)];
        assert(swordSamples.every(pose => pose.active === "true"));
        assert.notDeepEqual(swordSamples[0].swords, swordSamples[1].swords, "Swords operate independently of unavailable hero graphics or observers");
        assert.deepEqual(swordSamples[0], swordSamples[2]);
      }
      const decoration = await decorativeStructure(page);
      assert.deepEqual(errors, []);
      results.push({ engine: name, scenario: "static fallback", options,
        status: options.noGraphics && !graphicsAPIsAvailable ? "native worker graphics APIs unavailable; complete poster verified" : "passed",
        nativeGraphicsAPIs, swordSamples, staticMedia, decoration, workerFixture: { ...workerFixture } });
      console.log(JSON.stringify({ engine: name, phase: "static fallback", options, status: "passed" }));
      await teardown.get(ctx)();
    }
    console.log(JSON.stringify({ engine: name, phase: "whole-document lifecycle", status: "started" }));
    const { ctx, page, errors, workerFixture } = await context(1440, 900);
    const supported = await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null, undefined, { timeout: 6000 }).then(() => true, () => false);
    const samples = await documentSwordSequence(page);
    await page.setViewportSize({ width: 1180, height: 757 });
    const resized = await swordPose(page, .32);
    const resizedDecoration = await decorativeStructure(page);
    assert.equal(resized.active, "true");
    await page.setViewportSize({ width: 1440, height: 900 });
    // Retained Firefox probe 7 shows native zero clears the resize-origin
    // fraction, restoring comparable observed coordinates before exact checks.
    await swordPose(page, 0);
    const restored = await swordPose(page, .32);
    assert.deepEqual(restored, samples[1], "Restoring viewport and progress restores the exact pose");
    results.push({ engine: name, scenario: "whole-document swords, finite sparks, exact reverse and resize", samples, resized, resizedDecoration, restored, status: "passed" });
    console.log(JSON.stringify({ engine: name, phase: "whole-document sequence and resize", status: "passed" }));

    console.log(JSON.stringify({ engine: name, phase: "gallery modal restoration", status: "started" }));
    const thumbnail = page.locator(".home-thumb").first();
    await thumbnail.scrollIntoViewIfNeeded();
    const galleryProgress = await page.evaluate(() => scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
    const beforeModal = await swordPose(page, galleryProgress);
    await thumbnail.click();
    await page.locator("#modalRoot").waitFor();
    await page.waitForFunction(() => document.body.style.position === "fixed" && document.querySelector(".home-sword-duel").dataset.swordsActive === "false");
    assert.equal(await page.locator(".home-sword-duel").evaluate(node => getComputedStyle(node).visibility), "hidden");
    await page.waitForFunction(() => {
      const image = document.querySelector("#modalImage");
      return image?.complete && image.naturalWidth > 0 && !decodeURIComponent(image.currentSrc || image.src).includes("/thumbs/");
    });
    assert.equal(await page.locator(".home-sword-contact > span").count(), 10);
    await page.keyboard.press("Escape");
    await page.locator("#modalRoot").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.body.style.position !== "fixed");
    await page.waitForFunction(() => document.activeElement === document.querySelector(".home-thumb"));
    assert(Math.abs(await page.evaluate(() => scrollY) - beforeModal.y) <= 1, "Gallery restores the original document scroll position");
    const afterModal = await swordPose(page, galleryProgress);
    await page.waitForFunction(() => document.querySelector(".home-sword-duel").dataset.swordsActive === "true");
    assert.deepEqual(afterModal, beforeModal, "Modal pause does not reset or accumulate sword progress");
    results.push({ engine: name, scenario: "gallery full image, keyboard focus return and sword/body-lock restore", beforeModal, afterModal, status: "passed" });
    console.log(JSON.stringify({ engine: name, phase: "gallery modal restoration", status: "passed" }));

    const zoom = await contentZoomChecks(page, name);
    results.push({ engine: name, scenario: "content image hover/keyboard zoom and unchanged fixed backdrop", zoom, background: (await decorativeStructure(page)).background, status: "passed" });
    console.log(JSON.stringify({ engine: name, phase: "content zoom and fixed backdrop", status: "passed" }));
    console.log(JSON.stringify({ engine: name, phase: "OS, persistent Off and context loss", status: "started" }));
    if (supported) {
      assert(workerFixture.prefixFulfillments >= 1, "Scene lifecycle must inject the reviewed worker fixture");
      await page.locator("#resources-heading").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector("[data-home-scene]").dataset.sceneActive === "false");
      assert.equal(await page.locator(".home-sword-duel").getAttribute("data-swords-active"), "true", "Whole-page swords outlive the offscreen hero worker");
      await swordPose(page, 0);
      await page.waitForFunction(() => document.querySelector("[data-home-scene]").dataset.sceneActive === "true");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => !document.querySelector("canvas.home-scene-canvas") && !document.querySelector("[data-swords-ready]"));
    const reducedPose = await swordPose(page, .72);
    assert(reducedPose.swords.every(sword => sword.animation === "none") && reducedPose.sparks.every(spark => spark.opacity === 0));
    const reducedMedia = await staticContentZoomCheck(page);
    assert.deepEqual(await page.locator(".motion-toggle").allTextContents(), ["Motion off", "Motion off"]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await startSwords(page);
    if (supported) await page.waitForFunction(() => document.querySelector("[data-scene-ready]") !== null);
    await page.locator(".home-hero__motion .motion-toggle").click();
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), "off");
    assert.equal(await page.locator("canvas.home-scene-canvas").count(), 0);
    const offPose = await swordPose(page, .32);
    assert(offPose.swords.every(sword => sword.animation === "none") && offPose.sparks.every(spark => spark.opacity === 0));
    const offMedia = await staticContentZoomCheck(page);
    await page.locator(".home-hero__motion .motion-toggle").click();
    await startSwords(page);
    if (supported) {
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
    results.push({ engine: name, scenario: "scene lifecycle, OS, persistent Off, context loss", status: supported ? "passed" : "graphics unavailable; complete poster verified", reducedPose, reducedMedia, offPose, offMedia, workerFixture: { ...workerFixture } });
    console.log(JSON.stringify({ engine: name, phase: "OS, persistent Off and context loss", status: "passed", graphics: supported }));
    await teardown.get(ctx)();
  } finally {
    console.log(JSON.stringify({ engine: name, phase: "browser teardown", status: "started" }));
    try { await bounded(browser.close(), `${name} browser teardown`); }
    finally { await fs.writeFile(path.join(output, (selected || name) + ".json"), JSON.stringify(results, null, 2)); }
    console.log(JSON.stringify({ engine: name, phase: "browser teardown", status: "passed" }));
  }
}
console.log(JSON.stringify(results));
