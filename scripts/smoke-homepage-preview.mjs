import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DISCORD_INVITE_URL, OFFICIAL_GUILD_PROFILES } from "./lib/public-urls.mjs";

const args = process.argv.slice(2);
const baseUrl = new URL(args[args.indexOf("--base-url") + 1] || "http://127.0.0.1:8765");
assert(["127.0.0.1", "localhost"].includes(baseUrl.hostname), "Use the local fixture server.");
const sharedRoutes = ["/join", "/events", "/gallery", "/spotlight", "/recruitment", "/tome", "/ranks", "/leaders", "/announcements", "/raffle", "/spotify", "/twills"];
const viewports = [[320, 800], [360, 800], [375, 812], [390, 844], [768, 1024], [1024, 768], [1280, 900], [1440, 900]];
const browser = await chromium.launch();
let scenarios = 0;
try {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768, deviceScaleFactor: width < 768 ? 3 : 1, reducedMotion: "reduce" });
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseUrl.origin || !["GET", "HEAD"].includes(request.method())) return route.abort("blockedbyclient");
      if (url.pathname.startsWith("/_vercel/")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(baseUrl.href, { waitUntil: "domcontentloaded" });
    await page.locator("#heroJoinCta").waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("main #homeHeading").count(), 1);
    assert.equal(await page.locator("#main").getAttribute("tabindex"), "-1");
    assert.equal(await page.locator("#start-here ol > li").count(), 3);
    assert.match(await page.locator("#start-here").innerText(), /Double Counter verification/);
    assert.equal(await page.locator("#heroJoinCta").getAttribute("href"), DISCORD_INVITE_URL);
    const layout = await page.evaluate(() => {
      const action = document.querySelector("#heroJoinCta").getBoundingClientRect();
      const descriptor = document.querySelector("#heroDescriptor").getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, action: { top: action.top, bottom: action.bottom, width: action.width, height: action.height }, descriptorBottom: descriptor.bottom };
    });
    assert.equal(layout.overflow, false, `Home overflow at ${width}`);
    assert(layout.action.height >= 44, `Primary touch target at ${width}`);
    if (width === 390 || width === 1440) {
      assert(layout.action.bottom <= height, `Primary action outside ${width}x${height}: ${layout.action.bottom}`);
      assert(layout.descriptorBottom <= height, `Proposition outside ${width}x${height}`);
    }
    await page.locator('a[href="#main"]').first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.id), "main", "Skip link must focus main");
    assert.equal(await page.locator("#galleryGrid .home-thumb").count(), 4);
    if (width > 980) {
      const resources = page.locator("#site-header").getByRole("button", { name: /^Resources\b/ });
      await resources.focus();
      await resources.press("Enter");
      const menu = page.locator("#nav-menu-resources");
      await menu.waitFor({ state: "visible" });
      for (const href of [...sharedRoutes.filter(href => href !== "/twills"), "/games/mochi-pets"]) {
        assert.equal(await menu.locator(`a[href="${href}"]`).count(), 1, `Missing Home resource ${href}`);
      }
      for (const profile of OFFICIAL_GUILD_PROFILES) assert.equal(await menu.locator(`a[href="${profile.href}"]`).count(), 1);
      assert(await menu.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; }), `Resources menu clipped at ${width}`);
      await resources.press("Escape");
      assert.equal(await resources.getAttribute("aria-expanded"), "false");
    }
    console.log(`Home ${width}x${height}: CTA bottom ${layout.action.bottom.toFixed(1)}, overflow false.`);
    scenarios++;
    for (const routePath of sharedRoutes) {
      const response = await page.goto(new URL(routePath, baseUrl).href, { waitUntil: "domcontentloaded" });
      assert.equal(response.status(), 200, `${routePath} response`);
      const hero = page.locator(".page-hero").first();
      await hero.waitFor();
      const geometry = await hero.evaluate(element => { const box = element.getBoundingClientRect(); const image = element.querySelector(".page-hero__img"); return { ratio: box.width / box.height, fit: getComputedStyle(image).objectFit, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
      assert(Math.abs(geometry.ratio - 1.5) < 0.03, `${routePath} shared hero ratio ${geometry.ratio}`);
      assert.equal(geometry.fit, "contain", `${routePath} shared image fit`);
      assert.equal(geometry.overflow, false, `${routePath} overflow at ${width}`);
      assert.equal(new URL(page.url()).origin, baseUrl.origin);
      if (width > 980) {
        assert.equal(await page.locator("#site-header").getByRole("button", { name: /^Guild\b/ }).count(), 1, `${routePath} ordinary header`);
        assert.equal(await page.locator("#site-header").getByRole("button", { name: /^Resources\b/ }).count(), 0);
      }
      scenarios++;
    }
    await context.close();
  }
  console.log(`Homepage and shared hero smoke passed (${scenarios} scenarios; external and write requests blocked).`);
} finally {
  await browser.close();
}
