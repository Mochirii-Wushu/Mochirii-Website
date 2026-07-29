import "@supabase/functions-js/edge-runtime.d.ts";
import {
  PROVIDER_WEBHOOK_SIGNATURE_HEADER,
  verifyProviderWebhookSignature,
} from "../_shared/reward-crypto.ts";
import { createRewardAdminClient, rewardJson } from "../_shared/reward-edge.ts";
import { normalizeProviderEvent } from "../_shared/reward-webhook.ts";
import { raffleOperationalGates } from "../_shared/raffle-flags.ts";

const maximumWebhookBytes = 65_536;

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return rewardJson({ ok: false, error: "not_found" }, 404);
  }
  const gates = raffleOperationalGates();
  if (!gates.rewardOrders || !gates.relay) {
    return rewardJson({ ok: false, error: "not_found" }, 404);
  }
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maximumWebhookBytes) {
    return rewardJson({ ok: false, error: "request_too_large" }, 413);
  }
  const rawBody = await readBoundedBody(req, maximumWebhookBytes);
  if (!rawBody) {
    return rewardJson({ ok: false, error: "request_too_large" }, 413);
  }
  const secret = Deno.env.get("TREMENDOUS_WEBHOOK_SIGNING_SECRET") || "";
  const verification = await verifyProviderWebhookSignature({
    secret,
    rawBody,
    signature: req.headers.get(PROVIDER_WEBHOOK_SIGNATURE_HEADER),
    maxBodyBytes: maximumWebhookBytes,
  });
  if (!verification.ok) {
    const status = verification.reason === "missing_secret"
      ? 503
      : verification.reason === "body_too_large"
      ? 413
      : 401;
    return rewardJson({
      ok: false,
      error: status === 503 ? "service_unavailable" : "invalid_request",
    }, status);
  }

  const adminClient = createRewardAdminClient();
  if (!adminClient) {
    return rewardJson({ ok: false, error: "service_unavailable" }, 503);
  }
  const { data: configs, error: configError } = await adminClient
    .from("raffle_provider_configs")
    .select("id")
    .eq("environment", "production")
    .in("status", ["readiness", "active", "suspended"])
    .limit(2);
  if (configError || !configs || configs.length !== 1) {
    return rewardJson({ ok: false, error: "service_unavailable" }, 503);
  }

  let event;
  try {
    event = normalizeProviderEvent({
      rawBody,
      environment: "production",
      bodySha256: verification.bodyHash,
    });
  } catch {
    return rewardJson({ ok: false, error: "invalid_request" }, 400);
  }
  const { error } = await adminClient.from("raffle_provider_events").insert({
    provider_config_id: configs[0].id,
    provider_event_uuid: event.providerEventUuid,
    event_type: event.eventType,
    resource_type: event.resourceType,
    resource_reference: event.resourceReference,
    environment: event.environment,
    occurred_at: event.occurredAt,
    body_sha256: event.bodySha256,
    processing_status: event.processingStatus,
  });
  if (error?.code === "23505") {
    const { data: existing, error: duplicateReadError } = await adminClient
      .from("raffle_provider_events")
      .select(
        "event_type,resource_type,resource_reference,environment,occurred_at,body_sha256",
      )
      .eq("provider_event_uuid", event.providerEventUuid)
      .maybeSingle();
    const identical = !duplicateReadError && existing &&
      existing.event_type === event.eventType &&
      existing.resource_type === event.resourceType &&
      existing.resource_reference === event.resourceReference &&
      existing.environment === event.environment &&
      new Date(String(existing.occurred_at)).toISOString() ===
        event.occurredAt &&
      existing.body_sha256 === event.bodySha256;
    return identical
      ? rewardJson({ ok: true, status: "duplicate" })
      : rewardJson({ ok: false, error: "event_identity_conflict" }, 409);
  }
  if (error) return rewardJson({ ok: false, error: "enqueue_failed" }, 503);
  return rewardJson({
    ok: true,
    status: event.processingStatus === "ignored" ? "ignored" : "accepted",
  });
}

async function readBoundedBody(
  req: Request,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
