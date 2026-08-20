import {
  parseDiscordGalleryReservationAcquisition,
  parseDiscordGalleryReservationFinalization,
  parseDiscordGalleryUploadConfirmation,
} from "./discord-gallery-storage-reservation.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LEASE_ID = "22222222-2222-4222-8222-222222222222";
const OBJECT_ID = "33333333-3333-4333-8333-333333333333";
const SUBMISSION_ID = "44444444-4444-4444-8444-444444444444";

Deno.test("reservation acquisition accepts only its lease-generation user path and MIME extension", () => {
  const acquired = {
    outcome: "acquired",
    leaseToken: LEASE_ID,
    leaseExpiresAt: "2026-08-11T12:02:00.000Z",
    storagePath: `${USER_ID}/discord-ingest/${LEASE_ID}.webp`,
  };
  assertEquals(
    parseDiscordGalleryReservationAcquisition(acquired, USER_ID, "image/webp"),
    acquired,
  );
  for (
    const storagePath of [
      `${USER_ID}/discord-ingest/${OBJECT_ID}.jpg`,
      `${USER_ID}/discord-ingest/${OBJECT_ID}.webp`,
      `55555555-5555-4555-8555-555555555555/discord-ingest/${OBJECT_ID}.webp`,
      `${USER_ID}/discord-ingest/../../other.webp`,
      `${USER_ID}/discord/${OBJECT_ID}.webp`,
    ]
  ) {
    assertEquals(
      parseDiscordGalleryReservationAcquisition(
        { ...acquired, storagePath },
        USER_ID,
        "image/webp",
      ),
      null,
    );
  }
});

Deno.test("reservation acquisition validates ready, busy, conflict, and tombstone outcomes", () => {
  for (const outcome of ["busy", "conflict", "invalid", "tombstoned"]) {
    assertEquals(
      parseDiscordGalleryReservationAcquisition(
        { outcome },
        USER_ID,
        "image/png",
      ),
      { outcome },
    );
  }
  const ready = {
    outcome: "ready",
    submissionId: SUBMISSION_ID,
    status: "pending",
    createdAt: "2026-08-11T12:00:00.000Z",
  };
  assertEquals(
    parseDiscordGalleryReservationAcquisition(ready, USER_ID, "image/png"),
    ready,
  );
  assertEquals(
    parseDiscordGalleryReservationAcquisition(
      { ...ready, submissionId: "not-a-uuid" },
      USER_ID,
      "image/png",
    ),
    null,
  );
});

Deno.test("confirmation and finalization reject malformed database outcomes", () => {
  assertEquals(
    parseDiscordGalleryUploadConfirmation({ outcome: "confirmed" }),
    {
      outcome: "confirmed",
    },
  );
  assertEquals(
    parseDiscordGalleryUploadConfirmation({ outcome: "other" }),
    null,
  );

  const created = {
    outcome: "created",
    submissionId: SUBMISSION_ID,
    status: "pending",
    createdAt: "2026-08-11T12:00:00.000Z",
  };
  assertEquals(parseDiscordGalleryReservationFinalization(created), created);
  assertEquals(
    parseDiscordGalleryReservationFinalization({
      ...created,
      status: "private",
    }),
    null,
  );
  assertEquals(
    parseDiscordGalleryReservationFinalization({ outcome: "object_changed" }),
    { outcome: "object_changed" },
  );
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}
