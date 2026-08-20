import { parseDiscordGalleryIngestPayload } from "./discord-gallery-ingest-payload.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SHA256 = "a".repeat(64);
const baseline = {
  attachmentId: "9000000000000004",
  attachmentUrl:
    "https://cdn.discordapp.com/attachments/9000000000000002/9000000000000004/fixture.JPEG?ex=1&is=2&hm=synthetic",
  authorizationContextSha256: SHA256,
  authorizationContextVersion: "discord-gallery-authorization-context.v1",
  caption: null,
  channelId: "9000000000000002",
  discordUserId: "9000000000000005",
  guildId: "9000000000000001",
  instagramOptIn: false,
  messageId: "9000000000000003",
  mimeType: "image/jpeg",
  originalFilename: "fixture.JPEG",
  sizeBytes: 8_388_608,
  title: null,
};

Deno.test("Website consumer accepts the exact 14-field Reaper payload shape", () => {
  const parsed = parseDiscordGalleryIngestPayload(baseline);
  assert(parsed, "exact producer payload must parse");
  assert(parsed.sizeBytes === 8_388_608, "maximum byte size drifted");
  assert(
    parsed.title === null && parsed.caption === null,
    "explicit null optionals drifted",
  );
  assert(
    parsed.originalFilename === "fixture.JPEG",
    "signed filename bytes changed",
  );
});

Deno.test("Website consumer rejects missing, unknown, and implicit optional fields", () => {
  const { caption: _caption, ...missing } = baseline;
  assert(
    parseDiscordGalleryIngestPayload(missing) === null,
    "missing key was accepted",
  );
  assert(
    parseDiscordGalleryIngestPayload({ ...baseline, unknown: true }) === null,
    "unknown key was accepted",
  );
  assert(
    parseDiscordGalleryIngestPayload({ ...baseline, title: undefined }) ===
      null,
    "undefined optional was accepted",
  );
});

Deno.test("Website consumer rejects coercion, whitespace, and truncation", () => {
  for (
    const override of [
      { guildId: " 9000000000000001" },
      { sizeBytes: "10" },
      { instagramOptIn: 0 },
      { originalFilename: " fixture.jpeg" },
      { originalFilename: `${"f".repeat(252)}.jpg` },
      { title: " " },
      { title: "t".repeat(81) },
      { caption: "c".repeat(301) },
    ]
  ) {
    assert(
      parseDiscordGalleryIngestPayload({ ...baseline, ...override }) === null,
      `non-canonical payload was accepted: ${Object.keys(override)[0]}`,
    );
  }
});

Deno.test("Website consumer rejects escaped semantic U+FEFF", () => {
  const escapedTitle = JSON.parse('"a\\uFEFFb"');
  assert(
    escapedTitle === "a\uFEFFb",
    "fixture must decode an escaped U+FEFF",
  );
  assert(
    parseDiscordGalleryIngestPayload({
      ...baseline,
      title: escapedTitle,
    }) === null,
    "escaped semantic U+FEFF was accepted",
  );
});

Deno.test("Website consumer enforces size, MIME, filename, and URL identity", () => {
  for (
    const override of [
      { sizeBytes: 0 },
      { sizeBytes: 8_388_609 },
      { sizeBytes: 1.5 },
      { mimeType: "image/jpg" },
      { mimeType: "image/png" },
      { originalFilename: "fixture.webp" },
      {
        attachmentUrl:
          "https://cdn.discordapp.com/attachments/9000000000000099/9000000000000004/fixture.JPEG",
      },
      {
        attachmentUrl:
          "https://cdn.discordapp.com/attachments/9000000000000002/9000000000000099/fixture.JPEG",
      },
      { attachmentUrl: ` ${baseline.attachmentUrl}` },
      { attachmentUrl: baseline.attachmentUrl.replace("https://", "HTTPS://") },
    ]
  ) {
    assert(
      parseDiscordGalleryIngestPayload({ ...baseline, ...override }) === null,
      `identity or media mismatch was accepted: ${Object.keys(override)[0]}`,
    );
  }
});

Deno.test("Website consumer requires exact authorization-context fields", () => {
  for (
    const override of [
      {
        authorizationContextVersion: "discord-gallery-authorization-context.v2",
      },
      { authorizationContextSha256: "A".repeat(64) },
      { authorizationContextSha256: "a".repeat(63) },
    ]
  ) {
    assert(
      parseDiscordGalleryIngestPayload({ ...baseline, ...override }) === null,
      "authorization-context shape drift was accepted",
    );
  }
});
