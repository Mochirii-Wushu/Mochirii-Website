import {
  GALLERY_LOCAL_SANITIZER_ATTESTATION,
  GALLERY_SANITIZER_ATTESTATION_HEADER,
  galleryPreviewSanitizerIsAttested,
  galleryPreviewVercelIdentityFromEnv,
} from "./gallery-preview-attestation.ts";

const SYNTHETIC_VERCEL_IDENTITY = {
  owner: "synthetic-gallery-team",
  ownerId: "team_TestOnlyGalleryOwner000001",
  project: "synthetic-gallery-project",
  projectId: "prj_TestOnlyGalleryProject000001",
} as const;

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
      iss: `https://oidc.vercel.com/${SYNTHETIC_VERCEL_IDENTITY.owner}`,
      aud: `https://vercel.com/${SYNTHETIC_VERCEL_IDENTITY.owner}`,
      sub:
        `owner:${SYNTHETIC_VERCEL_IDENTITY.owner}:project:${SYNTHETIC_VERCEL_IDENTITY.project}:environment:${environment}`,
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: nowSeconds + 3600,
      owner: SYNTHETIC_VERCEL_IDENTITY.owner,
      owner_id: SYNTHETIC_VERCEL_IDENTITY.ownerId,
      project: SYNTHETIC_VERCEL_IDENTITY.project,
      project_id: SYNTHETIC_VERCEL_IDENTITY.projectId,
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
  const fetchImpl = (input: string | URL | Request) => {
    assert(
      String(input) ===
        `https://oidc.vercel.com/${SYNTHETIC_VERCEL_IDENTITY.owner}/.well-known/jwks`,
      "the verifier requested an unpinned JWKS destination",
    );
    return Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return {
    fetchImpl,
    nowMs: nowSeconds * 1000,
    token,
    vercelIdentity: SYNTHETIC_VERCEL_IDENTITY,
  };
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

Deno.test("server-only Vercel identity pins require all four exact values", () => {
  const values = new Map<string, string>([
    ["GALLERY_PREVIEW_VERCEL_OWNER", SYNTHETIC_VERCEL_IDENTITY.owner],
    ["GALLERY_PREVIEW_VERCEL_OWNER_ID", SYNTHETIC_VERCEL_IDENTITY.ownerId],
    ["GALLERY_PREVIEW_VERCEL_PROJECT", SYNTHETIC_VERCEL_IDENTITY.project],
    ["GALLERY_PREVIEW_VERCEL_PROJECT_ID", SYNTHETIC_VERCEL_IDENTITY.projectId],
  ]);
  const loaded = galleryPreviewVercelIdentityFromEnv((name) =>
    values.get(name)
  );
  assert(
    JSON.stringify(loaded) === JSON.stringify(SYNTHETIC_VERCEL_IDENTITY),
    "the exact synthetic identity pins were not loaded",
  );

  for (const key of values.keys()) {
    const missing = new Map(values);
    missing.delete(key);
    assert(
      galleryPreviewVercelIdentityFromEnv((name) => missing.get(name)) ===
        null,
      `${key} was not required`,
    );
  }

  for (
    const [key, malformed] of [
      ["GALLERY_PREVIEW_VERCEL_OWNER", "synthetic.example/path"],
      ["GALLERY_PREVIEW_VERCEL_OWNER_ID", "team_too_short"],
      ["GALLERY_PREVIEW_VERCEL_PROJECT", "synthetic---project"],
      ["GALLERY_PREVIEW_VERCEL_PROJECT_ID", "prj_too_short"],
    ] as const
  ) {
    const invalid = new Map(values);
    invalid.set(key, malformed);
    assert(
      galleryPreviewVercelIdentityFromEnv((name) => invalid.get(name)) ===
        null,
      `${key} accepted a malformed pin`,
    );
  }
});

Deno.test("missing or malformed identity pins fail before a JWKS request", async () => {
  const test = await fixture();
  const token = await test.token();
  for (
    const vercelIdentity of [
      null,
      {
        ...SYNTHETIC_VERCEL_IDENTITY,
        owner: "synthetic.example/path",
      },
      {
        ...SYNTHETIC_VERCEL_IDENTITY,
        project: "synthetic---project",
      },
    ]
  ) {
    let fetched = false;
    assert(
      !(await galleryPreviewSanitizerIsAttested(request(token), {
        nowMs: test.nowMs,
        vercelIdentity,
        fetchImpl: () => {
          fetched = true;
          throw new Error("unexpected JWKS request");
        },
      })),
      "an incomplete or malformed Vercel identity was accepted",
    );
    assert(!fetched, "malformed identity pins influenced a JWKS request");
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
