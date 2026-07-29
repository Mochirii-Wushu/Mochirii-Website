import {
  createDiscordGalleryIngestHeaders,
  createDiscordGalleryIngestSignature,
  DISCORD_GALLERY_INGEST_HEADERS,
  DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS,
  DISCORD_GALLERY_INGEST_PATH,
  discordGalleryIngestActiveKey,
  exactDiscordGalleryIngestPath,
  parseDiscordGalleryIngestHmacKeys,
  readDiscordGalleryIngestBody,
  verifyDiscordGalleryIngestRequest,
} from "./discord-gallery-ingest-auth.ts";

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const NOW_MS = 1_790_000_000_000;
const RAW_BODY = JSON.stringify({ guildId: "1078630751077142608" });
const NONCE = "0123456789abcdef0123456789abcdef";

Deno.test("gallery ingest accepts only the exact deployed function path", () => {
  assertEquals(
    exactDiscordGalleryIngestPath(
      `https://example.supabase.co${DISCORD_GALLERY_INGEST_PATH}`,
    ),
    DISCORD_GALLERY_INGEST_PATH,
  );
  assertEquals(
    exactDiscordGalleryIngestPath(
      `https://example.supabase.co${DISCORD_GALLERY_INGEST_PATH}/other`,
    ),
    null,
  );
  assertEquals(exactDiscordGalleryIngestPath("not a URL"), null);
});

Deno.test("gallery ingest HMAC accepts one fresh body-bound request", async () => {
  const keys = requiredKeys();
  const headers = new Headers(
    await createDiscordGalleryIngestHeaders({
      keys,
      activeKeyId: "primary",
      rawBody: RAW_BODY,
      nowMs: NOW_MS,
      nonce: NONCE,
    }),
  );
  const consumed: string[] = [];
  const result = await verifyDiscordGalleryIngestRequest(headers, RAW_BODY, {
    keys,
    nowMs: NOW_MS,
    consumeNonce: (keyId, nonce, expiresAt) => {
      consumed.push(`${keyId}:${nonce}:${expiresAt}`);
      return Promise.resolve(true);
    },
  });

  assertEquals(result, { ok: true, keyId: "primary" });
  assertEquals(consumed.length, 1);
  assert(
    consumed[0]?.startsWith(`primary:${NONCE}:`),
    "nonce must be consumed",
  );
});

Deno.test("gallery ingest HMAC binds the body, method, and exact function path", async () => {
  const keys = requiredKeys();
  const headers = new Headers(
    await createDiscordGalleryIngestHeaders({
      keys,
      activeKeyId: "primary",
      rawBody: RAW_BODY,
      nowMs: NOW_MS,
      nonce: NONCE,
    }),
  );
  const dependencies = {
    keys,
    nowMs: NOW_MS,
    consumeNonce: () => Promise.resolve(true),
  };

  assertEquals(
    await verifyDiscordGalleryIngestRequest(
      headers,
      `${RAW_BODY} `,
      dependencies,
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(headers, RAW_BODY, {
      ...dependencies,
      method: "PUT",
    }),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verifyDiscordGalleryIngestRequest(headers, RAW_BODY, {
      ...dependencies,
      path: `${DISCORD_GALLERY_INGEST_PATH}/other`,
    }),
    { ok: false, status: 401, error: "invalid_request" },
  );
});

Deno.test("gallery ingest HMAC rejects stale, future, malformed, and unknown-key requests", async () => {
  const keys = requiredKeys();
  const timestamp = Math.floor(NOW_MS / 1000).toString();
  const signature = await createDiscordGalleryIngestSignature({
    secret: SECRET_A,
    keyId: "primary",
    timestamp,
    nonce: NONCE,
    rawBody: RAW_BODY,
  });
  const validHeaders = new Headers({
    [DISCORD_GALLERY_INGEST_HEADERS.keyId]: "primary",
    [DISCORD_GALLERY_INGEST_HEADERS.timestamp]: timestamp,
    [DISCORD_GALLERY_INGEST_HEADERS.nonce]: NONCE,
    [DISCORD_GALLERY_INGEST_HEADERS.signature]: signature,
  });
  const verify = (headers: Headers, nowMs: number) =>
    verifyDiscordGalleryIngestRequest(headers, RAW_BODY, {
      keys,
      nowMs,
      consumeNonce: () => Promise.resolve(true),
    });

  assertEquals(
    await verify(
      validHeaders,
      NOW_MS + (DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS + 1) * 1000,
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );
  assertEquals(
    await verify(
      validHeaders,
      NOW_MS - (DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS + 1) * 1000,
    ),
    { ok: false, status: 401, error: "invalid_request" },
  );

  const malformed = new Headers(validHeaders);
  malformed.set(DISCORD_GALLERY_INGEST_HEADERS.signature, "v1=not-hex");
  assertEquals(await verify(malformed, NOW_MS), {
    ok: false,
    status: 401,
    error: "invalid_request",
  });

  const unknownKey = new Headers(validHeaders);
  unknownKey.set(DISCORD_GALLERY_INGEST_HEADERS.keyId, "retired");
  assertEquals(await verify(unknownKey, NOW_MS), {
    ok: false,
    status: 401,
    error: "invalid_request",
  });
});

Deno.test("gallery ingest HMAC consumes a nonce once and fails closed on store errors", async () => {
  const keys = requiredKeys();
  const headers = new Headers(
    await createDiscordGalleryIngestHeaders({
      keys,
      activeKeyId: "primary",
      rawBody: RAW_BODY,
      nowMs: NOW_MS,
      nonce: NONCE,
    }),
  );
  let available = true;
  const consumed = new Set<string>();
  const verify = () =>
    verifyDiscordGalleryIngestRequest(headers, RAW_BODY, {
      keys,
      nowMs: NOW_MS,
      consumeNonce: (_keyId, nonce) => {
        if (!available) throw new Error("store unavailable");
        if (consumed.has(nonce)) return Promise.resolve(false);
        consumed.add(nonce);
        return Promise.resolve(true);
      },
    });

  assertEquals(await verify(), { ok: true, keyId: "primary" });
  assertEquals(await verify(), {
    ok: false,
    status: 401,
    error: "replayed_request",
  });
  consumed.clear();
  available = false;
  assertEquals(await verify(), {
    ok: false,
    status: 503,
    error: "verification_unavailable",
  });
});

Deno.test("gallery ingest HMAC key parsing supports bounded rotation and rejects weak configuration", () => {
  const keys = requiredKeys();
  assertEquals(discordGalleryIngestActiveKey(keys, "next"), {
    keyId: "next",
    secret: SECRET_B,
  });
  assertEquals(parseDiscordGalleryIngestHmacKeys("{}"), null);
  assertEquals(
    parseDiscordGalleryIngestHmacKeys(JSON.stringify({ primary: "short" })),
    null,
  );
  assertEquals(
    parseDiscordGalleryIngestHmacKeys(JSON.stringify({
      a: SECRET_A,
      b: SECRET_B,
      c: "c".repeat(32),
      d: "d".repeat(32),
    })),
    null,
  );
  assertEquals(
    parseDiscordGalleryIngestHmacKeys(JSON.stringify({
      primary: SECRET_A,
      duplicate: SECRET_A,
    })),
    null,
  );
  assertEquals(discordGalleryIngestActiveKey(keys, "missing"), null);
});

Deno.test("gallery ingest HMAC verifies a secondary key during rotation", async () => {
  const keys = requiredKeys();
  const headers = new Headers(
    await createDiscordGalleryIngestHeaders({
      keys,
      activeKeyId: "next",
      rawBody: RAW_BODY,
      nowMs: NOW_MS,
      nonce: NONCE,
    }),
  );

  assertEquals(
    await verifyDiscordGalleryIngestRequest(headers, RAW_BODY, {
      keys,
      nowMs: NOW_MS,
      consumeNonce: () => Promise.resolve(true),
    }),
    { ok: true, keyId: "next" },
  );
});

Deno.test("gallery ingest body reader enforces media type and streaming byte limits", async () => {
  const validRequest = new Request("https://example.test/functions/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: RAW_BODY,
  });
  assertEquals(await readDiscordGalleryIngestBody(validRequest), {
    ok: true,
    rawBody: RAW_BODY,
  });

  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12345"));
      controller.enqueue(new TextEncoder().encode("67890"));
      controller.close();
    },
  });
  const oversizedRequest = new Request(
    "https://example.test/functions/v1/ingest",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedStream,
    },
  );
  assertEquals(await readDiscordGalleryIngestBody(oversizedRequest, 8), {
    ok: false,
    status: 413,
    error: "request_too_large",
  });

  const wrongMediaType = new Request(
    "https://example.test/functions/v1/ingest",
    {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: RAW_BODY,
    },
  );
  assertEquals(await readDiscordGalleryIngestBody(wrongMediaType), {
    ok: false,
    status: 400,
    error: "invalid_request_body",
  });
});

function requiredKeys() {
  const keys = parseDiscordGalleryIngestHmacKeys(JSON.stringify({
    primary: SECRET_A,
    next: SECRET_B,
  }));
  if (!keys) throw new Error("test key set should be valid");
  return keys;
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
