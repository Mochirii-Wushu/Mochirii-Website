import {
  canonicalDiscordSnowflake,
  DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION,
  discordGalleryAuthorizationContextEvidence,
  discordGalleryAuthorizationContextMatches,
} from "./discord-gallery-authorization-context.ts";
import { parseDiscordGalleryIngestJsonRecord } from "./discord-gallery-ingest-auth.ts";
import authorizationContextContract from "../../../docs/integrations/discord-gallery-authorization-context.v1.json" with {
  type: "json",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SYNTHETIC_CONTEXT = {
  guildId: "9000000000000001",
  galleryChannelId: "9000000000000002",
  requiredRoleIds: ["9000000000000004", "9000000000000003"],
} as const;
const SYNTHETIC_CONTEXT_SHA256 =
  "af0e2e6f1bcc2f15633ed33fc8947684c0f86abf50fa82d51c7f849bd72450d2";
const SYNTHETIC_CONTEXT_BASE64 =
  "dmVyc2lvbgBkaXNjb3JkLWdhbGxlcnktYXV0aG9yaXphdGlvbi1jb250ZXh0LnYxCmd1aWxkADkwMDAwMDAwMDAwMDAwMDEKZ2FsbGVyeS1jaGFubmVsADkwMDAwMDAwMDAwMDAwMDIKcmVxdWlyZWQtcm9sZS1jb3VudAAyCnJlcXVpcmVkLXJvbGUtbWF0Y2gAYWxsCnJlcXVpcmVkLXJvbGUAOTAwMDAwMDAwMDAwMDAwMwpyZXF1aXJlZC1yb2xlADkwMDAwMDAwMDAwMDAwMDQK";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

Deno.test("Website independently reproduces the frozen authorization-context vector", async () => {
  const evidence = await discordGalleryAuthorizationContextEvidence(
    SYNTHETIC_CONTEXT,
  );
  assert(evidence, "synthetic context must be valid");
  assert(
    evidence.canonicalBytes.length === 213,
    "canonical byte count drifted",
  );
  assert(
    base64(evidence.canonicalBytes) === SYNTHETIC_CONTEXT_BASE64,
    "canonical bytes drifted",
  );
  assert(
    evidence.sha256 === SYNTHETIC_CONTEXT_SHA256,
    "synthetic SHA-256 drifted",
  );
});

Deno.test("authorization context is order-independent but rejects duplicates and malformed IDs", async () => {
  const reversed = await discordGalleryAuthorizationContextEvidence({
    ...SYNTHETIC_CONTEXT,
    requiredRoleIds: [...SYNTHETIC_CONTEXT.requiredRoleIds].reverse(),
  });
  assert(
    reversed?.sha256 === SYNTHETIC_CONTEXT_SHA256,
    "roles were not ASCII-sorted",
  );

  for (
    const context of [
      { ...SYNTHETIC_CONTEXT, guildId: "not-a-snowflake" },
      { ...SYNTHETIC_CONTEXT, galleryChannelId: "900" },
      { ...SYNTHETIC_CONTEXT, requiredRoleIds: ["9000000000000003"] },
      {
        ...SYNTHETIC_CONTEXT,
        requiredRoleIds: ["9000000000000003", "9000000000000003"],
      },
    ]
  ) {
    assert(
      await discordGalleryAuthorizationContextEvidence(context) === null,
      "invalid context must fail closed",
    );
  }
});

Deno.test("Snowflakes require exact positive uint64 decimal bytes without coercion", () => {
  for (
    const valid of [
      "9000000000000000",
      "10000000000000000",
      "18446744073709551615",
    ]
  ) {
    assert(
      canonicalDiscordSnowflake(valid) === valid,
      `${valid} must be canonical`,
    );
  }

  for (
    const invalid of [
      "09000000000000001",
      "0000000000000000",
      "18446744073709551616",
      " 9000000000000001",
      "9000000000000001 ",
      "+9000000000000001",
      "9000000000000001.0",
      "9000000000000001\n",
      9000000000000001,
    ]
  ) {
    assert(
      canonicalDiscordSnowflake(invalid) === null,
      `non-canonical Snowflake was accepted: ${JSON.stringify(invalid)}`,
    );
  }
});

Deno.test("ASCII role ordering is distinguished from numeric ordering and binds all-role matching", async () => {
  const evidence = await discordGalleryAuthorizationContextEvidence({
    guildId: "9000000000000001",
    galleryChannelId: "9000000000000002",
    requiredRoleIds: ["9000000000000000", "10000000000000000"],
  });
  assert(evidence, "sort-distinguishing context must be valid");
  assert(
    evidence.canonicalBytes.length === 214,
    "sort vector byte count drifted",
  );
  assert(
    evidence.sha256 ===
      "70e0d0f32e819025ab8b35831e2ccd53fc2d6a95599141d4fd7761a6d79fdbab",
    "ASCII sort or all-role binding drifted",
  );
  assert(
    String(evidence.sha256) !==
      "dfbe607461ff52ce4484eb4ad13535243c18d41460f109ec884e6c3d01847c6f",
    "numeric role ordering was accepted",
  );
  assert(
    new TextDecoder().decode(evidence.canonicalBytes).includes(
      `required-role-match${String.fromCharCode(0)}all\n` +
        `required-role${String.fromCharCode(0)}10000000000000000\n` +
        `required-role${String.fromCharCode(0)}9000000000000000\n`,
    ),
    "canonical rows did not bind all-role matching and ASCII order",
  );
});

Deno.test("every frozen negative authorization-context override fails closed", async () => {
  const baseline = authorizationContextContract.negativeVectorBaseline;
  for (const vector of authorizationContextContract.negativeVectors) {
    const override = vector.override as {
      guildId?: unknown;
      galleryChannelId?: unknown;
      requiredRoleMatch?: unknown;
      requiredRoleIdsInput?: unknown;
    };
    const roleMatch = override.requiredRoleMatch ?? baseline.requiredRoleMatch;
    const roleIds = override.requiredRoleIdsInput ??
      baseline.requiredRoleIdsInput;
    const evidence = roleMatch === "all" && Array.isArray(roleIds)
      ? await discordGalleryAuthorizationContextEvidence({
        guildId: (override.guildId ?? baseline.guildId) as string,
        galleryChannelId:
          (override.galleryChannelId ?? baseline.galleryChannelId) as string,
        requiredRoleIds: roleIds as string[],
      })
      : null;
    assert(evidence === null, `${vector.name} negative vector was accepted`);
  }
});

Deno.test("consumer requires both exact HMAC-bound context fields", async () => {
  const body = {
    authorizationContextVersion: DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION,
    authorizationContextSha256: SYNTHETIC_CONTEXT_SHA256,
  };
  assert(
    await discordGalleryAuthorizationContextMatches(body, SYNTHETIC_CONTEXT),
    "matching context must pass",
  );
  for (
    const invalidBody of [
      {},
      {
        ...body,
        authorizationContextVersion: "discord-gallery-authorization-context.v2",
      },
      {
        ...body,
        authorizationContextSha256: SYNTHETIC_CONTEXT_SHA256.toUpperCase(),
      },
      { ...body, authorizationContextSha256: "0".repeat(64) },
    ]
  ) {
    assert(
      !await discordGalleryAuthorizationContextMatches(
        invalidBody,
        SYNTHETIC_CONTEXT,
      ),
      "missing or mismatched context must fail closed",
    );
  }
});

Deno.test("HMAC-bound request JSON rejects literal and decoded duplicate keys", () => {
  const accepted = parseDiscordGalleryIngestJsonRecord(
    `{"authorizationContextVersion":"${DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION}","sizeBytes":1,"instagramOptIn":false}`,
  );
  assert(accepted?.sizeBytes === 1, "flat primitive body must parse");
  for (
    const rawBody of [
      '{"guildId":"9000000000000001","guildId":"9000000000000002"}',
      '{"guildId":"9000000000000001","guild\\u0049d":"9000000000000002"}',
      '{"guildId":{"nested":"unsupported"}}',
      '{"roles":["unsupported"]}',
    ]
  ) {
    assert(
      parseDiscordGalleryIngestJsonRecord(rawBody) === null,
      "ambiguous or nested request body must fail closed",
    );
  }
});
