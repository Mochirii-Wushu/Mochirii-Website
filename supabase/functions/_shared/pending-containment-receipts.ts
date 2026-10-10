import type { PendingContainmentApplyResult, SupabaseAdminClient } from "./pending-verification-containment.ts";

export const CONTAINMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATES = ["missing", "reserved", "writing", "completed", "rejected", "blocked"];
export type ContainmentReceipt = {
  state: "missing" | "reserved" | "writing" | "completed" | "rejected" | "blocked";
  result: { discordWrites: number; dbWrites: number; staleRecordsCleared: number } | null;
};

export async function containmentInputHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc(admin: SupabaseAdminClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!admin.rpc) throw new Error("Containment receipts unavailable.");
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error("Containment receipt operation unavailable.");
  return data;
}

export function containmentReceipt(value: unknown): ContainmentReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid containment receipt.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "result,state" || !STATES.includes(String(record.state))) throw new Error("Invalid containment receipt.");
  if (record.state === "completed") {
    const result = record.result as Record<string, unknown>;
    if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).sort().join(",") !== "dbWrites,discordWrites,staleRecordsCleared" ||
      Object.values(result).some((count) => !Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 10000)) throw new Error("Invalid containment receipt.");
  } else if (record.result !== null) throw new Error("Invalid containment receipt.");
  return record as ContainmentReceipt;
}

export async function readContainmentReceipt(admin: SupabaseAdminClient, requestKey: string): Promise<ContainmentReceipt> {
  return containmentReceipt(await rpc(admin, "reaper_pending_containment_status", { p_request_key: requestKey }));
}

export class ContainmentRequest {
  private owned = false;
  private writing = false;
  private completed = false;
  constructor(private admin: SupabaseAdminClient, readonly requestKey: string, private ownerId = crypto.randomUUID()) {}

  async reserve(subjectId: string, inputHash: string): Promise<"acquired" | "duplicate" | "busy" | "disabled" | "identity_conflict"> {
    const result = await rpc(this.admin, "reaper_reserve_pending_containment", {
      p_request_key: this.requestKey, p_subject_id: subjectId, p_input_sha256: inputHash, p_owner_id: this.ownerId,
    });
    if (!["acquired", "duplicate", "busy", "disabled", "identity_conflict"].includes(String(result))) throw new Error("Invalid containment reservation.");
    this.owned = result === "acquired";
    return result as Awaited<ReturnType<ContainmentRequest["reserve"]>>;
  }

  // Mark uncertainty BEFORE the RPC: its response can be lost after commit.
  beforeWrite = async (): Promise<void> => {
    if (!this.owned || this.completed) throw new Error("Containment request does not own the fence.");
    this.writing = true;
    if (await rpc(this.admin, "reaper_begin_pending_containment_write", { p_request_key: this.requestKey, p_owner_id: this.ownerId }) !== true) {
      throw new Error("Containment write fence rejected.");
    }
  };

  async complete(result: Pick<PendingContainmentApplyResult, "discordWrites" | "dbWrites" | "staleRecordsCleared">): Promise<void> {
    if (!this.owned || this.completed) throw new Error("Containment request does not own the fence.");
    // A lost completion acknowledgment is resolved through the permanent receipt.
    if (await rpc(this.admin, "reaper_finish_pending_containment", {
      p_request_key: this.requestKey, p_owner_id: this.ownerId, p_outcome: "completed", p_result: result,
    }) !== true) throw new Error("Containment completion requires reconciliation.");
    this.completed = true;
  }

  async fail(): Promise<void> {
    if (!this.owned || this.completed) return;
    const outcome = this.writing ? "blocked" : "rejected";
    if (await rpc(this.admin, "reaper_finish_pending_containment", {
      p_request_key: this.requestKey, p_owner_id: this.ownerId, p_outcome: outcome, p_result: null,
    }) !== true) throw new Error("Containment failure requires reconciliation.");
  }
}

// A short authenticated request must not retain an Edge worker on a stalled
// body. Reject duplicate JSON keys before constructing its immutable identity.
export async function readContainmentJson(request: Request, limit = 8192): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new SyntaxError("Invalid body length.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SyntaxError("Body timed out.")), 2000); });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.length;
      if (size > limit) throw new SyntaxError("Body too large.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const keys = new Set<string>();
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '"') continue;
      const start = i++;
      for (; i < text.length; i++) { if (text[i] === "\\") i++; else if (text[i] === '"') break; }
      let next = i + 1; while (/\s/.test(text[next] || "") && next < text.length) next++;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) throw new SyntaxError("Duplicate request key.");
        keys.add(key);
      }
    }
    return JSON.parse(text);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
