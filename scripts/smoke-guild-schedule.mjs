import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseArgument = process.argv.find((value) => value.startsWith("--base-url="));
const baseUrl = new URL(baseArgument?.slice("--base-url=".length) || "http://127.0.0.1:8765");
if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("Guild schedule smoke requires a local HTTP application server.");
}

const browser = await chromium.launch({ headless: true });
const errors = [];
let observations = 0;

async function openAt(route, instant, timezoneId = "UTC", browserInstance = browser) {
  const context = await browserInstance.newContext({ timezoneId });
  await context.route("**/*", (request) => new URL(request.request().url()).origin === baseUrl.origin
    ? request.continue()
    : request.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/hydration|hydrated|did not match|server rendered|Minified React error/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.scheduleLifecycle = [];
    for (const event of ["freeze", "resume", "visibilitychange"]) {
      document.addEventListener(event, (nativeEvent) => window.scheduleLifecycle.push({ event, visibility: document.visibilityState, trusted: nativeEvent.isTrusted, now: Date.now() }));
    }
    window.addEventListener("focus", (nativeEvent) => window.scheduleLifecycle.push({ event: "focus", visibility: document.visibilityState, trusted: nativeEvent.isTrusted, now: Date.now() }));
  });
  // Deliberately use a browser instant different from the request's real server clock.
  await page.clock.install({ time: new Date(Date.parse(instant) - 60_000) });
  await page.goto(new URL(route, baseUrl).href, { waitUntil: "networkidle" });
  await page.clock.pauseAt(instant);
  return { context, page, route };
}

async function expectFeatured(view, title, date, timeText) {
  const titleSelector = view.route === "/" ? "#featuredBulletinTitle" : "#featuredCard h3";
  const metaSelector = view.route === "/" ? "#featuredBulletinDate" : "#featuredCard .kicker";
  await view.page.locator(titleSelector).filter({ hasText: title }).waitFor();
  assert.equal((await view.page.locator(titleSelector).textContent())?.trim(), title);
  const meta = (await view.page.locator(metaSelector).textContent())?.trim();
  assert.ok(meta?.includes(date), `${title}: expected ${date}, received ${meta}`);
  assert.ok(meta?.includes(timeText), `${title}: expected ${timeText}, received ${meta}`);
  assert.ok(meta?.includes("UTC+8"), `${title}: missing authoritative timezone`);
  observations += 1;
  return { title, meta };
}

async function boardItem(page, title) {
  return page.locator("#eventsUpcoming .events-list__item").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).locator(".kicker").textContent();
}

try {
  const timezoneSnapshots = [];
  for (const timezoneId of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
    const snapshots = [];
    for (const route of ["/", "/events"]) {
      const view = await openAt(route, "2026-11-01T23:59:00+08:00", timezoneId);
      try {
        snapshots.push(await expectFeatured(view, "Monthly Guild Gathering", "2 Nov 2026", "12:00 AM - 1:00 AM"));
        if (route === "/events") {
          assert.equal(await view.page.locator("#eventsUpcoming .events-list__item").count(), 7);
          assert.match(await boardItem(view.page, "Guild Party"), /2 Nov 2026/);
          assert.match(await boardItem(view.page, "Monthly Guild Gathering"), /After the first Sunday/);
          assert.equal(await view.page.getByRole("heading", { name: "Monthly Guild Raffle", exact: true }).count(), 0);
          await view.page.getByRole("button", { name: "Past", exact: true }).click();
          assert.equal(await view.page.locator("#eventsUpcoming .events-list__item").count(), 0);
          assert.match(await view.page.locator("#eventsUpcoming").textContent(), /No past events are archived/);
          await view.page.getByRole("button", { name: "Upcoming", exact: true }).click();
        }
        await view.page.clock.runFor(60_000);
        await expectFeatured(view, "Monthly Guild Gathering", "2 Nov 2026", "12:00 AM - 1:00 AM");
        await view.page.clock.fastForward(3_599_999);
        await expectFeatured(view, "Monthly Guild Gathering", "2 Nov 2026", "12:00 AM - 1:00 AM");
        await view.page.clock.runFor(1);
        await expectFeatured(view, "Guild Party", "2 Nov 2026", "9:30 PM - 10:00 PM");
        if (timezoneId === "UTC") {
          for (const width of [360, 390, 768]) {
            await view.page.setViewportSize({ width, height: 844 });
            const geometry = await view.page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
            assert.ok(geometry.scrollWidth <= geometry.width, `${route} overflow at ${width}px: ${geometry.scrollWidth}`);
          }
        }
        if (route === "/events") assert.match(await boardItem(view.page, "Monthly Guild Gathering"), /7 Dec 2026/);
        await view.page.clock.runFor(1);
        await expectFeatured(view, "Guild Party", "2 Nov 2026", "9:30 PM - 10:00 PM");
      } finally {
        await view.context.close();
      }
    }
    timezoneSnapshots.push(snapshots);
  }
  assert.deepEqual(timezoneSnapshots[0], timezoneSnapshots[1]);
  assert.deepEqual(timezoneSnapshots[0], timezoneSnapshots[2]);

  for (const route of ["/", "/events"]) {
    const friday = await openAt(route, "2026-10-09T21:59:59.999+08:00");
    try {
      await expectFeatured(friday, "Guild Party", "9 Oct 2026", "9:30 PM - 10:00 PM");
      await friday.page.clock.runFor(1);
      await expectFeatured(friday, "Skyward Bond", "9 Oct 2026", "10:00 PM - 11:00 PM");
      if (route === "/events") assert.match(await boardItem(friday.page, "Guild Hero's Realm: Weekly Coordination"), /9 Oct 2026.*11:00 PM - 12:00 AM/);
      await friday.page.clock.fastForward(3_599_999);
      await expectFeatured(friday, "Skyward Bond", "9 Oct 2026", "10:00 PM - 11:00 PM");
      await friday.page.clock.runFor(1);
      await expectFeatured(friday, "Guild Hero's Realm: Weekly Coordination", "9 Oct 2026", "11:00 PM - 12:00 AM");
      await friday.page.clock.fastForward(3_599_999);
      await expectFeatured(friday, "Guild Hero's Realm: Weekly Coordination", "9 Oct 2026", "11:00 PM - 12:00 AM");
      await friday.page.clock.runFor(1);
      await expectFeatured(friday, "Guild Wars", "10 Oct 2026", "8:30 PM - 11:00 PM");
    } finally {
      await friday.context.close();
    }

    const yearEnd = await openAt(route, "2026-12-31T23:59:59.999+08:00");
    try {
      await expectFeatured(yearEnd, "Showdown", "31 Dec 2026", "10:00 PM - 12:00 AM");
      await yearEnd.page.clock.runFor(1);
      await expectFeatured(yearEnd, "Guild Party", "1 Jan 2027", "9:30 PM - 10:00 PM");
    } finally {
      await yearEnd.context.close();
    }

    const monthEnd = await openAt(route, "2026-11-30T23:59:59.999+08:00");
    try {
      await expectFeatured(monthEnd, "Breaking Army", "30 Nov 2026", "10:00 PM - 12:00 AM");
      await monthEnd.page.clock.runFor(1);
      await expectFeatured(monthEnd, "Guild Party", "1 Dec 2026", "9:30 PM - 10:00 PM");
    } finally {
      await monthEnd.context.close();
    }
  }

  const resumeBrowser = await chromium.launch({ channel: "chromium", headless: false });
  const suspended = await openAt("/events", "2026-11-02T00:31:00+08:00", "UTC", resumeBrowser);
  try {
    await expectFeatured(suspended, "Monthly Guild Gathering", "2 Nov 2026", "12:00 AM - 1:00 AM");
    await suspended.page.getByRole("button", { name: "All", exact: true }).click();
    const cdp = await suspended.context.newCDPSession(suspended.page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    const background = await suspended.context.newPage();
    await background.bringToFront();
    const browserCdp = await resumeBrowser.newBrowserCDPSession();
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    const { windowId } = await browserCdp.send("Browser.getWindowForTarget", { targetId: targetInfo.targetId });
    await browserCdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    const nativeHidden = await suspended.page.evaluate(() => document.visibilityState === "hidden");
    if (nativeHidden) await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await suspended.page.clock.setSystemTime("2026-11-02T01:05:00+08:00");
    if (nativeHidden) await cdp.send("Page.setWebLifecycleState", { state: "active" });
    await browserCdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await suspended.page.bringToFront();
    await suspended.page.clock.runFor(0);
    await expectFeatured(suspended, "Guild Party", "2 Nov 2026", "9:30 PM - 10:00 PM");
    assert.equal(await suspended.page.getByRole("button", { name: "All", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await boardItem(suspended.page, "Monthly Guild Gathering"), /7 Dec 2026/);
    const lifecycle = await suspended.page.evaluate(() => window.scheduleLifecycle);
    assert.ok(lifecycle.some((entry) => entry.event === "focus" && entry.trusted && entry.now === Date.parse("2026-11-02T01:05:00+08:00")), "Chromium did not dispatch a native focus event after resuming");
    if (nativeHidden) {
      assert.ok(lifecycle.some((entry) => entry.event === "freeze" && entry.trusted), "Chromium did not dispatch a native freeze event");
      assert.ok(lifecycle.some((entry) => entry.event === "resume" && entry.trusted), "Chromium did not dispatch a native resume event");
    } else {
      console.log("- Native freeze/resume SKIPPED: this environment kept document visible during background/minimize; native focus resume is verified.");
    }
    console.log(`- Native Chromium resume observations (timers remained paused): ${JSON.stringify(lifecycle)}.`);

    await suspended.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await suspended.page.clock.setSystemTime("2026-12-07T00:31:00+08:00");
    assert.equal((await suspended.page.locator("#featuredCard h3").textContent())?.trim(), "Guild Party");
    await suspended.page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expectFeatured(suspended, "Monthly Guild Gathering", "7 Dec 2026", "12:00 AM - 1:00 AM");
    console.log("- Synthetic visibilitychange covered hidden-tab timer pause and visible-tab refresh separately.");
    await suspended.page.clock.setSystemTime("2026-12-07T01:00:00+08:00");
    await suspended.page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expectFeatured(suspended, "Guild Party", "7 Dec 2026", "9:30 PM - 10:00 PM");
    console.log("- Synthetic pageshow also refreshed after a wall-clock change without firing a schedule timer.");
  } finally {
    await suspended.context.close();
    await resumeBrowser.close();
  }

  assert.deepEqual(errors, [], "Browser runtime or hydration errors");
  console.log(`Guild schedule browser smoke OK: ${observations} scheduling observations.`);
  console.log("- Home/Events agree through the Nov 2 midnight/01:00 boundaries, Dec 7 recurrence, Friday Skyward 22:00 to Hero 23:00 to midnight, month and year rollover.");
  console.log("- UTC, Los Angeles and Auckland browsers render identical UTC+8 dates and clocks.");
  console.log("- Separate Monday Guild Party and midnight gathering, inactive public raffle, filter state, native focus resume and hydration passed.");
  console.log("- This uses virtual browser time and a real local server; it is not live game or deployed-site evidence.");
} finally {
  await browser.close();
}
