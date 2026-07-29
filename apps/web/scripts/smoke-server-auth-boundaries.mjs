import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.MOCHIRII_AUTH_SMOKE_PORT || 4305);
const origin = `http://127.0.0.1:${port}`;
const requestDeadlineMs = 15_000;
const output = [];
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-public-test-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output.push(String(chunk));
    if (output.join("").length > 16_000) output.shift();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      const response = await boundedFetch(origin, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Next server did not become ready.\n${output.join("")}`);
}

function boundedFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(requestDeadlineMs),
  });
}

async function assertRedirect(path, expectedLocation, forbiddenCopy) {
  const response = await boundedFetch(`${origin}${path}`, { redirect: "manual" });
  const body = await response.text();
  assert.ok([303, 307, 308].includes(response.status), `${path} returned ${response.status}`);
  assert.equal(new URL(String(response.headers.get("location")), origin).pathname + new URL(String(response.headers.get("location")), origin).search, expectedLocation);
  assert.doesNotMatch(body, forbiddenCopy);
  if (path.startsWith("/leader-dashboard") || path.startsWith("/oauth/consent")) {
    assertProtectedHeaders(response);
  }
}

function assertProtectedHeaders(response) {
  const policy = String(response.headers.get("content-security-policy") || "");
  const scriptDirective = policy.split("; ").find((directive) => directive.startsWith("script-src ")) || "";
  assert.match(scriptDirective, /'nonce-[A-Fa-f0-9]{32}'/);
  assert.match(scriptDirective, /'strict-dynamic'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/);
  assert.match(String(response.headers.get("cache-control") || ""), /\bno-store\b/);
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.local-signature`;
}

function authCookie(accessToken) {
  const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
  const session = {
    access_token: accessToken,
    refresh_token: "local-refresh-token",
    expires_at: expiresAt,
    expires_in: 3_600,
    token_type: "bearer",
  };
  return `sb-example-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

async function assertCookieRedirect(path, expectedLocation, forbiddenCopy, cookie) {
  const response = await boundedFetch(`${origin}${path}`, {
    redirect: "manual",
    headers: { Cookie: cookie },
  });
  const body = await response.text();
  assert.ok([303, 307, 308].includes(response.status), `${path} returned ${response.status}`);
  const location = new URL(String(response.headers.get("location")), origin);
  assert.equal(location.pathname + location.search, expectedLocation);
  assert.doesNotMatch(body, forbiddenCopy);
}

async function assertAuthUnavailable(path, forbiddenCopy, cookie) {
  const response = await boundedFetch(`${origin}${path}`, {
    redirect: "manual",
    headers: { Cookie: cookie },
  });
  const body = await response.text();
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  assert.equal(response.headers.get("location"), null, `${path} must not redirect an outage to login`);
  assertProtectedHeaders(response);
  assert.match(body, /This guild page is temporarily unavailable/);
  assert.doesNotMatch(body, forbiddenCopy);
  assert.doesNotMatch(body, /AuthRetryableFetchError|example\.invalid|local-refresh-token/);
}

try {
  await waitForServer();
  await assertRedirect(
    "/leader-dashboard",
    "/auth?redirect=%2Fleader-dashboard",
    /Review member image uploads, inspect context/,
  );
  await assertRedirect(
    "/oauth/consent?authorization_id=request_123",
    "/auth?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Drequest_123",
    /Review the requested guild social access before continuing/,
  );
  await assertRedirect(
    "/auth/callback?next=%2Fleader-dashboard",
    "/auth?redirect=%2Fleader-dashboard&error=sign_in_failed",
    /Review member image uploads, inspect context/,
  );
  await assertCookieRedirect(
    "/leader-dashboard",
    "/auth?redirect=%2Fleader-dashboard",
    /Review member image uploads, inspect context/,
    authCookie("not-a-jwt"),
  );
  const upstreamCookie = authCookie(jwt({
    sub: "local-member",
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    role: "authenticated",
  }));
  await assertAuthUnavailable(
    "/leader-dashboard",
    /Review member image uploads, inspect context/,
    upstreamCookie,
  );
  await assertAuthUnavailable(
    "/oauth/consent?authorization_id=request_123",
    /Review the requested guild social access before continuing/,
    upstreamCookie,
  );
  console.log("Server authentication boundary smoke passed.");
} finally {
  server.kill();
}
