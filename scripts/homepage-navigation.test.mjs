import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
const requireWeb = createRequire(resolve(webRoot, "package.json"));
const React = requireWeb("react");
let birthdayHooks = null;
const birthdayReact = Object.fromEntries(["useState", "useRef", "useEffect"].map(name => [name, (...args) => (birthdayHooks || React)[name](...args)]));
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const ts = requireWeb("typescript");
let pathname = "/";
let scheduleState;
let spotlightFixture = null;
let spotlightRequests = 0;
const cache = new Map();

// Compile the actual components in memory. No production fixture hooks, global
// module interception, browser, backend, or generated fixture files are needed.
function loadComponentSource(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
  const module = { exports: {} };
  cache.set(filename, module);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const errors = diagnostics.filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")), []);
  const localRequire = (specifier) => {
    if (specifier === "react" && filename.endsWith("HomeBirthdaySplash.tsx")) return birthdayReact;
    if (specifier.endsWith(".css")) return {};
    if (specifier === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
    if (specifier === "next/image") return Object.assign((props) => {
      const imageProps = { ...props };
      delete imageProps.fill;
      delete imageProps.priority;
      delete imageProps.unoptimized;
      return React.createElement("img", imageProps);
    }, { getImageProps: (props) => ({ props }) });
    if (specifier === "next/navigation") return { usePathname: () => pathname };
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/supabase/spotlight") return { getCurrentSpotlightWinner: async () => {
      spotlightRequests++;
      return typeof spotlightFixture === "function" ? spotlightFixture() : spotlightFixture;
    } };
    if (specifier === "@/lib/events/use-guild-schedule") return { useGuildSchedule: () => scheduleState };
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return requireWeb(specifier);
    const base = specifier.startsWith("@/")
      ? resolve(webRoot, specifier.slice(2))
      : resolve(dirname(filename), specifier);
    const dependency = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
    assert.ok(dependency, `unresolved component dependency: ${specifier}`);
    return loadComponentSource(dependency);
  };
  const execute = runInThisContext(`(function(require, module, exports) {\n${outputText}\n})`, { filename });
  execute(localRequire, module, module.exports);
  return module.exports;
}

const { SiteHeader } = loadComponentSource(resolve(webRoot, "components/SiteHeader.tsx"));
const { SiteFooter } = loadComponentSource(resolve(webRoot, "components/SiteFooter.tsx"));
const { HomeNextEvent } = loadComponentSource(resolve(webRoot, "components/public-pages/HomeNextEvent.tsx"));
const { getHomeRecruitment } = loadComponentSource(resolve(webRoot, "lib/home-recruitment.ts"));
const { HomePvpHighlights } = loadComponentSource(resolve(webRoot, "components/home/HomePvpHighlights.tsx"));
const { publicGuildSchedule } = loadComponentSource(resolve(webRoot, "lib/events/public-schedule.ts"));
const { websiteEventCardsFromSchedule } = loadComponentSource(resolve(webRoot, "lib/guild-schedule.ts"));
const publicUrls = JSON.parse(readFileSync(resolve(webRoot, "config/public-urls.json"), "utf8"));
const scheduleAuthority = JSON.parse(readFileSync(resolve(webRoot, "public/data/guild-schedule.json"), "utf8"));
const homeData = JSON.parse(readFileSync(resolve(webRoot, "public/data/home.json"), "utf8"));
const eventImageSizes = "(max-width: 767px) 100vw, 700px";

function unexpectedRequest() {
  throw new Error("rendering navigation must not initiate auth, moderator, or spinner requests");
}

test("PvP keeps its empty state honest and loads no player or invented cards", () => {
  const html = renderToStaticMarkup(React.createElement(HomePvpHighlights, { clips: [] }));
  assert.match(html, /PvP Highlights/);
  assert.match(html, /Duel highlights will appear here/);
  assert.doesNotMatch(html, /<video|data-pvp-play|<button/);
});

test("reviewed PvP cards keep poster dimensions and a native link fallback without video sources before intent", () => {
  const html = renderToStaticMarkup(React.createElement(HomePvpHighlights, { clips: [{ id: "local-fixture", title: "Fixture duel", description: "Two fixture fighters", durationSeconds: 92,
    width: 1920, height: 1080, poster: "/assets/home/pvp/local-fixture/poster.webp", source: "/assets/home/pvp/local-fixture/clip-h264.mp4",
    captions: { source: "/assets/home/pvp/local-fixture/captions.vtt", language: "en", label: "English" }, transcript: "A fixture transcript." }] }));
  assert.match(html, /href="\/assets\/home\/pvp\/local-fixture\/clip-h264.mp4"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /<video hidden="" controls="" playsInline="" preload="none" width="1920" height="1080"/);
  assert.doesNotMatch(html, /<video[^>]*\ssrc=|<source|<track[^>]*\ssrc=|autoplay=/i);
  assert.match(html, /A fixture transcript/);
});

function renderShell(authState, { home = true, status = "open" } = {}) {
  pathname = home ? "/" : "/join";
  const homeRecruitment = home ? getHomeRecruitment(status) : undefined;
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(SiteHeader, {
      authState,
      homeRecruitment,
      ensureAuthLoaded: unexpectedRequest,
      ensureModeratorAccess: unexpectedRequest,
      launchSpinnerViewer: unexpectedRequest,
    }),
    React.createElement(SiteFooter, { authState, homeRecruitment, launchSpinnerViewer: unexpectedRequest }),
  ));
}

function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: /\bhref="([^"]*)"/.exec(match[1])?.[1],
    hidden: /\bhidden(?:="[^"]*")?(?:\s|$)/.test(match[1]),
    className: /\bclass="([^"]*)"/.exec(match[1])?.[1] || "",
    content: match[2],
  }));
}

const signedOut = { signedIn: false, activeMember: false, spinnerViewer: false, moderator: false };
const states = [
  { label: "signed out", auth: signedOut, eligible: ["/auth"] },
  { label: "signed in without member access", auth: { ...signedOut, signedIn: true }, eligible: ["/account"] },
  { label: "active member", auth: { ...signedOut, signedIn: true, activeMember: true }, eligible: ["/account", "/gallery-submit"] },
  { label: "verified spinner viewer", auth: { ...signedOut, signedIn: true, activeMember: true, spinnerViewer: true }, eligible: ["/account", "/gallery-submit", "/spinner"] },
  { label: "moderator without viewer access", auth: { ...signedOut, signedIn: true, activeMember: true, moderator: true }, eligible: ["/account", "/gallery-submit", "/leader-dashboard"] },
];

for (const home of [true, false]) {
  for (const { label, auth, eligible } of states) {
    test(`${home ? "Home Resources" : "non-Home Guild"} retains exact auth eligibility for ${label}`, () => {
      const html = renderShell(auth, { home });
      const renderedLinks = links(html);
      // Menus start collapsed. Inspect the link's own authorization state;
      // opening menus, focus, hydration, and session-first launch need browser QA.
      for (const href of ["/auth", "/account", "/gallery-submit", "/spinner", "/leader-dashboard"]) {
        const allowedLinks = renderedLinks.filter((link) => link.href === href && !link.hidden);
        assert.equal(allowedLinks.length > 0, eligible.includes(href), href);
      }
      assert.equal(html.includes('aria-controls="nav-menu-resources"'), home);
      assert.equal(html.includes('aria-controls="nav-menu-guild"'), !home);
      assert.equal(html.includes('aria-label="Official Mōchirīī social profiles in the Resources menu"'), home);
      assert.equal(html.includes('aria-label="Official Mōchirīī social profiles in the Guild menu"'), !home);
      assert.equal(renderedLinks.filter((link) => link.href === "/spinner").length, auth.spinnerViewer ? 3 : 0);

      for (const href of ["/", "/join", "/recruitment", "/events", "/gallery", "/spotlight", "/announcements", "/raffle", "/tome", "/ranks", "/leaders", "/spotify", "/games/mochi-pets", "/privacy", "/meta-data-deletion", "mailto:support@mochirii.com", publicUrls.socialHost, publicUrls.forumsHost]) {
        assert.ok(renderedLinks.some((link) => link.href === href && !link.hidden), `missing public destination ${href}`);
      }
      for (const profile of publicUrls.officialGuildProfiles) {
        assert.equal(renderedLinks.filter((link) => link.href === profile.href).length, 3, profile.id);
      }
      if (home) {
        assert.equal(renderedLinks.filter((link) => link.href === "/#guild-activity").length, 2);
        for (const href of [publicUrls.socialHost, publicUrls.forumsHost]) {
          assert.ok(renderedLinks.filter((link) => link.href === href).every((link) => link.content.includes("(Coming Soon)")));
        }
      }
    });
  }
}

for (const status of ["open", "limited", "paused", "unrecognized"]) {
  test(`Home header and footer recruitment actions agree for ${status}`, () => {
    const recruitment = getHomeRecruitment(status);
    const actions = links(renderShell(signedOut, { status })).filter((link) => /^(?:cta|footer-cta)$/.test(link.className));
    assert.equal(actions.length, 2);
    for (const action of actions) {
      assert.equal(action.href, recruitment.href);
      assert.ok(action.content.includes(recruitment.label));
    }
    if (!recruitment.open) assert.equal(links(renderShell(signedOut, { status })).filter((link) => link.href === publicUrls.discordInviteUrl).length, 0);
  });
}

function renderEvent(referenceTime, schedule = publicGuildSchedule) {
  scheduleState = { referenceTime, items: websiteEventCardsFromSchedule(schedule, new Date(referenceTime)) };
  // Home owns the surrounding link and static slots. Sentinels prove slot
  // forwarding; actual server copy/link still need route/browser coverage.
  return renderToStaticMarkup(React.createElement(HomeNextEvent, {
    referenceTime,
    scheduleData: schedule,
    imageSizes: eventImageSizes,
    children: React.createElement("span", { "data-event-action-fixture": true }, "Test-supplied event action"),
    emptyState: React.createElement("div", { "data-event-empty-fixture": true }, "Test-supplied empty state"),
  }));
}

test("HomeNextEvent renders the genuine upcoming event and versioned public cover", () => {
  const html = renderEvent("2026-10-09T13:29:59.999Z");
  assert.match(html, /id="featuredBulletinType"[^>]*>Next Event</);
  assert.match(html, /id="featuredBulletinTitle"[^>]*>Guild Party</);
  assert.ok(html.includes(`/assets/img/discord-events/guild-party.png?v=${scheduleAuthority.discordCoverVersion}`));
  assert.ok(html.includes(`sizes="${eventImageSizes}"`));
  assert.match(html, /9:30 PM/);
  assert.match(html, /UTC\+8/);
  assert.equal(html.includes("discordEventId"), false);
  assert.equal(html.includes("discordRecurrenceRule"), false);
  assert.ok(html.includes('data-event-action-fixture="true"'));
  assert.equal(html.includes("data-event-empty-fixture"), false);
});

test("HomeNextEvent switches current/upcoming selection at real exclusive event boundaries", () => {
  for (const instant of ["2026-10-09T13:30:00.000Z", "2026-10-09T13:59:59.999Z"]) {
    const html = renderEvent(instant);
    assert.match(html, /id="featuredBulletinType"[^>]*>Current Event</);
    assert.match(html, /id="featuredBulletinTitle"[^>]*>Guild Party</);
  }
  const html = renderEvent("2026-10-09T14:00:00.000Z");
  assert.match(html, /id="featuredBulletinType"[^>]*>Current Event</);
  assert.match(html, /id="featuredBulletinTitle"[^>]*>Skyward Bond</);
  assert.ok(html.includes("/assets/img/discord-events/skyward-bond.png?v="));
  assert.equal(html.includes("/assets/img/discord-events/guild-party.png"), false);
});

test("HomeNextEvent empty schedules forward the supplied fallback without stale dynamic content", () => {
  const html = renderEvent("2026-10-09T14:00:00.000Z", { timezone: publicGuildSchedule.timezone, monthly: {}, weekly: [] });
  assert.equal(html, '<div data-event-empty-fixture="true">Test-supplied empty state</div>');
  assert.equal(html.includes("data-event-action-fixture"), false);
  assert.equal(html.includes('id="featuredBulletinImage"'), false);
  assert.equal(html.includes('id="featuredBulletinTitle"'), false);
  assert.equal(html.includes("Guild Party"), false);
});

function findElement(node, id) {
  if (Array.isArray(node)) return node.map((child) => findElement(child, id)).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  return node.props.id === id ? node : findElement(node.props.children, id);
}

test("disabled celebration stays absent; enabled static frame and copy remain server-owned", async () => {
  const { default: Home } = loadComponentSource(resolve(webRoot, "app/page.tsx"));
  const splash = findComponent(Home(), "OptionalBirthdaySplash");
  assert.equal(await splash.type(splash.props), null);
  assert.equal(await splash.type({ config: { ...homeData.celebrationSplash, enabled: true, title: " " } }), null);
  const enabled = await splash.type({ config: { ...homeData.celebrationSplash, enabled: true } });
  const html = renderToStaticMarkup(enabled.props.children);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /data-dismiss/);
  assert.equal((html.match(/birthday-splash__firework birthday-splash__firework--/g) || []).length, 3);
  assert(html.includes(homeData.celebrationSplash.title));
  assert(html.includes(homeData.celebrationSplash.message));
  assert.equal(Object.hasOwn(enabled.props.config, "title"), false);
});

test("celebration controller preserves date bounds, focus, 5200ms dismissal, Escape and cleanup", () => {
  const { HomeBirthdaySplash } = loadComponentSource(resolve(webRoot, "components/HomeBirthdaySplash.tsx"));
  const oldWindow = globalThis.window, oldNow = Date.now, oldSetTimeout = globalThis.setTimeout, oldClearTimeout = globalThis.clearTimeout;
  const now = Date.parse("2026-10-24T00:00:00.000Z");
  const timers = new Map(), listeners = new Map(); let visible = false, effects = [], focused = 0, sequence = 0;
  birthdayHooks = {
    useState: () => [visible, value => { visible = value; }],
    useRef: () => ({ current: { querySelector: () => ({ focus: () => focused++ }) } }),
    useEffect: callback => { effects.push(callback); },
  };
  globalThis.window = {
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  globalThis.setTimeout = globalThis.window.setTimeout; globalThis.clearTimeout = globalThis.window.clearTimeout;
  Date.now = () => now;
  const render = config => { effects = []; return HomeBirthdaySplash({ config, children: "server frame" }); };
  try {
    for (const config of [undefined, { enabled: false }, { enabled: true, startsAt: "invalid" }, { enabled: true, endsAt: "invalid" },
      { enabled: true, startsAt: "2026-10-24T00:00:00.001Z" }, { enabled: true, endsAt: "2026-10-23T23:59:59.999Z" }]) {
      assert.equal(render(config), null); assert.equal(effects[0](), undefined); assert.equal(timers.size, 0);
    }
    for (const unbounded of [{ enabled: true }, { enabled: true, startsAt: "  ", endsAt: "" }]) {
      render(unbounded); const stop = effects[0](); assert.equal(timers.size, 1); stop(); assert.equal(timers.size, 0);
    }
    const config = { enabled: true, startsAt: "2026-10-24T00:00:00.000Z", endsAt: "2026-10-24T00:00:00.000Z" };
    render(config); const stopShow = effects[0](); const show = [...timers.values()].find(t => t.delay === 0); show.callback(); stopShow();
    assert.equal(visible, true);
    const tree = render(config), stopVisible = effects[1]();
    assert.equal(tree.props.children, "server frame");
    [...timers.values()].find(t => t.delay === 80).callback(); assert.equal(focused, 1);
    [...timers.values()].find(t => t.delay === 5200).callback(); assert.equal(visible, false);
    visible = true; listeners.get("keydown")({ key: "Escape" }); assert.equal(visible, false);
    visible = true; tree.props.onClick({ target: { closest: () => ({}) } }); assert.equal(visible, false);
    stopVisible(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
  } finally { globalThis.window = oldWindow; Date.now = oldNow; globalThis.setTimeout = oldSetTimeout; globalThis.clearTimeout = oldClearTimeout; birthdayHooks = null; }
});

test("actual Home supplies the real empty-state copy inside its Events link", async () => {
  const { default: Home } = loadComponentSource(resolve(webRoot, "app/page.tsx"));
  const tree = await Home();
  const eventLink = findElement(tree, "featuredBulletin");
  assert.ok(eventLink, "actual Home did not provide its event link");
  scheduleState = { referenceTime: "2026-10-09T14:00:00.000Z", items: [] };
  // Render only the actual server-owned subtree; unrelated async leaves and
  // client gallery behavior are outside this local empty-event scenario.
  const html = renderToStaticMarkup(eventLink);
  assert.equal(links(html)[0].href, "/events");
  assert.match(html, /No event is scheduled\./);
  assert.match(html, /Check the UTC\+8 schedule for the next event\./);
  assert.match(html, /View all events/);
  assert.equal(html.includes('id="featuredBulletinImage"'), false);
  assert.equal(html.includes("Guild Party"), false);
});

async function resolveAsyncLeaves(node) {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsyncLeaves));
  if (!React.isValidElement(node)) return node;
  if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") {
    return resolveAsyncLeaves(await node.type(node.props));
  }
  const children = await resolveAsyncLeaves(node.props.children);
  return Array.isArray(children)
    ? React.cloneElement(node, undefined, ...children)
    : React.cloneElement(node, undefined, children);
}

function findComponent(node, name) {
  if (Array.isArray(node)) return node.map(child => findComponent(child, name)).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  return node.type?.name === name ? node : findComponent(node.props.children, name);
}

async function actualSpotlightCard(Home) {
  const child = findComponent(Home(), "CurrentHomeSpotlight");
  assert.ok(child, "Home must put its request in the asynchronous child");
  const card = await child.type(child.props);
  return card.type(card.props);
}

test("a delayed Spotlight request cannot block constructing Home or its usable Suspense fallback", async () => {
  const { default: Home } = loadComponentSource(resolve(webRoot, "app/page.tsx"));
  let release;
  spotlightFixture = () => new Promise(resolveWinner => { release = resolveWinner; });
  const before = spotlightRequests;
  try {
    const tree = Home();
    assert.equal(tree instanceof Promise, false);
    assert.ok(findElement(tree, "heroImage"));
    assert.equal(spotlightRequests, before, "the parent must not initiate the request");
    const child = findComponent(tree, "CurrentHomeSpotlight");
    const pending = child.type(child.props);
    assert.ok(pending instanceof Promise);
    assert.equal(spotlightRequests, before + 1);
    release(null);
    const card = await pending;
    const html = renderToStaticMarkup(await resolveAsyncLeaves(card.type(card.props)));
    assert.match(html, /Member Spotlight/);
    assert.ok(html.includes(homeData.spotlight.fallbackIntro));
  } finally { spotlightFixture = null; }
});

test("actual Home Spotlight shows a provided winner and only its matching reviewed contribution", async () => {
  const { default: Home } = loadComponentSource(resolve(webRoot, "app/page.tsx"));
  const recognition = homeData.spotlight.recognitions[0];
  spotlightFixture = { winnerName: "Fixture Member", monthKey: recognition.monthKey };
  try {
    const card = await actualSpotlightCard(Home);
    const html = renderToStaticMarkup(await resolveAsyncLeaves(card));
    assert.equal(links(html)[0].href, "/spotlight");
    assert.match(html, /id="spotlightTitle"[^>]*>Fixture Member</);
    assert.ok(html.includes(recognition.summary.replaceAll("&", "&amp;")));
    assert.equal(html.includes(homeData.spotlight.fallbackIntro), false);
    assert.equal(html.includes("/members"), false);
  } finally {
    spotlightFixture = null;
  }
});

test("actual Home Spotlight keeps the no-winner card generic without a contribution claim", async () => {
  const { default: Home } = loadComponentSource(resolve(webRoot, "app/page.tsx"));
  const card = await actualSpotlightCard(Home);
  const html = renderToStaticMarkup(await resolveAsyncLeaves(card));
  assert.equal(links(html)[0].href, "/spotlight");
  assert.match(html, /id="spotlightTitle"[^>]*>Member Spotlight</);
  assert.ok(html.includes(homeData.spotlight.fallbackIntro));
  assert.equal(html.includes(homeData.spotlight.recognitions[0].summary), false);
  assert.equal(html.includes("Fixture Member"), false);
});

test("actual Home gallery accepts empty candidate and fallback collections without phantom images", () => {
  const { HomeGallerySpotlight } = loadComponentSource(resolve(webRoot, "components/HomeGallerySpotlight.tsx"));
  const html = renderToStaticMarkup(React.createElement(HomeGallerySpotlight, { candidates: [], fallbackItems: [] }));
  assert.match(html, /id="galleryGrid"/);
  assert.equal(html.includes("<button"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes('role="dialog"'), false);
});

test("actual Leaders page retains the Twills fallback profile destination", () => {
  const { LeadersPage } = loadComponentSource(resolve(webRoot, "components/public-pages/route-pages/LeadersPage.tsx"));
  const html = renderToStaticMarkup(React.createElement(LeadersPage));
  assert.equal(links(html).filter((link) => link.href === "/twills").length, 1);
  assert.equal(links(html).some((link) => link.href?.startsWith("/members")), false);
});
