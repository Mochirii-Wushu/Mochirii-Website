import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const verifier = resolve("scripts/gallery-lighthouse-local-fixture.mjs");
const origin = "http://127.0.0.1:8765";

function report(
  pathname,
  requestUrls = [`${origin}${pathname}`],
  { consoleItems = [], statusCode = 200 } = {},
) {
  return {
    requestedUrl: `${origin}${pathname}`,
    finalDisplayedUrl: `${origin}${pathname}`,
    audits: {
      "network-requests": {
        details: { items: requestUrls.map((url) => ({ statusCode, url })) },
      },
      "errors-in-console": {
        details: { items: consoleItems },
      },
    },
  };
}

function writeEvidence(
  directory,
  {
    galleryConsoleItems,
    galleryStatusCode,
    galleryUrls,
    logRow,
    malformedHome = false,
  } = {},
) {
  const log = join(directory, "fixture.jsonl");
  const home = join(directory, "home.json");
  const recruitment = join(directory, "recruitment.json");
  const gallery = join(directory, "gallery.json");
  writeFileSync(
    log,
    `${
      JSON.stringify(
        logRow || {
          method: "POST",
          path: "/__mochirii_gallery_lighthouse_fixture",
          status: 200,
        },
      )
    }\n`,
  );
  writeFileSync(home, JSON.stringify(malformedHome ? {} : report("/")));
  writeFileSync(recruitment, JSON.stringify(report("/recruitment")));
  writeFileSync(
    gallery,
    JSON.stringify(report("/gallery", galleryUrls, {
      consoleItems: galleryConsoleItems,
      statusCode: galleryStatusCode,
    })),
  );
  return [log, home, recruitment, gallery];
}

function verify(paths) {
  return execFileSync(process.execPath, [verifier, "verify", ...paths], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Audit proxy exited before becoming ready.");
    try {
      const response = await fetch(url);
      if (response.status === 204) return;
    } catch {
      // The child may still be binding its loopback listener.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("Audit proxy did not become ready.");
}

function validListBody() {
  return {
    action: "list",
    category: null,
    cursor: null,
    pageSize: 24,
    query: null,
    sort: "newest",
  };
}

test("local Lighthouse evidence accepts only the three exact loopback routes", () => {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-gallery-lighthouse-"));
  try {
    assert.match(
      verify(writeEvidence(directory)),
      /zero hosted\/provider HTTP requests/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local Lighthouse evidence rejects provider traffic and malformed reports", () => {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-gallery-lighthouse-"));
  try {
    assert.throws(
      () =>
        verify(writeEvidence(directory, {
          galleryUrls: [
            `${origin}/gallery`,
            "https://project.supabase.co/functions/v1/list-approved-gallery-submissions",
          ],
        })),
      /Command failed/,
    );
    assert.throws(
      () => verify(writeEvidence(directory, { malformedHome: true })),
      /Command failed/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local Lighthouse evidence rejects unexpected fixture requests", () => {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-gallery-lighthouse-"));
  try {
    assert.throws(
      () =>
        verify(writeEvidence(directory, {
          logRow: { method: "GET", path: "/unexpected", status: 404 },
        })),
      /Command failed/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local Lighthouse evidence rejects failed requests and console errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-gallery-lighthouse-"));
  try {
    assert.throws(
      () => verify(writeEvidence(directory, { galleryStatusCode: 404 })),
      /Command failed/,
    );
    assert.throws(
      () =>
        verify(writeEvidence(directory, {
          galleryConsoleItems: [{ description: "fixture error" }],
        })),
      /Command failed/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the local audit proxy injects its interceptor without changing built assets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mochirii-gallery-lighthouse-"));
  const log = join(directory, "fixture.jsonl");
  writeFileSync(log, "");
  const upstream = createServer((request, response) => {
    if (request.url === "/asset.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end("globalThis.__unchangedAsset=true;");
      return;
    }
    response.writeHead(200, {
      "Content-Security-Policy": "script-src 'self' 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end("<!doctype html><html><head><title>Audit</title></head><body>Gallery</body></html>");
  });
  let child;
  try {
    const upstreamPort = await listen(upstream);
    const proxyPort = await reservePort();
    child = spawn(process.execPath, [
      verifier,
      "serve",
      log,
      `http://127.0.0.1:${upstreamPort}`,
      String(proxyPort),
    ], { stdio: "pipe" });
    await waitForHealth(`http://127.0.0.1:${proxyPort}/healthz`, child);

    const pageResponse = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /data-mochirii-gallery-audit-interceptor/);
    assert.match(page, /\/__mochirii_gallery_lighthouse_fixture/);

    const assetResponse = await fetch(`http://127.0.0.1:${proxyPort}/asset.js`);
    assert.equal(await assetResponse.text(), "globalThis.__unchangedAsset=true;");

    const fixtureResponse = await fetch(
      `http://127.0.0.1:${proxyPort}/__mochirii_gallery_lighthouse_fixture`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validListBody()),
      },
    );
    const fixture = await fixtureResponse.json();
    assert.equal(fixtureResponse.status, 200);
    assert.equal(fixture.ok, true);
    assert.equal(fixture.data.count, 0);
    assert.match(
      readFileSync(log, "utf8"),
      /"path":"\/__mochirii_gallery_lighthouse_fixture","status":200/,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
    if (upstream.listening) await close(upstream);
    rmSync(directory, { recursive: true, force: true });
  }
});
