const args = process.argv.slice(2);
const baseUrl = readBaseUrl(args);
const failures = [];

const stateScenarios = [
  ["inactive", "No raffle is active", "Entries closed"],
  ["previous-only", "No raffle is active", "Entries closed", "Previous drawing results", [], ["Previous fixture drawing", "Winner confirmed"]],
  ["scheduled", "A raffle is scheduled", "Entries closed"],
  ["open", "A raffle is active", "Entries open"],
  ["open-standard", "A raffle is active", "Standard entries open"],
  ["closed", "Submissions are closed", "Entries closed"],
  ["drawing", "Drawing in progress", "Entries closed"],
  ["results-signed-out", "Drawing complete", "Entries closed", "Current and previous results", ["Current drawing", "Previous drawings"]],
  ["paused", "Raffle paused", "Entries closed"],
];

const commonViewports = [
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
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error("Playwright is required for rendered raffle fixture verification.");
  process.exit(1);
}

for (const [browserName, browserType] of [
  ["chromium", playwright.chromium],
  ["firefox", playwright.firefox],
  ["webkit", playwright.webkit],
]) {
  const browser = await launch(browserName, browserType);
  if (!browser) continue;
  try {
    await verifyAllStates(browser, browserName);
    if (browserName === "chromium") {
      await verifyGeometryMatrix(browser);
      await verifyLocalization(browser);
      await verifyNoJavaScript(browser);
      await verifyRenderFixtureIsolation(browser);
      await verifyMissingData(browser);
    }
  } finally {
    await browser.close();
  }
}

if (failures.length) {
  console.error(`Rendered raffle fixture smoke failed with ${failures.length} finding${failures.length === 1 ? "" : "s"}.`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Rendered raffle fixture smoke OK.");
console.log(`- All ${stateScenarios.length} public state/entry variants passed in Chromium, Firefox, and WebKit.`);
console.log(`- Active-state geometry passed at ${commonViewports.length} representative viewports, including the 980px breakpoint.`);
console.log("- The signed-out and verified-member winner feature passed reflow, privacy, and reduced-motion checks.");
console.log("- UTC+8 governing time, visitor localization, no-JavaScript output, missing-data rejection, and alternating render-fixture isolation passed.");
console.log("- Authenticated session and shared-cache isolation remain part of the server-integrated core track.");

async function launch(browserName, browserType) {
  try {
    return await browserType.launch({ headless: true });
  } catch (error) {
    failures.push(`${browserName}: browser launch failed: ${message(error)}`);
    return null;
  }
}

async function verifyAllStates(browser, browserName) {
  const context = await createContext(browser, { width: 390, height: 844 });
  try {
    for (const [scenario, drawing, entryHeading, resultsHeading, resultGroupHeadings = [], requiredResultText = []] of stateScenarios) {
      const label = `${browserName} ${scenario}`;
      const inspected = await inspectFixture(context, scenario, label);
      if (!inspected) continue;
      if (!inspected.text.includes(drawing)) failures.push(`${label}: missing drawing state ${drawing}.`);
      if (!inspected.entryHeading.includes(entryHeading)) failures.push(`${label}: expected entry heading ${entryHeading}.`);
      if (resultsHeading && inspected.resultsHeading.trim() !== resultsHeading) {
        failures.push(`${label}: expected results heading ${resultsHeading}.`);
      }
      for (const heading of resultGroupHeadings) {
        if (!inspected.resultGroupHeadings.includes(heading)) failures.push(`${label}: missing result group heading ${heading}.`);
      }
      for (const value of requiredResultText) {
        if (!inspected.text.includes(value)) failures.push(`${label}: missing result content ${value}.`);
      }
      if (!inspected.text.includes("No purchase necessary")) failures.push(`${label}: no-purchase disclosure is missing.`);
      if (inspected.controls.length) failures.push(`${label}: exposed dead or private controls: ${inspected.controls.join(", ")}.`);
      if (inspected.privateRequests.length) failures.push(`${label}: made private raffle requests: ${inspected.privateRequests.join(", ")}.`);
    }
  } finally {
    await closeContext(context);
  }
}

async function verifyGeometryMatrix(browser) {
  for (const viewport of commonViewports) {
    const context = await createContext(browser, viewport);
    try {
      const label = `chromium ${viewport.name} active geometry`;
      const inspected = await inspectFixture(context, "open", label, { geometry: true });
      if (!inspected) continue;
      if (inspected.horizontalOverflow > 1) failures.push(`${label}: document overflowed horizontally by ${inspected.horizontalOverflow}px.`);
      for (const issue of inspected.geometryIssues) failures.push(`${label}: ${issue}`);

      const winnerLabel = `chromium ${viewport.name} winner geometry`;
      const winner = await inspectFixture(context, "results-signed-out", winnerLabel, { geometry: true });
      if (!winner) continue;
      if (!winner.winnerPresent || winner.winnerNameVisible) failures.push(`${winnerLabel}: signed-out winner privacy state is incorrect.`);
      if (!winner.text.includes("Winner Confirmed")) failures.push(`${winnerLabel}: generic winner label is missing.`);
      if (winner.horizontalOverflow > 1) failures.push(`${winnerLabel}: document overflowed horizontally by ${winner.horizontalOverflow}px.`);
      for (const issue of winner.geometryIssues) failures.push(`${winnerLabel}: ${issue}`);
    } finally {
      await closeContext(context);
    }
  }

  const context = await createContext(browser, { width: 320, height: 568 });
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await navigate(page, "results-verified-a", "chromium phone 200%-text");
    await page.addStyleTag({ content: "html{font-size:200% !important}" });
    await page.waitForTimeout(100);
    const layout = await readGeometry(page);
    if (layout.horizontalOverflow > 1) failures.push("chromium phone 200%-text: document overflowed horizontally.");
    layout.geometryIssues.forEach((issue) => failures.push(`chromium phone 200%-text: ${issue}`));
    const winnerState = await page.locator(".raffle-monthly-winner").getAttribute("data-member-name-visible");
    if (winnerState !== "true") failures.push("chromium phone 200%-text: verified winner name is not visible.");
    reportErrors("chromium phone 200%-text", errors);
  } finally {
    await closeContext(context);
  }
}

async function verifyLocalization(browser) {
  const context = await createContext(browser, { width: 390, height: 844 }, {
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  try {
    const inspected = await inspectFixture(context, "open", "chromium active visitor localization");
    if (!inspected) return;
    if (!inspected.text.includes("UTC+8")) failures.push("active visitor localization: authoritative UTC+8 time is missing.");
    if (!inspected.text.includes("Your time:")) failures.push("active visitor localization: visitor-local time was not appended after hydration.");
    if (!inspected.text.includes("America/Los_Angeles")) failures.push("active visitor localization: visitor timezone label is missing.");
  } finally {
    await closeContext(context);
  }
}

async function verifyNoJavaScript(browser) {
  const context = await createContext(browser, { width: 390, height: 844 }, {
    javaScriptEnabled: false,
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  try {
    const inspected = await inspectFixture(context, "open", "chromium active no-JavaScript", {
      ignoreDisabledScripts: true,
      waitForHydration: false,
    });
    if (!inspected) return;
    if (!inspected.text.includes("UTC+8")) failures.push("active no-JavaScript: authoritative UTC+8 time is missing.");
    if (inspected.text.includes("Your time:")) failures.push("active no-JavaScript: visitor-local enhancement rendered without JavaScript.");
  } finally {
    await closeContext(context);
  }
}

async function verifyRenderFixtureIsolation(browser) {
  const context = await createContext(browser, { width: 390, height: 844 });
  const sequence = [
    ["results-verified-a", ["Aster Vale", "Mochi Star", "Jade Lantern"], ["Briar Moon"]],
    ["results-signed-out", ["Winner confirmed", "Community honor confirmed"], ["Aster Vale", "Briar Moon"]],
    ["results-verified-b", ["Briar Moon", "Cloud Ribbon", "Pearl Bell"], ["Aster Vale"]],
    ["results-unverified", ["Winner confirmed", "Community honor confirmed"], ["Aster Vale", "Briar Moon"]],
    ["results-verified-a", ["Aster Vale"], ["Briar Moon"]],
  ];
  try {
    for (const [scenario, required, forbidden] of sequence) {
      const inspected = await inspectFixture(context, scenario, `render fixture isolation ${scenario}`);
      if (!inspected) continue;
      for (const value of required) {
        if (!inspected.text.includes(value)) failures.push(`render fixture isolation ${scenario}: missing ${value}.`);
      }
      for (const value of forbidden) {
        if (inspected.text.includes(value)) failures.push(`render fixture isolation ${scenario}: leaked ${value}.`);
      }
    }
  } finally {
    await closeContext(context);
  }
}

async function verifyMissingData(browser) {
  const context = await createContext(browser, { width: 390, height: 844 });
  try {
    const response = await context.request.get(`${baseUrl}/raffle-render-fixtures-internal/missing-data`, { maxRedirects: 0 });
    if (response.status() !== 404) failures.push(`missing-data fixture: expected fail-closed HTTP 404, received ${response.status()}.`);
  } finally {
    await closeContext(context);
  }
}

async function createContext(browser, viewport, extra = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "dark",
    reducedMotion: "reduce",
    javaScriptEnabled: extra.javaScriptEnabled !== false,
    locale: extra.locale || "en-US",
    timezoneId: extra.timezoneId || "Asia/Singapore",
  });
  await prepareLocalFixture(context);
  return context;
}

async function inspectFixture(context, scenario, label, options = {}) {
  const page = await context.newPage();
  const errors = watchErrors(page, options);
  try {
    const response = await navigate(page, scenario, label, options.waitForHydration !== false);
    if (!response) return null;
    const basic = await page.evaluate(() => ({
      text: document.querySelector("#main")?.textContent || "",
      entryHeading: document.querySelector("#entryStatusHeading")?.textContent || "",
      resultsHeading: document.querySelector("#raffleResultsHeading")?.textContent || "",
      resultGroupHeadings: [...document.querySelectorAll(".raffle-result-group > h3")]
        .map((element) => element.textContent?.trim() || ""),
      controls: [...document.querySelectorAll("#main form,#main button,#main input,#main select,#main textarea")]
        .map((element) => element.tagName.toLowerCase()),
      winnerPresent: Boolean(document.querySelector(".raffle-monthly-winner")),
      winnerNameVisible: document.querySelector(".raffle-monthly-winner")?.getAttribute("data-member-name-visible") === "true",
    }));
    const geometry = options.geometry ? await readGeometry(page) : { horizontalOverflow: 0, geometryIssues: [] };
    await page.waitForTimeout(50);
    reportErrors(label, errors);
    return { ...basic, ...geometry, privateRequests: errors.privateRequests };
  } finally {
    await page.close();
  }
}

async function navigate(page, scenario, label, waitForHydration = true) {
  const response = await page.goto(`${baseUrl}/raffle-render-fixtures-internal/${scenario}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  if (!response || response.status() !== 200) {
    failures.push(`${label}: expected HTTP 200, received ${response?.status() ?? "no response"}.`);
    return null;
  }
  await page.waitForSelector("#main", { timeout: 15_000 });
  if (waitForHydration) await page.waitForTimeout(250);
  await page.evaluate(() => document.fonts?.ready).catch(() => null);
  return response;
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const issues = [];
    const documentElement = document.documentElement;
    const gridContracts = [
      [".raffle-status-grid", [8, 4]],
      [".raffle-program-grid", [7, 5]],
      [".raffle-reward-grid", [7, 5]],
    ];

    for (const [selector, spans] of gridContracts) {
      const grid = document.querySelector(selector);
      if (!(grid instanceof HTMLElement)) {
        issues.push(`${selector} is missing`);
        continue;
      }
      const children = [...grid.children].filter((child) => child instanceof HTMLElement);
      if (children.length !== 2) {
        issues.push(`${selector} does not have two cards`);
        continue;
      }
      const widths = children.map((child) => child.getBoundingClientRect().width);
      if (widths.some((width) => width <= 0)) issues.push(`${selector} contains a collapsed card`);
      if (innerWidth <= 980) {
        if (widths.some((width) => Math.abs(width - grid.clientWidth) > 2)) issues.push(`${selector} is not full width below 981px`);
      } else {
        const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
        const columnWidth = (grid.clientWidth - 11 * gap) / 12;
        const expected = spans.map((span) => span * columnWidth + (span - 1) * gap);
        if (widths.some((width, index) => Math.abs(width - expected[index]) > 3)) issues.push(`${selector} does not retain its ${spans.join("/")} proportion`);
      }
    }

    for (const element of document.querySelectorAll(".raffle-public-layout .glass-card,.raffle-public-layout li,.raffle-public-layout p,.raffle-public-layout h1,.raffle-public-layout h2,.raffle-public-layout h3,.raffle-public-layout a,.raffle-public-layout dt,.raffle-public-layout dd")) {
      if (!(element instanceof HTMLElement)) continue;
      const style = getComputedStyle(element);
      if (["hidden", "clip"].includes(style.overflowX) && element.scrollWidth - element.clientWidth > 1) {
        issues.push(`${element.tagName.toLowerCase()} content clips horizontally`);
      }
      if (["hidden", "clip"].includes(style.overflowY) && element.scrollHeight - element.clientHeight > 1) {
        issues.push(`${element.tagName.toLowerCase()} content clips vertically`);
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) issues.push(`${element.tagName.toLowerCase()} has zero geometry`);
    }
    for (const element of document.querySelectorAll(".raffle-public-layout .glass-card,.raffle-monthly-winner,.raffle-method-grid > li,.raffle-reward-list > section")) {
      if (!(element instanceof HTMLElement)) continue;
      const overflowX = getComputedStyle(element).overflowX;
      if (!["hidden", "clip"].includes(overflowX) && element.scrollWidth - element.clientWidth > 1) {
        issues.push(`${element.tagName.toLowerCase()} visibly overflows horizontally`);
      }
    }

    const winner = document.querySelector(".raffle-monthly-winner");
    if (winner instanceof HTMLElement) {
      const rect = winner.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.width <= 0 || rect.height <= 0) {
        issues.push("monthly winner card is outside the viewport or collapsed");
      }
      const emblem = winner.querySelector(".raffle-winner-emblem");
      if (!(emblem instanceof HTMLElement) || emblem.getBoundingClientRect().width <= 0) {
        issues.push("monthly winner emblem is missing or collapsed");
      }
      if (
        getComputedStyle(winner, "::before").animationName !== "none"
        || getComputedStyle(winner, "::after").animationName !== "none"
        || (emblem instanceof HTMLElement && getComputedStyle(emblem).animationName !== "none")
      ) {
        issues.push("monthly winner flair ignores reduced-motion preference");
      }
    }

    return {
      horizontalOverflow: documentElement.scrollWidth - documentElement.clientWidth,
      geometryIssues: [...new Set(issues)],
    };
  });
}

function watchErrors(page, options = {}) {
  const errors = { console: [], page: [], request: [], http: [], privateRequests: [] };
  page.on("console", (entry) => {
    if (entry.type() === "error") errors.console.push(message(entry.text()));
  });
  page.on("pageerror", (error) => errors.page.push(message(error)));
  page.on("requestfailed", (request) => {
    if (
      options.ignoreDisabledScripts
      && request.resourceType() === "script"
      && request.failure()?.errorText === "csp"
    ) return;
    errors.request.push(message(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.http.push(message(`${response.status()} ${response.url()}`));
  });
  page.on("request", (request) => {
    if (isPrivateRaffleRequest(request.url())) errors.privateRequests.push(message(`${request.method()} ${request.url()}`));
  });
  return errors;
}

function reportErrors(label, errors) {
  for (const category of ["console", "page", "request", "http"]) {
    for (const value of errors[category]) failures.push(`${label}: ${category} error: ${value}`);
  }
}

async function prepareLocalFixture(context) {
  const origin = new URL(baseUrl).origin;
  await context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (["/_vercel/insights/script.js", "/_vercel/speed-insights/script.js"].includes(url.pathname)) {
      await route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: "" });
      return;
    }
    const response = await route.fetch();
    const headers = response.headers();
    const policy = headers["content-security-policy"];
    if (policy) {
      headers["content-security-policy"] = policy
        .split(";")
        .map((directive) => directive.trim())
        .filter((directive) => directive.toLowerCase() !== "upgrade-insecure-requests")
        .join("; ");
    }
    await route.fulfill({ response, headers });
  });
}

async function closeContext(context) {
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
}

function isPrivateRaffleRequest(value) {
  const url = new URL(value);
  const target = `${url.hostname}${url.pathname}`.toLowerCase();
  return /(?:\/api\/raffle(?:\/|$)|\/raffle\/claim(?:\/|$)|\/leader-dashboard\/raffle(?:\/|$)|\/functions\/v1\/(?:[^/]*raffle[^/]*|reward-provider-webhook)|\/rest\/v1\/[^/]*(?:raffle|reward|prize)[^/]*|tremendous|reward-relay)/.test(target);
}

function readBaseUrl(argv) {
  const index = argv.indexOf("--base-url");
  const value = index >= 0 ? argv[index + 1] : process.env.RAFFLE_PUBLIC_FIXTURE_BASE_URL;
  if (!value) throw new Error("--base-url is required for rendered raffle fixture verification.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("The fixture base URL must be a plain HTTP(S) origin without credentials, query, or fragment.");
  }
  return url.href.replace(/\/$/, "");
}

function message(value) {
  return String(value?.message || value || "unknown error")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}
