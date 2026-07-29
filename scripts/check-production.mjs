import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const BASE_URL = (process.env.MOCHIRII_PRODUCTION_BASE_URL || SITE_ORIGIN).replace(/\/+$/, "");
const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
const DIAGNOSE = process.argv.includes("--diagnose");

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MochiriiProductionSmoke/1.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const DIAGNOSTIC_HEADERS = [
  "content-type",
  "date",
  "server",
  "cache-control",
  "cf-cache-status",
  "cf-ray",
  "x-cache",
  "x-github-request-id",
  "x-served-by",
];

const pageUrls = [
  "/",
  "/gallery",
  "/recruitment",
  "/join",
  "/events",
  "/privacy",
  "/meta-data-deletion",
  "/robots.txt",
  "/sitemap.xml",
];

function absoluteUrl(path) {
  return new URL(path, BASE_URL).href;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectedHeaders(response) {
  const headers = {};
  for (const name of DIAGNOSTIC_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function bodySnippet(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

class ProductionHttpError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ProductionHttpError";
    this.details = details;
  }
}

async function fetchProduction(input) {
  const url = input.startsWith("http") ? input : absoluteUrl(input);
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (DIAGNOSE) {
        console.log(`${response.ok ? "OK" : "WARN"} ${response.status} ${response.url}`);
      }

      if (response.ok) return response;

      const text = await response.text().catch(() => "");
      lastError = new ProductionHttpError(`${url} returned HTTP ${response.status}`, {
        url,
        finalUrl: response.url,
        status: response.status,
        headers: selectedHeaders(response),
        bodySnippet: bodySnippet(text),
      });
    } catch (error) {
      lastError = error;
      if (DIAGNOSE) {
        console.log(`WARN ${url} attempt ${attempt} failed: ${error?.message || error}`);
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await wait(500 * attempt);
    }
  }

  throw lastError;
}

async function fetchText(path) {
  const response = await fetchProduction(path);

  return {
    url: response.url,
    contentType: response.headers.get("content-type") || "",
    text: await response.text(),
  };
}

function assertIncludes(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`Missing ${label}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMetaContent(html, selector) {
  const match = html.match(selector);
  return match?.[1] || "";
}

async function checkUrlAvailability() {
  for (const path of pageUrls) {
    const result = await fetchText(path);
    if (path.endsWith(".html") || path === "/") {
      assertIncludes(result.contentType, /text\/html/i, `${path} HTML content type`);
    }
    if (path.endsWith(".xml")) {
      assertIncludes(result.contentType, /xml/i, `${path} XML content type`);
    }
    if (path.endsWith(".txt")) {
      assertIncludes(result.contentType, /text\/plain/i, `${path} text content type`);
    }
  }
}

async function checkMetadata() {
  const home = await fetchText("/");
  assertIncludes(home.text, /<title>[^<]*Where Winds Meet/i, "homepage title");
  assertIncludes(home.text, /<meta\s+name="description"\s+content="[^"]+"/i, "homepage description");
  assertIncludes(home.text, new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(BASE_URL)}/?"`, "i"), "homepage canonical");
  assertIncludes(home.text, /property="og:title"/i, "homepage OG title");
  assertIncludes(home.text, /property="og:image"/i, "homepage OG image");

  const ogImage = extractMetaContent(home.text, /property="og:image"\s+content="([^"]+)"/i);
  if (!ogImage) throw new Error("Homepage OG image URL was not found");

  const ogResponse = await fetchProduction(ogImage);
  const ogContentType = ogResponse.headers.get("content-type") || "";
  assertIncludes(ogContentType, /^image\//i, "homepage OG image content type");

  const recruitment = await fetchText("/recruitment");
  assertIncludes(recruitment.text, /Recruitment/i, "recruitment page content");
  assertIncludes(
    recruitment.text,
    new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(BASE_URL)}/recruitment"`, "i"),
    "recruitment canonical"
  );

  const privacy = await fetchText("/privacy");
  assertIncludes(privacy.text, /Mōchirīī Privacy Notice/i, "privacy page content");
  assertIncludes(
    privacy.text,
    new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(BASE_URL)}/privacy"`, "i"),
    "privacy canonical"
  );

  const deletion = await fetchText("/meta-data-deletion");
  assertIncludes(deletion.text, /Meta Data Deletion Instructions/i, "Meta data deletion page content");
  assertIncludes(
    deletion.text,
    new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(BASE_URL)}/meta-data-deletion"`, "i"),
    "Meta data deletion canonical"
  );
}

async function checkDiscoveryFiles() {
  const sitemap = await fetchText("/sitemap.xml");
  assertIncludes(sitemap.text, /<urlset[\s>]/i, "sitemap urlset");
  assertIncludes(sitemap.text, new RegExp(`${escapeRegExp(BASE_URL)}/gallery`, "i"), "gallery sitemap entry");
  assertIncludes(sitemap.text, new RegExp(`${escapeRegExp(BASE_URL)}/privacy`, "i"), "privacy sitemap entry");
  assertIncludes(sitemap.text, new RegExp(`${escapeRegExp(BASE_URL)}/meta-data-deletion`, "i"), "Meta data deletion sitemap entry");

  const robots = await fetchText("/robots.txt");
  assertIncludes(robots.text, new RegExp(`Sitemap:\\s*${escapeRegExp(BASE_URL)}/sitemap\\.xml`, "i"), "robots sitemap entry");
}

function printFailure(error) {
  console.error(`Production smoke check failed: ${error?.message || error}`);

  if (error?.name !== "ProductionHttpError") return;

  const details = error.details || {};
  console.error(`Status: ${details.status ?? "unknown"}`);
  console.error(`Requested URL: ${details.url ?? "unknown"}`);
  console.error(`Final URL: ${details.finalUrl ?? "unknown"}`);
  console.error(`Selected headers: ${JSON.stringify(details.headers || {}, null, 2)}`);
  if (details.bodySnippet) console.error(`Body snippet: ${details.bodySnippet}`);
  if (details.status === 403) {
    console.error(
      "HTTP 403 can mean GitHub Actions runner traffic is blocked or challenged even when local production checks pass."
    );
  }
}

try {
  await checkUrlAvailability();
  await checkMetadata();
  await checkDiscoveryFiles();
  console.log("Production smoke check OK.");
} catch (error) {
  printFailure(error);
  process.exit(1);
}
