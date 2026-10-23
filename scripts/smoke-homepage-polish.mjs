import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const argument = process.argv.indexOf("--base-url");
assert(argument >= 0 && process.argv[argument + 1], "Supply an explicit local --base-url.");
const base = new URL(process.argv[argument + 1]);
assert(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname), "Local read-only fixtures only.");
const preferenceKey = "mochirii.decorative-motion.v1";
const browserArgument = process.argv.indexOf("--browser");
const selectedBrowser = browserArgument >= 0 ? process.argv[browserArgument + 1] : null;
assert(selectedBrowser === null || ["Chromium", "Firefox", "WebKit"].includes(selectedBrowser), "Unknown browser selection.");
const widths = [[320,800],[375,812],[390,844],[768,1024],[1024,768],[1100,800],[1180,757],[1200,800],[1280,900],[1440,900],[1920,1080]];
let scenarios = 0;
const contextOrigins = new WeakMap();
const closingContexts = new WeakSet();
async function closeContext(ctx) { closingContexts.add(ctx); await ctx.close(); }

async function context(browser, width, height, options = {}) {
  const value = options.preference ?? "on";
  const engine = browser.browserType().name();
  // Match the project's existing WebKit secure-origin loopback fixture, without
  // disabling TLS checks or changing the application/provider configuration.
  const navigationOrigin = engine === "webkit" ? base.origin.replace(/^http:/,"https:") : base.origin;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 500 ? 3 : 1, isMobile: width < 500 && engine !== "firefox", hasTouch: width < 500, reducedMotion: "no-preference", serviceWorkers: "block", ...options.context });
  contextOrigins.set(ctx,navigationOrigin);
  await ctx.addInitScript(({ key, value, blocked, observer }) => {
    if (blocked) Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Unavailable", "SecurityError"); } });
    else if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    if (observer === false) delete window.IntersectionObserver;
  }, { key: preferenceKey, value, blocked: options.blocked, observer: options.observer });
  await ctx.route("**/*", async route => {
    try {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== navigationOrigin || !["GET", "HEAD"].includes(request.method())) return await route.abort("blockedbyclient");
    if (target.pathname.startsWith("/_vercel/")) return await route.fulfill({status:200,contentType:"application/javascript",body:""});
    if (navigationOrigin !== base.origin) {
      target.protocol=base.protocol; target.hostname=base.hostname; target.port=base.port;
      return await route.fulfill({response:await route.fetch({url:target.href,maxRedirects:0})});
    }
    return await route.continue();
    } catch (error) {
      if (!closingContexts.has(ctx) || !/disposed|has been closed|Target.*closed/i.test(error.message)) throw error;
    }
  });
  return ctx;
}

async function open(ctx, waitForFonts = true) {
  const page = await ctx.newPage();
  await page.goto(contextOrigins.get(ctx), { waitUntil: "load" });
  // Firefox's font promise does not settle with page JavaScript disabled.
  if (waitForFonts) await page.evaluate(() => document.fonts.ready);
  return page;
}

async function ownedAnimations(page) {
  return page.evaluate(() => document.getAnimations().filter(animation => {
    const target = animation.effect?.target;
    const style = target instanceof Element ? getComputedStyle(target) : null;
    return animation.playState === "running" && style?.animationName !== "none" && /^(home-|shell-|glint|border-shift)/.test(animation.animationName || "");
  }).map(animation => ({ name: animation.animationName, iterations: String(animation.effect.getTiming().iterations) })));
}

for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox], ["WebKit", webkit]]) {
  if (selectedBrowser && selectedBrowser !== name) continue;
  const browser = await engine.launch();
  try {
    for (const [width,height] of name === "Chromium" ? widths : widths.filter(([w]) => [390,768,1180,1440].includes(w))) {
      const ctx = await context(browser,width,height);
      const page = await open(ctx);
      await page.locator('[data-decorative-motion="on"]').waitFor();
      const initial = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, actionBottom: document.querySelector("#heroJoinCta").getBoundingClientRect().bottom, propositionBottom: document.querySelector("#heroDescriptor").getBoundingClientRect().bottom, backgroundImages: document.querySelectorAll(".bg-photo").length }));
      assert.equal(initial.overflow,false,name+" overflow at "+width);
      assert.equal(initial.backgroundImages,0,"Opaque Home must not request the occluded decorative background");
      if ([390,1440].includes(width)) { assert(initial.actionBottom <= height,"Join fits "+width); assert(initial.propositionBottom <= height,"Proposition fits "+width); }
      await page.locator(".footer-brand").scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      const footer = await page.locator(".footer-brand").evaluate(element => {
        const brand = element.querySelector(".footer-brand-link").getBoundingClientRect();
        const desc = element.querySelector(".footer-desc").getBoundingClientRect();
        const text = element.querySelector(".brand-sub").getBoundingClientRect();
        return { gap: desc.top - brand.bottom, taglineWidth: text.width, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert(footer.gap >= 10,"Separated footer introduction at "+width+": "+footer.gap);
      assert(footer.taglineWidth >= 110,"Footer tagline must not collapse at "+width);
      assert.equal(footer.overflow,false,"Footer reflow at "+width);
      await page.evaluate(()=>scrollTo(0,280));
      if (width > 980) {
        const trigger = page.locator("#site-header").getByRole("button",{name:/^Resources\b/});
        await trigger.focus(); await trigger.press("Enter");
        const panel = page.locator("#nav-menu-resources");
        await panel.waitFor({state:"visible"});
        const surfaces = await panel.evaluate(element => ({ panel: getComputedStyle(element).backgroundImage, header: getComputedStyle(document.querySelector("#site-header")).background, rect: (()=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom};})(), width:innerWidth,height:innerHeight }));
        assert(/rgb\(16, 28, 32\)/.test(surfaces.panel),"Opaque menu base");
        assert(surfaces.header.includes("rgb(11, 20, 24)"),"Opaque header base");
        assert(surfaces.rect.left >= 0 && surfaces.rect.right <= surfaces.width + 1 && surfaces.rect.bottom <= surfaces.height + 1,"Menu fits viewport");
        await page.keyboard.press("Escape");
        assert.equal(await trigger.getAttribute("aria-expanded"),"false");
      }
      const toggle = page.getByRole("button",{name:"Decorative motion",exact:true});
      await toggle.focus(); await toggle.press("Enter");
      await page.locator('[data-decorative-motion="off"]').waitFor();
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),preferenceKey),"off");
      assert.deepEqual(await ownedAnimations(page),[]);
      assert.equal(await page.locator("#site-header").evaluate(element=>getComputedStyle(element).transitionDuration),"0s","Off also disables finite header feedback");
      await page.locator('.footer-nav[href="/events"]').click();
      await page.waitForURL(new URL("/events",contextOrigins.get(ctx)).href);
      assert.equal(await page.locator(".site-shell").getAttribute("data-decorative-motion"),"off","Off survives client navigation");
      assert.equal(await page.locator(".bg-photo").count(),1,"Other routes retain their background");
      assert.equal(await page.locator(".site-header").getAttribute("data-variant"),null,"Other routes retain full navigation");
      scenarios++;
      console.log(name+" "+width+"x"+height+": shell, reflow, opacity, preference and navigation passed.");
      await closeContext(ctx);
    }

    for (const options of [ {preference:"off"}, {preference:"obsolete"}, {blocked:true}, {observer:false}, {context:{reducedMotion:"reduce"}}, {context:{javaScriptEnabled:false}} ]) {
      console.log(name+" static fallback starting: "+JSON.stringify(options));
      const ctx=await context(browser,390,844,options); const page=await open(ctx,options.context?.javaScriptEnabled !== false);
      assert.equal(await page.locator("h1").count(),1);
      assert(await page.locator("#heroJoinCta").isVisible());
      if (options.context?.javaScriptEnabled !== false && options.observer !== false) await page.locator('[data-decorative-motion="off"]').waitFor();
      await page.evaluate(()=>scrollTo(0,1200)); await page.waitForTimeout(250);
      assert.deepEqual(await ownedAnimations(page),[],"Static fallback "+JSON.stringify(options));
      const visible=await page.locator(".home-section").evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).opacity!=="0"&&getComputedStyle(node).visibility!=="hidden"));
      assert(visible,"Content remains visible without enhancement"); scenarios++; await closeContext(ctx);
      console.log(name+" static fallback passed: "+JSON.stringify(options));
    }

    console.log(name+" live motion starting");
    const ctx=await context(browser,1180,757); const page=await open(ctx);
    await page.locator('[data-decorative-motion="on"]').waitFor();
    await page.evaluate(()=>{
      window.__entryCounts={};
      new MutationObserver(rows=>{for(const row of rows){if(row.attributeName==='data-motion-state'&&row.target.getAttribute('data-motion-state')==='enter'){const key=row.target.getAttribute('data-motion-key');window.__entryCounts[key]=(window.__entryCounts[key]||0)+1;}}}).observe(document.querySelector('.site-shell'),{attributes:true,subtree:true,attributeFilter:['data-motion-state']});
    });
    await page.mouse.wheel(0,300);
    await page.waitForFunction(()=>document.querySelector('#featuredBulletin').dataset.motionState==='enter');
    const active=await ownedAnimations(page);
    assert(active.some(a=>a.name==='home-edge-travel'),name+" featured border sweep actually runs");
    assert(active.every(a=>a.iterations!=="Infinity"),"Finite effects only");
    await page.locator("#featuredBulletin").focus();
    assert.equal(await page.locator("#featuredBulletin").getAttribute("data-motion-state"),null,"Focus ends entrance and border travel");
    await page.mouse.wheel(0,5000); await page.waitForTimeout(120);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.locator('[data-motion-state="enter"]').count(),0,"Hidden document finishes optional work");
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.mouse.wheel(0,-5000); await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>window.__entryCounts['home-event']),1,"Entry does not replay on scroll reversal");
    await page.emulateMedia({reducedMotion:"reduce"}); await page.locator('[data-decorative-motion="off"]').waitFor();
    assert.deepEqual(await ownedAnimations(page),[],"Live reduced motion ends decoration");
    await page.emulateMedia({reducedMotion:"no-preference"}); await page.locator('[data-decorative-motion="on"]').waitFor();
    const toggle=page.getByRole("button",{name:"Decorative motion",exact:true}); await toggle.click();
    await page.emulateMedia({reducedMotion:"reduce"}); await page.emulateMedia({reducedMotion:"no-preference"});
    assert.equal(await page.locator(".site-shell").getAttribute("data-decorative-motion"),"off","OS changes preserve explicit Off");
    await page.reload({waitUntil:"load"}); await page.locator('[data-decorative-motion="off"]').waitFor();
    scenarios++; await closeContext(ctx);
    console.log(name+" live motion passed");
  } finally { for (const ctx of browser.contexts()) closingContexts.add(ctx); await browser.close(); }
}
console.log("Homepage polish passed ("+scenarios+" scenarios; local reads and preference writes only).");
