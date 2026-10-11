import { handleGatewayOperations, MAX_CIPHERTEXT_BYTES, sha256, signature, type OperationsDependencies, type Receipt } from "./index.ts";

function assert(value: unknown): asserts value { if (!value) throw new Error("Assertion failed"); }
const key = "synthetic-worker-key-32-bytes-minimum";
const maintenanceKey = "synthetic-maintenance-key-32-bytes-minimum";
const now = Date.parse("2026-10-11T03:30:00.000Z");
const capturedAt = "2026-10-11T03:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const encoder = new TextEncoder();
const cipher = encoder.encode("age-encryption.org/v1\nsynthetic encrypted fixture only, deliberately not production recovery material");
const payload = { version: 1, request_id: id, observed_at: new Date(now).toISOString(), healthy: true,
  checkpoint_id: null, checkpoint_captured_at: null, checkpoint_checked_at: null };
const empty = (requestId: string): Receipt => ({ version: 1, request_id: requestId, state: "missing", captured_at: null, ciphertext_sha256: null, ciphertext_bytes: null });

async function request(path: string, bytes = new Uint8Array(), options: { method?: string; nonce?: string; timestamp?: string; capture?: string; contentType?: string; headers?: Record<string, string> } = {}) {
  const method = options.method || (path.startsWith("/receipts/") ? "GET" : "POST");
  const timestamp = options.timestamp || String(now / 1000), nonce = options.nonce || crypto.randomUUID();
  const capture = options.capture ?? (path.startsWith("/checkpoints/") ? capturedAt : "");
  const hash = await sha256(bytes);
  const headers: Record<string, string> = { "x-reaper-timestamp": timestamp, "x-reaper-nonce": nonce,
    "x-reaper-content-sha256": hash, "x-reaper-signature": await signature(key, method, `/functions/v1/reaper-gateway-operations${path}`, timestamp, nonce, hash, capture) };
  if (method !== "GET") headers["content-type"] = options.contentType || (path === "/heartbeat" ? "application/json" : "application/octet-stream");
  if (capture) headers["x-reaper-captured-at"] = capture;
  Object.assign(headers, options.headers);
  return new Request(`https://operations.test/reaper-gateway-operations${path}`, { method, headers, ...(method === "GET" ? {} : { body: bytes.slice().buffer }) });
}

function fixture() {
  const rows = new Map<string, Receipt>(), objects = new Map<string, Uint8Array>(), nonces = new Set<string>(), calls: string[] = [];
  let enabled = true, health = true, loseUploadAck = false, loseCompleteAck = false, failUpload = false, failRemove = false, full = false;
  let prune: { request_id: string; ciphertext_sha256: string; ciphertext_bytes: number } | null = null;
  const deps: OperationsDependencies = {
    hmacKey: key, maintenanceKey, now: () => now,
    rpc: (name, args = {}) => Promise.resolve().then(() => {
      calls.push(name);
      const requestId = String(args.p_request_id), row = rows.get(requestId);
      if (name === "reaper_gateway_operations_status") return enabled && health;
      if (name === "reaper_gateway_operations_auth") {
        const nonce = String(args.p_nonce); if (nonces.has(nonce)) return false; nonces.add(nonce); return true;
      }
      if (name === "reaper_gateway_operations_heartbeat") return enabled;
      if (name === "reaper_gateway_operations_receipt") return row || empty(requestId);
      if (name === "reaper_gateway_operations_reserve") {
        if (row) return row.ciphertext_sha256 === args.p_sha256 && row.ciphertext_bytes === args.p_bytes && row.captured_at === args.p_captured_at ? "duplicate" : "identity_conflict";
        if (!enabled) return "disabled";
        if ([...rows.values()].some((value) => ["pending", "blocked"].includes(value.state))) return "busy";
        if (full) return "full";
        rows.set(requestId, { version: 1, request_id: requestId, state: "pending", captured_at: String(args.p_captured_at), ciphertext_sha256: String(args.p_sha256), ciphertext_bytes: Number(args.p_bytes) });
        return "acquired";
      }
      if (name === "reaper_gateway_operations_complete") {
        assert(row && objects.has(requestId)); row.state = "accepted";
        if (loseCompleteAck) throw new Error("Synthetic lost DB acknowledgement");
        return true;
      }
      if (name === "reaper_gateway_operations_block") { assert(row); row.state = "blocked"; return true; }
      if (name === "reaper_gateway_operations_prune_claim") { const value = prune; prune = null; return value; }
      if (name === "reaper_gateway_operations_prune_complete") { assert(row && !objects.has(requestId)); row.state = "retired"; full = false; return true; }
      throw new Error("Unexpected RPC");
    }),
    create: (requestId, bytes) => Promise.resolve().then(() => {
      calls.push(`create:${requestId}`); if (failUpload) throw new Error("Synthetic ambiguous upload");
      assert(!objects.has(requestId)); objects.set(requestId, bytes.slice());
      if (loseUploadAck) throw new Error("Synthetic lost upload acknowledgement");
    }),
    read(requestId) { calls.push(`read:${requestId}`); return Promise.resolve(objects.get(requestId) || null); },
    remove(requestId) { calls.push(`remove:${requestId}`); if (failRemove) throw new Error("Synthetic ambiguous deletion"); objects.delete(requestId); return Promise.resolve(); },
  };
  return { deps, rows, objects, calls, disable: () => enabled = false, unhealthy: () => health = false,
    loseUploadAck: () => loseUploadAck = true, loseCompleteAck: () => loseCompleteAck = true, failUpload: () => failUpload = true,
    failRemove: () => failRemove = true, prune(value: NonNullable<typeof prune>) { prune = value; }, full: () => full = true };
}

Deno.test("canonical HMAC framing matches independent Python stdlib vector", async () => {
  const bytes = encoder.encode("age-encryption.org/v1\n" + "synthetic-ciphertext-".repeat(8));
  const hash = await sha256(bytes);
  assert(hash === "2fa7e6e90ade6e2cb520ec095eaa310456ca94f7368c8227f251b13644e50951");
  assert(await signature("synthetic-operations-test-key-only-1234567890", "POST", `/functions/v1/reaper-gateway-operations/checkpoints/${id}`,
    "1791677100", id, hash, "2026-10-11T00:00:00.000Z") === "5e22d76fe772da470501ed58bdf415c4fcb4024c7502e7d0bb3d01c50961f51e");
});

Deno.test("status reveals only fixed no-store readiness and fails closed on malformed or unavailable requests", async () => {
  const f = fixture();
  for (const good of [true, false]) {
    if (!good) f.unhealthy();
    const response = await handleGatewayOperations(new Request("https://operations.test/reaper-gateway-operations/status"), f.deps);
    assert(response.status === (good ? 200 : 503) && await response.text() === (good ? "ok" : "unavailable"));
    assert(response.headers.get("cache-control") === "no-store");
  }
  f.deps.rpc = () => { throw new Error("Private diagnostic must not escape"); };
  for (const url of ["/status", "/status?secret=private"]) {
    const response = await handleGatewayOperations(new Request(`https://operations.test/reaper-gateway-operations${url}`), f.deps);
    assert(response.status === 503 && await response.text() === "unavailable");
  }
});

Deno.test("signed heartbeat authenticates the full exact schema and canonical external path", async () => {
  const f = fixture();
  const response = await handleGatewayOperations(await request("/heartbeat", encoder.encode(JSON.stringify(payload))), f.deps);
  assert(response.status === 200 && JSON.stringify(await response.json()) === JSON.stringify({ version: 1, request_id: id, state: "accepted" }));
  assert(f.calls.join(",") === "reaper_gateway_operations_auth,reaper_gateway_operations_heartbeat");
});

Deno.test("missing receipt GET is read-only, private, exact and has no storage/list capability", async () => {
  const f = fixture();
  const response = await handleGatewayOperations(await request(`/receipts/${id}`), f.deps);
  assert(response.status === 200 && JSON.stringify(await response.json()) === JSON.stringify(empty(id)));
  assert(f.calls.join(",") === "reaper_gateway_operations_auth,reaper_gateway_operations_receipt");
});

Deno.test("invalid signatures, expired time, path/capture tampering and missing key cause no database or provider call", async () => {
  const cases: Parameters<typeof request>[2][] = [
    { headers: { "x-reaper-signature": "0".repeat(64) } },
    { timestamp: String(now / 1000 - 121) },
    { headers: { "x-reaper-captured-at": "2026-10-11T02:00:00.000Z" } },
    { headers: { "x-reaper-content-sha256": "a".repeat(64) } },
    { headers: { "x-reaper-nonce": "not-a-uuid" } },
  ];
  for (const options of cases) {
    const f = fixture(); const response = await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher, options), f.deps);
    assert(response.status === 401 && f.calls.length === 0);
  }
  const f = fixture(); f.deps.hmacKey = "short";
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps)).status === 401 && !f.calls.length);
  f.deps.hmacKey = "é".repeat(129);
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps)).status === 401 && !f.calls.length);
  const wrongPath = await request(`/checkpoints/${id}`, cipher);
  const changed = new Request(wrongPath.url.replace(id, second), wrongPath);
  assert((await handleGatewayOperations(changed, fixture().deps)).status === 401);
});

Deno.test("fresh nonce replay cannot produce another upload", async () => {
  const f = fixture(); const nonce = crypto.randomUUID();
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher, { nonce }), f.deps)).status === 200);
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher, { nonce }), f.deps)).status === 401);
  assert(f.calls.filter((call) => call.startsWith("create:")).length === 1);
});

Deno.test("invalid HMAC is rejected before reading a body; valid HMAC still binds actual bytes", async () => {
  const signed = await request(`/checkpoints/${id}`, cipher);
  const headers = new Headers(signed.headers); headers.set("x-reaper-signature", "0".repeat(64));
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(cipher); controller.close(); } }, { highWaterMark: 0 });
  const req = new Request(signed.url, { method: "POST", headers, body });
  const f = fixture(); assert((await handleGatewayOperations(req, f.deps)).status === 401 && !reads && !f.calls.length);
  await req.body?.cancel();
  const changed = new Request(signed.url, { method: "POST", headers: signed.headers, body: new Uint8Array(cipher.length).buffer });
  assert((await handleGatewayOperations(changed, f.deps)).status === 401 && !f.calls.length);
});

Deno.test("raw ciphertext is create-only and exact duplicate identity never uploads twice", async () => {
  const f = fixture();
  const first = await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps);
  assert(first.status === 200 && (await first.json()).state === "accepted");
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps)).status === 200);
  const conflict = await handleGatewayOperations(await request(`/checkpoints/${id}`, encoder.encode("age-encryption.org/v1\ndifferent synthetic encrypted fixture only, deliberately not production recovery material")), f.deps);
  assert(conflict.status === 409 && (await conflict.json()).state === "blocked");
  assert(f.calls.filter((call) => call.startsWith("create:")).length === 1 && f.rows.get(id)?.state === "accepted");
});

Deno.test("lost provider or completion acknowledgement resolves the same exact receipt without another write", async () => {
  for (const failure of ["upload", "complete"]) {
    const f = fixture(); if (failure === "upload") f.loseUploadAck(); else f.loseCompleteAck();
    assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps)).status === 200);
    const lookup = await handleGatewayOperations(await request(`/receipts/${id}`), f.deps);
    assert(lookup.status === 200 && (await lookup.json()).state === "accepted");
    assert(f.calls.filter((call) => call.startsWith("create:")).length === 1);
  }
});

Deno.test("uncertain missing upload remains pending and fences different UUIDs without timeout reclaim", async () => {
  const f = fixture(); f.failUpload();
  const first = await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps);
  assert(first.status === 202 && (await first.json()).state === "pending");
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps)).status === 202);
  const lookup = await handleGatewayOperations(await request(`/receipts/${id}`), f.deps);
  assert(lookup.status === 200 && (await lookup.json()).state === "pending");
  assert((await handleGatewayOperations(await request(`/checkpoints/${second}`, cipher), f.deps)).status === 503);
  assert(f.calls.filter((call) => call.startsWith("create:")).length === 1);
});

Deno.test("reconciliation refuses changed ciphertext and creates a durable incident hold", async () => {
  const f = fixture(); f.failUpload();
  await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps);
  f.objects.set(id, encoder.encode("age-encryption.org/v1\ntampered"));
  const response = await handleGatewayOperations(await request(`/receipts/${id}`), f.deps);
  assert(response.status === 200 && (await response.json()).state === "blocked");
  assert(!f.calls.some((call) => call.startsWith("remove:")));
});

Deno.test("heartbeat rejects unknown/duplicate fields, malformed time, partial identity and future validation", async () => {
  const bad = [
    JSON.stringify({ ...payload, member_id: "private" }), JSON.stringify({ ...payload, checkpoint_id: id }),
    JSON.stringify({ ...payload, observed_at: "2026-10-11T03:30:00Z" }), JSON.stringify({ ...payload, observed_at: "2026-10-11T03:27:59.000Z" }),
    JSON.stringify({ ...payload, checkpoint_id: id, checkpoint_captured_at: capturedAt, checkpoint_checked_at: "2026-10-11T03:30:00.001Z" }),
    JSON.stringify({ ...payload, checkpoint_id: id, checkpoint_captured_at: capturedAt, checkpoint_checked_at: "2026-10-11T02:59:59.999Z" }),
    JSON.stringify(payload).replace('"healthy":true', '"healthy":false,"healthy":true'),
    JSON.stringify(payload).replace('"healthy":true', '"healthy":true,"hea\\u006cthy":false'),
    `\ufeff${JSON.stringify(payload)}`, JSON.stringify({ ...payload, healthy: { value: true } }),
    JSON.stringify({ ...payload, checkpoint_id: [] }),
  ];
  for (const body of bad) { const f = fixture(); assert((await handleGatewayOperations(await request("/heartbeat", encoder.encode(body)), f.deps)).status === 400 && !f.calls.length); }
  const f = fixture(); assert((await handleGatewayOperations(await request("/heartbeat", new Uint8Array([0xff, 0xfe])), f.deps)).status === 400 && !f.calls.length);
});

Deno.test("wrong media type, encoding, queries, raw plaintext and oversized bodies are rejected before admission", async () => {
  for (const [body, options] of [
    [encoder.encode("plaintext"), {}], [cipher, { contentType: "text/plain" }], [cipher, { headers: { "content-encoding": "gzip" } }],
    [cipher, { headers: { "content-length": String(MAX_CIPHERTEXT_BYTES + 1) } }],
    [new Uint8Array(MAX_CIPHERTEXT_BYTES + 1), {}],
  ] as const) {
    const f = fixture(); assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, body, options), f.deps)).status === 400 && !f.calls.length);
  }
  const f = fixture(); assert((await handleGatewayOperations(await request(`/receipts/${id}?x=1`), f.deps)).status === 400 && !f.calls.length);
  assert((await handleGatewayOperations(await request("/heartbeat", new Uint8Array(1025)), f.deps)).status === 400);
});

Deno.test("stalled heartbeat body is cancelled at the bounded deadline without authentication RPC", async () => {
  const signed = await request("/heartbeat", encoder.encode(JSON.stringify(payload)));
  let cancelled = false;
  const stalled = new Request(signed.url, { method: "POST", headers: signed.headers, body: new ReadableStream({ cancel() { cancelled = true; } }) });
  const f = fixture(); const response = await handleGatewayOperations(stalled, f.deps);
  assert(response.status === 400 && cancelled && !f.calls.length);
});

Deno.test("separate maintenance secret cannot be replaced by the worker key; ambiguous delete never retries", async () => {
  const f = fixture();
  f.rows.set(id, { ...empty(id), state: "accepted", captured_at: capturedAt, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
  f.objects.set(id, cipher); f.prune({ request_id: id, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
  const maintenance = (auth: string) => new Request("https://operations.test/reaper-gateway-operations/maintenance", { method: "POST", headers: { "content-type": "application/json", "x-reaper-maintenance-secret": auth }, body: "{}" });
  assert((await handleGatewayOperations(maintenance(key), f.deps)).status === 401 && !f.calls.length);
  f.failRemove(); assert((await handleGatewayOperations(maintenance(maintenanceKey), f.deps)).status === 503);
  assert(f.calls.indexOf("reaper_gateway_operations_prune_claim") < f.calls.indexOf(`remove:${id}`));
  assert(!f.calls.includes("reaper_gateway_operations_prune_complete"));
  await handleGatewayOperations(maintenance(maintenanceKey), f.deps);
  assert(f.calls.filter((call) => call.startsWith("remove:")).length === 1);
});

Deno.test("preadmission retires one validated obsolete object before acquiring the sixteenth slot", async () => {
  const f = fixture(); f.full();
  f.rows.set(second, { ...empty(second), state: "accepted", captured_at: capturedAt, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
  f.objects.set(second, cipher); f.prune({ request_id: second, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
  assert((await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps)).status === 200);
  assert(f.rows.get(second)?.state === "retired");
  assert(f.calls.indexOf("reaper_gateway_operations_prune_complete") < f.calls.indexOf(`create:${id}`));
});

Deno.test("cleanup never removes absent or mismatching claimed ciphertext", async () => {
  for (const present of [true, false]) {
    const f = fixture();
    f.rows.set(id, { ...empty(id), state: "accepted", captured_at: capturedAt, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
    if (present) f.objects.set(id, new Uint8Array(cipher.length));
    f.prune({ request_id: id, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
    const response = await handleGatewayOperations(new Request("https://operations.test/reaper-gateway-operations/maintenance", {
      method: "POST", headers: { "content-type": "application/json", "x-reaper-maintenance-secret": maintenanceKey }, body: "{}",
    }), f.deps);
    assert(response.status === 503 && f.rows.get(id)?.state === "blocked");
    assert(!f.calls.some((call) => call.startsWith("remove:")));
  }
});

Deno.test("one maintenance invocation removes at most one of multiple eligible objects", async () => {
  const f = fixture();
  for (const requestId of [id, second]) {
    f.rows.set(requestId, { version: 1, request_id: requestId, state: "accepted", captured_at: capturedAt, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
    f.objects.set(requestId, cipher);
  }
  const original = f.deps.rpc; let claims = 0;
  f.deps.rpc = (name, args) => {
    if (name === "reaper_gateway_operations_prune_claim") {
      claims++; const requestId = claims === 1 ? id : second;
      return Promise.resolve({ request_id: requestId, ciphertext_sha256: f.rows.get(requestId)?.ciphertext_sha256, ciphertext_bytes: cipher.length });
    }
    return original(name, args);
  };
  const response = await handleGatewayOperations(new Request("https://operations.test/reaper-gateway-operations/maintenance", {
    method: "POST", headers: { "content-type": "application/json", "x-reaper-maintenance-secret": maintenanceKey }, body: "{}",
  }), f.deps);
  assert(response.status === 200 && claims === 1 && f.rows.get(id)?.state === "retired" && f.rows.get(second)?.state === "accepted");
  assert(f.calls.filter((call) => call.startsWith("remove:")).length === 1 && f.objects.has(second));
});

Deno.test("retired receipt never grants a second upload or ciphertext read", async () => {
  const f = fixture();
  f.rows.set(id, { version: 1, request_id: id, state: "retired", captured_at: capturedAt, ciphertext_sha256: await sha256(cipher), ciphertext_bytes: cipher.length });
  const response = await handleGatewayOperations(await request(`/checkpoints/${id}`, cipher), f.deps);
  assert(response.status === 409 && (await response.json()).state === "retired");
  assert(!f.calls.some((call) => call.startsWith("create:") || call.startsWith("read:") || call.startsWith("remove:")));
});
