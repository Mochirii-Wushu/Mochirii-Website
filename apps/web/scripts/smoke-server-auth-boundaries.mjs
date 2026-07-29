import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.MOCHIRII_AUTH_SMOKE_PORT || 4305);
const origin = `http://127.0.0.1:${port}`;
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
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Next server did not become ready.\n${output.join("")}`);
}

async function assertRedirect(path, expectedLocation, forbiddenCopy) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual" });
  const body = await response.text();
  assert.ok([303, 307, 308].includes(response.status), `${path} returned ${response.status}`);
  assert.equal(new URL(String(response.headers.get("location")), origin).pathname + new URL(String(response.headers.get("location")), origin).search, expectedLocation);
  assert.doesNotMatch(body, forbiddenCopy);
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
    "/auth?error=session",
    /Review member image uploads, inspect context/,
  );
  console.log("Server authentication boundary smoke passed.");
} finally {
  server.kill();
}
