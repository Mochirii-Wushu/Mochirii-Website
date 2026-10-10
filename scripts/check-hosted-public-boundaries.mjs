import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SITE_ORIGIN,
  SOCIAL_HOST,
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_PROJECT_URL,
} from "./lib/public-urls.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/integrations/hosted-runtime.json"), "utf8"));
const TIMEOUT_MS = 20_000;
const OVERALL_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;
const requestHeaders = {
  "User-Agent": "MochiriiHostedBoundaryCheck/2.0",
  Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
};

const storefrontOrigin = runtimeOrigin("storefront");
const discordOrigin = runtimeOrigin("discord-interactions", "discord.com");
const serviceChecks = ["social", "forums"].map((id) => {
  const runtime = manifest.runtimes?.find((entry) => entry.id === id);
  const origin = runtimeOrigin(id);
  if (runtime?.continuity === "provider_managed_static_maintenance") return {
    label: `Mōchirīī ${id} maintenance shell`, url: `${origin}/`, statuses: [200], redirect: "error",
    validate: (result) => expectMaintenance(result, origin, id === "social" ? "Social" : "Forums"),
  };
  if (id === "social" && runtime?.continuity === "droplet_supervised_containers") return {
    label: "Mōchirīī Social instance", url: `${SOCIAL_HOST}/api/v1/instance`, statuses: [200],
    validate: (result) => expectJson(result, (body) => body?.uri === "social.mochirii.com" && body?.title === "Mōchirīī Social"),
  };
  throw new Error(`${id}: hosted boundary mode needs an explicit reviewed contract`);
});
const checks = [
  {
    label: "Website home",
    url: `${SITE_ORIGIN}/`,
    statuses: [200],
    validate: (result) => expectHtml(result, /Mochirii/i),
  },
  {
    label: "Website gallery",
    url: `${SITE_ORIGIN}/gallery`,
    statuses: [200],
    validate: (result) => expectHtml(result, /Mochirii/i),
  },
  ...serviceChecks,
  {
    label: "Storefront password boundary",
    url: `${storefrontOrigin}/`,
    statuses: [200],
    finalPath: "/password",
    validate: (result) => expectHtml(result, /Mochirii Cosmetics/i),
  },
  {
    label: "Supabase Auth unsigned boundary",
    url: `${SUPABASE_PROJECT_URL}/auth/v1/health`,
    statuses: [401],
    validate: (result) => expectJson(result, (body) => body && typeof body === "object"),
  },
  {
    label: "Reaper interactions unsigned boundary",
    url: `${SUPABASE_FUNCTIONS_URL}/reaper-discord-interactions`,
    method: "POST",
    body: { type: 1 },
    statuses: [401],
    validate: expectUnauthorizedBoundary,
  },
  {
    label: "Member access unsigned boundary",
    url: `${SUPABASE_FUNCTIONS_URL}/verify-member-access`,
    method: "POST",
    body: {},
    statuses: [401],
    validate: (result) => expectJson(result, (body) => body && typeof body === "object"),
  },
  {
    label: "Discord API gateway",
    url: `${discordOrigin}/api/v10/gateway`,
    statuses: [200],
    validate: (result) => expectJson(result, (body) => body?.url === "wss://gateway.discord.gg"),
  },
];

const overallController = new AbortController();
const overallTimer = setTimeout(() => overallController.abort(new Error("overall hosted-boundary timeout")), OVERALL_TIMEOUT_MS);
overallTimer.unref?.();

const results = await Promise.all(checks.map((check) => runCheck(check, overallController.signal)));
clearTimeout(overallTimer);

const failures = results.filter((result) => result.failure).map((result) => result.failure);
for (const result of results) {
  if (!result.failure) console.log(`OK ${result.label}: HTTP ${result.status}`);
}

if (failures.length) {
  console.error("Hosted public boundary check failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Hosted public boundary check OK (${checks.length} checks).`);

async function runCheck(check, overallSignal) {
  try {
    const result = await fetchWithRetry(check, overallSignal);
    if (!check.statuses.includes(result.status)) {
      throw new Error(`returned HTTP ${result.status}; expected ${check.statuses.join("/")}`);
    }
    if (check.finalPath && new URL(result.url).pathname !== check.finalPath) {
      throw new Error(`ended at ${new URL(result.url).pathname}; expected ${check.finalPath}`);
    }
    check.validate?.(result);
    return { label: check.label, status: result.status };
  } catch (error) {
    return { label: check.label, failure: `${check.label}: ${error.message}` };
  }
}

async function fetchWithRetry(check, overallSignal) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(check.url, {
        method: check.method || "GET",
        headers: {
          ...requestHeaders,
          ...(check.body ? { "Content-Type": "application/json" } : {}),
        },
        body: check.body ? JSON.stringify(check.body) : undefined,
        redirect: check.redirect || "follow",
        signal: AbortSignal.any([overallSignal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      const body = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await delay(retryDelay(response.headers.get("retry-after"), attempt), overallSignal);
        continue;
      }
      return {
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type") || "",
        headers: response.headers,
        body,
      };
    } catch (error) {
      lastError = error;
      if (overallSignal.aborted || attempt === MAX_ATTEMPTS) break;
      await delay(Math.min(500 * attempt, MAX_RETRY_DELAY_MS), overallSignal);
    }
  }
  throw lastError || new Error("request did not complete");
}

function expectHtml(result, requiredText) {
  if (!result.contentType.toLowerCase().includes("text/html")) {
    throw new Error("did not return HTML content");
  }
  if (!/^\s*<!doctype html/i.test(result.body) || !requiredText.test(result.body)) {
    throw new Error("HTML response did not match the Mochirii surface contract");
  }
}

function expectMaintenance(result, origin, surface) {
  expectHtml(result, /Coming Soon/i);
  const csp = result.headers?.get("content-security-policy") || "";
  const directives = new Map();
  for (const value of csp.split(";")) {
    const [rawName, ...values] = value.trim().split(/\s+/);
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (directives.has(name)) throw new Error("maintenance shell has duplicate CSP directives");
    directives.set(name, values.join(" "));
  }
  if (result.status !== 200 || result.url !== `${origin}/` ||
    !result.body.includes(`<title>${surface} · Coming Soon · Mōchirīī</title>`) ||
    (result.body.match(/<header\b/gi) || []).length !== 1 || (result.body.match(/<footer\b/gi) || []).length !== 1 ||
    !result.body.includes('aria-label="Primary"') || !result.body.includes('href="https://mochirii.com/events"') ||
    !result.body.includes('href="https://mochirii.com/privacy"') ||
    /<(?:script|iframe|form)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(result.body) ||
    /<meta\b[^>]*\bhttp-equiv\s*=/i.test(result.body) ||
    result.headers?.has("refresh") ||
    ["default-src", "base-uri", "form-action", "frame-ancestors"].some((name) => directives.get(name) !== "'none'") ||
    (directives.has("script-src") && directives.get("script-src") !== "'none'") ||
    result.headers?.get("x-frame-options") !== "DENY" || result.headers?.get("x-content-type-options") !== "nosniff" ||
    result.headers?.get("referrer-policy") !== "no-referrer") {
    throw new Error("maintenance shell did not match its static content, shared navigation or security contract");
  }
}

function expectJson(result, predicate) {
  if (!result.contentType.toLowerCase().includes("application/json")) {
    throw new Error("did not return JSON content");
  }
  let body;
  try {
    body = JSON.parse(result.body);
  } catch {
    throw new Error("returned malformed JSON");
  }
  if (!predicate(body)) throw new Error("JSON response did not match the hosted boundary contract");
}

function expectUnauthorizedBoundary(result) {
  if (result.contentType.toLowerCase().includes("application/json")) {
    expectJson(result, (body) => body && typeof body === "object");
    return;
  }
  if (!result.contentType.toLowerCase().includes("text/plain") || !result.body.trim()) {
    throw new Error("unauthorized boundary did not return a nonempty safe response");
  }
}

function runtimeOrigin(id, hostname) {
  const runtime = manifest.runtimes?.find((entry) => entry.id === id);
  const origins = runtime?.public_origins || [];
  const value = hostname
    ? origins.find((origin) => new URL(origin).hostname === hostname)
    : origins[0];
  if (!value) throw new Error(`hosted runtime manifest is missing ${id} origin`);
  return value.replace(/\/$/, "");
}

function retryDelay(value, attempt) {
  if (!value) return Math.min(500 * attempt, MAX_RETRY_DELAY_MS);
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), MAX_RETRY_DELAY_MS);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
  return Math.min(500 * attempt, MAX_RETRY_DELAY_MS);
}

function delay(milliseconds, signal) {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal.aborted) {
      rejectDelay(signal.reason || new Error("request aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(signal.reason || new Error("request aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveDelay();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
