import { constantTimeLowerHexMatches } from "./discord-gallery-ingest-auth.ts";

export const DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION =
  "discord-gallery-authorization-context.v1";
export const DISCORD_GALLERY_AUTHORIZATION_CONTEXT_REQUIRED_ROLE_COUNT = 2;
export const DISCORD_GALLERY_AUTHORIZATION_CONTEXT_REQUIRED_ROLE_MATCH = "all";

const DISCORD_SNOWFLAKE_PATTERN = /^[1-9][0-9]{15,19}$/;
const DISCORD_SNOWFLAKE_MAXIMUM = 18_446_744_073_709_551_615n;
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

export type DiscordGalleryAuthorizationContext = {
  guildId: string;
  galleryChannelId: string;
  requiredRoleIds: readonly string[];
};

export type DiscordGalleryAuthorizationContextEvidence = {
  version: typeof DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION;
  canonicalBytes: Uint8Array;
  sha256: string;
};

export function canonicalDiscordSnowflake(value: unknown): string | null {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= DISCORD_SNOWFLAKE_MAXIMUM &&
        parsed.toString(10) === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function canonicalRoleIds(roleIds: readonly string[]): string[] | null {
  if (
    roleIds.length !==
      DISCORD_GALLERY_AUTHORIZATION_CONTEXT_REQUIRED_ROLE_COUNT ||
    roleIds.some((roleId) => canonicalDiscordSnowflake(roleId) === null)
  ) return null;
  if (new Set(roleIds).size !== roleIds.length) return null;
  return [...roleIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}

function bytesToLowerHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function discordGalleryAuthorizationContextEvidence(
  context: DiscordGalleryAuthorizationContext,
): Promise<DiscordGalleryAuthorizationContextEvidence | null> {
  if (
    canonicalDiscordSnowflake(context.guildId) === null ||
    canonicalDiscordSnowflake(context.galleryChannelId) === null
  ) return null;
  const roleIds = canonicalRoleIds(context.requiredRoleIds);
  if (!roleIds) return null;

  const rows = [
    ["version", DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION],
    ["guild", context.guildId],
    ["gallery-channel", context.galleryChannelId],
    ["required-role-count", String(roleIds.length)],
    [
      "required-role-match",
      DISCORD_GALLERY_AUTHORIZATION_CONTEXT_REQUIRED_ROLE_MATCH,
    ],
    ...roleIds.map((roleId) => ["required-role", roleId]),
  ];
  const canonicalBytes = encoder.encode(
    rows.map(([label, value]) => `${label}\0${value}\n`).join(""),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(canonicalBytes),
  );
  return {
    version: DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION,
    canonicalBytes,
    sha256: bytesToLowerHex(new Uint8Array(digest)),
  };
}

export async function discordGalleryAuthorizationContextMatches(
  body: Record<string, unknown>,
  context: DiscordGalleryAuthorizationContext,
): Promise<boolean> {
  if (
    body.authorizationContextVersion !==
      DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION ||
    typeof body.authorizationContextSha256 !== "string" ||
    !LOWERCASE_SHA256_PATTERN.test(body.authorizationContextSha256)
  ) return false;

  const expected = await discordGalleryAuthorizationContextEvidence(context);
  return Boolean(
    expected &&
      constantTimeLowerHexMatches(
        expected.sha256,
        body.authorizationContextSha256,
      ),
  );
}
