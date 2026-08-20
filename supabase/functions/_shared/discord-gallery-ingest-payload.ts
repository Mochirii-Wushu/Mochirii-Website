import {
  canonicalDiscordSnowflake,
  DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION,
} from "./discord-gallery-authorization-context.ts";
import { validDiscordGalleryAttachmentUrl } from "./gallery-discord-ingest.ts";
import { GALLERY_SOURCE_IMAGE_MAX_BYTES } from "./gallery-source-image.ts";

type JsonRecord = Record<string, unknown>;

const PAYLOAD_KEYS = new Set([
  "attachmentId",
  "attachmentUrl",
  "authorizationContextSha256",
  "authorizationContextVersion",
  "caption",
  "channelId",
  "discordUserId",
  "guildId",
  "instagramOptIn",
  "messageId",
  "mimeType",
  "originalFilename",
  "sizeBytes",
  "title",
]);
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;

export type DiscordGalleryIngestPayload = {
  attachmentId: string;
  attachmentUrl: string;
  authorizationContextSha256: string;
  authorizationContextVersion:
    typeof DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION;
  caption: string | null;
  channelId: string;
  discordUserId: string;
  guildId: string;
  instagramOptIn: boolean;
  messageId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  originalFilename: string;
  sizeBytes: number;
  title: string | null;
};

function exactOptionalString(
  value: unknown,
  maximumLength: number,
): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximumLength && value.trim() === value
    ? value
    : undefined;
}

function exactRequiredString(
  value: unknown,
  maximumLength: number,
): string | null {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximumLength && value.trim() === value
    ? value
    : null;
}

function filenameMatchesMime(filename: string, mimeType: string): boolean {
  const lowerFilename = filename.toLowerCase();
  if (mimeType === "image/jpeg") {
    return lowerFilename.endsWith(".jpg") || lowerFilename.endsWith(".jpeg");
  }
  if (mimeType === "image/png") return lowerFilename.endsWith(".png");
  return mimeType === "image/webp" && lowerFilename.endsWith(".webp");
}

export function parseDiscordGalleryIngestPayload(
  body: JsonRecord,
): DiscordGalleryIngestPayload | null {
  const keys = Object.keys(body);
  if (
    keys.length !== PAYLOAD_KEYS.size ||
    keys.some((key) => !PAYLOAD_KEYS.has(key)) ||
    Object.values(body).some((value) =>
      typeof value === "string" && value.includes("\uFEFF")
    )
  ) return null;

  const guildId = canonicalDiscordSnowflake(body.guildId);
  const channelId = canonicalDiscordSnowflake(body.channelId);
  const messageId = canonicalDiscordSnowflake(body.messageId);
  const attachmentId = canonicalDiscordSnowflake(body.attachmentId);
  const discordUserId = canonicalDiscordSnowflake(body.discordUserId);
  if (!guildId || !channelId || !messageId || !attachmentId || !discordUserId) {
    return null;
  }

  const attachmentUrl = validDiscordGalleryAttachmentUrl(
    body.attachmentUrl,
    channelId,
    attachmentId,
  );
  const mimeType = typeof body.mimeType === "string" &&
      MIME_TYPES.has(body.mimeType)
    ? body.mimeType as DiscordGalleryIngestPayload["mimeType"]
    : null;
  const originalFilename = exactRequiredString(body.originalFilename, 255);
  const title = exactOptionalString(body.title, 80);
  const caption = exactOptionalString(body.caption, 300);

  if (
    !attachmentUrl || !mimeType || !originalFilename ||
    !filenameMatchesMime(originalFilename, mimeType) ||
    !Number.isSafeInteger(body.sizeBytes) ||
    (body.sizeBytes as number) < 1 ||
    (body.sizeBytes as number) > GALLERY_SOURCE_IMAGE_MAX_BYTES ||
    title === undefined || caption === undefined ||
    typeof body.instagramOptIn !== "boolean" ||
    body.authorizationContextVersion !==
      DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION ||
    typeof body.authorizationContextSha256 !== "string" ||
    !LOWERCASE_SHA256.test(body.authorizationContextSha256)
  ) return null;

  return {
    attachmentId,
    attachmentUrl,
    authorizationContextSha256: body.authorizationContextSha256,
    authorizationContextVersion: DISCORD_GALLERY_AUTHORIZATION_CONTEXT_VERSION,
    caption,
    channelId,
    discordUserId,
    guildId,
    instagramOptIn: body.instagramOptIn,
    messageId,
    mimeType,
    originalFilename,
    sizeBytes: body.sizeBytes as number,
    title,
  };
}
