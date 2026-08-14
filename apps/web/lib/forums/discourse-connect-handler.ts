import {
  buildForumsDiscourseConnectRedirect,
  deterministicForumsUsername,
  verifyDiscourseConnectRequest,
} from "./discourse-connect-core.ts";
import type { ForumsMemberResult } from "./discourse-connect-member.ts";

const MAX_REQUEST_BODY_BYTES = 12 * 1_024;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const BEARER_PATTERN = /^[A-Za-z0-9._~-]{1,8192}$/;

const PRIVATE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  Expires: "0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: "Origin, Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export type DiscourseConnectHandlerConfig = Readonly<{
  enabled: boolean;
  secret: string;
  websiteOrigin: string;
}>;

export type DiscourseConnectHandlerDependencies = Readonly<{
  loadMember: (token: string) => Promise<ForumsMemberResult>;
}>;

function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, {
    status,
    headers: PRIVATE_HEADERS,
  });
}

function errorResponse(
  status: 400 | 401 | 403 | 503,
  code: "invalid_request" | "sign_in_required" | "member_access_required" | "unavailable",
) {
  const message = code === "sign_in_required"
    ? "Sign in to continue to Mōchirīī Forums."
    : code === "member_access_required"
      ? "Currently verified Mōchirīī membership is required."
      : code === "unavailable"
        ? "Mōchirīī Forums sign-in is unavailable."
        : "This Mōchirīī Forums sign-in request is invalid.";
  return json({ ok: false, code, error: message }, status);
}

function bearerToken(request: Request) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  const token = match?.[1] || "";
  return BEARER_PATTERN.test(token) ? token : "";
}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) return null;

  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

function opaqueRequestBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== "sig" || keys[1] !== "sso") return null;
  if (typeof body.sso !== "string" || typeof body.sig !== "string") return null;
  return { sso: body.sso, sig: body.sig };
}

export async function handleForumsDiscourseConnect(
  request: Request,
  config: DiscourseConnectHandlerConfig,
  dependencies: DiscourseConnectHandlerDependencies,
) {
  if (!config.enabled || !SECRET_PATTERN.test(config.secret)) {
    return errorResponse(503, "unavailable");
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return errorResponse(400, "invalid_request");
  }
  if (
    requestUrl.origin !== config.websiteOrigin
    || requestUrl.pathname !== "/api/forums/discourse-connect"
    || requestUrl.search
    || requestUrl.hash
    || request.headers.get("origin") !== config.websiteOrigin
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    return errorResponse(400, "invalid_request");
  }

  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    return errorResponse(400, "invalid_request");
  }

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return errorResponse(400, "invalid_request");

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_request");
  }
  const body = opaqueRequestBody(parsedBody);
  if (!body) return errorResponse(400, "invalid_request");

  const verification = verifyDiscourseConnectRequest({
    encodedPayload: body.sso,
    signatureHex: body.sig,
    secret: config.secret,
  });
  if (!verification.ok) return errorResponse(400, "invalid_request");

  const token = bearerToken(request);
  if (!token) return errorResponse(401, "sign_in_required");

  let memberResult: ForumsMemberResult;
  try {
    memberResult = await dependencies.loadMember(token);
  } catch {
    return errorResponse(503, "unavailable");
  }
  if (!memberResult.ok) {
    if (memberResult.status === 401) return errorResponse(401, "sign_in_required");
    if (memberResult.status === 403) return errorResponse(403, "member_access_required");
    return errorResponse(503, "unavailable");
  }

  let redirectUrl: string;
  try {
    const username = deterministicForumsUsername(memberResult.member.id);
    redirectUrl = buildForumsDiscourseConnectRedirect({
      nonce: verification.request.nonce,
      email: memberResult.member.email,
      externalId: memberResult.member.id,
      username,
      name: memberResult.member.displayName,
      secret: config.secret,
    });
  } catch {
    return errorResponse(503, "unavailable");
  }

  return json({ ok: true, redirectUrl }, 200);
}
