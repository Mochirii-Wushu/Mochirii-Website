import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { endpointClass } from "./protocol.mjs";
import { RelayService } from "./service.mjs";
import { RelayState } from "./state.mjs";
import { TremendousApi } from "./tremendous.mjs";

export function createRelayServer({ config, state, provider, logger = defaultLogger, now = Date.now }) {
  const service = new RelayService({ config, state, provider, now });
  const server = createServer(async (request, response) => {
    const startedAt = now();
    const traceId = randomUUID();
    let statusCode = 500;
    let path = "unknown";
    try {
      let url;
      try {
        url = new URL(request.url || "/", "http://relay.invalid");
      } catch {
        writeResponse(response, 404, {});
        statusCode = 404;
        return;
      }
      path = url.search || url.hash || url.pathname.includes("//") ? "unknown" : url.pathname;
      if (path === "unknown" || request.method !== "POST" || !isJsonContentType(request.headers["content-type"])) {
        writeResponse(response, 404, {});
        statusCode = 404;
        return;
      }
      const rawBody = await readBodyBounded(request, config.maximumRequestBytes, config.inboundRequestTimeoutMs);
      const result = await service.handle({
        method: request.method,
        path,
        headers: new Headers(request.headers),
        rawBody,
      });
      writeResponse(response, result.status, result.body, result.headers);
      statusCode = result.status;
    } catch (error) {
      statusCode = error?.code === "body_too_large" || error?.code === "request_body_timeout" ? 404 : 503;
      writeResponse(response, statusCode, statusCode === 404 ? {} : { error: "relay_failure" });
    } finally {
      logger({
        event: "relay_request",
        traceId,
        endpointClass: endpointClass(path),
        statusCode,
        latencyMs: Math.max(0, now() - startedAt),
      });
    }
  });
  server.requestTimeout = config.inboundRequestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  return server;
}

export function startRelay(env = process.env) {
  const config = loadConfig(env);
  const state = new RelayState(config.databasePath);
  const provider = config.mode === "disabled" ? null : new TremendousApi({
    baseUrl: config.providerBaseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.requestTimeoutMs,
    maximumResponseBytes: config.maximumResponseBytes,
  });
  const server = createRelayServer({ config, state, provider });
  server.listen(config.port, config.host, () => {
    defaultLogger({ event: "relay_started", traceId: "startup", endpointClass: "none", statusCode: 0, latencyMs: 0 });
  });
  const shutdown = () => server.close(() => {
    state.close();
    process.exit(0);
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, state, config };
}

function isJsonContentType(value) {
  return typeof value === "string" && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value.trim());
}

async function readBodyBounded(request, maximumBytes, timeoutMs) {
  const declared = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw bodyTooLarge();
  const bodyRead = (async () => {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
      total += chunk.length;
      if (total > maximumBytes) throw bodyTooLarge();
      chunks.push(chunk);
    }
    if (total === 0) return Buffer.alloc(0);
    return Buffer.concat(chunks);
  })();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = requestBodyTimeout();
      request.destroy(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([bodyRead, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function bodyTooLarge() {
  const error = new Error("request_body_rejected");
  error.code = "body_too_large";
  return error;
}

function requestBodyTimeout() {
  const error = new Error("request_body_timeout");
  error.code = "request_body_timeout";
  return error;
}

function writeResponse(response, status, body, extraHeaders = {}) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized),
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    ...extraHeaders,
  });
  response.end(serialized);
}

function defaultLogger(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startRelay();
