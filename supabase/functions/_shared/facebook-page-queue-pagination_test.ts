import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  decodeFacebookPageQueueCursor,
  encodeFacebookPageQueueCursor,
  parseFacebookPageQueuePageSize,
  parseFacebookPageQueueStatus,
} from "./facebook-page-queue-pagination.ts";

const cursorValue = {
  updatedAt: "2026-07-29T06:00:00.123456+00:00",
  id: "11111111-1111-4111-8111-111111111111",
};

Deno.test("Facebook Page queue cursor round trips and is status bound", () => {
  const encoded = encodeFacebookPageQueueCursor("queued", cursorValue);
  assertEquals(decodeFacebookPageQueueCursor(encoded, "queued"), cursorValue);
  assertThrows(() => decodeFacebookPageQueueCursor(encoded, "failed"));
});

Deno.test("Facebook Page queue cursor preserves Postgres microseconds", () => {
  const encoded = encodeFacebookPageQueueCursor("queued", cursorValue);
  const decoded = decodeFacebookPageQueueCursor(encoded, "queued");
  assertEquals(decoded?.updatedAt, "2026-07-29T06:00:00.123456+00:00");
});

Deno.test("Facebook Page queue cursor rejects malformed input", () => {
  assertThrows(() => decodeFacebookPageQueueCursor("not-a-cursor", "queued"));
  assertThrows(() =>
    encodeFacebookPageQueueCursor("queued", {
      ...cursorValue,
      id: "not-a-uuid",
    })
  );
});

Deno.test("Facebook Page queue status and page size are bounded", () => {
  assertEquals(parseFacebookPageQueueStatus(undefined), "queued");
  assertEquals(
    parseFacebookPageQueueStatus("reconcile_required"),
    "reconcile_required",
  );
  assertEquals(parseFacebookPageQueueStatus("unknown"), null);
  assertEquals(parseFacebookPageQueuePageSize(undefined), 25);
  assertEquals(parseFacebookPageQueuePageSize(50), 50);
  assertEquals(parseFacebookPageQueuePageSize(51), null);
  assertEquals(parseFacebookPageQueuePageSize("25"), null);
});
