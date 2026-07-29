const DEFAULT_BASE_URL = "https://mochirii.vercel.app";
const TIMEOUT_MS = 30000;
const retiredGameRoute = `/games/${["mochi", "social"].join("-")}`;
const unknownRoute = "/__mochirii-unknown-route__";

const cleanRoutes = [
  "/",
  "/join",
  "/ranks",
  "/leaders",
  "/tome",
  "/events",
  "/announcements",
  "/raffle",
  "/raffle/rules",
  "/gallery",
  "/spotlight",
  "/spotify",
  "/recruitment",
  "/twills",
  "/privacy",
  "/meta-data-deletion",
  "/auth",
  "/account",
  "/gallery-submit",
  "/leader-dashboard",
  "/games/mochi-pets",
];

const retiredRoutes = [
  "/members",
  "/members/twills",
  retiredGameRoute,
];

const legacyRedirects = new Map([
  ["/index.html", "/"],
  ["/join.html", "/join"],
  ["/ranks.html", "/ranks"],
  ["/leaders.html", "/leaders"],
  ["/events.html", "/events"],
  ["/announcements.html", "/announcements"],
  ["/raffles", "/raffle"],
  ["/raffles.html", "/raffle"],
  ["/gallery.html", "/gallery"],
  ["/spotlight.html", "/spotlight"],
  ["/spotify.html", "/spotify"],
  ["/recruitment.html", "/recruitment"],
  ["/twills.html", "/twills"],
  ["/auth.html", "/auth"],
  ["/account.html", "/account"],
  ["/gallery-submit.html", "/gallery-submit"],
  ["/leader-dashboard.html", "/leader-dashboard"],
]);

const bodyChecks = new Map([
  ["/privacy", /Mōchirīī Privacy Notice|Destination-specific consent/i],
  ["/meta-data-deletion", /Meta Data Deletion Instructions|Mochirii data deletion request/i],
  ["/auth", /Mochirii Login|Sign-in connects your website account|Website Sign-In/i],
  ["/account", /Choose a Sign-In Method|Sign In Required/i],
  ["/gallery-submit", /Login Required|Access Check/i],
  ["/leader-dashboard", /Choose a Sign-In Method|Sign In Required|Access Denied/i],
  ["/games/mochi-pets", /Mochi Pets|tester doorway|fresh Unity project/i],
]);

const requestHeaders = {
  "user-agent": "MochiriiVercelProductionSmoke/1.0",
  accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.6",
};

function parseBaseUrl() {
  const baseArg = process.argv.find((value) => value.startsWith("--base-url="))?.split("=").slice(1).join("=");
  const positionalUrl = process.argv.slice(2).find((value) => /^https?:\/\//i.test(value));
  const raw = baseArg || process.env.BASE_URL || process.env.SMOKE_BASE_URL || positionalUrl || DEFAULT_BASE_URL;
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`BASE_URL must use http or https: ${raw}`);
  }

  return parsed.origin;
}

function urlFor(baseUrl, path) {
  return new URL(path, baseUrl).href;
}

async function request(baseUrl, path, { method = "HEAD", redirect = "follow" } = {}) {
  return fetch(urlFor(baseUrl, path), {
    method,
    redirect,
    headers: requestHeaders,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function checkRoute(baseUrl, path) {
  let response = await request(baseUrl, path);

  if (response.status === 405) {
    response = await request(baseUrl, path, { method: "GET" });
  }

  if (response.status !== 200) {
    throw new Error(`${path} expected HTTP 200, got ${response.status}`);
  }

  console.log(`OK route ${path} 200`);
}

async function checkRetiredRoute(baseUrl, path) {
  let response = await request(baseUrl, path);

  if (response.status === 405) {
    response = await request(baseUrl, path, { method: "GET" });
  }

  if (response.status !== 404) {
    throw new Error(`${path} expected retired route HTTP 404, got ${response.status}`);
  }

  console.log(`OK retired route ${path} 404`);
}

async function checkBrandedNotFound(baseUrl) {
  const response = await request(baseUrl, unknownRoute, { method: "GET" });
  const body = await response.text();

  if (response.status !== 404) {
    throw new Error(`${unknownRoute} expected HTTP 404, got ${response.status}`);
  }

  for (const pattern of [/Page not found/, /Return Home/, /Mōchirīī/]) {
    if (!pattern.test(body)) {
      throw new Error(`${unknownRoute} did not render the branded recovery page`);
    }
  }

  const robotsTags = body.match(/<meta\b[^>]*>/gi) || [];
  const noindex = robotsTags.some((tag) => /name=["']robots["']/i.test(tag) && /content=["'][^"']*\bnoindex\b/i.test(tag));
  if (!noindex) {
    throw new Error(`${unknownRoute} did not render the automatic noindex directive`);
  }

  console.log(`OK branded unknown route ${unknownRoute} 404`);
}

async function checkRedirect(baseUrl, from, expectedPath) {
  const first = await request(baseUrl, from, { redirect: "manual" });
  const followed = await request(baseUrl, from, { redirect: "follow" });
  const finalPath = new URL(followed.url).pathname;

  if (![301, 302, 307, 308].includes(first.status)) {
    throw new Error(`${from} expected redirect, got HTTP ${first.status}`);
  }

  if (followed.status !== 200 || finalPath !== expectedPath) {
    throw new Error(`${from} expected final ${expectedPath} 200, got ${finalPath} ${followed.status}`);
  }

  console.log(`OK redirect ${from} ${first.status} -> ${expectedPath}`);
}

async function checkBody(baseUrl, path, pattern) {
  const response = await request(baseUrl, path, { method: "GET" });
  const body = await response.text();

  if (response.status !== 200) {
    throw new Error(`${path} body check expected HTTP 200, got ${response.status}`);
  }

  if (/Invalid supabaseUrl/i.test(body)) {
    throw new Error(`${path} rendered Invalid supabaseUrl`);
  }

  if (!pattern.test(body)) {
    throw new Error(`${path} did not render expected signed-out/access content`);
  }

  console.log(`OK content ${path}`);
}

try {
  const baseUrl = parseBaseUrl();
  console.log(`Smoke base: ${baseUrl}`);

  for (const route of cleanRoutes) {
    await checkRoute(baseUrl, route);
  }

  for (const route of retiredRoutes) {
    await checkRetiredRoute(baseUrl, route);
  }

  await checkBrandedNotFound(baseUrl);

  for (const [from, expectedPath] of legacyRedirects) {
    await checkRedirect(baseUrl, from, expectedPath);
  }

  for (const [path, pattern] of bodyChecks) {
    await checkBody(baseUrl, path, pattern);
  }

  console.log("Vercel production smoke check OK.");
} catch (error) {
  console.error(`Vercel production smoke check failed: ${error?.message || error}`);
  process.exit(1);
}
