import {
  authenticateDiscordGalleryIngestBody,
  decodeDiscordGalleryIngestBody,
  DISCORD_GALLERY_INGEST_HEADERS,
  DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS,
  DISCORD_GALLERY_INGEST_PATH,
  DISCORD_GALLERY_INGEST_WIRE_CONTRACT,
  DISCORD_GALLERY_SUPABASE_ORIGIN,
  exactDiscordGalleryIngestPath,
  exactDiscordGallerySupabaseOrigin,
  parseDiscordGalleryIngestHmacKeys,
  readDiscordGalleryIngestBody,
  verifyDiscordGalleryIngestRequest,
} from "./discord-gallery-ingest-auth.ts";

const SECRET = "k".repeat(32);
const NOW_MS = 1_790_000_000_000;
const RAW_BODY = '{"guildId":"900000000000000004"}';
const encoder = new TextEncoder();
const RAW_BODY_BYTES = encoder.encode(RAW_BODY);
const NONCE = "0123456789abcdef0123456789abcdef";
const FIXED_REAPER_SIGNATURE =
  "v1=034008d78c6063d529a028e4cbc09c990f883c0473c3dbb51d6ce887e1b40e93";
const FIXED_BOM_SIGNATURE =
  "v1=354a48904ee02df5324e630e9fc00e9663b6cb10d86122996d79f9f1da033ed7";
const FIXED_INVALID_UTF8_SIGNATURE =
  "v1=e045b1480d0dcd11931acb692110d37cb820739f0c4d73a832d907dd419bf066";

function requiredKeys() {
  const keys = parseDiscordGalleryIngestHmacKeys(
    JSON.stringify({ current: SECRET }),
  );
  if (!keys) throw new Error("synthetic key set should be valid");
  return keys;
}

function fixtureHeaders(overrides: Record<string, string> = {}) {
  return new Headers({
    [DISCORD_GALLERY_INGEST_HEADERS.keyId]: "current",
    [DISCORD_GALLERY_INGEST_HEADERS.timestamp]: "1790000000",
    [DISCORD_GALLERY_INGEST_HEADERS.nonce]: NONCE,
    [DISCORD_GALLERY_INGEST_HEADERS.signature]: FIXED_REAPER_SIGNATURE,
    ...overrides,
  });
}

function dependencies(overrides: Partial<{
  nowMs: number;
  method: string;
  path: string;
  consumeNonce: (
    keyId: string,
    nonce: string,
    expiresAt: string,
  ) => Promise<boolean>;
}> = {}) {
  return {
    keys: requiredKeys(),
    nowMs: NOW_MS,
    method: "POST",
    path: DISCORD_GALLERY_INGEST_PATH,
    consumeNonce: () => Promise.resolve(true),
    ...overrides,
  };
}

Deno.test("Website verifier is bound to the frozen Reaper v1 wire contract", () => {
  assertEquals(
    DISCORD_GALLERY_INGEST_WIRE_CONTRACT,
    "discord-gallery-ingest-hmac.v1",
  );
  assertEquals(
    exactDiscordGalleryIngestPath(
      `${DISCORD_GALLERY_SUPABASE_ORIGIN}${DISCORD_GALLERY_INGEST_PATH}`,
    ),
    DISCORD_GALLERY_INGEST_PATH,
  );
  assertEquals(
    exactDiscordGalleryIngestPath(
      `${DISCORD_GALLERY_SUPABASE_ORIGIN}${DISCORD_GALLERY_INGEST_PATH}/other`,
    ),
    null,
  );
  for (
    const invalidUrl of [
      `${DISCORD_GALLERY_SUPABASE_ORIGIN}${DISCORD_GALLERY_INGEST_PATH}?x=1`,
      `${DISCORD_GALLERY_SUPABASE_ORIGIN}${DISCORD_GALLERY_INGEST_PATH}#fragment`,
      `https://user:password@deyvmtncimmcinldjyqe.supabase.co${DISCORD_GALLERY_INGEST_PATH}`,
      `https://deyvmtncimmcinldjyqe.supabase.co:8443${DISCORD_GALLERY_INGEST_PATH}`,
      `https://other.supabase.co${DISCORD_GALLERY_INGEST_PATH}`,
      `${DISCORD_GALLERY_SUPABASE_ORIGIN}${DISCORD_GALLERY_INGEST_PATH}%2fother`,
      "not a URL",
    ]
  ) assertEquals(exactDiscordGalleryIngestPath(invalidUrl), null);

  const normalizedTraversal = new Request(
    `${DISCORD_GALLERY_SUPABASE_ORIGIN}/discarded/../functions/v1/submit-discord-gallery-image`,
  ).url;
  assertEquals(
    exactDiscordGalleryIngestPath(normalizedTraversal),
    DISCORD_GALLERY_INGEST_PATH,
  );
});

Deno.test("Website receiver accepts only the exact canonical Supabase service origin", () => {
  assertEquals(
    exactDiscordGallerySupabaseOrigin(DISCORD_GALLERY_SUPABASE_ORIGIN),
    DISCORD_GALLERY_SUPABASE_ORIGIN,
  );
  for (
    const invalidOrigin of [
      `http://deyvmtncimmcinldjyqe.supabase.co`,
      `https://deyvmtncimmcinldjyqe.supabase.co/`,
      `https://deyvmtncimmcinldjyqe.supabase.co/rest/v1`,
      `https://deyvmtncimmcinldjyqe.supabase.co?redirect=evil`,
      `https://deyvmtncimmcinldjyqe.supabase.co#fragment`,
      `https://user:password@deyvmtncimmcinldjyqe.supabase.co`,
      `https://deyvmtncimmcinldjyqe.supabase.co:443`,
      `https://deyvmtncimmcinldjyqe.supabase.co.evil.test`,
      ` https://deyvmtncimmcinldjyqe.supabase.co`,
      "not-a-url",
      null,
    ]
  ) assertEquals(exactDiscordGallerySupabaseOrigin(invalidOrigin), null);
});

Deno.test("frozen Reaper signer fixture verifies once against the Website receiver", async () => {
  const consumed: string[] = [];
  const result = await verifyDiscordGalleryIngestRequest(
    fixtureHeaders(),
    RAW_BODY_BYTES,
    dependencies({
      consumeNonce: (keyId, nonce, expiresAt) => {
        consumed.push(`${keyId}:${nonce}:${expiresAt}`);
        return Promise.resolve(true);
      },
    }),
  );
  assertEquals(result, { ok: true, keyId: "current" });
  assert(
    consumed[0]?.startsWith(`current:${NONCE}:`),
    "fresh nonce should be consumed",
  );
});

Deno.test("Website verifier binds exact bytes, method, and runtime-normalized pathname", async () => {
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      encoder.encode(`${RAW_BODY}\r\n`),
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      concatBytes(new Uint8Array([0xef, 0xbb, 0xbf]), RAW_BODY_BYTES),
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      encoder.encode(`${RAW_BODY} `),
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      RAW_BODY_BYTES,
      dependencies({ method: "PUT" }),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      RAW_BODY_BYTES,
      dependencies({ path: `${DISCORD_GALLERY_INGEST_PATH}/other` }),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
});

Deno.test("Website authenticates exact bytes before UTF-8 and BOM rejection", async () => {
  const bomBody = concatBytes(
    new Uint8Array([0xef, 0xbb, 0xbf]),
    RAW_BODY_BYTES,
  );
  const invalidUtf8Body = concatBytes(RAW_BODY_BYTES, new Uint8Array([0xff]));

  for (
    const [rawBodyBytes, signature] of [
      [bomBody, FIXED_BOM_SIGNATURE],
      [invalidUtf8Body, FIXED_INVALID_UTF8_SIGNATURE],
    ] as const
  ) {
    let nonceConsumptions = 0;
    const result = await authenticateDiscordGalleryIngestBody(
      fixtureHeaders({ [DISCORD_GALLERY_INGEST_HEADERS.signature]: signature }),
      rawBodyBytes,
      dependencies({
        consumeNonce: () => {
          nonceConsumptions += 1;
          return Promise.resolve(true);
        },
      }),
    );
    assertEquals(nonceConsumptions, 1);
    assertEquals(result, {
      ok: false,
      status: 400,
      error: "invalid_request_body",
    });
  }

  for (
    const mutatedBody of [
      encoder.encode(`${RAW_BODY} `),
      encoder.encode(`${RAW_BODY}\r\n`),
      bomBody,
    ]
  ) {
    let nonceConsumptions = 0;
    const result = await authenticateDiscordGalleryIngestBody(
      fixtureHeaders(),
      mutatedBody,
      dependencies({
        consumeNonce: () => {
          nonceConsumptions += 1;
          return Promise.resolve(true);
        },
      }),
    );
    assertEquals(nonceConsumptions, 0);
    assertEquals(result, { ok: false, status: 401, error: "invalid_request" });
  }
});

Deno.test("Website verifier rejects stale, future, malformed, and unknown-key requests", async () => {
  for (
    const nowMs of [
      NOW_MS + (DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS + 1) * 1000,
      NOW_MS - (DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS + 1) * 1000,
    ]
  ) {
    assertEquals(
      await verifyDiscordGalleryIngestRequest(
        fixtureHeaders(),
        RAW_BODY_BYTES,
        dependencies({ nowMs }),
      ),
      { ok: false, status: 401, error: "invalid_request" },
    );
  }

  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders({
        [DISCORD_GALLERY_INGEST_HEADERS.signature]: "v1=not-hex",
      }),
      RAW_BODY_BYTES,
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );

  for (const headerName of Object.values(DISCORD_GALLERY_INGEST_HEADERS)) {
    const partialHeaders = fixtureHeaders();
    partialHeaders.delete(headerName);
    assertEquals(
      await verifyDiscordGalleryIngestRequest(
        partialHeaders,
        RAW_BODY_BYTES,
        dependencies(),
      ),
      { ok: false, status: 401, error: "invalid_request" },
    );
  }
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders({
        [DISCORD_GALLERY_INGEST_HEADERS.nonce]:
          "ABCDEF0123456789ABCDEF0123456789",
      }),
      RAW_BODY_BYTES,
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders({
        [DISCORD_GALLERY_INGEST_HEADERS.signature]: `v1=${"0".repeat(64)}`,
      }),
      RAW_BODY_BYTES,
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders({ [DISCORD_GALLERY_INGEST_HEADERS.keyId]: "retired" }),
      RAW_BODY_BYTES,
      dependencies(),
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
});

Deno.test("Website verifier rejects replay and fails closed when nonce storage is unavailable", async () => {
  const consumed = new Set<string>();
  const consumeNonce = (_keyId: string, nonce: string) => {
    if (consumed.has(nonce)) return Promise.resolve(false);
    consumed.add(nonce);
    return Promise.resolve(true);
  };
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      RAW_BODY_BYTES,
      dependencies({ consumeNonce }),
    ),
    { ok: true, keyId: "current" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      RAW_BODY_BYTES,
      dependencies({ consumeNonce }),
    ),
    { ok: false, status: 401, error: "replayed_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      fixtureHeaders(),
      RAW_BODY_BYTES,
      dependencies({
        consumeNonce: () => Promise.reject(new Error("store unavailable")),
      }),
    ),
    { ok: false, status: 503, error: "verification_unavailable" },
  );
});

Deno.test("Website verifier key parsing is bounded and rejects decoded duplicate IDs", () => {
  const valid = parseDiscordGalleryIngestHmacKeys(JSON.stringify({
    current: SECRET,
    next: "n".repeat(32),
  }));
  assert(valid?.current === SECRET, "current key should parse");
  assert(Object.isFrozen(valid), "parsed keys should be immutable");

  for (
    const raw of [
      "",
      "not-json",
      "[]",
      "{}",
      JSON.stringify({ INVALID: SECRET }),
      JSON.stringify({ current: "short" }),
      JSON.stringify({ current: SECRET, duplicate: SECRET }),
      `{"current":"${SECRET}","current":"${"z".repeat(32)}"}`,
      `{"current":"${SECRET}","curr\\u0065nt":"${"z".repeat(32)}"}`,
      JSON.stringify({
        a: SECRET,
        b: "b".repeat(32),
        c: "c".repeat(32),
        d: "d".repeat(32),
      }),
    ]
  ) {
    assertEquals(parseDiscordGalleryIngestHmacKeys(raw), null);
  }
});

Deno.test("Website receiver reads only JSON bodies within the streaming byte limit", async () => {
  const valid = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: RAW_BODY,
  });
  const validRead = await readDiscordGalleryIngestBody(valid);
  assert(validRead.ok, "valid body should be read");
  assertEquals(Array.from(validRead.rawBodyBytes), Array.from(RAW_BODY_BYTES));
  assertEquals(
    decodeDiscordGalleryIngestBody(validRead.rawBodyBytes),
    RAW_BODY,
  );

  const bomBody = concatBytes(
    new Uint8Array([0xef, 0xbb, 0xbf]),
    RAW_BODY_BYTES,
  );
  const bomRequest = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bomBody,
  });
  const bomRead = await readDiscordGalleryIngestBody(bomRequest);
  assert(
    bomRead.ok,
    "bounded reader must preserve BOM bytes before authentication",
  );
  assertEquals(Array.from(bomRead.rawBodyBytes), Array.from(bomBody));
  assertEquals(decodeDiscordGalleryIngestBody(bomRead.rawBodyBytes), null);

  const embeddedFeff = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"caption":"\uFEFF"}',
  });
  const feffRead = await readDiscordGalleryIngestBody(embeddedFeff);
  assert(feffRead.ok, "bounded reader must preserve embedded U+FEFF bytes");
  assertEquals(decodeDiscordGalleryIngestBody(feffRead.rawBodyBytes), null);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12345"));
      controller.enqueue(new TextEncoder().encode("67890"));
      controller.close();
    },
  });
  const oversized = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
  });
  assertEquals(await readDiscordGalleryIngestBody(oversized, 8), {
    ok: false,
    status: 413,
    error: "request_too_large",
  });

  const wrongType = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: RAW_BODY,
  });
  assertEquals(await readDiscordGalleryIngestBody(wrongType), {
    ok: false,
    status: 400,
    error: "invalid_request_body",
  });
});

Deno.test("Website receiver bounds stalled, drip-fed, and aborted request bodies", async () => {
  const stalled = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    }),
  });
  assertEquals(await readDiscordGalleryIngestBody(stalled, 1024, 20), {
    ok: false,
    status: 408,
    error: "request_timeout",
  });

  let dripController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const drip = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        dripController = controller;
        controller.enqueue(encoder.encode("{"));
        setTimeout(() => {
          if (dripController === controller) {
            controller.enqueue(encoder.encode("}"));
          }
        }, 50);
      },
      cancel() {
        dripController = null;
      },
    }),
  });
  assertEquals(await readDiscordGalleryIngestBody(drip, 1024, 20), {
    ok: false,
    status: 408,
    error: "request_timeout",
  });

  const abortController = new AbortController();
  abortController.abort();
  const aborted = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: RAW_BODY,
    signal: abortController.signal,
  });
  assertEquals(await readDiscordGalleryIngestBody(aborted), {
    ok: false,
    status: 400,
    error: "invalid_request_body",
  });
});

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}
