import {
  buildRelaySignatureHeaders,
  RELAY_SIGNATURE_HEADERS,
  verifyRelayResponse,
} from "./reward-crypto.ts";
import { RELAY_PATHS } from "./reward-relay-contract.ts";

export type RelayTransportResponse = {
  status: number;
  body: unknown;
  retryAfterMs: number | null;
};

export type RelayTransport = {
  request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<RelayTransportResponse>;
};

export type RelayClientOptions = {
  baseUrl: string;
  hmacSecret: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  nonce?: () => string;
};

const MAX_RESPONSE_BYTES = 32_768;
const ALLOWED_RELAY_PATHS = new Set<string>(Object.values(RELAY_PATHS));
export const REWARD_RELAY_ORIGIN = "https://reward-gateway.mochirii.com";

export function createRelayClient(options: RelayClientOptions): RelayTransport {
  const baseUrl = validateRewardRelayUrl(options.baseUrl);
  if (options.hmacSecret.length < 32) {
    throw new Error("Reward relay signing secret is not configured.");
  }
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? 10_000, 1_000),
    30_000,
  );
  const now = options.now || Date.now;
  const nonce = options.nonce || crypto.randomUUID;

  return {
    async request(
      path: string,
      body: Record<string, unknown>,
    ): Promise<RelayTransportResponse> {
      if (!ALLOWED_RELAY_PATHS.has(path)) {
        throw new Error("Unsupported reward relay path.");
      }
      const serialized = JSON.stringify(body);
      if (new TextEncoder().encode(serialized).byteLength > 16_384) {
        throw new Error("Reward relay request exceeds the size limit.");
      }
      const headers = await buildRelaySignatureHeaders({
        secret: options.hmacSecret,
        method: "POST",
        path,
        body: serialized,
        timestampSeconds: Math.floor(now() / 1_000),
        nonce: nonce(),
      });
      const requestTimestamp = headers[RELAY_SIGNATURE_HEADERS.timestamp];
      const requestNonce = headers[RELAY_SIGNATURE_HEADERS.nonce];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(new URL(path, baseUrl), {
          method: "POST",
          headers: {
            ...headers,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
          body: serialized,
          signal: controller.signal,
          redirect: "error",
        });
        const length = Number(response.headers.get("content-length") || "0");
        if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
          throw new Error("Reward relay response exceeds the size limit.");
        }
        const text = await readResponseTextBounded(
          response,
          MAX_RESPONSE_BYTES,
        );
        let parsed: unknown = {};
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new Error("Reward relay response is not valid JSON.");
          }
        }
        const responseVerified = await verifyRelayResponse({
          secret: options.hmacSecret,
          path,
          status: response.status,
          requestTimestamp,
          requestNonce,
          headers: response.headers,
          body: parsed,
        });
        if (!responseVerified) {
          throw new Error("Reward relay response authentication failed.");
        }
        return {
          status: response.status,
          body: parsed,
          retryAfterMs: parseRetryAfterMs(
            response.headers.get("retry-after"),
            now(),
          ),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function readResponseTextBounded(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Reward relay response exceeds the size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function validateRewardRelayUrl(
  value: string,
): string {
  const url = new URL(value);
  const isApprovedProductionHost = url.origin === REWARD_RELAY_ORIGIN;
  if (
    !isApprovedProductionHost ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Reward relay URL must be a dedicated Mochirii HTTPS origin.",
    );
  }
  return `${url.origin}/`;
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return null;
}

export class MockRelayTransport implements RelayTransport {
  readonly requests: Array<{ path: string; body: Record<string, unknown> }> =
    [];
  #responses: Array<RelayTransportResponse | Error>;

  constructor(responses: Array<RelayTransportResponse | Error>) {
    this.#responses = [...responses];
  }

  request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<RelayTransportResponse> {
    this.requests.push({ path, body: structuredClone(body) });
    const next = this.#responses.shift();
    if (!next) {
      return Promise.reject(new Error("Mock relay response queue is empty."));
    }
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(structuredClone(next));
  }
}
