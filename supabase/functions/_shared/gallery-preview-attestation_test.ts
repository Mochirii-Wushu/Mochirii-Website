import {
  GALLERY_LOCAL_SANITIZER_ATTESTATION,
  GALLERY_SANITIZER_ATTESTATION_HEADER,
  galleryPreviewSanitizerIsAttested,
} from "./gallery-preview-attestation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

async function fixture() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "gallery-test-key";
  Object.assign(jwk, { alg: "RS256", kid, use: "sig", key_ops: ["verify"] });
  const nowSeconds = 1_785_242_400;
  async function token(
    overrides: Record<string, unknown> = {},
    headerOverrides: Record<string, unknown> = {},
  ) {
    const header = base64Url(
      JSON.stringify({ typ: "JWT", alg: "RS256", kid, ...headerOverrides }),
    );
    const environment = String(overrides.environment || "preview");
    const payload = base64Url(JSON.stringify({
      iss: "https://oidc.vercel.com/mochirii",
      aud: "https://vercel.com/mochirii",
      sub: `owner:mochirii:project:mochirii:environment:${environment}`,
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: nowSeconds + 3600,
      owner: "mochirii",
      owner_id: "team_kxEoikL8rs06zcQqN5w6TZN2",
      project: "mochirii",
      project_id: "prj_iYdxmeRnENzAHWzeXgbDWpfieSEt",
      environment,
      ...overrides,
    }));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    );
    return `${header}.${payload}.${base64Url(signature)}`;
  }
  const fetchImpl = () =>
    Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  return { fetchImpl, nowMs: nowSeconds * 1000, token };
}

function request(
  token?: string,
  url = "https://project.supabase.co/functions/v1/list-gallery-review-queue",
) {
  return new Request(url, {
    method: "POST",
    headers: token ? { [GALLERY_SANITIZER_ATTESTATION_HEADER]: token } : {},
  });
}

Deno.test("a moderator bearer alone cannot attest the source-byte request", async () => {
  let fetched = false;
  const allowed = await galleryPreviewSanitizerIsAttested(
    new Request(
      "https://project.supabase.co/functions/v1/list-gallery-review-queue",
      {
        method: "POST",
        headers: { Authorization: "Bearer header.payload.signature" },
      },
    ),
    {
      fetchImpl: () => {
        fetched = true;
        throw new Error("unexpected");
      },
    },
  );
  assert(!allowed, "a moderator bearer bypassed sanitizer attestation");
  assert(!fetched, "a missing attestation caused a JWKS request");
});

Deno.test("signed Vercel preview and production project identities are accepted", async () => {
  const test = await fixture();
  for (const environment of ["preview", "production"]) {
    assert(
      await galleryPreviewSanitizerIsAttested(
        request(await test.token({ environment })),
        test,
      ),
      `${environment} Vercel identity was rejected`,
    );
  }
});

Deno.test("wrong claims, algorithms, signatures, and time windows fail closed", async () => {
  const test = await fixture();
  const candidates = [
    await test.token({ owner: "outside" }),
    await test.token({ owner_id: "team_outside" }),
    await test.token({ project: "outside" }),
    await test.token({ project_id: "prj_outside" }),
    await test.token({ aud: "https://vercel.com/outside" }),
    await test.token({ environment: "development" }),
    await test.token({ exp: Math.floor(test.nowMs / 1000) }),
    await test.token({ nbf: Math.floor(test.nowMs / 1000) + 61 }),
    await test.token({}, { alg: "none" }),
    await test.token({}, { crit: ["outside"] }),
  ];
  const valid = await test.token();
  candidates.push(`${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`);
  for (const candidate of candidates) {
    assert(
      !(await galleryPreviewSanitizerIsAttested(request(candidate), test)),
      "an invalid Vercel identity was accepted",
    );
  }
});

Deno.test("the local marker is confined to the exact loopback Supabase origin", async () => {
  assert(
    await galleryPreviewSanitizerIsAttested(
      request(
        GALLERY_LOCAL_SANITIZER_ATTESTATION,
        "http://127.0.0.1:54321/functions/v1/list-gallery-review-queue",
      ),
      { supabaseUrl: "http://localhost:54321" },
    ),
    "the exact local sanitizer was rejected",
  );
  for (
    const [url, supabaseUrl] of [
      [
        "https://project.supabase.co/functions/v1/list-gallery-review-queue",
        "https://project.supabase.co",
      ],
      [
        "http://127.0.0.1.example.com:54321/functions/v1/list-gallery-review-queue",
        "http://127.0.0.1.example.com:54321",
      ],
      [
        "http://127.0.0.1:54322/functions/v1/list-gallery-review-queue",
        "http://127.0.0.1:54321",
      ],
    ]
  ) {
    assert(
      !(await galleryPreviewSanitizerIsAttested(
        request(GALLERY_LOCAL_SANITIZER_ATTESTATION, url),
        { supabaseUrl },
      )),
      "the local-only marker escaped its loopback boundary",
    );
  }
});
