import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { CHECK_PLAN } from "./check-all.mjs";
import { PUBLIC_UX_TIMEOUT_MS, openPublicPage, publicPageReady, runEventsPublicUxSmoke } from "./smoke-events-public-ux.mjs";

const baseUrl = new URL("http://127.0.0.1:8765");
const fallbackText = "Upcoming times are shown below. Reload this page for the latest schedule.";

function node(textContent = "", { visible = true, attributes = {} } = {}) {
  return {
    textContent,
    attributes,
    style: { display: visible ? "block" : "none", visibility: "visible" },
    getClientRects() { return this.style.display === "none" ? [] : [{}]; },
    getAttribute(name) { return this.attributes[name] ?? null; },
  };
}

function routeDocument(route = "/events", javaScriptEnabled = true) {
  const elements = new Map([
    ["h1", [node(route === "/events" ? "Events" : "Mōchirīī")]],
    ['a[href="/events"] .home-link', route === "/" ? [node("View All Events")] : []],
    ["#eventsUpcoming .events-list__item", route === "/events" ? Array.from({ length: 7 }, () => node()) : []],
    ["#eventsCount", [node("Upcoming: 7 events")]],
    [".events-filters", [node("", { visible: javaScriptEnabled })]],
    ["noscript p", javaScriptEnabled ? [] : [node(fallbackText)]],
  ]);
  for (const filter of ["upcoming", "past", "all"]) {
    elements.set(`[data-events-filter="${filter}"]`, [node(filter, {
      attributes: { "aria-pressed": String(filter === "upcoming") },
    })]);
  }
  return {
    readyState: "interactive",
    body: { dataset: { page: route === "/events" && javaScriptEnabled ? "events" : "home" } },
    elements,
    querySelectorAll(selector) { return this.elements.get(selector) || []; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
}

function evaluateReadiness(predicate, expected, document) {
  // Execute the actual browser callback, without a copied readiness implementation.
  return vm.runInNewContext(`(${predicate.toString()})(expected)`, {
    document,
    expected,
    getComputedStyle: (element) => element.style,
  });
}

function harness({
  route = "/events", javaScriptEnabled = true, status = 200, noResponse = false,
  responseUrl = new URL(route, baseUrl).href, pageUrl = responseUrl,
  redirectedFrom = null, documents = [routeDocument(route, javaScriptEnabled)],
  gotoError, rejectGoto = false, closeError, renderUrl, browserCloseError, rejectBrowserClose = false,
} = {}) {
  const calls = { contexts: [], goto: [], readiness: [], samples: [], closed: 0, browserClosed: 0, listeners: new Map() };
  const timeout = new Error("Synthetic render readiness timeout");
  let currentUrl = pageUrl;
  const page = {
    on(event, listener) { calls.listeners.set(event, listener); },
    async goto(url, options) {
      calls.goto.push({ url, options });
      if (gotoError || rejectGoto) throw gotoError;
      // Model a route whose independent background request never becomes idle.
      if (options.waitUntil === "networkidle") throw new Error("Background request still active");
      return noResponse ? null : { status: () => status, url: () => responseUrl, request: () => ({ redirectedFrom: () => redirectedFrom }) };
    },
    url() { return currentUrl; },
    async waitForFunction(predicate, expected, options) {
      calls.readiness.push({ predicate, expected, options });
      for (const document of documents) {
        const ready = evaluateReadiness(predicate, expected, document);
        calls.samples.push(ready);
        if (ready) {
          if (renderUrl) currentUrl = renderUrl;
          return;
        }
      }
      throw timeout;
    },
  };
  const context = {
    async route(pattern, handler) { calls.routePattern = pattern; calls.routeHandler = handler; },
    async newPage() { return page; },
    async close() { calls.closed += 1; if (closeError) throw closeError; },
  };
  const browser = {
    async newContext(options) { calls.contexts.push(options); return context; },
    async close() { calls.browserClosed += 1; if (rejectBrowserClose) throw browserCloseError; },
  };
  return { browser, context, page, calls, timeout };
}

test("import has no CLI parsing or browser side effect", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval",
    `await import(${JSON.stringify(new URL("./smoke-events-public-ux.mjs", import.meta.url).href)}); console.log("import-only");`,
    "--", "--base-url=https://outside.example"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "import-only");
});

test("root check plan executes the focused regression file exactly once", () => {
  assert.deepEqual(CHECK_PLAN.filter(([name]) => name === "test:events-public-ux-readiness"), [
    ["test:events-public-ux-readiness", ["node", "--test", "scripts/smoke-events-public-ux.test.mjs"]],
  ]);
});

for (const route of ["/events", "/"]) {
  for (const javaScriptEnabled of [true, false]) {
    test(`actual open accepts complete ${route}, JavaScript=${javaScriptEnabled}, despite ongoing background traffic`, async () => {
      const fixture = harness({ route, javaScriptEnabled });
      const result = await openPublicPage(fixture.browser, baseUrl, route, { javaScriptEnabled });
      assert.equal(result.page, fixture.page);
      assert.equal(result.context, fixture.context);
      assert.deepEqual(fixture.calls.goto, [{
        url: new URL(route, baseUrl).href,
        options: { waitUntil: "domcontentloaded", timeout: PUBLIC_UX_TIMEOUT_MS },
      }]);
      assert.equal(PUBLIC_UX_TIMEOUT_MS, 30_000);
      assert.equal(fixture.calls.readiness[0].predicate, publicPageReady);
      assert.deepEqual(fixture.calls.readiness[0].expected, { route, javaScriptEnabled });
      assert.deepEqual(fixture.calls.readiness[0].options, { timeout: 30_000 });
      assert.deepEqual(fixture.calls.contexts, [{ viewport: { width: 1440, height: 900 }, javaScriptEnabled }]);
      assert.equal(fixture.calls.closed, 0);
      await result.context.close();
      assert.equal(fixture.calls.closed, 1);
    });
  }
}

for (const status of [204, 301, 404, 500, null]) {
  test(`actual open rejects ${status === null ? "missing" : status} HTTP response before render and closes the context`, async () => {
    const fixture = harness({ status, noResponse: status === null });
    await assert.rejects(openPublicPage(fixture.browser, baseUrl, "/events"), /application response was not successful/);
    assert.equal(fixture.calls.readiness.length, 0);
    assert.equal(fixture.calls.closed, 1);
  });
}

for (const drift of [
  { responseUrl: "https://outside.example/events?PRIVATE_SENTINEL" },
  { pageUrl: "http://127.0.0.1:8765/?PRIVATE_SENTINEL" },
  { responseUrl: "http://user:PRIVATE_SENTINEL@127.0.0.1:8765/events" },
  { redirectedFrom: {} },
  { renderUrl: "http://127.0.0.1:8765/events#PRIVATE_SENTINEL" },
]) {
  test(`actual open rejects navigation or post-render URL drift (${Object.keys(drift)[0]})`, async () => {
    const fixture = harness(drift);
    await assert.rejects(openPublicPage(fixture.browser, baseUrl, "/events"), (error) => {
      assert.match(error.message, /exact requested route/);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL|outside\.example/);
      return true;
    });
    assert.equal(fixture.calls.closed, 1);
  });
}

const incompleteEvents = [
  ["still loading", (document) => { document.readyState = "loading"; }],
  ["body marker not hydrated", (document) => { document.body.dataset.page = "home"; }],
  ["missing heading", (document) => { document.elements.set("h1", []); }],
  ["duplicate heading", (document) => { document.elements.get("h1").push(node("Events")); }],
  ["wrong heading", (document) => { document.elements.get("h1")[0].textContent = "Gallery"; }],
  ["incomplete board", (document) => { document.elements.get("#eventsUpcoming .events-list__item").pop(); }],
  ["stale count", (document) => { document.elements.get("#eventsCount")[0].textContent = "Upcoming: 6 events"; }],
  ["wrong initial filter", (document) => { document.elements.get('[data-events-filter="upcoming"]')[0].attributes["aria-pressed"] = "false"; }],
  ["another pressed filter", (document) => { document.elements.get('[data-events-filter="past"]')[0].attributes["aria-pressed"] = "true"; }],
  ["missing filter", (document) => { document.elements.delete('[data-events-filter="all"]'); }],
  ["duplicate filter", (document) => { document.elements.get('[data-events-filter="all"]').push(node("All")); }],
  ["invisible filters", (document) => { document.elements.get(".events-filters")[0].style.visibility = "hidden"; }],
];

for (const [name, mutate] of incompleteEvents) {
  test(`actual readiness rejects ${name}; actual open propagates its bounded wait failure`, async () => {
    const document = routeDocument();
    mutate(document);
    assert.equal(evaluateReadiness(publicPageReady, { route: "/events", javaScriptEnabled: true }, document), false);
    const fixture = harness({ documents: [document] });
    await assert.rejects(openPublicPage(fixture.browser, baseUrl, "/events"), (error) => error === fixture.timeout);
    assert.equal(fixture.calls.closed, 1);
  });
}

test("actual open waits through the initial SSR state for the complete client render", async () => {
  const initial = routeDocument("/events", false);
  const fixture = harness({ documents: [initial, routeDocument()] });
  await openPublicPage(fixture.browser, baseUrl, "/events");
  assert.deepEqual(fixture.calls.samples, [false, true]);
  await fixture.context.close();
});

for (const [name, mutate] of [
  ["missing noscript fallback", (document) => { document.elements.delete("noscript p"); }],
  ["wrong noscript fallback", (document) => { document.elements.get("noscript p")[0].textContent = "Loading"; }],
  ["visible nonfunctional filters", (document) => { document.elements.get(".events-filters")[0].style.display = "block"; }],
  ["incorrect SSR body marker", (document) => { document.body.dataset.page = "events"; }],
]) {
  test(`JavaScript-disabled Events rejects ${name}`, async () => {
    const document = routeDocument("/events", false);
    mutate(document);
    const fixture = harness({ javaScriptEnabled: false, documents: [document] });
    await assert.rejects(openPublicPage(fixture.browser, baseUrl, "/events", { javaScriptEnabled: false }), (error) => error === fixture.timeout);
    assert.equal(fixture.calls.closed, 1);
  });
}

for (const [name, mutate] of [
  ["missing Events link", (document) => { document.elements.delete('a[href="/events"] .home-link'); }],
  ["duplicate Events link", (document) => { document.elements.get('a[href="/events"] .home-link').push(node("View All Events")); }],
  ["invisible Events label", (document) => { document.elements.get('a[href="/events"] .home-link')[0].style.display = "none"; }],
  ["incorrect Events label", (document) => { document.elements.get('a[href="/events"] .home-link')[0].textContent = "View All"; }],
]) {
  test(`Home render rejects ${name}`, async () => {
    const document = routeDocument("/");
    mutate(document);
    const fixture = harness({ route: "/", documents: [document] });
    await assert.rejects(openPublicPage(fixture.browser, baseUrl, "/"), (error) => error === fixture.timeout);
    assert.equal(fixture.calls.closed, 1);
  });
}

test("navigation and render failures retain the first error even if context cleanup fails", async () => {
  const error = new Error("Synthetic navigation timeout");
  const navigation = harness({ gotoError: error, closeError: new Error("Synthetic cleanup failure") });
  await assert.rejects(openPublicPage(navigation.browser, baseUrl, "/events"), (actual) => actual === error);
  assert.equal(navigation.calls.closed, 1);
  const render = harness({ documents: [routeDocument("/events", false)], closeError: error });
  await assert.rejects(openPublicPage(render.browser, baseUrl, "/events"), (actual) => actual === render.timeout);
  assert.equal(render.calls.closed, 1);
});

test("actual open retains same-origin request isolation and runtime/hydration error listeners", async () => {
  const fixture = harness();
  const errors = [];
  await openPublicPage(fixture.browser, baseUrl, "/events", {}, errors);
  const traffic = [];
  for (const url of ["http://127.0.0.1:8765/_next/chunk.js", "https://outside.example/tracker"]) {
    await fixture.calls.routeHandler({ request: () => ({ url: () => url }), continue: () => traffic.push("continue"), abort: () => traffic.push("abort") });
  }
  assert.equal(fixture.calls.routePattern, "**/*");
  assert.deepEqual(traffic, ["continue", "abort"]);
  fixture.calls.listeners.get("pageerror")(new Error("Synthetic page failure"));
  fixture.calls.listeners.get("console")({ text: () => "Synthetic hydration mismatch" });
  fixture.calls.listeners.get("console")({ text: () => "Ordinary console message" });
  assert.deepEqual(errors, ["Synthetic page failure", "Synthetic hydration mismatch"]);
  await fixture.context.close();
});

test("actual smoke runner delegates to guarded open and closes its browser on failure", async () => {
  const fixture = harness({ status: 404 });
  const launches = [];
  await assert.rejects(runEventsPublicUxSmoke({ argv: [], browserType: {
    async launch(options) { launches.push(options); return fixture.browser; },
  } }), /application response was not successful/);
  assert.deepEqual(launches, [{ headless: true }]);
  assert.equal(fixture.calls.contexts[0].javaScriptEnabled, true);
  assert.deepEqual(fixture.calls.contexts[0].viewport, { width: 360, height: 900 });
  assert.equal(fixture.calls.goto[0].url, "http://127.0.0.1:8765/events");
  assert.equal(fixture.calls.closed, 1);
  assert.equal(fixture.calls.browserClosed, 1);
});

for (const failure of [new Error("Synthetic first failure"), "Synthetic first failure", null, undefined, false, 0]) {
  test(`actual default runner preserves ${failure instanceof Error ? "Error" : String(failure)} navigation failure when browser cleanup also fails`, async () => {
    const fixture = harness({ gotoError: failure, rejectGoto: true,
      browserCloseError: new Error("Synthetic browser cleanup failure"), rejectBrowserClose: true });
    let rejected = false;
    try {
      await runEventsPublicUxSmoke({ argv: [], browserType: { async launch() { return fixture.browser; } } });
    } catch (error) {
      rejected = true;
      assert.equal(error, failure);
    }
    assert.equal(rejected, true);
    assert.equal(fixture.calls.goto.length, 1);
    assert.equal(fixture.calls.closed, 1);
    assert.equal(fixture.calls.browserClosed, 1);
  });
}

test("actual default runner preserves HTTP and render failures over browser cleanup failure", async () => {
  for (const scenario of [{ status: 404 }, { documents: [routeDocument("/events", false)] }]) {
    const fixture = harness({ ...scenario, browserCloseError: new Error("Synthetic cleanup failure"), rejectBrowserClose: true });
    await assert.rejects(runEventsPublicUxSmoke({ argv: [], browserType: { async launch() { return fixture.browser; } } }),
      (error) => scenario.status === 404 ? /application response was not successful/.test(error.message) : error === fixture.timeout);
    assert.equal(fixture.calls.closed, 1);
    assert.equal(fixture.calls.browserClosed, 1);
  }
});

for (const failure of [new Error("Synthetic standalone cleanup failure"), undefined]) {
  test(`actual runner surfaces standalone ${failure instanceof Error ? "Error" : "undefined"} browser cleanup failure after successful inspection`, async () => {
    const fixture = harness({ browserCloseError: failure, rejectBrowserClose: true });
    const inspections = [];
    let rejected = false;
    try {
      await runEventsPublicUxSmoke({ argv: [], browserType: { async launch() { return fixture.browser; } },
        // Exercise only the resource-cleanup success seam. The default inspector
        // remains bound by the actual-runner HTTP/render tests and built smoke.
        async inspect(browser, target) { inspections.push({ browser, target }); },
      });
    } catch (error) {
      rejected = true;
      assert.equal(error, failure);
    }
    assert.equal(rejected, true);
    assert.deepEqual(inspections, [{ browser: fixture.browser, target: baseUrl }]);
    assert.equal(fixture.calls.browserClosed, 1);
  });
}

test("actual runner rejects non-local or non-HTTP targets before launching", async () => {
  for (const url of ["https://127.0.0.1:8765", "http://outside.example:8765"]) {
    await assert.rejects(runEventsPublicUxSmoke({ argv: [`--base-url=${url}`], browserType: {
      async launch() { assert.fail("An invalid target must not launch a browser"); },
    } }), /local HTTP application server/);
  }
});
