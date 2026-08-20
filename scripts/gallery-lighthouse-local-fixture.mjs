import { appendFileSync, readFileSync } from "node:fs";
import { createServer, request as requestHttp } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const defaultAppPort = 8765;
const defaultUpstreamOrigin = "http://127.0.0.1:8766";
const feedPath = "/functions/v1/list-approved-gallery-submissions";
const fixturePath = "/__mochirii_gallery_lighthouse_fixture";
const analyticsScriptPaths = new Set([
  "/_vercel/insights/script.js",
  "/_vercel/speed-insights/script.js",
]);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicUrls = JSON.parse(
  readFileSync(resolve(repositoryRoot, "apps/web/config/public-urls.json"), "utf8"),
);
const projectRef = String(publicUrls.supabaseProjectRef || "").trim().toLowerCase();
if (!/^[a-z0-9]{20}$/u.test(projectRef)) {
  throw new Error("The public Supabase project reference is invalid.");
}
const publicFeedUrl = `https://${projectRef}.supabase.co${feedPath}`;
const mode = process.argv[2];

if (mode === "serve") {
  const logPath = requiredPath(process.argv[3], "fixture request log");
  const upstreamOrigin = exactLoopbackOrigin(
    process.argv[4] || defaultUpstreamOrigin,
    "upstream origin",
  );
  const appPort = exactPort(process.argv[5] || defaultAppPort, "listen port");
  const interceptor = galleryFetchInterceptor();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${host}:${appPort}`);
    if (request.method === "GET" && url.pathname === "/healthz" && !url.search) {
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    if (
      request.method === "GET" && analyticsScriptPaths.has(url.pathname) &&
      !url.search
    ) {
      logRequest(logPath, request.method, url.pathname, 200);
      respond(response, 200, "void 0;", "application/javascript; charset=utf-8");
      return;
    }

    if (url.pathname === fixturePath && !url.search) {
      let status = 404;
      let body = JSON.stringify({ ok: false });
      if (request.method === "POST") {
        const requestBody = await readBoundedBody(request, 4096);
        if (parseListRequest(requestBody)) {
          status = 200;
          body = galleryFixtureBody();
        } else {
          status = 400;
        }
      }
      logRequest(logPath, request.method || "", url.pathname, status);
      respond(response, status, body, "application/json; charset=utf-8");
      return;
    }

    proxyToNext(request, response, upstreamOrigin, interceptor);
  });

  server.listen(appPort, host, () => {
    process.stdout.write(
      `Gallery Lighthouse audit proxy listening on ${host}:${appPort}.\n`,
    );
  });
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
} else if (mode === "verify") {
  const logPath = requiredPath(process.argv[3], "fixture request log");
  const reportPaths = process.argv.slice(4).map((value) =>
    requiredPath(value, "Lighthouse report")
  );
  if (reportPaths.length !== 3) {
    throw new Error(
      "Expected Home, Recruitment, and Gallery Lighthouse reports.",
    );
  }

  const fixtureRows = readLines(logPath).map(parseJsonRecord);
  if (
    !fixtureRows.some((row) =>
      row.method === "POST" && row.path === fixturePath && row.status === 200
    )
  ) {
    throw new Error(
      "The local Gallery audit never reached the deterministic interceptor.",
    );
  }
  if (fixtureRows.some((row) => !isExpectedFixtureRow(row))) {
    throw new Error(
      "The local Gallery audit proxy received an unexpected intercepted request.",
    );
  }

  const allowedOrigin = `http://${host}:${defaultAppPort}`;
  const expectedPaths = ["/", "/recruitment", "/gallery"];
  for (const [index, reportPath] of reportPaths.entries()) {
    const reportText = readFileSync(reportPath, "utf8");
    if (/https:\/\/[^"\s]*\.supabase\.co/iu.test(reportText)) {
      throw new Error(`${reportPath} recorded a hosted Supabase request.`);
    }
    const report = parseJsonRecord(reportText);
    if (report.runtimeError) {
      throw new Error(`${reportPath} contains a Lighthouse runtime error.`);
    }
    for (const field of ["requestedUrl", "finalDisplayedUrl"]) {
      if (typeof report[field] !== "string") {
        throw new Error(`${reportPath} is missing ${field}.`);
      }
      const target = new URL(report[field]);
      if (
        target.origin !== allowedOrigin ||
        target.pathname !== expectedPaths[index]
      ) {
        throw new Error(
          `${reportPath} does not represent the expected local route.`,
        );
      }
    }
    const items = report.audits?.["network-requests"]?.details?.items;
    if (!Array.isArray(items)) {
      throw new Error(
        `${reportPath} has no Lighthouse network-request evidence.`,
      );
    }
    for (const item of items) {
      if (
        !item || typeof item.url !== "string" || !/^https?:/iu.test(item.url)
      ) continue;
      if (new URL(item.url).origin !== allowedOrigin) {
        throw new Error(`${reportPath} recorded a non-local HTTP request.`);
      }
      if (
        Number.isFinite(item.statusCode) &&
        (item.statusCode < 200 || item.statusCode >= 400)
      ) {
        throw new Error(`${reportPath} recorded a failed HTTP request.`);
      }
    }
    const consoleItems = report.audits?.["errors-in-console"]?.details?.items;
    if (!Array.isArray(consoleItems) || consoleItems.length !== 0) {
      throw new Error(`${reportPath} recorded a browser console error.`);
    }
  }
  console.log(
    "Local Lighthouse network contract OK: 3 reports, zero hosted/provider HTTP requests.",
  );
} else {
  throw new Error(
    "Usage: gallery-lighthouse-local-fixture.mjs serve <log> [upstream-origin] [listen-port] | verify <log> <home.json> <recruitment.json> <gallery.json>",
  );
}

function galleryFetchInterceptor() {
  return `<script data-mochirii-gallery-audit-interceptor>(()=>{const n=globalThis.fetch.bind(globalThis);const t=${JSON.stringify(publicFeedUrl)};const f=${JSON.stringify(fixturePath)};globalThis.fetch=(i,o)=>{let u;try{u=new URL(typeof i==="string"||i instanceof URL?i:i.url,location.href)}catch{return n(i,o)}const m=String(o?.method||(typeof Request!=="undefined"&&i instanceof Request?i.method:"GET")).toUpperCase();return u.href===t&&m==="POST"?n(f,o):n(i,o)}})();</script>`;
}

function proxyToNext(request, response, upstreamOrigin, interceptor) {
  const target = new URL(request.url || "/", upstreamOrigin);
  const headers = { ...request.headers, host: target.host, "accept-encoding": "identity" };
  delete headers.connection;
  const upstream = requestHttp(target, { method: request.method, headers }, (incoming) => {
    const contentType = String(incoming.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("text/html")) {
      response.writeHead(incoming.statusCode || 502, withoutHopByHopHeaders(incoming.headers));
      incoming.pipe(response);
      return;
    }

    void readBoundedBody(incoming, 2 * 1024 * 1024).then((body) => {
      if (body === null || (incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity")) {
        respond(response, 502, "Local audit proxy could not inspect the HTML response.", "text/plain; charset=utf-8");
        return;
      }
      const head = /<head(?:\s[^>]*)?>/iu.exec(body);
      if (!head || head.index === undefined) {
        respond(response, 502, "Local audit proxy did not find the HTML head.", "text/plain; charset=utf-8");
        return;
      }
      const insertion = head.index + head[0].length;
      const html = `${body.slice(0, insertion)}${interceptor}${body.slice(insertion)}`;
      const responseHeaders = withoutHopByHopHeaders(incoming.headers);
      delete responseHeaders["content-length"];
      delete responseHeaders["content-encoding"];
      responseHeaders["cache-control"] = "no-store";
      responseHeaders["content-length"] = Buffer.byteLength(html);
      response.writeHead(incoming.statusCode || 200, responseHeaders);
      response.end(html);
    }).catch(() => {
      if (!response.headersSent) {
        respond(response, 502, "Local audit proxy could not read the HTML response.", "text/plain; charset=utf-8");
      } else {
        response.destroy();
      }
    });
  });
  upstream.on("error", () => {
    if (!response.headersSent) {
      respond(response, 502, "Local audit upstream is unavailable.", "text/plain; charset=utf-8");
    } else {
      response.destroy();
    }
  });
  request.pipe(upstream);
}

function withoutHopByHopHeaders(headers) {
  const result = { ...headers };
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) delete result[name];
  return result;
}

function galleryFixtureBody() {
  return JSON.stringify({
    ok: true,
    data: {
      schemaVersion: 2,
      items: [],
      count: 0,
      totalEligible: 0,
      facets: {
        "member-submissions": 0,
        portraits: 0,
        gatherings: 0,
        action: 0,
        scenery: 0,
        companions: 0,
      },
      hasMore: false,
      nextCursor: null,
      partial: false,
      complete: true,
      deliveryFailures: 0,
      delivery: "bounded-edge-media",
      cacheSeconds: 15,
    },
    message: "No member-submitted images are available yet.",
  });
}

function respond(response, status, body, contentType) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function logRequest(logPath, method, path, status) {
  appendFileSync(logPath, `${JSON.stringify({ method, path, status })}\n`, "utf8");
}

function requiredPath(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing ${label} path.`);
  }
  return resolve(value);
}

function exactLoopbackOrigin(value, label) {
  const target = new URL(value);
  if (
    target.protocol !== "http:" || target.hostname !== host || !target.port ||
    target.pathname !== "/" || target.search || target.hash ||
    target.username || target.password
  ) throw new Error(`${label} must be an exact HTTP loopback origin.`);
  return target.origin;
}

function exactPort(value, label) {
  const text = String(value);
  if (!/^\d{1,5}$/u.test(text)) throw new Error(`${label} must be a TCP port.`);
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`${label} must be between 1024 and 65535.`);
  }
  return port;
}

function readLines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
}

function parseJsonRecord(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed;
}

async function readBoundedBody(request, maximumBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseListRequest(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const keys = Object.keys(parsed).sort();
    return keys.join("\n") ===
          ["action", "category", "cursor", "pageSize", "query", "sort"]
            .sort().join("\n") &&
        parsed.action === "list" && parsed.pageSize === 24 &&
        parsed.cursor === null && parsed.sort === "newest" &&
        parsed.category === null && parsed.query === null
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isExpectedFixtureRow(row) {
  return row.status === 200 && (
    (row.method === "POST" && row.path === fixturePath) ||
    (row.method === "GET" && analyticsScriptPaths.has(row.path))
  );
}
