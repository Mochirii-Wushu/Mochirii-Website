import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";

const EDGE_PATH = "/reaper-gateway-operations";
const EXTERNAL_PATH = `/functions/v1${EDGE_PATH}`;
export const MAX_CIPHERTEXT_BYTES = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const AGE_PREFIX = encoder.encode("age-encryption.org/v1\n");
type RecordValue = Record<string, unknown>;
export type Receipt = {
  version: 1;
  request_id: string;
  state: "missing" | "pending" | "accepted" | "blocked" | "retired";
  captured_at: string | null;
  ciphertext_sha256: string | null;
  ciphertext_bytes: number | null;
};
export type OperationsDependencies = {
  hmacKey: string;
  maintenanceKey: string;
  now(): number;
  rpc(name: string, args?: RecordValue): Promise<unknown>;
  create(id: string, bytes: Uint8Array): Promise<void>;
  read(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<void>;
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function rejected(status = 400): Response { return json({ version: 1, state: "rejected" }, status); }
function unavailable(): Response { return json({ version: 1, state: "unavailable" }, 503); }
function record(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function fields(value: RecordValue, expected: string[]): boolean { return Object.keys(value).sort().join(",") === expected.sort().join(","); }
function iso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function keyReady(value: string): boolean { const size = encoder.encode(value).length; return size >= 32 && size <= 256; }
function equal(a: string, b: string): boolean {
  const left = encoder.encode(a), right = encoder.encode(b);
  let different = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) different |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return different === 0;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes.slice();
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)), (value) => value.toString(16).padStart(2, "0")).join("");
}
export async function signature(key: string, method: string, path: string, timestamp: string, nonce: string, hash: string, capturedAt = ""): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", imported, encoder.encode(["v1", method, path, timestamp, nonce, hash, capturedAt].join("\n")));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function readBytes(body: ReadableStream<Uint8Array> | null, limit: number, timeout: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    return await Promise.race([
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > limit) throw new SyntaxError("Body limit.");
          chunks.push(value);
        }
        const output = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
        return output;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SyntaxError("Body deadline.")), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

function parseReceipt(value: unknown, id: string): Receipt {
  if (!record(value) || !fields(value, ["version", "request_id", "state", "captured_at", "ciphertext_sha256", "ciphertext_bytes"])
    || value.version !== 1 || value.request_id !== id || !UUID.test(id)
    || !["missing", "pending", "accepted", "blocked", "retired"].includes(String(value.state))) throw new Error("Invalid receipt.");
  if (value.state === "missing") {
    if (value.captured_at !== null || value.ciphertext_sha256 !== null || value.ciphertext_bytes !== null) throw new Error("Invalid missing receipt.");
  } else if (!iso(value.captured_at) || typeof value.ciphertext_sha256 !== "string" || !SHA256.test(value.ciphertext_sha256)
    || !Number.isInteger(value.ciphertext_bytes) || Number(value.ciphertext_bytes) < 64 || Number(value.ciphertext_bytes) > MAX_CIPHERTEXT_BYTES) throw new Error("Invalid receipt metadata.");
  return value as Receipt;
}

async function receipt(deps: OperationsDependencies, id: string, reconcile: boolean): Promise<Receipt> {
  let result = parseReceipt(await deps.rpc("reaper_gateway_operations_receipt", { p_request_id: id }), id);
  if (reconcile && result.state === "pending") {
    const bytes = await deps.read(id);
    // Missing is ambiguous after reservation; it never authorizes another write.
    if (bytes !== null) {
      if (bytes.length !== result.ciphertext_bytes || await sha256(bytes) !== result.ciphertext_sha256) {
        await deps.rpc("reaper_gateway_operations_block", { p_request_id: id });
      } else {
        await deps.rpc("reaper_gateway_operations_complete", { p_request_id: id, p_sha256: result.ciphertext_sha256, p_bytes: result.ciphertext_bytes });
      }
      result = parseReceipt(await deps.rpc("reaper_gateway_operations_receipt", { p_request_id: id }), id);
    }
  }
  return result;
}
function receiptResponse(value: Receipt, lookup = false): Response {
  return json(value, lookup || value.state === "accepted" || value.state === "missing" ? 200 : value.state === "pending" ? 202 : 409);
}

async function pruneOne(deps: OperationsDependencies): Promise<boolean> {
  const claim = await deps.rpc("reaper_gateway_operations_prune_claim");
  if (claim === null) return false;
  if (!record(claim) || !fields(claim, ["request_id", "ciphertext_sha256", "ciphertext_bytes"])
    || typeof claim.request_id !== "string" || !UUID.test(claim.request_id) || typeof claim.ciphertext_sha256 !== "string" || !SHA256.test(claim.ciphertext_sha256)
    || !Number.isInteger(claim.ciphertext_bytes) || Number(claim.ciphertext_bytes) < 64 || Number(claim.ciphertext_bytes) > MAX_CIPHERTEXT_BYTES) throw new Error("Invalid cleanup claim.");
  const bytes = await deps.read(claim.request_id);
  if (bytes === null || bytes.length !== claim.ciphertext_bytes || await sha256(bytes) !== claim.ciphertext_sha256) {
    await deps.rpc("reaper_gateway_operations_block", { p_request_id: claim.request_id });
    throw new Error("Cleanup requires reconciliation.");
  }
  // The durable deleting fence was acquired before touching the provider. An
  // uncertain response is held; no timeout-based retry or automatic takeover.
  await deps.remove(claim.request_id);
  if (await deps.rpc("reaper_gateway_operations_prune_complete", { p_request_id: claim.request_id }) !== true) throw new Error("Cleanup acknowledgement unavailable.");
  return true;
}

function heartbeat(bytes: Uint8Array, now: number): RecordValue {
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  // Flat exact schema: reject duplicate JSON keys instead of accepting last wins.
  const keys = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) => JSON.parse(`"${match[1]}"`));
  if (new Set(keys).size !== keys.length) throw new SyntaxError("Duplicate heartbeat field.");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !fields(value, ["version", "request_id", "observed_at", "healthy", "checkpoint_id", "checkpoint_captured_at", "checkpoint_checked_at"])
    || value.version !== 1 || typeof value.request_id !== "string" || !UUID.test(value.request_id) || !iso(value.observed_at)
    || Math.abs(Date.parse(value.observed_at) - now) > 120_000 || typeof value.healthy !== "boolean") throw new SyntaxError("Invalid heartbeat.");
  const absent = value.checkpoint_id === null && value.checkpoint_captured_at === null && value.checkpoint_checked_at === null;
  if (!absent && (typeof value.checkpoint_id !== "string" || !UUID.test(value.checkpoint_id) || !iso(value.checkpoint_captured_at) || !iso(value.checkpoint_checked_at)
    || Date.parse(value.checkpoint_checked_at) < Date.parse(value.checkpoint_captured_at) || Date.parse(value.checkpoint_checked_at) > now)) throw new SyntaxError("Invalid checkpoint reference.");
  return value;
}

export async function handleGatewayOperations(req: Request, deps: OperationsDependencies): Promise<Response> {
  const url = new URL(req.url);
  const suffix = url.pathname.startsWith(`${EDGE_PATH}/`) ? url.pathname.slice(EDGE_PATH.length) : "";
  if (suffix === "/status" && req.method === "GET") {
    let healthy = false;
    try { healthy = !url.search && !req.headers.has("content-encoding") && !req.body && keyReady(deps.hmacKey) && await deps.rpc("reaper_gateway_operations_status") === true; } catch { /* Fixed public failure only. */ }
    return new Response(healthy ? "ok" : "unavailable", { status: healthy ? 200 : 503, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  if (url.search || req.headers.has("content-encoding")) return rejected();
  if (suffix === "/maintenance" && req.method === "POST") {
    if (!keyReady(deps.maintenanceKey) || equal(deps.maintenanceKey, deps.hmacKey)
      || !equal(req.headers.get("x-reaper-maintenance-secret") || "", deps.maintenanceKey)) return rejected(401);
    try {
      if (req.headers.get("content-type") !== "application/json" || new TextDecoder().decode(await readBytes(req.body, 2, 2000)) !== "{}") return rejected();
      await pruneOne(deps);
      return json({ version: 1, state: "accepted" });
    } catch { return unavailable(); }
  }
  const uploadId = suffix.startsWith("/checkpoints/") ? suffix.slice("/checkpoints/".length) : "";
  const receiptId = suffix.startsWith("/receipts/") ? suffix.slice("/receipts/".length) : "";
  const isHeartbeat = suffix === "/heartbeat" && req.method === "POST";
  const isUpload = UUID.test(uploadId) && req.method === "POST";
  const isReceipt = UUID.test(receiptId) && req.method === "GET";
  if (!isHeartbeat && !isUpload && !isReceipt) return rejected(404);
  const timestamp = req.headers.get("x-reaper-timestamp") || "", nonce = req.headers.get("x-reaper-nonce") || "";
  const hash = req.headers.get("x-reaper-content-sha256") || "", provided = req.headers.get("x-reaper-signature") || "";
  const capturedAt = req.headers.get("x-reaper-captured-at") || "";
  if (!keyReady(deps.hmacKey) || !/^[1-9][0-9]{0,11}$/.test(timestamp) || Math.abs(Number(timestamp) * 1000 - deps.now()) > 120_000
    || !UUID.test(nonce) || !SHA256.test(hash) || !SHA256.test(provided)) return rejected(401);
  if (isUpload ? !iso(capturedAt) || Date.parse(capturedAt) > deps.now() : capturedAt !== "") return rejected();
  if (isHeartbeat && req.headers.get("content-type") !== "application/json"
    || isUpload && req.headers.get("content-type") !== "application/octet-stream"
    || isReceipt && (req.body !== null || req.headers.has("content-type"))) return rejected();
  const length = req.headers.get("content-length");
  const limit = isUpload ? MAX_CIPHERTEXT_BYTES : isHeartbeat ? 1024 : 0;
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)) return rejected();
  // Authenticate the declared digest before allocating or waiting on a large
  // body; then bind that digest to the actual bytes before any database call.
  if (!equal(await signature(deps.hmacKey, req.method, `${EXTERNAL_PATH}${suffix}`, timestamp, nonce, hash, capturedAt), provided)) return rejected(401);
  let bytes: Uint8Array;
  try { bytes = await readBytes(req.body, limit, isUpload ? 15_000 : 2000); } catch { return rejected(); }
  if (await sha256(bytes) !== hash) return rejected(401);
  let payload: RecordValue | null = null;
  try {
    if (isHeartbeat) payload = heartbeat(bytes, deps.now());
    if (isUpload && (bytes.length < 64 || !AGE_PREFIX.every((value, index) => bytes[index] === value))) return rejected();
  } catch { return rejected(); }
  try {
    if (await deps.rpc("reaper_gateway_operations_auth", { p_nonce: nonce, p_timestamp: Number(timestamp) }) !== true) return rejected(401);
    if (payload) {
      const accepted = await deps.rpc("reaper_gateway_operations_heartbeat", {
        p_request_id: payload.request_id, p_observed_at: payload.observed_at, p_healthy: payload.healthy,
        p_checkpoint_id: payload.checkpoint_id, p_captured_at: payload.checkpoint_captured_at, p_checked_at: payload.checkpoint_checked_at,
      });
      return accepted === true ? json({ version: 1, request_id: payload.request_id, state: "accepted" }) : unavailable();
    }
    if (isReceipt) return receiptResponse(await receipt(deps, receiptId, true), true);
    const args = { p_request_id: uploadId, p_sha256: hash, p_bytes: bytes.length, p_captured_at: capturedAt };
    let reserved = await deps.rpc("reaper_gateway_operations_reserve", args);
    if (reserved === "full" && await pruneOne(deps)) reserved = await deps.rpc("reaper_gateway_operations_reserve", args);
    if (reserved === "identity_conflict") return receiptResponse({ ...await receipt(deps, uploadId, false), state: "blocked" });
    if (reserved === "duplicate") return receiptResponse(await receipt(deps, uploadId, true));
    if (reserved !== "acquired") return unavailable();
    try {
      await deps.create(uploadId, bytes);
      await deps.rpc("reaper_gateway_operations_complete", { p_request_id: uploadId, p_sha256: hash, p_bytes: bytes.length });
    } catch { /* The exact reserved receipt reconciles a lost provider/DB ACK. */ }
    return receiptResponse(await receipt(deps, uploadId, true));
  } catch { return unavailable(); }
}

function runtimeDependencies(): OperationsDependencies {
  let admin: SupabaseClient | undefined;
  const client = () => {
    if (admin) return admin;
    const url = Deno.env.get("SUPABASE_URL") || "", key = getServiceRoleKey();
    if (!url || !key) throw new Error("Operations unavailable.");
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: {
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
        const bytes = await readBytes(response.body, MAX_CIPHERTEXT_BYTES, 15_000);
        const headers = new Headers(response.headers); headers.delete("content-length"); headers.delete("content-encoding");
        return new Response(response.status === 204 ? null : bytes, { status: response.status, headers });
      },
    } });
    return admin;
  };
  const bucket = () => client().storage.from("reaper-gateway-recovery");
  const path = (id: string) => { if (!UUID.test(id)) throw new Error("Invalid storage identity."); return `v1/${id}.age`; };
  return {
    hmacKey: Deno.env.get("REAPER_GATEWAY_OPERATIONS_HMAC_KEY") || "",
    maintenanceKey: Deno.env.get("REAPER_GATEWAY_OPERATIONS_MAINTENANCE_SECRET") || "", now: Date.now,
    rpc: async (name, args) => { const { data, error } = await client().rpc(name, args); if (error) throw new Error("Operations database unavailable."); return data; },
    create: async (id, bytes) => { const { error } = await bucket().upload(path(id), bytes, { upsert: false, contentType: "application/octet-stream" }); if (error) throw new Error("Upload acknowledgement unavailable."); },
    read: async (id) => {
      const { data, error } = await bucket().download(path(id));
      if (error) { if ("statusCode" in error && String(error.statusCode) === "404") return null; throw new Error("Object observation unavailable."); }
      if (!data || data.size > MAX_CIPHERTEXT_BYTES) throw new Error("Object limit.");
      return new Uint8Array(await data.arrayBuffer());
    },
    remove: async (id) => { const { error } = await bucket().remove([path(id)]); if (error) throw new Error("Delete acknowledgement unavailable."); },
  };
}

if (import.meta.main) Deno.serve((req) => handleGatewayOperations(req, runtimeDependencies()));
