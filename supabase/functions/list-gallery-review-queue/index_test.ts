import type { SupabaseClient } from "@supabase/supabase-js";
import { handleProcessingAdmission, handleRequest } from "./index.ts";
import type { ModeratorAccessResult } from "../_shared/gallery-moderation.ts";
import { signGalleryMedia } from "../../../packages/gallery-media/proof.ts";

const actor = "10000000-0000-4000-8000-000000000001";
const submission = "10000000-0000-4000-8000-000000000002";
const lease = "10000000-0000-4000-8000-000000000003";
const other = "10000000-0000-4000-8000-000000000004";
const secret = "a".repeat(64); // Synthetic fixture, not a provider credential.
const now = 1_800_000_000_000;
const sentinel = "PRIVATE_ADMISSION_SENTINEL";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
function same(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), "unexpected categorical result"); }
const body = (operation = "acquire") => ({ processingAdmission: { protocol: "gallery-admission-v1", operation,
  actor_id: actor, submission_id: submission, lease_id: lease, issued_at_ms: now } });
async function request(value: unknown, purpose = "gallery-processing-admission-v1\n", signature?: string) {
  const raw = JSON.stringify(value);
  const req = new Request("https://gallery.example/review", { method: "POST", headers: { "content-type": "application/json",
    "x-mochirii-gallery-admission-proof": signature ?? await signGalleryMedia(purpose + raw, secret) }, body: raw });
  return { req, raw };
}
function fixture(result: unknown = { acquired: true, code: "acquired" }, mode = "success") {
  const calls: Record<string, unknown>[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    same(name, "gallery_processing_admission"); calls.push(args);
    if (mode === "throw") throw new Error(sentinel);
    return { data: result, error: mode === "error" ? { message: sentinel, code: sentinel } : null };
  } };
  return { calls, access: { userId: actor, adminClient: client as unknown as SupabaseClient } };
}
async function run(f: ReturnType<typeof fixture>, value: unknown = body(), purpose?: string, signature?: string) {
  const { req, raw } = await request(value, purpose, signature);
  return handleProcessingAdmission(req, f.access, raw, secret, now);
}

Deno.test("actual admission consumer verifies a separate exact-byte purpose and binds the fresh actor/source/token/operation to RPC", async () => {
  for (const operation of ["acquire", "release"]) {
    const f = fixture({ acquired: operation === "acquire", code: operation === "acquire" ? "acquired" : "released" });
    const response = await run(f, body(operation)); same(response.status, 200);
    same(f.calls, [{ p_actor_id: actor, p_submission_id: submission, p_lease_id: lease, p_operation: operation }]);
    const text = await response.text(); assert(!text.includes(actor)); assert(!text.includes(submission)); assert(!text.includes(lease));
    assert(!text.includes(secret)); assert(!text.includes(sentinel));
  }
});

Deno.test("actual request handler freshly authorizes and bounds/parses the exact signed admission body before RPC", async () => {
  const f = fixture(); let checks = 0;
  const verify = async () => { checks++; return { ok: true, ...f.access } as ModeratorAccessResult; };
  const value = body(); value.processingAdmission.issued_at_ms = Date.now();
  const signed = await request(value);
  same((await handleRequest(signed.req, verify, () => secret)).status, 200);
  same(checks, 1); same(f.calls.length, 1);
  const denied = await request(body());
  const denial = new Response("denied", { status: 403 });
  assert((await handleRequest(denied.req, async () => { checks++; return { ok: false, response: denial }; }, () => secret)) === denial);
  same(checks, 2); same(f.calls.length, 1);
  for (const raw of ["{", JSON.stringify({ processingAdmission: sentinel.repeat(4096) })]) {
    const req = new Request("https://gallery.example/review", { method: "POST", headers: { "content-type": "application/json" }, body: raw });
    const response = await handleRequest(req, verify, () => secret);
    same(response.status, 400); same(f.calls.length, 1); assert(!(await response.text()).includes(sentinel));
  }
});

Deno.test("moderator bearer without trusted proof, publication-domain proof, changed raw bytes and other actor cannot mutate admission", async () => {
  for (const [purpose, signature] of [[undefined, ""], ["", undefined], [undefined, "0".repeat(64)]] as const) {
    const f = fixture(); const response = await run(f, body(), purpose, signature);
    same(response.status, 403); same(f.calls.length, 0);
  }
  const value = body(); value.processingAdmission.actor_id = other;
  const f = fixture(); same((await run(f, value)).status, 403); same(f.calls.length, 0);
  const signed = await request(body());
  const changed = signed.raw.replace('"acquire"', '"release"');
  same((await handleProcessingAdmission(signed.req, f.access, changed, secret, now)).status, 403);
  same(f.calls.length, 0);
});

Deno.test("actual request handler contains thrown fresh-verification and secret-read failures categorically", async () => {
  const f = fixture();
  const verify = async () => ({ ok: true, ...f.access } as ModeratorAccessResult);
  const throws = () => { throw new Error(sentinel); };
  for (const [verifier, secretReader, category] of [
    [async () => throws(), () => secret, "moderation_verification_unavailable"],
    [verify, throws, "processing_admission_unavailable"],
  ] as const) {
    const { req } = await request(body());
    const response = await handleRequest(req, verifier, secretReader);
    same(response.status, 503); same(f.calls.length, 0);
    const value = await response.json(); same(value.error, category);
    const text = JSON.stringify(value);
    for (const privateValue of [sentinel, secret, actor, submission, lease, "Error", "stack"]) assert(!text.includes(privateValue));
  }
});

Deno.test("expired/future, malformed, extra-key and cross-operation envelopes fail closed before RPC", async () => {
  const changes = [
    (value: ReturnType<typeof body>) => { value.processingAdmission.issued_at_ms = now - 30_001; },
    (value: ReturnType<typeof body>) => { value.processingAdmission.issued_at_ms = now + 5_001; },
    (value: ReturnType<typeof body>) => { value.processingAdmission.protocol = sentinel; },
    (value: ReturnType<typeof body>) => { value.processingAdmission.operation = sentinel; },
    (value: ReturnType<typeof body>) => { value.processingAdmission.lease_id = sentinel; },
    (value: ReturnType<typeof body>) => { value.processingAdmission.submission_id = sentinel; },
    (value: ReturnType<typeof body>) => { Object.assign(value.processingAdmission, { extra: sentinel }); },
    (value: ReturnType<typeof body>) => { Object.assign(value, { processingSource: submission }); },
  ];
  for (const change of changes) {
    const value = body(); change(value);
    const f = fixture(); const response = await run(f, value);
    same(response.status, 403); same(f.calls.length, 0); assert(!(await response.text()).includes(sentinel));
  }
  for (const value of [null, [], { processingAdmission: null }, { processingAdmission: [] }]) {
    const f = fixture(); same((await run(f, value)).status, 403); same(f.calls.length, 0);
  }
});

Deno.test("busy/stale results stay categorical; expiry grants no takeover and rejected release grants no ownership", async () => {
  for (const code of ["busy", "stale", "not_owner"]) {
    const f = fixture({ acquired: false, code });
    const response = await run(f); same(response.status, 200);
    same(await response.json(), { ok: true, data: { acquired: false, code } }); same(f.calls.length, 1);
  }
  const f = fixture({ acquired: false, code: "not_owner" });
  same((await run(f, body("release"))).status, 200);
});

Deno.test("RPC faults and inconsistent success records expose only fixed failure categories", async () => {
  for (const [result, mode, operation] of [
    [null, "success", "acquire"], [{ acquired: true, code: "busy" }, "success", "acquire"],
    [{ acquired: false, code: "acquired" }, "success", "acquire"],
    [{ acquired: true, code: "released" }, "success", "release"],
    [{ acquired: false, code: "released" }, "success", "acquire"],
    [{ acquired: false, code: "busy" }, "success", "release"],
    [{ acquired: false, code: sentinel }, "success", "acquire"],
    [{ acquired: true, code: "acquired" }, "error", "acquire"], [null, "throw", "acquire"],
  ] as const) {
    const f = fixture(result, mode); const response = await run(f, body(operation)); same(response.status, 503);
    const text = await response.text(); assert(!text.includes(sentinel)); assert(!text.includes(actor)); assert(!text.includes(lease));
  }
});
