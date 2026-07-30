import { safeMetaTelemetryFields } from "./safe-telemetry.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Meta telemetry drops identifiers, secrets, paths, URLs, and messages", () => {
  const safe = safeMetaTelemetryFields({
    provider: "instagram",
    stage: "publish_request",
    outcome: "reconcile_required",
    statusCode: 503,
    jobId: "63333333-3333-4333-8333-333333333333",
    accessToken: "secret",
    message: "raw provider message",
    signedUrl: "https://example.test/private?token=secret",
    objectPath: "_social/private.jpg",
    hash: "a".repeat(64),
  });
  const serialized = JSON.stringify(safe);
  assert(safe.provider === "instagram", "provider lost");
  assert(safe.statusCode === 503, "status lost");
  for (
    const forbidden of [
      "63333333",
      "secret",
      "provider message",
      "_social",
      "aaaa",
    ]
  ) {
    assert(
      !serialized.includes(forbidden),
      `unsafe value survived: ${forbidden}`,
    );
  }
});

Deno.test("Meta telemetry accepts only stable labels and valid status codes", () => {
  const safe = safeMetaTelemetryFields({
    stage: "Publish Request",
    errorCategory: "meta_timeout",
    statusCode: 999,
  });
  assert(safe.stage === undefined, "free text label accepted");
  assert(safe.errorCategory === "meta_timeout", "safe category rejected");
  assert(safe.statusCode === undefined, "invalid status accepted");
});
