const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log([
    "Usage: node scripts/smoke-raffle-public.mjs [--local] [--base-url URL]",
    "",
    "  --local           Test http://127.0.0.1:8765 (the default).",
    "  --base-url URL    Test another HTTP(S) origin, such as a reviewed preview.",
    "",
    "RAFFLE_PUBLIC_BASE_URL may be used instead of --base-url.",
  ].join("\n"));
  process.exit(0);
}

const baseUrl = resolveBaseUrl(args);
const failures = [];
const results = [];
let webkitExplicitFocusChecks = 0;

const routes = [
  {
    path: "/raffle",
    title: /raffle/i,
    h1: /monthly raffle/i,
    requiredText: [
      "No raffle is active",
      "Standard entries",
      "Bonus entries",
      "No purchase necessary",
      "Possible rewards",
      "Standing rules",
    ],
    grids: [
      { selector: ".raffle-status-grid", spans: [8, 4] },
      { selector: ".raffle-program-grid", spans: [7, 5] },
      { selector: ".raffle-reward-grid", spans: [7, 5] },
    ],
  },
  {
    path: "/raffle/rules",
    title: /raffle.*rules|rules.*raffle/i,
    h1: /^raffle rules$/i,
    requiredText: [
      "No active drawing rules",
      "Standing program principles",
      "Standing bonus methods",
      "Rules archive",
      "No purchase necessary",
    ],
    grids: [
      { selector: ".raffle-program-grid", spans: [7, 5] },
      { selector: ".raffle-rules-state-grid", spans: [7, 5] },
    ],
  },
];

const chromiumViewports = [
  { name: "compact-320x256", width: 320, height: 256 },
  { name: "phone-320x568", width: 320, height: 568 },
  { name: "phone-360x800", width: 360, height: 800 },
  { name: "phone-375x812", width: 375, height: 812 },
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "phone-393x852", width: 393, height: 852 },
  { name: "phone-412x915", width: 412, height: 915 },
  { name: "phone-430x932", width: 430, height: 932 },
  { name: "landscape-640x360", width: 640, height: 360 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "breakpoint-980x900", width: 980, height: 900 },
  { name: "breakpoint-981x900", width: 981, height: 900 },
  { name: "desktop-1024x768", width: 1024, height: 768 },
  { name: "desktop-1280x720", width: 1280, height: 720 },
  { name: "desktop-1366x768", width: 1366, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "wide-2560x1440", width: 2560, height: 1440 },
];

const representativeViewports = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "landscape-640x360", width: 640, height: 360 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

const textZoomViewports = [
  { name: "phone-320x568", width: 320, height: 568 },
  { name: "landscape-640x360", width: 640, height: 360 },
  { name: "desktop-1024x768", width: 1024, height: 768 },
];

const noJavaScriptViewports = [
  { name: "phone-320x568", width: 320, height: 568 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

let playwright;
try {
  playwright = await import("playwright");
} catch (error) {
  console.error("Playwright is required for the raffle public smoke test.");
  console.error("Run the repository's reviewed Playwright setup before retrying.");
  process.exit(1);
}

await runBrowserMatrix(playwright.chromium, "chromium", chromiumViewports);
await runBrowserMatrix(playwright.firefox, "firefox", representativeViewports);
await runBrowserMatrix(playwright.webkit, "webkit", representativeViewports);
await runBrowserMatrix(playwright.chromium, "chromium", textZoomViewports, { textScale: 2 });
await runBrowserMatrix(playwright.chromium, "chromium", noJavaScriptViewports, { javaScriptEnabled: false });

if (failures.length > 0) {
  console.error(`Raffle public smoke failed with ${failures.length} finding${failures.length === 1 ? "" : "s"}.`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Raffle public smoke OK.");
console.log(`- Base URL: ${baseUrl}`);
console.log(`- Route checks: ${results.length}`);
console.log(`- Chromium viewports: ${chromiumViewports.length}`);
console.log(`- Firefox/WebKit representative viewports: ${representativeViewports.length} each`);
console.log(`- 200% text cases: ${textZoomViewports.length}`);
console.log(`- JavaScript-disabled cases: ${noJavaScriptViewports.length}`);
console.log(`- WebKit explicit keyboard-activation checks: ${webkitExplicitFocusChecks}`);

async function runBrowserMatrix(browserType, browserName, viewports, options = {}) {
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
        javaScriptEnabled: options.javaScriptEnabled !== false,
        ignoreHTTPSErrors: false,
      });

      if (isLocalBaseUrl(baseUrl)) await prepareLocalHttpFixture(context);

      try {
        for (const route of routes) {
          await inspectRoute(context, browserName, viewport, route, options);
        }
      } finally {
        await context.unrouteAll({ behavior: "wait" });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function inspectRoute(context, browserName, viewport, route, options) {
  const page = await context.newPage();
  const label = scenarioLabel(browserName, viewport, route.path, options);
  const errors = {
    console: [],
    page: [],
    request: [],
    http: [],
    privateRaffleRequests: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(safeMessage(message.text()));
  });
  page.on("pageerror", (error) => errors.page.push(safeMessage(error)));
  page.on("requestfailed", (request) => {
    if (
      options.javaScriptEnabled === false
      && request.resourceType() === "script"
      && request.failure()?.errorText === "csp"
    ) {
      return;
    }
    errors.request.push(safeMessage(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.http.push(safeMessage(`${response.status()} ${response.url()}`));
  });
  page.on("request", (request) => {
    if (isPrivateRaffleRequest(request.url())) {
      errors.privateRaffleRequests.push(safeMessage(`${request.method()} ${request.url()}`));
    }
  });

  try {
    const response = await page.goto(`${baseUrl}${route.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const status = response?.status() || 0;
    if (status < 200 || status >= 400) {
      failures.push(`${label}: navigation returned HTTP ${status || "unknown"}.`);
      return;
    }

    await page.waitForSelector("#main", { timeout: 15_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => null);
    if (options.textScale === 2) {
      await page.addStyleTag({ content: "html{font-size:200% !important;}" });
    }
    await page.waitForTimeout(150);

    const state = await page.evaluate(({ routeConfig, expectedCanonical }) => {
      const root = document.documentElement;
      const body = document.body;
      const main = document.querySelector("#main");
      const raffleLayout = main?.querySelector(".raffle-public-layout");
      const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: normalizedText(heading),
      }));
      const h1s = headings.filter((heading) => heading.level === 1);
      const headingJumps = headings
        .slice(1)
        .filter((heading, index) => heading.level > headings[index].level + 1)
        .map((heading) => heading.text);
      const controls = [...(main?.querySelectorAll("form,button,input,select,textarea,iframe,[role='button']") || [])]
        .map(elementLabel);
      const canonical = document.querySelector("link[rel='canonical']")?.href || "";
      const robots = [
        ...document.querySelectorAll("meta[name='robots'],meta[name='googlebot']"),
      ].map((meta) => meta.getAttribute("content") || "").join(",");
      const statusText = [
        ...document.querySelectorAll("[role='status'],#rafflesBadges,.raffle-status-grid,.raffle-rules-state-grid"),
      ].map(normalizedText).join(" ");
      const allMainText = normalizedText(main);
      const grids = routeConfig.grids.map((gridConfig) => inspectGrid(gridConfig));
      const textClipping = [...(raffleLayout?.querySelectorAll(".glass-card,li,p,h1,h2,h3,a,dt,dd") || [])]
        .filter((element) => {
          const style = getComputedStyle(element);
          const clipsX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
          const clipsY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
          return clipsX || clipsY;
        })
        .map(elementLabel)
        .slice(0, 10);
      const visiblyOverflowing = [...(raffleLayout?.querySelectorAll(".glass-card, .raffle-method-grid > li, .raffle-reward-list > section") || [])]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map(elementLabel)
        .slice(0, 10);
      const animated = [...(main?.querySelectorAll("*") || [])]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.animationName !== "none" && maximumTime(style.animationDuration) > 10;
        })
        .map(elementLabel)
        .slice(0, 10);

      return {
        title: document.title,
        description: document.querySelector("meta[name='description']")?.getAttribute("content")?.trim() || "",
        canonical,
        canonicalMatches: canonical === expectedCanonical,
        robots,
        indexable: !/(?:^|,)\s*(?:noindex|nofollow)\b/i.test(robots),
        h1s,
        headingJumps,
        requiredText: routeConfig.requiredText.map((text) => ({ text, present: allMainText.includes(text) })),
        statusText,
        controls,
        mainPresent: Boolean(main),
        layoutPresent: Boolean(raffleLayout),
        horizontalOverflow:
          Math.ceil(root.scrollWidth) > Math.ceil(root.clientWidth) + 1
          || Math.ceil(body.scrollWidth) > Math.ceil(body.clientWidth) + 1,
        widths: { document: root.scrollWidth, viewport: root.clientWidth },
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animated,
        textClipping,
        visiblyOverflowing,
        grids,
      };

      function inspectGrid(gridConfig) {
        const grid = document.querySelector(gridConfig.selector);
        if (!grid) return { selector: gridConfig.selector, present: false, children: [], overlaps: [] };
        const gridRect = grid.getBoundingClientRect();
        const style = getComputedStyle(grid);
        const gap = Number.parseFloat(style.columnGap) || 0;
        const trackWidth = (gridRect.width - (11 * gap)) / 12;
        const children = [...grid.children].map((child, index) => {
          const rect = child.getBoundingClientRect();
          const span = gridConfig.spans[index];
          const expectedWidth = span ? (span * trackWidth) + ((span - 1) * gap) : null;
          return {
            label: elementLabel(child),
            left: rect.left,
            right: rect.right,
            width: rect.width,
            expectedWidth,
            fullWidthDelta: Math.abs(rect.width - gridRect.width),
            leftDelta: Math.abs(rect.left - gridRect.left),
            contained: rect.left >= gridRect.left - 1 && rect.right <= gridRect.right + 1,
          };
        });
        const overlaps = [];
        for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
          const leftRect = grid.children[leftIndex].getBoundingClientRect();
          for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
            const rightRect = grid.children[rightIndex].getBoundingClientRect();
            const overlapWidth = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
            const overlapHeight = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
            if (overlapWidth > 1 && overlapHeight > 1) {
              overlaps.push(`${elementLabel(grid.children[leftIndex])} / ${elementLabel(grid.children[rightIndex])}`);
            }
          }
        }
        return { selector: gridConfig.selector, present: true, width: gridRect.width, gap, children, overlaps };
      }

      function normalizedText(element) {
        return (element?.textContent || "").replace(/\s+/g, " ").trim();
      }

      function elementLabel(element) {
        const classes = [...element.classList].slice(0, 3).join(".");
        return [element.tagName.toLowerCase(), element.id ? `#${element.id}` : "", classes ? `.${classes}` : ""]
          .filter(Boolean)
          .join("");
      }

      function maximumTime(value) {
        return Math.max(0, ...value.split(",").map((item) => {
          const trimmed = item.trim();
          return trimmed.endsWith("ms") ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
        }).filter(Number.isFinite));
      }
    }, {
      routeConfig: { grids: route.grids, requiredText: route.requiredText },
      expectedCanonical: `https://mochirii.com${route.path}`,
    });

    validateDocumentState(label, route, viewport, state);
    const focus = await inspectRaffleFocus(page, browserName);
    if (!focus.reached) failures.push(`${label}: keyboard tabbing did not reach a raffle-owned link.`);
    if (focus.reached && !focus.visible) failures.push(`${label}: raffle-owned keyboard focus had no visible outline or shadow.`);
    if (focus.reached && !focus.inViewport) failures.push(`${label}: raffle-owned keyboard focus was outside the viewport.`);
    if (focus.reached && focus.activated === false) failures.push(`${label}: focused raffle link did not activate from the keyboard.`);
    if (focus.explicitWebKitCheck) webkitExplicitFocusChecks += 1;

    for (const [kind, entries] of Object.entries(errors)) {
      for (const error of entries) failures.push(`${label}: ${kind} error: ${error}`);
    }

    results.push({ browserName, viewport: viewport.name, route: route.path, options });
  } catch (error) {
    failures.push(`${label}: ${safeMessage(error)}`);
  } finally {
    await page.close();
  }
}

function validateDocumentState(label, route, viewport, state) {
  if (!state.mainPresent || !state.layoutPresent) failures.push(`${label}: missing the main raffle layout.`);
  if (!route.title.test(state.title)) failures.push(`${label}: unexpected document title ${JSON.stringify(state.title)}.`);
  if (!state.description) failures.push(`${label}: missing meta description.`);
  if (!state.canonicalMatches) failures.push(`${label}: canonical URL was ${JSON.stringify(state.canonical)}.`);
  if (!state.indexable) failures.push(`${label}: robots metadata is not indexable (${JSON.stringify(state.robots)}).`);
  if (state.h1s.length !== 1 || !route.h1.test(state.h1s[0]?.text || "")) {
    failures.push(`${label}: expected one matching h1, found ${JSON.stringify(state.h1s)}.`);
  }
  if (state.headingJumps.length) failures.push(`${label}: heading levels skip before ${state.headingJumps.join(", ")}.`);
  for (const required of state.requiredText) {
    if (!required.present) failures.push(`${label}: missing required public text ${JSON.stringify(required.text)}.`);
  }
  if (!/no (?:raffle is active|active drawing rules)|entries closed|no purchase necessary/i.test(state.statusText)) {
    failures.push(`${label}: status region does not expose the inactive drawing state.`);
  }
  if (state.controls.length) failures.push(`${label}: raffle content exposes forbidden controls: ${state.controls.join(", ")}.`);
  if (state.horizontalOverflow) {
    failures.push(`${label}: horizontal overflow (${state.widths.document}px document vs ${state.widths.viewport}px viewport).`);
  }
  if (!state.reducedMotion) failures.push(`${label}: reduced-motion preference did not match.`);
  if (state.animated.length) failures.push(`${label}: active animation remains under reduced motion: ${state.animated.join(", ")}.`);
  if (state.textClipping.length) failures.push(`${label}: text can be clipped by overflow: ${state.textClipping.join(", ")}.`);
  if (state.visiblyOverflowing.length) failures.push(`${label}: raffle card content overflows horizontally: ${state.visiblyOverflowing.join(", ")}.`);

  for (const grid of state.grids) {
    if (!grid.present) {
      failures.push(`${label}: missing expected grid ${grid.selector}.`);
      continue;
    }
    if (grid.children.length !== route.grids.find((entry) => entry.selector === grid.selector)?.spans.length) {
      failures.push(`${label}: ${grid.selector} has an unexpected direct-child count.`);
    }
    if (grid.overlaps.length) failures.push(`${label}: ${grid.selector} cards overlap: ${grid.overlaps.join(", ")}.`);
    for (const child of grid.children) {
      if (!child.contained) failures.push(`${label}: ${grid.selector} child ${child.label} escapes its grid.`);
      if (viewport.width <= 980) {
        if (child.fullWidthDelta > 2 || child.leftDelta > 2) {
          failures.push(`${label}: ${grid.selector} child ${child.label} is not full width below the 980px breakpoint.`);
        }
      } else if (child.expectedWidth === null || Math.abs(child.width - child.expectedWidth) > 3) {
        failures.push(`${label}: ${grid.selector} child ${child.label} does not match its desktop column span.`);
      }
    }
  }
}

async function inspectRaffleFocus(page, browserName) {
  await page.locator("body").press("Home").catch(() => null);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    window.scrollTo(0, 0);
  });

  for (let index = 0; index < 50; index += 1) {
    // WebKit follows Safari's default preference: Option+Tab reaches links
    // when full keyboard access is not enabled. Chromium and Firefox use Tab.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    const focus = await readFocusedElement(page);
    if (focus.reached) return focus;
  }

  if (browserName === "webkit") {
    // Playwright WebKit follows Safari's platform preference that can omit
    // links from sequential focus navigation. Explicitly focus the semantic
    // link, then require visible focus and Enter-key activation. Physical
    // Safari remains the authority for the operating-system preference.
    const link = page.locator("#main a[href]").first();
    if (await link.count()) {
      const previousUrl = page.url();
      const destination = await link.evaluate((element) => (element instanceof HTMLAnchorElement ? element.href : ""));
      await link.focus();
      await link.scrollIntoViewIfNeeded();
      const focus = await readFocusedElement(page);
      await Promise.all([
        page.waitForURL(destination, { timeout: 15_000 }),
        page.keyboard.press("Enter"),
      ]);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      return {
        ...focus,
        activated: Boolean(destination) && page.url() === destination && page.url() !== previousUrl,
        explicitWebKitCheck: true,
      };
    }
  }
  return { reached: false, visible: false, inViewport: false };
}

async function readFocusedElement(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || !element.closest("#main")) {
      return { reached: false, visible: false, inViewport: false };
    }
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    return {
      reached: true,
      visible: (outlineWidth > 0 && style.outlineStyle !== "none") || style.boxShadow !== "none",
      inViewport: rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0,
    };
  });
}

async function prepareLocalHttpFixture(context) {
  const localOrigin = new URL(baseUrl).origin;
  await context.route(`${localOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (["/_vercel/insights/script.js", "/_vercel/speed-insights/script.js"].includes(url.pathname)) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: "",
      });
      return;
    }

    const response = await route.fetch();
    const headers = response.headers();
    const policy = headers["content-security-policy"];
    if (policy) {
      // Production is HTTPS and retains this directive. The loopback fixture is
      // HTTP, so remove only the HTTPS-upgrade directive to let WebKit load the
      // same-origin assets while enforcing every other CSP directive.
      headers["content-security-policy"] = policy
        .split(";")
        .map((directive) => directive.trim())
        .filter((directive) => directive.toLowerCase() !== "upgrade-insecure-requests")
        .join("; ");
    }
    await route.fulfill({ response, headers });
  });
}

function isPrivateRaffleRequest(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  const target = `${url.hostname}${url.pathname}`.toLowerCase();
  return /(?:\/api\/raffle(?:\/|$)|\/raffle\/claim(?:\/|$)|\/leader-dashboard\/raffle(?:\/|$)|\/functions\/v1\/(?:[^/]*raffle[^/]*|reward-provider-webhook)|\/rest\/v1\/[^/]*(?:raffle|reward|prize)[^/]*|tremendous|reward-relay)/.test(target);
}

function resolveBaseUrl(argv) {
  const index = argv.indexOf("--base-url");
  if (index >= 0 && !argv[index + 1]) throw new Error("--base-url requires an HTTP(S) URL.");
  const candidate = index >= 0
    ? argv[index + 1]
    : argv.includes("--local")
      ? "http://127.0.0.1:8765"
      : process.env.RAFFLE_PUBLIC_BASE_URL || "http://127.0.0.1:8765";
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The raffle smoke base URL must use HTTP(S).");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the raffle smoke base URL.");
  if (url.search || url.hash) throw new Error("The raffle smoke base URL must not contain a query string or fragment.");
  return url.href.replace(/\/$/, "");
}

function isLocalBaseUrl(value) {
  const hostname = new URL(value).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function scenarioLabel(browserName, viewport, path, options) {
  const mode = options.textScale === 2
    ? "200%-text"
    : options.javaScriptEnabled === false
      ? "javascript-disabled"
      : "standard";
  return `${browserName} ${viewport.name} ${path} (${mode})`;
}

function safeMessage(value) {
  return String(value?.message || value || "unknown error")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}
