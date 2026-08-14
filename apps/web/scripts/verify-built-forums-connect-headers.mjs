import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = resolve(appRoot, "node_modules/next/dist/bin/next");
const port = 4789;
const expectedHeaders = new Map([
  ["cache-control", "private, no-store, max-age=0"],
  ["referrer-policy", "no-referrer"],
  ["x-robots-tag", "noindex, nofollow, noarchive, nosnippet, noimageindex"],
]);

const server = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: appRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let output = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    if (output.length < 16_384) output += chunk;
  });
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill();
  await Promise.race([once(server, "exit"), delay(5_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

try {
  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      response = await fetch(
        `http://127.0.0.1:${port}/forums/connect?sso=bm9uY2U9c3ludGhldGlj&sig=${"a".repeat(64)}`,
        { method: "HEAD", cache: "no-store", redirect: "manual" },
      );
      break;
    } catch {
      await delay(250);
    }
  }

  if (!response) {
    throw new Error(`The built app did not become ready.\n${output.trim()}`);
  }
  if (response.status !== 200) {
    throw new Error(`The built Forums connection page returned HTTP ${response.status}.`);
  }
  for (const [name, expected] of expectedHeaders) {
    const actual = response.headers.get(name);
    if (actual !== expected) {
      throw new Error(`The built Forums connection page returned an unexpected ${name} header.`);
    }
  }

  console.log("Built Forums connection page private response headers verified.");
} finally {
  await stopServer();
}
