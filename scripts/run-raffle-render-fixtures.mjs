import { spawn, spawnSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";

const root = process.cwd();
const webRoot = resolve(root, "apps/web");
const nextBin = resolve(webRoot, "node_modules/next/dist/bin/next");
const smokeScript = resolve(root, "scripts/smoke-raffle-render-fixtures.mjs");
const publicSmokeScript = resolve(root, "scripts/smoke-raffle-public.mjs");
const port = await reserveLoopbackPort();
const baseUrl = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  RAFFLE_PUBLIC_RENDER_FIXTURES: "1",
};
let output = "";
let server = null;

try {
  await buildWebForSmoke(environment);
  server = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: webRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  server.stderr.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  await waitUntilReady(server, baseUrl, () => output);
  await runChild(
    process.execPath,
    [smokeScript, "--base-url", baseUrl],
    { cwd: root, env: environment, stdio: "inherit" },
    "rendered raffle fixture smoke",
    12 * 60_000,
  );
} finally {
  await stopChild(server);
}

await verifyProductionFixtureBoundary();

async function buildWebForSmoke(buildEnvironment) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required for rendered raffle fixture verification.");
  await runChild(
    process.execPath,
    [npmCli, "--prefix", webRoot, "run", "build"],
    { cwd: root, env: buildEnvironment, stdio: "inherit" },
    "rendered raffle fixture production build",
    5 * 60_000,
  );
}

async function verifyProductionFixtureBoundary() {
  const productionEnvironment = withoutFixtureEnvironment();
  const productionPort = await reserveLoopbackPort();
  const productionBaseUrl = `http://127.0.0.1:${productionPort}`;
  let productionServer = null;
  let productionOutput = "";

  try {
    await buildWebForSmoke(productionEnvironment);
    productionServer = spawn(
      process.execPath,
      [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(productionPort)],
      { cwd: webRoot, env: productionEnvironment, stdio: ["ignore", "pipe", "pipe"] },
    );
    productionServer.stdout.on("data", (chunk) => { productionOutput = boundedOutput(productionOutput, chunk); });
    productionServer.stderr.on("data", (chunk) => { productionOutput = boundedOutput(productionOutput, chunk); });
    await waitUntilReady(productionServer, productionBaseUrl, () => productionOutput, "/raffle");

    const fixtureResponse = await fetch(`${productionBaseUrl}/raffle-render-fixtures-internal/inactive`, { redirect: "manual" });
    if (fixtureResponse.status !== 404) {
      throw new Error(`Production fixture route did not fail closed (HTTP ${fixtureResponse.status}).`);
    }
    const unavailableRulesResponse = await fetch(`${productionBaseUrl}/raffle/rules/unavailable-version`, { redirect: "manual" });
    if (unavailableRulesResponse.status !== 404) {
      throw new Error(`Unavailable rule-version route did not fail closed (HTTP ${unavailableRulesResponse.status}).`);
    }
    await runChild(
      process.execPath,
      [publicSmokeScript, "--base-url", productionBaseUrl],
      { cwd: root, env: productionEnvironment, stdio: "inherit" },
      "production-mode public raffle smoke",
      12 * 60_000,
    );
    console.log("Production route boundary OK: internal fixtures and unavailable rule versions return HTTP 404.");
  } finally {
    await stopChild(productionServer);
  }
}

function withoutFixtureEnvironment() {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (key.toUpperCase() === "RAFFLE_PUBLIC_RENDER_FIXTURES") delete clean[key];
  }
  return clean;
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

async function waitUntilReady(child, origin, getOutput, readinessPath = "/raffle-render-fixtures-internal/inactive") {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js fixture server exited before readiness.\n${getOutput()}`);
    try {
      const response = await fetch(`${origin}${readinessPath}`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The loopback development server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Next.js fixture server did not become ready.\n${getOutput()}`);
}

function runChild(command, commandArgs, options, label, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, options);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      forceStopChildTree(child);
      reject(new Error(`${label} exceeded ${timeoutMs}ms and was terminated.`));
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`${label} exited with code ${code ?? "none"} and signal ${signal ?? "none"}.`));
    });
  });
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
    forceStopChildTree(child);
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
  ]);
  if (!exited) child.kill("SIGKILL");
}

function forceStopChildTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

function boundedOutput(current, chunk) {
  return `${current}${String(chunk)}`.slice(-8_000);
}
