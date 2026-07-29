import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { enforceProductionGalleryMatrixGuard } from "./lib/live-gallery-media-smoke-guard.mjs";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const argSet = new Set(args);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const writeReport = argSet.has("--write") || process.env.BROWSER_ROUTE_MATRIX_WRITE === "true";
const baseUrl = getArg("--base-url", process.env.BROWSER_ROUTE_MATRIX_BASE_URL || SITE_ORIGIN).replace(/\/$/, "");
enforceProductionGalleryMatrixGuard({ baseUrl, siteOrigin: SITE_ORIGIN });
const browserName = getArg("--browser", process.env.BROWSER_ROUTE_MATRIX_BROWSER || "chromium").toLowerCase();
const navigationBaseUrl = localWebKitNavigationUrl(baseUrl, browserName);
const reportJsonPath = resolve(root, "reports/browser-route-matrix.json");
const reportMdPath = resolve(root, "reports/browser-route-matrix.md");
const checkedAt = new Date().toISOString();
const failures = [];
const warnings = [];

const allRoutes = [
  { route: "/", label: "Home", expectMain: true, expectLiveRegion: true },
  { route: "/join", label: "Join", expectMain: true, expectNoIframe: true, requireOpaquePanels: [".hero-intro", ".page-main .glass-card"] },
  { route: "/events", label: "Events", expectMain: true, expectNoIframe: true, requireOpaquePanels: [".hero-intro", ".page-main .glass-card"] },
  { route: "/raffle", label: "Raffle", expectMain: true, expectNoIframe: true, expectNoForm: true, requireOpaquePanels: [".hero-intro", ".page-main .glass-card"] },
  { route: "/raffle/rules", label: "Raffle Rules Status", expectMain: true, expectNoIframe: true, expectNoForm: true, requireOpaquePanels: [".page-main .glass-card"] },
  { route: "/gallery", label: "Gallery", expectMain: true, expectLiveRegion: true },
  { route: "/tome", label: "Tome", expectMain: true, requireOpaquePanels: [".hero-intro", ".page-main .glass-card"] },
  { route: "/auth", label: "Auth", expectMain: true, expectLiveRegion: true, expectAlert: true },
  { route: "/account", label: "Account", expectMain: true, expectLiveRegion: true, expectAlert: true },
  { route: "/social", label: "Social", expectMain: true, expectLiveRegion: true, expectAlert: true },
  { route: "/leader-dashboard", label: "Leader Dashboard", expectMain: true, expectLiveRegion: true, expectAlert: true },
  { route: "/games/mochi-pets", label: "Mochi Pets", expectMain: true, expectNoForm: true, expectNoIframe: true },
  {
    route: "/__mochirii-unknown-route__",
    label: "Not Found",
    expectedStatus: 404,
    expectedH1: "Page not found",
    expectNoindex: true,
    expectBrandEmblem: true,
    expectMain: true,
    expectNoForm: true,
    expectNoIframe: true,
    requireOpaquePanels: [".not-found-card"],
  },
];
const routeFilter = getArg("--route", "");
const routes = routeFilter ? allRoutes.filter((entry) => entry.route === routeFilter) : allRoutes;
if (!routes.length) throw new Error(`Unknown route filter ${routeFilter}.`);

const viewports = [
  { name: "mobile-360x800", width: 360, height: 800 },
  { name: "mobile-375x812", width: 375, height: 812 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-390x900", width: 390, height: 900 },
  { name: "mobile-414x896", width: 414, height: 896 },
  { name: "mobile-430x932", width: 430, height: 932 },
  { name: "mobile-320x568-text-200", width: 320, height: 568, textScale: 2 },
  { name: "desktop-1280x720", width: 1280, height: 720 },
  { name: "desktop-1366x768", width: 1366, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1440x1100", width: 1440, height: 1100 },
  { name: "desktop-1536x864", width: 1536, height: 864 },
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
];

const playwright = await import("playwright");
const browserType = playwright[browserName];
if (!browserType || !["chromium", "firefox", "webkit"].includes(browserName)) {
  throw new Error(`Unsupported browser ${browserName}; expected chromium, firefox, or webkit.`);
}
const browser = await browserType.launch({ headless: true });
const matrix = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
      colorScheme: "dark",
      ignoreHTTPSErrors: false,
    });
    await bridgeWebKitLocalHttps(context, navigationBaseUrl);
    await stubLocalAnalytics(context);
    for (const route of routes) {
      const result = await inspectRoute(context, route, viewport);
      matrix.push(result);
    }
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
} finally {
  await browser.close();
}

const summary = {
  routeCount: routes.length,
  viewportCount: viewports.length,
  checks: matrix.length,
  statusOk: matrix.filter((entry) => entry.statusOk).length,
  noOverflow: matrix.filter((entry) => !entry.horizontalOverflow).length,
  footerReflowPass: matrix.filter(
    (entry) => !entry.footerReflow.horizontalOverflow && !entry.footerReflow.clippedColumns,
  ).length,
  focusVisible: matrix.filter((entry) => entry.focus.visible).length,
  reducedMotionMatched: matrix.filter((entry) => entry.reducedMotion.matches).length,
  iframeTitlePass: matrix.filter((entry) => entry.iframes.total === entry.iframes.titled).length,
  readabilityPanelsPass: matrix.filter((entry) => !entry.readabilityPanels?.required || entry.readabilityPanels.transparent === 0).length,
  expectedNextPrefetchCancellations: matrix.reduce((total, entry) => total + entry.canceledNextPrefetches.length, 0),
};

const report = {
  ok: failures.length === 0,
  checkedAt,
  scope:
    "No-secret Playwright browser route matrix for Mochirii route readiness. Runs in clean browser contexts with reduced motion enabled and records route, layout, focus, iframe, form, live-region, alert, and console evidence without cookies or headers. Viewports include common current mobile and desktop widths from StatCounter plus the existing tall evidence sizes.",
  baseUrl,
  browser: `playwright ${browserName}`,
  viewports,
  routes: routes.map(({ route, label }) => ({ route, label })),
  summary,
  matrix,
  warnings,
  failures,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = renderMarkdown(report);
scanRenderedArtifact("json", json);
scanRenderedArtifact("markdown", markdown);
report.ok = failures.length === 0;

if (writeReport) {
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMdPath, renderMarkdown(report), "utf8");
}

if (!report.ok) {
  console.error("Browser route matrix failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Browser route matrix OK.");
console.log(`- Base URL: ${baseUrl}`);
console.log(`- Browser: ${browserName}`);
console.log(`- Checks: ${summary.checks}`);
console.log(`- No horizontal overflow: ${summary.noOverflow}/${summary.checks}`);
console.log(`- Footer reflow without clipping: ${summary.footerReflowPass}/${summary.checks}`);
console.log(`- Visible focus reached: ${summary.focusVisible}/${summary.checks}`);
console.log(`- Reduced motion matched: ${summary.reducedMotionMatched}/${summary.checks}`);
console.log(`- Exact-signature Next prefetch cancellations recorded: ${summary.expectedNextPrefetchCancellations}`);
if (warnings.length) console.log(`- Warnings documented: ${warnings.length}`);
if (writeReport) {
  console.log(`- JSON report: ${pathForReport(reportJsonPath)}`);
  console.log(`- Markdown report: ${pathForReport(reportMdPath)}`);
}

async function inspectRoute(context, route, viewport) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const canceledNextPrefetches = [];
  const httpErrors = [];
  const discordPreviewRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(safeText(message.text()));
  });
  page.on("pageerror", (error) => pageErrors.push(safeText(error.message)));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "failed";
    const headers = request.headers();
    const requestUrl = new URL(request.url());
    const expectedNextPrefetchCancellation = failure === "net::ERR_ABORTED"
      && request.method() === "GET"
      && request.resourceType() === "fetch"
      && requestUrl.origin === new URL(navigationBaseUrl).origin
      && requestUrl.searchParams.has("_rsc")
      && headers.rsc === "1"
      && headers["next-router-prefetch"] === "1";
    if (expectedNextPrefetchCancellation) {
      canceledNextPrefetches.push(`${request.method()} ${requestUrl.pathname} Next RSC prefetch canceled`);
    } else {
      failedRequests.push(safeText(`${request.method()} ${request.url()} ${failure}`));
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(safeText(`${response.status()} ${response.url()}`));
  });
  page.on("request", (request) => {
    if (/^https:\/\/discord\.com\/widget\?/i.test(request.url())) discordPreviewRequests.push(request.url());
  });

  const url = `${navigationBaseUrl}${route.route}`;
  let response = null;
  let gotoError = "";
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    await page.waitForSelector("body", { timeout: 10000 });
  } catch (error) {
    gotoError = safeText(error?.message || String(error));
  }

  if (viewport.textScale) {
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`;
    }, viewport.textScale);
    await page.waitForTimeout(50);
  }

  const status = response?.status() || 0;
  const expectedStatus = route.expectedStatus ?? 200;
  const statusOk = status === expectedStatus && !gotoError;
  const browserState = await page.evaluate((readabilitySelectors) => {
    const doc = document.documentElement;
    const body = document.body;
    const all = [...document.querySelectorAll("body *")];
    const animated = all
      .slice(0, 120)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration,
        };
      })
      .filter((entry) => {
        const hasAnimation = entry.animationName && entry.animationName !== "none" && !/^0(?:s|ms)?(?:,\s*0(?:s|ms)?)*$/.test(entry.animationDuration);
        const hasTransition = entry.transitionDuration && !/^(?:0s|0ms|1e-06s)(?:,\s*(?:0s|0ms|1e-06s))*$/.test(entry.transitionDuration);
        return hasAnimation || hasTransition;
      })
      .slice(0, 12);
    function inspectReadabilityPanels(selectors) {
      if (!selectors?.length) return { required: false, total: 0, transparent: 0, samples: [] };
      const joinedSelectors = selectors.join(",");
      const panels = [...document.querySelectorAll(joinedSelectors)];
      const transparentPanels = panels.filter((element) => {
        const style = getComputedStyle(element);
        const transparentColor = style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent";
        return style.backgroundImage === "none" && transparentColor;
      });
      return {
        required: true,
        total: panels.length,
        transparent: transparentPanels.length,
        samples: transparentPanels.slice(0, 4).map((element) => {
          const classes = [...element.classList].slice(0, 4).join(".");
          return [element.tagName.toLowerCase(), element.id || "", classes ? `.${classes}` : ""].filter(Boolean).join("");
        }),
      };
    }
    const iframes = [...document.querySelectorAll("iframe")];
    const inputs = [...document.querySelectorAll("input, textarea, select")];
    const readabilityPanels = inspectReadabilityPanels(readabilitySelectors);
    const footerColumns = document.querySelector(".footer-cols");
    const footerBounds = footerColumns?.getBoundingClientRect();
    const footerColumnBounds = footerColumns
      ? [...footerColumns.children].map((element) => element.getBoundingClientRect())
      : [];
    const textOverflowSamples = [...document.querySelectorAll(".page-main .glass-card, .page-main p, .page-main li")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0
          && bounds.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && !["auto", "scroll"].includes(style.overflowX)
          && Math.ceil(element.scrollWidth) > Math.ceil(element.clientWidth) + 1;
      })
      .slice(0, 6)
      .map((element) => ({
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((name) => `.${name}`).join("")}`,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() || "",
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
      brandEmblem: Boolean(document.querySelector(".not-found-emblem")),
      main: Boolean(document.querySelector("#main")),
      liveRegions: document.querySelectorAll("[aria-live]").length,
      alerts: document.querySelectorAll('[role="alert"]').length,
      forms: document.querySelectorAll("form").length,
      inputCount: inputs.length,
      labeledInputs: inputs.filter((input) => Boolean(input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || Boolean(input.closest("label")) || Boolean(input.getAttribute("aria-label")) || Boolean(input.getAttribute("aria-labelledby"))).length,
      iframes: { total: iframes.length, titled: iframes.filter((iframe) => Boolean(iframe.getAttribute("title")?.trim())).length },
      horizontalOverflow: Math.ceil(doc.scrollWidth) > Math.ceil(doc.clientWidth) + 1 || Math.ceil(body.scrollWidth) > Math.ceil(body.clientWidth) + 1,
      textOverflowSamples,
      documentWidth: doc.scrollWidth,
      viewportWidth: doc.clientWidth,
      footerReflow: {
        present: Boolean(footerColumns),
        horizontalOverflow: Boolean(
          footerColumns && Math.ceil(footerColumns.scrollWidth) > Math.ceil(footerColumns.clientWidth) + 1
        ),
        clippedColumns: Boolean(
          footerBounds && footerColumnBounds.some(
            (bounds) => bounds.left < footerBounds.left - 1 || bounds.right > footerBounds.right + 1,
          )
        ),
      },
      reducedMotion: { matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches, animated },
      readabilityPanels,
    };
  }, route.requireOpaquePanels || []).catch((error) => ({ evaluationError: safeText(error?.message || String(error)) }));

  const focus = await inspectFocus(page);
  const trap = await inspectKeyboardTrap(page);
  const discordPreview = route.route === "/join"
    ? await inspectDiscordPreview(page, discordPreviewRequests)
    : null;

  await page.close();

  const result = {
    route: route.route,
    label: route.label,
    viewport: viewport.name,
    size: `${viewport.width}x${viewport.height}`,
    url,
    status,
    statusOk,
    title: safeText(browserState.title || ""),
    h1: safeText(browserState.h1 || ""),
    robots: safeText(browserState.robots || ""),
    brandEmblem: Boolean(browserState.brandEmblem),
    main: Boolean(browserState.main),
    liveRegions: browserState.liveRegions || 0,
    alerts: browserState.alerts || 0,
    forms: browserState.forms || 0,
    inputs: { total: browserState.inputCount || 0, labeled: browserState.labeledInputs || 0 },
    iframes: browserState.iframes || { total: 0, titled: 0 },
    horizontalOverflow: Boolean(browserState.horizontalOverflow),
    textOverflowSamples: browserState.textOverflowSamples || [],
    widths: { document: browserState.documentWidth || 0, viewport: browserState.viewportWidth || viewport.width },
    footerReflow: browserState.footerReflow || { present: false, horizontalOverflow: true, clippedColumns: true },
    reducedMotion: browserState.reducedMotion || { matches: false, animated: [] },
    readabilityPanels: browserState.readabilityPanels || { required: false, total: 0, transparent: 0, samples: [] },
    focus,
    keyboardTrap: trap,
    discordPreview,
    consoleErrors: consoleErrors.slice(0, 8),
    pageErrors: pageErrors.slice(0, 8),
    failedRequests: failedRequests.slice(0, 8),
    canceledNextPrefetches: canceledNextPrefetches.slice(0, 8),
    httpErrors: httpErrors.slice(0, 8),
    gotoError,
  };

  validateResult(route, result);
  return result;
}

async function inspectDiscordPreview(page, requests) {
  const initialRequestCount = requests.length;
  const button = page.getByRole("button", { name: "Show server preview" });
  const initial = await page.evaluate(() => ({
    iframeCount: document.querySelectorAll("#joinDiscordServerPreview iframe").length,
    expanded: document.querySelector('[aria-controls="joinDiscordServerPreview"]')?.getAttribute("aria-expanded") || "",
  }));

  await button.focus();
  await button.press("Enter");
  await page.waitForSelector("#joinDiscordServerPreview iframe", { state: "visible", timeout: 10_000 });
  for (let attempt = 0; attempt < 20 && requests.length === initialRequestCount; attempt += 1) {
    await page.waitForTimeout(50);
  }

  const shown = await page.evaluate(() => {
    const toggle = document.querySelector('[aria-controls="joinDiscordServerPreview"]');
    const iframe = document.querySelector("#joinDiscordServerPreview iframe");
    const rect = iframe?.getBoundingClientRect();
    return {
      expanded: toggle?.getAttribute("aria-expanded") || "",
      iframeCount: document.querySelectorAll("#joinDiscordServerPreview iframe").length,
      iframeTitle: iframe?.getAttribute("title") || "",
      iframeSource: iframe?.getAttribute("src") || "",
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      toggleFocused: document.activeElement === toggle,
    };
  });

  await page.getByRole("button", { name: "Hide server preview" }).press("Enter");
  await page.waitForSelector("#joinDiscordServerPreview iframe", { state: "detached", timeout: 10_000 });
  const hidden = await page.evaluate(() => {
    const toggle = document.querySelector('[aria-controls="joinDiscordServerPreview"]');
    return {
      expanded: toggle?.getAttribute("aria-expanded") || "",
      iframeCount: document.querySelectorAll("#joinDiscordServerPreview iframe").length,
      toggleFocused: document.activeElement === toggle,
    };
  });

  return {
    initialRequestCount,
    requestCountAfterActivation: requests.length,
    initial,
    shown,
    hidden,
  };
}

async function inspectFocus(page) {
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || element === document.documentElement) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const outlineWidth = Number.parseFloat(style.outlineWidth || "0") || 0;
      const visible = (outlineWidth > 0 && style.outlineStyle !== "none") || (style.boxShadow && style.boxShadow !== "none");
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        role: element.getAttribute("role") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow === "none" ? "none" : "present",
        visible,
        inViewport: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    });
    if (focus?.visible && focus?.inViewport) return focus;
  }
  return { visible: false, inViewport: false, tag: "", id: "", text: "" };
}

async function inspectKeyboardTrap(page) {
  const seen = [];
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press("Tab");
    const key = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return "none";
      return [element.tagName.toLowerCase(), element.id || "", element.getAttribute("aria-label") || "", (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)].join("#");
    });
    seen.push(key);
  }
  await page.keyboard.press("Escape").catch(() => null);
  const unique = new Set(seen.filter((entry) => entry && entry !== "body###"));
  return { checkedTabs: seen.length, uniqueFocusStops: unique.size, likelyTrap: unique.size <= 1 };
}

function validateResult(route, result) {
  const label = `${route.route} ${result.viewport}`;
  const expectedDocumentNotFound = route.expectedStatus === 404 && result.status === 404;
  const opaqueSpinnerCleanup = route.route === "/leader-dashboard"
    && result.failedRequests.length > 0
    && result.httpErrors.every((error) => /^404 https?:\/\/[^/]+\/spinner\/session$/.test(error))
    && result.failedRequests.every((error) => /^DELETE https?:\/\/[^/]+\/spinner\/session net::ERR_ABORTED$/.test(error));
  const consoleErrors = opaqueSpinnerCleanup || expectedDocumentNotFound
    ? result.consoleErrors.filter((error) => !/^Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)$/.test(error))
    : result.consoleErrors;
  const failedRequests = opaqueSpinnerCleanup ? [] : result.failedRequests;
  const httpErrors = opaqueSpinnerCleanup
    ? []
    : expectedDocumentNotFound
      ? result.httpErrors.filter((error) => error !== `404 ${result.url}`)
      : result.httpErrors;
  if (!result.statusOk) failures.push(`${label}: expected HTTP ${route.expectedStatus ?? 200}, got status ${result.status}${result.gotoError ? ` (${result.gotoError})` : ""}.`);
  if (route.expectedH1 && result.h1 !== route.expectedH1) failures.push(`${label}: expected h1 ${JSON.stringify(route.expectedH1)}, got ${JSON.stringify(result.h1)}.`);
  if (route.expectNoindex && !/(?:^|,)\s*noindex\s*(?:,|$)/i.test(result.robots)) failures.push(`${label}: expected an automatic noindex robots directive.`);
  if (route.expectBrandEmblem && !result.brandEmblem) failures.push(`${label}: branded page emblem is missing.`);
  if (route.expectMain && !result.main) failures.push(`${label}: missing #main skip-link target.`);
  if (result.horizontalOverflow) failures.push(`${label}: horizontal overflow (${result.widths.document}px document vs ${result.widths.viewport}px viewport).`);
  if (result.textOverflowSamples.length) failures.push(`${label}: internal text overflow ${JSON.stringify(result.textOverflowSamples)}.`);
  if (!result.footerReflow.present) failures.push(`${label}: footer navigation is missing.`);
  if (result.footerReflow.horizontalOverflow || result.footerReflow.clippedColumns) {
    failures.push(`${label}: footer navigation requires horizontal scrolling or clips a column.`);
  }
  if (!result.focus.visible) failures.push(`${label}: keyboard tabbing did not reach a visible focus state.`);
  if (result.keyboardTrap.likelyTrap) failures.push(`${label}: keyboard tabbing appears trapped on one focus stop.`);
  if (result.iframes.total !== result.iframes.titled) failures.push(`${label}: iframe title coverage ${result.iframes.titled}/${result.iframes.total}.`);
  if (route.expectNoIframe && result.iframes.total !== 0) failures.push(`${label}: route must not contain an iframe.`);
  if (route.route === "/join") {
    const preview = result.discordPreview;
    if (!preview || preview.initialRequestCount !== 0 || preview.initial.iframeCount !== 0 || preview.initial.expanded !== "false") {
      failures.push(`${label}: Discord preview must be collapsed and make no provider request before activation.`);
    }
    if (!preview || preview.requestCountAfterActivation <= preview.initialRequestCount) {
      failures.push(`${label}: Discord preview activation did not request the iframe source.`);
    }
    if (!preview || preview.shown.expanded !== "true" || preview.shown.iframeCount !== 1 || !preview.shown.iframeTitle || !preview.shown.iframeSource || !preview.shown.visible) {
      failures.push(`${label}: activated Discord preview is missing its visible, titled iframe or expanded state.`);
    }
    if (preview?.shown.horizontalOverflow) failures.push(`${label}: activated Discord preview causes horizontal overflow.`);
    if (!preview?.shown.toggleFocused) failures.push(`${label}: preview toggle lost keyboard focus after opening.`);
    if (!preview || preview.hidden.expanded !== "false" || preview.hidden.iframeCount !== 0 || !preview.hidden.toggleFocused) {
      failures.push(`${label}: hidden Discord preview did not remove the iframe, collapse state, and retain toggle focus.`);
    }
  }
  if (route.expectForm && result.forms === 0) failures.push(`${label}: expected a form.`);
  if (route.expectNoForm && result.forms !== 0) failures.push(`${label}: route must not contain a form.`);
  if (route.requireOpaquePanels?.length) {
    if (result.readabilityPanels.total === 0) failures.push(`${label}: no critical readability panels matched ${route.requireOpaquePanels.join(", ")}.`);
    if (result.readabilityPanels.transparent > 0) {
      failures.push(`${label}: ${result.readabilityPanels.transparent}/${result.readabilityPanels.total} critical readability panels computed as transparent (${result.readabilityPanels.samples.join("; ") || "no samples"}).`);
    }
  }
  if (result.inputs.total > 0 && result.inputs.labeled < result.inputs.total) failures.push(`${label}: form input label coverage ${result.inputs.labeled}/${result.inputs.total}.`);
  if (route.expectLiveRegion && result.liveRegions === 0) failures.push(`${label}: expected at least one live region.`);
  if (route.expectAlert && result.alerts === 0) warnings.push(`${label}: no alert region observed in signed-out/default browser state; confirm error state remains covered statically.`);
  if (!result.reducedMotion.matches) failures.push(`${label}: reduced-motion media query did not match in Playwright context.`);
  if (result.reducedMotion.animated.length) warnings.push(`${label}: reduced-motion context still reported ${result.reducedMotion.animated.length} animated or transitioning sampled elements.`);
  if (opaqueSpinnerCleanup) warnings.push(`${label}: signed-out spinner-session cleanup returned the intentional opaque 404 response.`);
  for (const error of result.pageErrors) failures.push(`${label}: page error: ${error}`);
  for (const error of consoleErrors) failures.push(`${label}: console error: ${error}`);
  for (const error of failedRequests) failures.push(`${label}: failed request: ${error}`);
  for (const error of httpErrors) failures.push(`${label}: HTTP error: ${error}`);
}

async function stubLocalAnalytics(context) {
  await context.route("**/_vercel/insights/script.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript; charset=utf-8",
    body: "",
  }));
  await context.route("**/_vercel/speed-insights/script.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript; charset=utf-8",
    body: "",
  }));
  await context.route("https://discord.com/widget?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html lang=\"en\"><title>Server preview fixture</title><body></body></html>",
  }));
  await context.route("**/functions/v1/list-approved-gallery-submissions", (route) => route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: true, data: { submissions: [], count: 0 } }),
  }));
  await context.route("**/functions/v1/list-visible-profile-cards", (route) => route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: true, data: { profiles: [], count: 0 } }),
  }));
}

function localWebKitNavigationUrl(urlValue, engineName) {
  const url = new URL(urlValue);
  if (engineName !== "webkit" || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return urlValue;
  }

  url.protocol = "https:";
  return url.href.replace(/\/$/, "");
}

async function bridgeWebKitLocalHttps(context, secureBaseUrl) {
  if (secureBaseUrl === baseUrl) return;

  const secureOrigin = new URL(secureBaseUrl).origin;
  await context.route(`${secureOrigin}/**`, async (route) => {
    const localUrl = new URL(route.request().url());
    localUrl.protocol = "http:";
    const response = await route.fetch({ url: localUrl.href });
    await route.fulfill({ response });
  });
}

function renderMarkdown(report) {
  const rows = report.matrix
    .map((entry) => {
      const panels = entry.readabilityPanels?.required ? `${entry.readabilityPanels.total - entry.readabilityPanels.transparent}/${entry.readabilityPanels.total}` : "n/a";
      const footerReflow = !entry.footerReflow.horizontalOverflow && !entry.footerReflow.clippedColumns;
      return `| ${entry.route} | ${entry.viewport} | ${entry.status} | ${entry.main ? "yes" : "no"} | ${entry.horizontalOverflow ? "yes" : "no"} | ${footerReflow ? "yes" : "no"} | ${entry.focus.visible ? "yes" : "no"} | ${entry.iframes.titled}/${entry.iframes.total} | ${panels} | ${entry.reducedMotion.matches ? "yes" : "no"} | ${entry.keyboardTrap.likelyTrap ? "yes" : "no"} |`;
    })
    .join("\n");
  const warningsText = report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- None";
  const failuresText = report.failures.length ? report.failures.map((failure) => `- ${failure}`).join("\n") : "- None";
  return `# Browser Route Matrix\n\nGenerated: ${report.checkedAt}\n\nThis file is intentionally no-secret. It records clean-context Playwright browser evidence for key Mochirii routes without cookies, request headers, raw response headers, screenshots, or private form values.\n\n## Result\n\n- OK: ${report.ok ? "yes" : "no"}\n- Base URL: ${report.baseUrl}\n- Browser: ${report.browser}\n- Checks: ${report.summary.checks}\n- Exact-signature Next prefetch cancellations: ${report.summary.expectedNextPrefetchCancellations}\n- Viewports: ${report.viewports.map((viewport) => `${viewport.name} ${viewport.width}x${viewport.height}`).join(", ")}\n\n## Matrix\n\n| Route | Viewport | Status | Main | Overflow | Footer reflow | Visible focus | Iframes titled | Opaque panels | Reduced motion | Trap |\n| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- | --- |\n${rows}\n\n## Warnings\n\n${warningsText}\n\n## Failures\n\n${failuresText}\n`;
}

function scanRenderedArtifact(label, text) {
  const patterns = [
    { label: "GitHub token", pattern: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/ },
    { label: "Supabase PAT", pattern: /\bsbp_[A-Za-z0-9_-]{20,}\b/ },
    { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/ },
    { label: "JWT-like token", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
    { label: "Discord webhook URL", pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/ },
    { label: "raw cookie header", pattern: /\bCookie:\s*[^;\s]+=/i },
  ];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const { label: patternLabel, pattern } of patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) failures.push(`rendered ${label} report line ${index + 1}: ${patternLabel}`);
      }
    });
}

function safeText(value) {
  return String(value || "")
    .replace(/\beyJ[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,}){1,2}\b/g, "[redacted-token]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, "$1?[redacted-query]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function pathForReport(file) {
  return relative(root, resolve(root, file)).replace(/\\/g, "/");
}
