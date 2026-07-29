import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  applySetCookieChanges,
  hasNonemptyAuthTokenCookie,
  parseSetCookieChange,
} from "./raffle-auth-preview-cookies.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const privateEvidenceRoot = path.join(repositoryRoot, ".artifacts", "operations");
const fixturePath = String(process.env.MOCHIRII_RAFFLE_PREVIEW_AUTH_FIXTURE || "").trim();
const previewOriginValue = String(process.env.MOCHIRII_RAFFLE_PREVIEW_BASE_URL || "").trim();

function fail(message) {
  console.error(`Raffle auth Preview smoke failed: ${message}`);
  process.exit(1);
}

function reviewedOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function cookiePairs(header) {
  if (!header || header.length > 16_384 || /[\r\n\u0000]/.test(header)) return null;
  const pairs = new Map();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) return null;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !value) return null;
    pairs.set(name, value);
  }
  return pairs;
}

function responseCookieChanges(response) {
  const headers = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const changes = [];
  for (const header of headers) {
    const parsed = parseSetCookieChange(String(header));
    if (!parsed) fail("the callback returned a malformed session cookie");
    changes.push(parsed);
  }
  return changes;
}

const previewOrigin = reviewedOrigin(previewOriginValue);
if (!previewOrigin) fail("set a reviewed HTTPS Preview base URL");
if (
  !path.isAbsolute(fixturePath)
  || !existsSync(fixturePath)
  || !lstatSync(fixturePath).isFile()
  || lstatSync(fixturePath).isSymbolicLink()
) {
  fail("set an absolute, regular ignored fixture path");
}
const realFixture = realpathSync(fixturePath);
let realEvidenceRoot;
try {
  realEvidenceRoot = realpathSync(privateEvidenceRoot);
} catch {
  fail("the ignored .artifacts/operations boundary is unavailable");
}
if (!realFixture.startsWith(`${realEvidenceRoot}${path.sep}`) || lstatSync(realFixture).size > 16_384) {
  fail("the fixture must be a bounded file inside .artifacts/operations");
}

let fixture;
try {
  fixture = JSON.parse(readFileSync(realFixture, "utf8"));
} catch {
  fail("the private fixture is not valid JSON");
}
if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) fail("the private fixture must be an object");
if (Object.keys(fixture).some((key) => key !== "callbackUrl" && key !== "cookieHeader")) {
  fail("the private fixture contains an unsupported field");
}

let callbackUrl;
try {
  callbackUrl = new URL(String(fixture.callbackUrl || ""));
} catch {
  fail("the callback URL is invalid");
}
if (callbackUrl.origin !== previewOrigin || callbackUrl.pathname !== "/auth/callback" || callbackUrl.hash) {
  fail("the callback URL does not match the reviewed Preview callback");
}
const callbackKeys = [...callbackUrl.searchParams.keys()];
const codes = callbackUrl.searchParams.getAll("code");
const destinations = callbackUrl.searchParams.getAll("next");
if (
  callbackKeys.some((key) => key !== "code" && key !== "next")
  || codes.length !== 1
  || !codes[0]
  || codes[0].length > 4_096
  || destinations.length !== 1
  || destinations[0] !== "/raffle/claim"
) fail("the callback query is not the reviewed claim handoff");

const incomingCookies = cookiePairs(String(fixture.cookieHeader || ""));
if (!incomingCookies || ![...incomingCookies.keys()].some((name) => name.endsWith("-code-verifier"))) {
  fail("the private fixture is missing its PKCE verifier cookie");
}
if ([...incomingCookies.keys()].some((name) => /auth-token(?:\.|$)/.test(name))) {
  fail("the callback fixture must not contain an existing auth session");
}

let callbackResponse;
try {
  callbackResponse = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { Cookie: [...incomingCookies].map(([name, value]) => `${name}=${value}`).join("; ") },
  });
} catch {
  fail("the callback request could not be completed");
}
if (callbackResponse.status !== 303) fail("the callback did not return the reviewed redirect status");
const cacheControl = callbackResponse.headers.get("cache-control") || "";
if (!/\bno-store\b/i.test(cacheControl)) fail("the callback response is cacheable");

let destination;
try {
  destination = new URL(callbackResponse.headers.get("location") || "", previewOrigin);
} catch {
  fail("the callback returned an invalid destination");
}
if (destination.origin !== previewOrigin || destination.pathname !== "/raffle/claim" || destination.search || destination.hash) {
  fail("the callback did not return the reviewed claim destination");
}

const sessionCookieChanges = responseCookieChanges(callbackResponse);
if (!sessionCookieChanges.some(({ name, value, deletion }) => (
  /auth-token(?:\.|$)/.test(name) && Boolean(value) && !deletion
))) {
  fail("the callback did not set a cookie-backed auth session");
}
applySetCookieChanges(incomingCookies, sessionCookieChanges);
if (!hasNonemptyAuthTokenCookie(incomingCookies)) {
  fail("the callback did not leave a usable cookie-backed auth session");
}

let protectedResponse;
try {
  protectedResponse = await fetch(destination, {
    redirect: "manual",
    headers: { Cookie: [...incomingCookies].map(([name, value]) => `${name}=${value}`).join("; ") },
  });
} catch {
  fail("the protected follow-up request could not be completed");
}
if (protectedResponse.status !== 200) fail("the new session did not reach the verified-member claim boundary");
if (!/\bno-store\b/i.test(protectedResponse.headers.get("cache-control") || "")) {
  fail("the protected claim response is cacheable");
}
if (!/\bnoindex\b/i.test(protectedResponse.headers.get("x-robots-tag") || "")) {
  fail("the protected claim response is indexable");
}
if ((protectedResponse.headers.get("referrer-policy") || "").toLowerCase() !== "no-referrer") {
  fail("the protected claim response permits referrers");
}

console.log("Raffle auth Preview smoke passed without recording callback, cookie, or member data.");
