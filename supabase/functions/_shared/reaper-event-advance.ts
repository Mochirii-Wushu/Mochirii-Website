import { asRecord, type JsonRecord } from "./discord-interaction-helpers.ts";
import { processEventSync, type ReaperEventSyncDependencies } from "./reaper-event-sync-workflow.ts";

export const EVENT_ADVANCE_PATH = "/reaper-discord-interactions/advance";
export const EVENT_ADVANCE_PROJECT = "https://deyvmtncimmcinldjyqe.supabase.co";
const GUILD_ID = "1078630751077142608";
const KEYS = ["breaking-army", "showdown"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

type Dependencies = Omit<ReaperEventSyncDependencies, "interactionId" | "editOriginalInteractionResponse"> & {
  projectUrl: string;
  configuredGuildId: string;
  botConfigured: boolean;
  waitUntil(task: Promise<unknown>): void;
};

async function dispatchId(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 128)) throw new Error("Invalid dispatch request.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing dispatch request.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Dispatch body timed out.")), 2_000); });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > 128) throw new Error("Dispatch body exceeds limit.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = asRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (Object.keys(body).length !== 1 || typeof body.dispatchId !== "string" || !UUID.test(body.dispatchId)) throw new Error("Invalid dispatch identity.");
    return body.dispatchId;
  } finally {
    clearTimeout(timer);
    // Cancellation must not extend the request's deadline if a source stalls.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// This separate route accepts only a short-lived, one-use database capability.
// Ordinary Discord interactions still require their original Ed25519 signature.
export async function handleEventAdvance(request: Request, deps: Dependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== EVENT_ADVANCE_PATH || url.search || request.method !== "POST") return new Response("Not found.", { status: 404 });
  if (deps.projectUrl !== EVENT_ADVANCE_PROJECT || deps.configuredGuildId !== GUILD_ID || deps.expectedGuildId !== GUILD_ID || !deps.botConfigured) {
    return new Response("Unavailable.", { status: 503 });
  }
  const capability = request.headers.get("x-mochirii-event-advance-capability") || "";
  if (!/^[a-f0-9]{64}$/.test(capability) || request.headers.get("content-type") !== "application/json") {
    return new Response("Unauthorized.", { status: 401 });
  }
  let id: string;
  try { id = await dispatchId(request); } catch { return new Response("Invalid request.", { status: 400 }); }
  const ownerId = crypto.randomUUID();
  let admin: ReturnType<Dependencies["serviceAdminClient"]>;
  let claim: JsonRecord;
  try {
    admin = deps.serviceAdminClient("event advancement capability");
    const { data, error } = await admin.rpc("reaper_claim_event_advance", { p_dispatch_id: id, p_capability: capability, p_owner_id: ownerId });
    if (error) throw new Error("Claim unavailable.");
    claim = asRecord(data);
  } catch { return new Response("Unavailable.", { status: 503 }); }
  if (claim.guildId !== GUILD_ID || typeof claim.interactionId !== "string" || !/^9\d{19}$/.test(claim.interactionId) ||
    !Array.isArray(claim.activityKeys) || !claim.activityKeys.length || claim.activityKeys.length > 2 ||
    new Set(claim.activityKeys).size !== claim.activityKeys.length || claim.activityKeys.some((key) => typeof key !== "string" || !KEYS.includes(key))) {
    return new Response("Unauthorized.", { status: 401 });
  }
  const task = async () => {
    try {
      await processEventSync("apply", "", "", {
        ...deps,
        interactionId: String(claim.interactionId),
        reservationOwnerId: ownerId,
        advanceKeys: claim.activityKeys as string[],
        // Upkeep never posts messages or needs a Discord interaction webhook.
        editOriginalInteractionResponse: () => Promise.resolve(),
      });
    } finally {
      const { data, error } = await admin.rpc("reaper_finish_event_advance", { p_dispatch_id: id, p_owner_id: ownerId });
      if (error || data !== true) throw new Error("Event advancement requires reconciliation.");
    }
  };
  deps.waitUntil(task().catch(() => { console.error("Hosted event advancement requires reconciliation."); }));
  return new Response("Accepted.", { status: 202 });
}
