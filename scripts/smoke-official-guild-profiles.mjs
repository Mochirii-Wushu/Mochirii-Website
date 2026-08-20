const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log([
    "Usage: node scripts/smoke-official-guild-profiles.mjs [--base-url URL]",
    "",
    "  --base-url URL    Local production server origin (default: http://127.0.0.1:8765).",
    "",
    "OFFICIAL_GUILD_PROFILES_BASE_URL or SMOKE_BASE_URL may be used instead.",
  ].join("\n"));
  process.exit(0);
}

const baseUrl = resolveBaseUrl();
const routePath = "/privacy";
const failures = [];
let scenarios = 0;

const vercelAnalyticsPaths = new Set([
  "/_vercel/insights/script.js",
  "/_vercel/speed-insights/script.js",
]);

const headerProfiles = [
  {
    id: "facebook-page",
    name: "Facebook Mōchirīī Guild Page external profile",
    href: "https://www.facebook.com/mochiriiguildpage",
  },
  {
    id: "instagram",
    name: "Instagram @mochirii_guild external profile",
    href: "https://www.instagram.com/mochirii_guild",
  },
  {
    id: "tiktok",
    name: "TikTok @mochiriiguild external profile",
    href: "https://www.tiktok.com/@mochiriiguild",
  },
];

const footerProfiles = [
  ...headerProfiles,
  {
    id: "facebook-group",
    name: "Facebook Group Mōchirīī Guild external profile",
    href: "https://www.facebook.com/groups/mochiriiguild",
  },
  {
    id: "twitch",
    name: "Twitch @mochiriiguild external profile",
    href: "https://www.twitch.tv/mochiriiguild",
  },
];

const providerOrigins = new Set(footerProfiles.map((profile) => new URL(profile.href).origin));

const chromiumViewports = [
  { label: "compact-short", width: 320, height: 256 },
  { label: "compact-phone", width: 320, height: 568 },
  { label: "compact-phone-text-200", width: 320, height: 568, textScale: 2 },
  { label: "android-phone", width: 360, height: 800 },
  { label: "iphone-portrait", width: 390, height: 844 },
  { label: "large-phone", width: 430, height: 932 },
  { label: "phone-landscape", width: 640, height: 360 },
  { label: "tablet-portrait", width: 768, height: 1024 },
  { label: "tablet-landscape", width: 1024, height: 768 },
  { label: "small-desktop", width: 1280, height: 720 },
  { label: "common-desktop", width: 1366, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
  { label: "full-hd", width: 1920, height: 1080 },
  { label: "wide-desktop", width: 2560, height: 1440 },
];

const representativeViewports = [
  { label: "compact-phone", width: 320, height: 568 },
  { label: "compact-phone-text-200", width: 320, height: 568, textScale: 2 },
  { label: "phone-landscape", width: 640, height: 360 },
  { label: "tablet-portrait", width: 768, height: 1024 },
  { label: "tablet-landscape", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
  { label: "wide-desktop", width: 2560, height: 1440 },
];

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error("Playwright is required for the official guild-profile smoke test.");
  console.error("Install the locked dependencies and run the repository's reviewed browser setup.");
  process.exit(1);
}

await runEngine(playwright.chromium, "Chromium", chromiumViewports);
await runEngine(playwright.firefox, "Firefox", representativeViewports);
await runEngine(playwright.webkit, "WebKit", representativeViewports);

if (failures.length > 0) {
  console.error(`Official guild-profile smoke failed with ${failures.length} finding${failures.length === 1 ? "" : "s"}.`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Official guild-profile smoke passed.");
console.log(`- Base URL: ${baseUrl}`);
console.log(`- Browser/viewport scenarios: ${scenarios}`);
console.log(`- Chromium viewports: ${chromiumViewports.length}`);
console.log(`- Firefox/WebKit representative viewports: ${representativeViewports.length} each`);
console.log("- External profile navigations: 0");

async function runEngine(browserType, browserName, viewports) {
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
  } catch (error) {
    failures.push(`${browserName}: browser launch failed: ${safeMessage(error)}`);
    return;
  }

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: "dark",
        reducedMotion: "reduce",
        ignoreHTTPSErrors: false,
      });
      const navigationUrl = navigationBaseUrl(browserName);

      try {
        await bridgeWebKitLocalHttps(context, navigationUrl);
        await stubLocalVercelAnalytics(context, navigationUrl);
        await inspectPage(context, browserName, viewport, navigationUrl);
        console.log(`[official-profiles] ${browserName} ${viewport.label} ${viewport.width}x${viewport.height} passed.`);
      } catch (error) {
        const failure = `${browserName} ${viewport.label} ${viewport.width}x${viewport.height}: ${safeMessage(error)}`;
        failures.push(failure);
        console.error(`[official-profiles] ${failure}`);
      } finally {
        await context.unrouteAll({ behavior: "wait" });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function inspectPage(context, browserName, viewport, navigationUrl) {
  scenarios += 1;
  const page = await context.newPage();
  const diagnostics = installDiagnostics(page, navigationUrl);

  const response = await page.goto(`${navigationUrl}${routePath}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  assert(response && response.status() === 200, `navigation returned HTTP ${response?.status() || "unknown"}`);
  await page.waitForSelector("#site-header");
  await page.waitForSelector(".site-footer");
  await page.waitForLoadState("load");
  if (viewport.textScale === 2) {
    await page.addStyleTag({ content: "html{font-size:200%!important}" });
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => null);
  await page.waitForTimeout(150);

  assert(diagnostics.providerRequests.length === 0, providerRequestMessage(diagnostics.providerRequests));
  await assertDocumentReflow(page, "initial page");

  if (viewport.width > 980) {
    await verifyDesktopHeader(page);
  } else {
    await verifyMobileMenu(page);
  }

  assert(diagnostics.providerRequests.length === 0, providerRequestMessage(diagnostics.providerRequests));
  await verifyFooter(page);
  await assertDocumentReflow(page, "page after header and footer interactions");
  await page.waitForTimeout(100);
  assertDiagnosticsClean(diagnostics, browserName, viewport);
}

async function verifyDesktopHeader(page) {
  const trigger = page.getByRole("button", { name: /^Guild\b/ });
  assert(await trigger.count() === 1, "desktop Guild trigger is missing or duplicated");
  assert(await trigger.isVisible(), "desktop Guild trigger is not visible");

  await trigger.focus();
  await trigger.press("Enter");
  await waitForAttribute(trigger, "aria-expanded", "true");

  const menu = page.locator("#nav-menu-guild");
  assert(await menu.isVisible(), "desktop Guild menu did not open from the keyboard");
  const profiles = menu.locator('[data-official-profiles="header"]');
  await verifyProfileSection(profiles, headerProfiles, "desktop Guild menu");
  await assertElementInsideViewport(page, menu, "desktop Guild menu");
  await assertDocumentReflow(page, "open desktop Guild menu");

  const firstProfile = profiles.locator('[data-official-profile="facebook-page"]');
  await firstProfile.focus();
  assert(await firstProfile.evaluate((element) => element === document.activeElement), "desktop profile link could not receive focus");
  await trigger.focus();
  await page.keyboard.press("Escape");
  await waitForAttribute(trigger, "aria-expanded", "false");
  assert(await menu.isHidden(), "desktop Guild menu did not close with Escape");
  assert(await trigger.evaluate((element) => element === document.activeElement), "desktop Guild trigger did not retain focus after Escape");
}

async function verifyMobileMenu(page) {
  const menuButton = page.locator("#menu-btn");
  assert(await page.getByRole("button", { name: "Open menu", exact: true }).count() === 1, "mobile menu trigger is missing or duplicated");
  assert(await menuButton.isVisible(), "mobile menu trigger is not visible");

  await menuButton.focus();
  await menuButton.press("Enter");
  await waitForAttribute(menuButton, "aria-expanded", "true");

  const dialog = page.getByRole("dialog", { name: "Menu", exact: true });
  await dialog.waitFor({ state: "visible" });
  const closeButton = dialog.getByRole("button", { name: "Close menu", exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Close menu");

  const profiles = dialog.locator('[data-official-profiles="mobile"]');
  await profiles.scrollIntoViewIfNeeded();
  await verifyProfileSection(profiles, headerProfiles, "mobile Official profiles group");
  await assertElementInsideViewport(page, page.locator(".mobile-sheet"), "mobile menu sheet");
  await assertDocumentReflow(page, "open mobile menu");

  const focusable = dialog.locator("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])").filter({ visible: true });
  const focusableCount = await focusable.count();
  assert(focusableCount > 1, "mobile menu does not expose enough controls to verify focus containment");
  const firstFocusable = focusable.first();
  const lastFocusable = focusable.nth(focusableCount - 1);
  await lastFocusable.focus();
  await page.keyboard.press("Tab");
  assert(await firstFocusable.evaluate((element) => element === document.activeElement), "mobile menu did not wrap Tab focus to its first control");
  await firstFocusable.focus();
  await page.keyboard.press("Shift+Tab");
  assert(await lastFocusable.evaluate((element) => element === document.activeElement), "mobile menu did not wrap Shift+Tab focus to its last control");

  const firstProfile = profiles.locator('[data-official-profile="facebook-page"]');
  await firstProfile.focus();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await waitForAttribute(menuButton, "aria-expanded", "false");
  await page.waitForFunction(() => document.activeElement?.id === "menu-btn");
  assert(await menuButton.evaluate((element) => element === document.activeElement), "mobile menu did not return focus to its trigger after Escape");
}

async function verifyFooter(page) {
  const footer = page.locator(".site-footer");
  await footer.scrollIntoViewIfNeeded();
  const profiles = footer.locator('[data-official-profiles="footer"]');
  await verifyProfileSection(profiles, footerProfiles, "footer Official profiles");
  await assertElementInsideViewport(page, profiles, "footer Official profiles");
}

async function verifyProfileSection(section, expectedProfiles, label) {
  assert(await section.count() === 1, `${label} section is missing or duplicated`);
  const expectedSectionLabel = label.startsWith("desktop")
    ? "Official Mōchirīī profiles in the Guild menu"
    : label.startsWith("mobile")
      ? "Official Mōchirīī profiles in the mobile menu"
      : "Official Mōchirīī profiles in the footer";
  assert(await section.getAttribute("role") === "group", `${label} must be a non-landmark group`);
  assert(await section.getAttribute("aria-label") === expectedSectionLabel, `${label} has an incorrect accessible label`);

  const links = section.locator("a[data-official-profile]");
  assert(await links.count() === expectedProfiles.length, `${label} has ${await links.count()} profile links instead of ${expectedProfiles.length}`);

  for (const profile of expectedProfiles) {
    const link = section.getByRole("link", { name: profile.name, exact: true });
    assert(await link.count() === 1, `${label} is missing the exact accessible link: ${profile.name}`);
    assert(await link.getAttribute("data-official-profile") === profile.id, `${label} ${profile.name} has the wrong stable ID`);
    assert(await link.getAttribute("href") === profile.href, `${label} ${profile.name} has the wrong destination`);
    assert(await link.getAttribute("referrerpolicy") === "no-referrer", `${label} ${profile.name} must suppress the originating page URL`);
    assert(await link.getAttribute("target") === null, `${label} ${profile.name} unexpectedly opens a new browsing context`);

    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `${label} ${profile.name} is smaller than 44 by 44 CSS pixels`);
    await assertElementInsideViewport(link.page(), link, `${label} ${profile.name}`);

    const textClips = await link.evaluate((element) => [...element.querySelectorAll(".official-profile-platform,.official-profile-account")].some((child) => {
      const style = getComputedStyle(child);
      return (["hidden", "clip"].includes(style.overflowX) && child.scrollWidth > child.clientWidth + 1)
        || (["hidden", "clip"].includes(style.overflowY) && child.scrollHeight > child.clientHeight + 1);
    }));
    assert(!textClips, `${label} ${profile.name} clips its visible label or account name`);

    const markState = await link.getAttribute("data-has-mark");
    assert(markState === "true" || markState === "false", `${label} ${profile.name} is missing its mark state`);
    const marks = link.locator(".official-profile-mark img");
    assert(await marks.count() === (markState === "true" ? 1 : 0), `${label} ${profile.name} mark state does not match its rendered imagery`);
    if (markState === "true") {
      const mark = marks.first();
      const src = await mark.getAttribute("src");
      assert(src?.includes("/assets/social-profiles/"), `${label} ${profile.name} does not use a local reviewed mark`);
      assert(await mark.getAttribute("alt") === "", `${label} ${profile.name} repeats the link name through its decorative mark`);
      assert(await mark.evaluate((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), `${label} ${profile.name} mark did not load`);
    }
  }
}

async function assertDocumentReflow(page, label) {
  const state = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert(state.scrollWidth <= state.clientWidth + 1, `${label} has horizontal document overflow (${state.scrollWidth}px > ${state.clientWidth}px)`);
  assert(state.bodyScrollWidth <= state.clientWidth + 1, `${label} has horizontal body overflow (${state.bodyScrollWidth}px > ${state.clientWidth}px)`);
}

async function assertElementInsideViewport(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const state = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  assert(state.width > 0, `${label} collapsed to zero width`);
  assert(state.left >= -1 && state.right <= state.viewportWidth + 1, `${label} escapes the horizontal viewport`);
}

function installDiagnostics(page, navigationUrl) {
  const appOrigin = new URL(navigationUrl).origin;
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
    providerRequests: [],
    expectedPrefetchCancellations: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(safeMessage(message.text()));
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(safeMessage(error)));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "failed";
    if (isExpectedNextPrefetchCancellation(request, navigationUrl, failure)) {
      diagnostics.expectedPrefetchCancellations.push(`${request.method()} ${safeUrl(request.url())} ${safeMessage(failure)}`);
      return;
    }
    diagnostics.failedRequests.push(`${request.method()} ${safeUrl(request.url())} ${safeMessage(failure)}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.httpErrors.push(`${response.status()} ${safeUrl(response.url())}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (providerOrigins.has(url.origin)) diagnostics.providerRequests.push(`${request.method()} ${safeUrl(request.url())}`);
    if (url.origin === appOrigin && vercelAnalyticsPaths.has(url.pathname)) return;
  });
  return diagnostics;
}

function assertDiagnosticsClean(diagnostics, browserName, viewport) {
  assert(
    diagnostics.expectedPrefetchCancellations.length <= 32,
    `${browserName} ${viewport.width}x${viewport.height} canceled an unexpected number of same-origin Next prefetches`,
  );
  const findings = [
    ...diagnostics.consoleErrors.map((message) => `console error: ${message}`),
    ...diagnostics.pageErrors.map((message) => `page error: ${message}`),
    ...diagnostics.failedRequests.map((message) => `failed request: ${message}`),
    ...diagnostics.httpErrors.map((message) => `HTTP error: ${message}`),
    ...diagnostics.providerRequests.map((message) => `profile provider request before activation: ${message}`),
  ];
  assert(findings.length === 0, `${browserName} ${viewport.width}x${viewport.height} browser diagnostics:\n${findings.join("\n")}`);
}

function isExpectedNextPrefetchCancellation(request, navigationUrl, failure) {
  const url = new URL(request.url());
  const sameOrigin = url.origin === new URL(navigationUrl).origin;
  const exactNextPrefetch = request.method() === "GET"
    && request.resourceType() === "fetch"
    && url.searchParams.has("_rsc")
    && url.pathname.startsWith("/");
  const expectedEngineCancellation = ["net::ERR_ABORTED", "NS_BINDING_ABORTED", "cancelled", "Load request cancelled"].includes(failure);
  return sameOrigin && exactNextPrefetch && expectedEngineCancellation;
}

async function stubLocalVercelAnalytics(context, navigationUrl) {
  const appOrigin = new URL(navigationUrl).origin;
  await context.route(
    (url) => url.origin === appOrigin && vercelAnalyticsPaths.has(url.pathname),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: "",
    }),
  );
}

async function bridgeWebKitLocalHttps(context, navigationUrl) {
  const original = new URL(baseUrl);
  const target = new URL(navigationUrl);
  if (original.origin === target.origin) return;

  await context.route(`${target.origin}/**`, async (route) => {
    const localUrl = new URL(route.request().url());
    localUrl.protocol = original.protocol;
    localUrl.hostname = original.hostname;
    localUrl.port = original.port;
    const response = await route.fetch({ url: localUrl.href });
    await route.fulfill({ response });
  });
}

function navigationBaseUrl(browserName) {
  if (browserName !== "WebKit") return baseUrl;
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return baseUrl;
  url.protocol = "https:";
  return url.href.replace(/\/$/, "");
}

async function waitForAttribute(locator, name, expected) {
  await locator.page().waitForFunction(
    ({ selector, attributeName, expectedValue }) => document.querySelector(selector)?.getAttribute(attributeName) === expectedValue,
    {
      selector: await stableSelector(locator),
      attributeName: name,
      expectedValue: expected,
    },
  );
}

async function stableSelector(locator) {
  const id = await locator.getAttribute("id");
  if (id) return `#${cssEscape(id)}`;
  const controls = await locator.getAttribute("aria-controls");
  if (controls) return `[aria-controls="${cssEscape(controls)}"]`;
  throw new Error("interactive smoke target lacks a stable id or aria-controls value");
}

function cssEscape(value) {
  return value.replace(/([\\"#.:[\]()=+~*^$|> ])/g, "\\$1");
}

function providerRequestMessage(requests) {
  return requests.length
    ? `profile provider requests occurred without a user activating a link: ${requests.join(" | ")}`
    : "";
}

function resolveBaseUrl() {
  const index = args.indexOf("--base-url");
  const candidate = index >= 0
    ? args[index + 1]
    : process.env.OFFICIAL_GUILD_PROFILES_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:8765";
  if (!candidate) throw new Error("--base-url requires an HTTP(S) URL");
  const url = new URL(candidate);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Smoke base URL must use HTTP or HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("Smoke base URL must be a bare origin without credentials, query, or fragment");
  return url.origin;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function safeMessage(value) {
  return String(value instanceof Error ? value.message : value || "unknown error")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
