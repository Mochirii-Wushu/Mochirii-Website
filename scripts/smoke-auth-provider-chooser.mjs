import { execFileSync, spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const root = process.cwd();
const webRoot = resolve(root, "apps/web");
const nextBin = resolve(webRoot, "node_modules/next/dist/bin/next");
const port = await reserveLoopbackPort();
const baseUrl = `http://127.0.0.1:${port}`;
const syntheticAuthOrigin = baseUrl;
const expectedProviders = [
  ["Continue with Apple", "apple-logo.generated.svg"],
  ["Continue with Facebook", "facebook-login-mark.svg"],
  ["Continue with Google", "google-g.generated.svg"],
  ["Sign in with Discord", "discord-symbol-white.svg"],
  ["Log in with Twitch", "twitch-glitch-white.svg"],
  ["Log in with Spotify", "spotify-primary-logo-green.svg"],
];
const expectedShellPrefetchPaths = new Set([
  "/announcements",
  "/events",
  "/gallery",
  "/join",
  "/leaders",
  "/raffle",
  "/ranks",
  "/spotlight",
  "/tome",
]);
const viewports = [
  { name: "compact phone", width: 320, height: 568 },
  { name: "current phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];
const engines = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
];
const requestedEngine = String(process.env.MOCHIRII_AUTH_PROVIDER_SMOKE_ENGINE || "").trim().toLowerCase();
const activeEngines = requestedEngine
  ? engines.filter(([name]) => name.toLowerCase() === requestedEngine)
  : engines;
if (!activeEngines.length) throw new Error(`Unknown MOCHIRII_AUTH_PROVIDER_SMOKE_ENGINE: ${requestedEngine}`);
const environment = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: syntheticAuthOrigin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_browser_smoke_only",
  NEXT_PUBLIC_SITE_URL: baseUrl,
  NEXT_PUBLIC_AUTH_PROVIDER_IDS: "apple,facebook,google,discord,twitch,spotify",
  NEXT_PUBLIC_AUTH_IDENTITY_LINK_PROVIDER_IDS: "discord,google,twitch,apple",
  NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS: "",
  NEXT_PUBLIC_PHONE_AUTH_READY: "false",
  NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED: "false",
};

let server = null;
let serverOutput = "";

try {
  await runChild(
    process.execPath,
    [nextBin, "build"],
    { cwd: webRoot, env: environment, stdio: "inherit" },
    "authentication chooser production build",
    5 * 60_000,
  );
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: webRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput = boundedOutput(serverOutput, chunk); });
  server.stderr.on("data", (chunk) => { serverOutput = boundedOutput(serverOutput, chunk); });
  await waitUntilReady(server, `${baseUrl}/auth`);

  for (const [engineName, browserType] of activeEngines) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const viewport of viewports) {
        await verifyChooser(browser, engineName, viewport);
      }
    } finally {
      await browser.close();
    }
  }

  console.log(`Authentication provider chooser smoke passed: ${activeEngines.length * viewports.length} responsive browser cases and ${activeEngines.length} synthetic Facebook handoffs.`);
} finally {
  await stopChild(server);
}

async function verifyChooser(browser, engineName, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce",
    bypassCSP: true,
  });
  const failures = [];
  const externalRequests = [];
  const syntheticRequests = [];
  const browserErrors = [];
  const failedRequests = [];
  const expectedHandoffCancellations = [];
  let providerHandoffInProgress = false;
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const locationUrl = message.location().url || "";
    if (locationUrl.startsWith(syntheticAuthOrigin) || isAnalyticsUrl(locationUrl)) return;
    browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    if (isExpectedWebKitHandoffPageError(engineName, providerHandoffInProgress, error.message)) {
      expectedHandoffCancellations.push(`page: ${error.message}`);
      return;
    }
    browserErrors.push(`page: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (isAnalyticsUrl(request.url())) return;
    if (isExpectedProviderHandoffRequestCancellation(engineName, providerHandoffInProgress, request)) {
      expectedHandoffCancellations.push(`request: ${request.url()}`);
      return;
    }
    failedRequests.push(`${request.url()} ${request.failure()?.errorText || "failed"}`);
  });

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === syntheticAuthOrigin && url.pathname.startsWith("/auth/v1/")) {
      syntheticRequests.push(url.href);
      return;
    }
    if (url.origin !== baseUrl) externalRequests.push(url.href);
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === syntheticAuthOrigin && url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname === "/auth/v1/authorize") {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: { "Cache-Control": "no-store" },
          body: "<!doctype html><title>Synthetic authorization boundary</title>",
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json; charset=utf-8",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ message: "Auth session missing" }),
      });
      return;
    }
    if (
      isAnalyticsUrl(url.href)
      || (url.origin === baseUrl && ["/_vercel/insights/script.js", "/_vercel/speed-insights/script.js"].includes(url.pathname))
    ) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (url.origin === baseUrl) {
      try {
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
      } catch (error) {
        if (!isExpectedRouteTeardownError(error)) throw error;
      }
      return;
    }
    await route.fallback();
  });

  try {
    const response = await page.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded" });
    if (!response || response.status() !== 200) failures.push(`expected /auth 200, received ${response?.status() ?? "no response"}`);
    const documentPolicy = await response?.headerValue("content-security-policy");
    if (documentPolicy?.toLowerCase().includes("upgrade-insecure-requests")) {
      failures.push("local HTTP fixture retained the production HTTPS-upgrade directive");
    }
    try {
      await page.getByRole("heading", { name: "Website Sign-In", exact: true }).waitFor();
    } catch {
      const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600);
      throw new Error(`${engineName} ${viewport.name}: /auth did not render the sign-in heading at ${page.url()}. Browser errors: ${browserErrors.join(" | ") || "none"}. Body: ${bodyText}`);
    }
    try {
      await page.locator(".provider-grid .provider-button:not([disabled])").first().waitFor({ state: "visible" });
    } catch {
      const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600);
      throw new Error(`${engineName} ${viewport.name}: provider controls did not hydrate. Browser errors: ${browserErrors.join(" | ") || "none"}. Body: ${bodyText}`);
    }
    // Let Next finish route prefetches before the synthetic provider handoff.
    // WebKit otherwise reports navigation-aborted prefetch promises as page
    // errors when the desktop case leaves /auth immediately after hydration.
    await page.waitForLoadState("networkidle");

    for (const [label, assetName] of expectedProviders) {
      const button = page.getByRole("button", { name: label, exact: true });
      if (await button.count() !== 1) {
        failures.push(`${label}: expected one enabled button`);
        continue;
      }
      if (await button.isDisabled()) failures.push(`${label}: unexpectedly disabled`);
      await button.scrollIntoViewIfNeeded();
      const image = button.locator("img");
      const src = await image.getAttribute("src");
      if (!src?.endsWith(`/assets/auth-providers/${assetName}`)) failures.push(`${label}: unexpected logo source ${src || "missing"}`);
      const imageLoaded = await image.evaluate((node) => {
        if (node.complete) return node.naturalWidth > 0 && node.naturalHeight > 0;
        return Promise.race([
          new Promise((resolveImage) => {
            node.addEventListener("load", () => resolveImage(node.naturalWidth > 0 && node.naturalHeight > 0), { once: true });
            node.addEventListener("error", () => resolveImage(false), { once: true });
          }),
          new Promise((resolveImage) => setTimeout(() => resolveImage(false), 5_000)),
        ]);
      });
      if (!imageLoaded) failures.push(`${label}: official logo did not finish loading`);
      const imageGeometry = await image.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
          renderedWidth: rect.width,
          renderedHeight: rect.height,
        };
      });
      const imageBox = await image.boundingBox();
      if (!imageBox || imageBox.width <= 0 || imageBox.height <= 0) failures.push(`${label}: logo has no rendered geometry`);
      if (
        imageGeometry.naturalWidth > 0
        && imageGeometry.naturalHeight > 0
        && imageGeometry.renderedWidth > 0
        && imageGeometry.renderedHeight > 0
      ) {
        const naturalRatio = imageGeometry.naturalWidth / imageGeometry.naturalHeight;
        const renderedRatio = imageGeometry.renderedWidth / imageGeometry.renderedHeight;
        const relativeRatioError = Math.abs(renderedRatio - naturalRatio) / naturalRatio;
        if (relativeRatioError > 0.015) {
          failures.push(`${label}: official logo aspect ratio drifted by ${(relativeRatioError * 100).toFixed(2)}%`);
        }
      }
      const buttonBox = await button.boundingBox();
      if (!buttonBox || buttonBox.height < 44) failures.push(`${label}: button is below the 44px touch target`);
      if (buttonBox && (buttonBox.x < -0.5 || buttonBox.x + buttonBox.width > viewport.width + 0.5)) {
        failures.push(`${label}: button escapes the ${viewport.width}px viewport`);
      }
      const renderedButtonText = (await button.innerText()).replace(/\s+/g, " ").trim();
      if (renderedButtonText !== label) failures.push(`${label}: provider status text leaked into the branded control`);
      const describedBy = await button.getAttribute("aria-describedby");
      if (!describedBy || await page.locator(`#${describedBy}`).count() !== 1) {
        failures.push(`${label}: external provider status description is missing`);
      }

      const brandMetrics = await button.evaluate((node) => {
        const buttonRect = node.getBoundingClientRect();
        const buttonStyle = getComputedStyle(node);
        const labelNode = node.querySelector(".provider-button__label");
        const logoNode = node.querySelector(".provider-logo");
        const imageNode = node.querySelector("img");
        const labelRect = labelNode?.getBoundingClientRect();
        const logoRect = logoNode?.getBoundingClientRect();
        const renderedImageRect = imageNode?.getBoundingClientRect();
        const labelStyle = labelNode ? getComputedStyle(labelNode) : null;
        return {
          backgroundColor: buttonStyle.backgroundColor,
          borderColor: buttonStyle.borderColor,
          borderRadius: buttonStyle.borderRadius,
          buttonCenter: buttonRect.left + (buttonRect.width / 2),
          buttonHeight: buttonRect.height,
          buttonWidth: buttonRect.width,
          labelCenter: labelRect ? labelRect.left + (labelRect.width / 2) : null,
          labelRightMargin: labelRect ? buttonRect.right - labelRect.right : null,
          labelColor: labelStyle?.color || "",
          labelFontFamily: labelStyle?.fontFamily || "",
          labelFontSize: labelStyle?.fontSize || "",
          labelFontWeight: labelStyle?.fontWeight || "",
          labelLineHeight: labelStyle?.lineHeight || "",
          logoWidth: logoRect?.width || 0,
          logoHeight: logoRect?.height || 0,
          imageWidth: renderedImageRect?.width || 0,
          imageHeight: renderedImageRect?.height || 0,
        };
      });
      if (label === "Continue with Google") {
        if (brandMetrics.backgroundColor !== "rgb(19, 19, 20)") failures.push(`${label}: official dark background drifted`);
        if (brandMetrics.borderColor !== "rgb(142, 145, 143)") failures.push(`${label}: official dark border drifted`);
        if (brandMetrics.borderRadius !== "28px") failures.push(`${label}: official pill radius drifted`);
        if (brandMetrics.labelColor !== "rgb(227, 227, 227)") failures.push(`${label}: official label color drifted`);
        if (brandMetrics.labelFontSize !== "14px") failures.push(`${label}: official label size drifted`);
        if (brandMetrics.labelFontWeight !== "500") failures.push(`${label}: official label weight drifted`);
        if (brandMetrics.labelLineHeight !== "20px") failures.push(`${label}: official label line height drifted`);
        if (!brandMetrics.labelFontFamily.toLowerCase().includes("roboto")) failures.push(`${label}: official font stack drifted`);
        if (Math.abs(brandMetrics.logoWidth - 20) > 0.5 || Math.abs(brandMetrics.logoHeight - 20) > 0.5) {
          failures.push(`${label}: official standard G container is not 20x20`);
        }
        if (Math.abs(brandMetrics.imageWidth - 20) > 0.5 || Math.abs(brandMetrics.imageHeight - 20) > 0.5) {
          failures.push(`${label}: official standard G image is not 20x20`);
        }
      }
      if (label === "Continue with Apple") {
        const expectedButtonSize = viewport.width <= 340 ? 52 : 56;
        const expectedLabelSize = viewport.width <= 340 ? 22 : 24;
        if (brandMetrics.backgroundColor !== "rgb(255, 255, 255)") failures.push(`${label}: official white background drifted`);
        if (brandMetrics.borderColor !== "rgb(0, 0, 0)") failures.push(`${label}: official black border drifted`);
        if (brandMetrics.borderRadius !== "15px") failures.push(`${label}: official radius drifted`);
        if (brandMetrics.labelColor !== "rgb(0, 0, 0)") failures.push(`${label}: official black label drifted`);
        if (brandMetrics.labelFontSize !== `${expectedLabelSize}px`) failures.push(`${label}: official proportional label size drifted`);
        if (brandMetrics.labelFontWeight !== "500") failures.push(`${label}: official label weight drifted`);
        if (brandMetrics.labelLineHeight !== `${expectedLabelSize}px`) failures.push(`${label}: official label line height drifted`);
        if (Math.abs(brandMetrics.buttonHeight - expectedButtonSize) > 0.5) failures.push(`${label}: official proportional button height drifted`);
        if (Math.abs(brandMetrics.logoWidth - expectedButtonSize) > 0.5 || Math.abs(brandMetrics.logoHeight - expectedButtonSize) > 0.5) {
          failures.push(`${label}: official logo container does not match the button height`);
        }
        if (Math.abs(brandMetrics.imageWidth - expectedButtonSize) > 0.5 || Math.abs(brandMetrics.imageHeight - expectedButtonSize) > 0.5) {
          failures.push(`${label}: official logo image does not match the button height`);
        }
        if (brandMetrics.labelCenter === null || Math.abs(brandMetrics.buttonCenter - brandMetrics.labelCenter) > 0.75) {
          failures.push(`${label}: title is not horizontally centered`);
        }
        if (brandMetrics.labelRightMargin === null || brandMetrics.labelRightMargin + 0.5 < brandMetrics.buttonWidth * 0.08) {
          failures.push(`${label}: title does not retain Apple's minimum right margin`);
        }
      }
    }

    const providerButtonMetrics = await page.locator(".provider-grid .provider-button:not([disabled])").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        className: node.className,
        width: rect.width,
        height: rect.height,
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        opacity: style.opacity,
      };
    }));
    const referenceButton = providerButtonMetrics[0];
    const buttonWidths = providerButtonMetrics.map(({ width }) => width);
    const buttonHeights = providerButtonMetrics.map(({ height }) => height);
    if (buttonWidths.length && Math.max(...buttonWidths) - Math.min(...buttonWidths) > 0.5) {
      failures.push(`provider buttons do not share one usable width (${Math.min(...buttonWidths).toFixed(2)}px-${Math.max(...buttonWidths).toFixed(2)}px)`);
    }
    if (buttonHeights.length && Math.max(...buttonHeights) / Math.min(...buttonHeights) > 1.15) {
      failures.push(`provider button heights exceed the 15% equal-prominence bound (${Math.min(...buttonHeights).toFixed(2)}px-${Math.max(...buttonHeights).toFixed(2)}px)`);
    }
    for (const [index, metrics] of providerButtonMetrics.entries()) {
      if (metrics.className.includes("provider-button--primary")) {
        failures.push(`provider ${index + 1}: provider-specific primary emphasis returned`);
      }
      if (
        referenceButton
        && (
          metrics.borderTopWidth !== referenceButton.borderTopWidth
          || metrics.borderRightWidth !== referenceButton.borderRightWidth
          || metrics.borderBottomWidth !== referenceButton.borderBottomWidth
          || metrics.borderLeftWidth !== referenceButton.borderLeftWidth
          || metrics.opacity !== referenceButton.opacity
        )
      ) {
        failures.push(`provider ${index + 1}: button border or opacity does not have equal visual weight`);
      }
    }

    if (await page.locator('.provider-grid[role="list"] > .provider-option[role="listitem"]').count() !== expectedProviders.length) {
      failures.push("provider chooser list semantics do not match the enabled provider count");
    }

    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      facebookAccessibleName: document.querySelector(".provider-logo--facebook")?.closest("button")?.textContent || "",
    }));
    if (layout.scrollWidth > layout.viewportWidth + 1) failures.push(`horizontal overflow ${layout.scrollWidth}px > ${layout.viewportWidth}px`);
    if (!layout.facebookAccessibleName.includes("Continue with Facebook")) failures.push("Facebook label is not present in the button name content");

    if (viewport.name === "desktop") {
      const facebook = page.getByRole("button").filter({ hasText: "Continue with Facebook" });
      providerHandoffInProgress = true;
      await Promise.all([
        page.waitForURL((url) => url.origin === syntheticAuthOrigin && url.pathname === "/auth/v1/authorize"),
        facebook.click(),
      ]);
      const handoff = new URL(page.url());
      if (handoff.searchParams.get("provider") !== "facebook") failures.push("synthetic handoff did not select Facebook");
      if (!handoff.searchParams.get("redirect_to")?.startsWith(`${baseUrl}/auth/callback`)) {
        failures.push("synthetic handoff did not preserve the reviewed same-origin callback");
      }
      const authorizeRequests = syntheticRequests.filter((value) => new URL(value).pathname === "/auth/v1/authorize");
      if (authorizeRequests.length !== 1) failures.push(`expected one synthetic authorize navigation, received ${authorizeRequests.length}`);
      if (expectedHandoffCancellations.length > 32) {
        failures.push(`browser cancelled more provider-handoff prefetches than the bounded navigation inventory allows: ${expectedHandoffCancellations.length}`);
      }
    }

    const forbiddenProviderRequests = externalRequests.filter((value) => /(^|\.)facebook\.com$|(^|\.)fbcdn\.net$|(^|\.)meta\.com$/i.test(new URL(value).hostname));
    if (forbiddenProviderRequests.length) failures.push("a real Meta or Facebook request escaped the synthetic boundary");
    const unexpectedExternalRequests = externalRequests.filter((value) => !isAnalyticsUrl(value));
    if (unexpectedExternalRequests.length) failures.push(`unexpected external requests: ${unexpectedExternalRequests.join(" | ")}`);
    if (failedRequests.length) failures.push(`unexpected failed requests: ${failedRequests.join(" | ")}`);
    if (browserErrors.length) failures.push(`unexpected browser errors: ${browserErrors.join(" | ")}`);
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }

  if (failures.length) {
    throw new Error(`${engineName} ${viewport.name} (${viewport.width}x${viewport.height}) failed:\n- ${failures.join("\n- ")}`);
  }
}

function isExpectedProviderHandoffRequestCancellation(engineName, handoffInProgress, request) {
  if (!handoffInProgress || request.method() !== "GET") return false;
  const url = new URL(request.url());
  const expectedAbort = {
    Chromium: "net::ERR_ABORTED",
    Firefox: "NS_BINDING_ABORTED",
    WebKit: "Load request cancelled",
  }[engineName];
  if (!expectedAbort || request.failure()?.errorText !== expectedAbort || url.origin !== baseUrl) return false;
  const isShellPrefetch = (
    request.resourceType() === "fetch"
    && expectedShellPrefetchPaths.has(url.pathname)
    && url.searchParams.has("_rsc")
  );
  const isNextRouteAsset = (
    url.pathname.startsWith("/_next/static/chunks/")
    && (
      (request.resourceType() === "script" && url.pathname.endsWith(".js"))
      || (request.resourceType() === "stylesheet" && url.pathname.endsWith(".css"))
    )
  );
  return isShellPrefetch || isNextRouteAsset;
}

function isExpectedWebKitHandoffPageError(engineName, handoffInProgress, message) {
  if (engineName !== "WebKit" || !handoffInProgress) return false;
  const host = new URL(baseUrl).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...expectedShellPrefetchPaths].some((path) => {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^(?:Fetch API cannot load )?(?:https?:)?/{1,2}${host}${escapedPath}\\?_rsc=[^\\s]+ due to access control checks\\.?$`).test(message);
  });
}

function reserveLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const socket = createNetServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close(() => reject(new Error("Could not reserve a loopback port.")));
        return;
      }
      socket.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitUntilReady(child, url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before readiness.\n${serverOutput}`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Next.js did not become ready.\n${serverOutput}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function runChild(command, args, options, label, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, options);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stopChild(child);
      reject(new Error(`${label} exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolveRun() : reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

function isAnalyticsUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://va.vercel-scripts.com"
      && ["/v1/script.js", "/v1/script.debug.js", "/v1/speed-insights/script.js", "/v1/speed-insights/script.debug.js"].includes(url.pathname);
  } catch {
    return false;
  }
}

function boundedOutput(current, chunk) {
  return `${current}${String(chunk)}`.slice(-20_000);
}

function isExpectedRouteTeardownError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Request context disposed") || message.includes("Route is already handled");
}
