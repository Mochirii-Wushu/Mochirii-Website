import type { SupabaseClient } from "@supabase/supabase-js";
import {
  instagramAccountIdIsValid,
  instagramAccountIdMatchesCanonicalPin,
  instagramApiVersionIsValid,
  instagramContainerStatusDecision,
  instagramFeedImageIsCompatible,
  instagramGraphFailure,
  instagramGraphOutcome,
  instagramGraphUrl,
  instagramIdentityMatches,
  instagramMediaObjectEvidence,
  instagramPublishFlagEnabled,
  instagramPublishingQuota,
  instagramTemporaryMediaUrlIsSafe,
  normalizeInstagramContainerStatusCode,
  normalizeInstagramPostPermalink,
  publishInstagramJob,
} from "./instagram-publishing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actorId = "61111111-1111-4111-8111-111111111111";
const jobId = "63333333-3333-4333-8333-333333333333";
const expectedUpdatedAt = "2026-07-29T20:00:00.000000+00:00";
const digest = "a".repeat(64);

Deno.test("Instagram identifiers and Graph URL are v26-only", () => {
  assert(instagramAccountIdIsValid("111111111111111"), "numeric id rejected");
  assert(!instagramAccountIdIsValid("mochirii_guild"), "username accepted");
  assert(instagramApiVersionIsValid("v26.0"), "v26 rejected");
  assert(!instagramApiVersionIsValid("v25.0"), "v25 accepted");
  assert(!instagramApiVersionIsValid("latest"), "floating version accepted");
  assert(
    instagramGraphUrl("v26.0", "111111111111111/media") ===
      "https://graph.facebook.com/v26.0/111111111111111/media",
    "Graph URL drifted",
  );
});

Deno.test("Instagram runtime account pin must match independently", () => {
  assert(
    instagramAccountIdMatchesCanonicalPin(
      "111111111111111",
      "111111111111111",
    ),
    "exact pin rejected",
  );
  assert(
    !instagramAccountIdMatchesCanonicalPin(
      "111111111111111",
      "222222222222222",
    ),
    "mismatched pin accepted",
  );
});

Deno.test("Instagram identity verifies id and username without an undocumented subtype field", () => {
  assert(
    instagramIdentityMatches({
      id: "111111111111111",
      username: "mochirii_guild",
    }, "111111111111111"),
    "official identity rejected",
  );
  assert(
    !instagramIdentityMatches({
      id: "111111111111111",
      username: "old_account",
      account_type: "BUSINESS",
    }, "111111111111111"),
    "wrong username accepted",
  );
});

Deno.test("Instagram quota is provider-derived and fail closed", () => {
  const available = instagramPublishingQuota({
    data: [{ quota_usage: 7, config: { quota_total: 23 } }],
  });
  assert(available.readable && !available.exhausted, "dynamic quota rejected");
  assert(available.total === 23, "quota was hard-coded");
  const exhausted = instagramPublishingQuota({
    data: [{ quota_usage: 23, config: { quota_total: 23 } }],
  });
  assert(exhausted.exhausted, "exhausted quota accepted");
  assert(
    !instagramPublishingQuota({ data: [{}] }).readable,
    "missing quota became available",
  );
});

Deno.test("Instagram container states use a closed allowlist", () => {
  const supported = [
    "FINISHED",
    "IN_PROGRESS",
    "ERROR",
    "EXPIRED",
    "PUBLISHED",
  ] as const;
  for (const status of supported) {
    assert(
      normalizeInstagramContainerStatusCode(status.toLowerCase()) === status,
      `${status} was not normalized`,
    );
  }
  assert(
    instagramContainerStatusDecision("FINISHED").action === "ready",
    "finished container was not ready",
  );
  assert(
    instagramContainerStatusDecision("IN_PROGRESS").action ===
      "reconcile_required",
    "in-progress container did not stop before media_publish",
  );
  assert(
    instagramContainerStatusDecision("IN_PROGRESS").error ===
      "container_in_progress",
    "in-progress container lost its safe error category",
  );
  for (const status of ["ERROR", "EXPIRED", "PUBLISHED"] as const) {
    assert(
      instagramContainerStatusDecision(status).action ===
        "reconcile_required",
      `${status} did not fail closed into reconciliation`,
    );
  }
});

Deno.test("unknown and oversized Instagram container states reconcile without raw provider text", () => {
  for (
    const rawStatus of ["FUTURE_PROVIDER_STATE", `SECRET_${"x".repeat(4000)}`]
  ) {
    const decision = instagramContainerStatusDecision(rawStatus);
    const serialized = JSON.stringify(decision);
    assert(decision.statusCode === "UNKNOWN", "untrusted state was retained");
    assert(
      decision.action === "reconcile_required",
      "untrusted state did not enter reconciliation",
    );
    assert(
      decision.error === "container_status_unknown",
      "untrusted state did not use the stable error category",
    );
    assert(!serialized.includes(rawStatus), "raw provider state was retained");
    assert(!serialized.includes("SECRET_"), "provider evidence leaked");
  }
});

Deno.test("Instagram media evidence binds id, owner, username, type, and permalink", () => {
  const evidence = instagramMediaObjectEvidence(
    {
      id: "333333333333333",
      owner: { id: "111111111111111" },
      username: "mochirii_guild",
      media_type: "IMAGE",
      permalink: "https://instagram.com/p/AbC_123/?igsh=tracking",
    },
    "333333333333333",
    "111111111111111",
  );
  assert(evidence.verified, "official image evidence rejected");
  assert(
    evidence.permalink === "https://www.instagram.com/p/AbC_123/",
    "permalink not canonical",
  );
  assert(
    !instagramMediaObjectEvidence(
      {
        id: "333333333333333",
        owner: { id: "999999999999999" },
        username: "mochirii_guild",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/AbC_123/",
      },
      "333333333333333",
      "111111111111111",
    ).verified,
    "foreign owner accepted",
  );
  assert(
    normalizeInstagramPostPermalink("https://evil.example/p/x") === null,
    "foreign permalink accepted",
  );
});

Deno.test("Instagram temporary media URL is HTTPS, origin-bound, and bearer-free", () => {
  const supabaseUrl = "https://project.supabase.co";
  const safeUrl =
    `${supabaseUrl}/storage/v1/object/sign/member-gallery/_social/submissions/` +
    `${jobId}/${actorId}.jpg?token=signed-value`;
  assert(
    instagramTemporaryMediaUrlIsSafe(safeUrl, supabaseUrl),
    "valid temporary media URL was rejected",
  );
  for (
    const value of [
      safeUrl.replace("https://", "http://"),
      safeUrl.replace("project.supabase.co", "evil.example"),
      safeUrl.replace("?token=", "?access_token=secret&token="),
      `${supabaseUrl}/storage/v1/object/public/member-gallery/image.jpg`,
    ]
  ) {
    assert(
      !instagramTemporaryMediaUrlIsSafe(value, supabaseUrl),
      `unsafe temporary media URL was accepted: ${value}`,
    );
  }
});

Deno.test("Instagram copy and missing alt text stop before database or Graph", async () => {
  for (
    const values of [
      { caption: "mochirii dot com", altText: "Reviewed alt" },
      { caption: "Reviewed caption", altText: null },
    ]
  ) {
    let databaseCalls = 0;
    let providerCalls = 0;
    const result = await publishInstagramJob({
      adminClient: {
        rpc: () => {
          databaseCalls += 1;
          throw new Error("database must not run");
        },
      } as unknown as SupabaseClient,
      actorId,
      jobId,
      caption: values.caption,
      altText: values.altText,
      expectedUpdatedAt,
      confirmationFingerprint: digest,
      confirmationCopyHash: digest,
      fetchImpl: () => {
        providerCalls += 1;
        throw new Error("provider must not run");
      },
    });
    assert(!result.ok && !result.attempted, "invalid request attempted");
    assert(databaseCalls === 0, "invalid request reached database");
    assert(providerCalls === 0, "invalid request reached Graph");
  }
});

Deno.test("Instagram disabled flag prevents database and Graph requests", async () => {
  let databaseCalls = 0;
  let providerCalls = 0;
  const result = await publishInstagramJob({
    adminClient: {
      rpc: () => {
        databaseCalls += 1;
        throw new Error("database must not run");
      },
    } as unknown as SupabaseClient,
    actorId,
    jobId,
    caption: "Reviewed caption",
    altText: "Reviewed alt text.",
    expectedUpdatedAt,
    confirmationFingerprint: digest,
    confirmationCopyHash: digest,
    config: {
      accountId: "111111111111111",
      expectedAccountId: "111111111111111",
      accessToken: "token",
      apiVersion: "v26.0",
      appId: "333333333333333",
      appSecret: "secret",
      expectedAppId: "333333333333333",
      expectedUsername: "mochirii_guild",
      accountIdPinned: true,
      publishEnabled: false,
      configured: true,
      missingSecrets: [],
      invalidFields: [],
    },
    fetchImpl: () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  });
  assert(result.error === "instagram_publish_disabled", "wrong blocker");
  assert(databaseCalls === 0, "disabled publisher reached database");
  assert(providerCalls === 0, "disabled publisher reached Graph");
});

Deno.test("Instagram JPEG compatibility and activation are fail closed", () => {
  assert(
    instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 1080,
      height: 1350,
    }),
    "valid 4:5 JPEG rejected",
  );
  assert(
    !instagramFeedImageIsCompatible({
      mimeType: "image/png",
      sizeBytes: 1024,
      width: 1080,
      height: 1080,
    }),
    "PNG accepted",
  );
  assert(instagramPublishFlagEnabled("true"), "exact flag rejected");
  assert(!instagramPublishFlagEnabled("TRUE"), "loose flag accepted");
});

Deno.test("ambiguous outcomes reconcile and reflected provider evidence is redacted", () => {
  assert(instagramGraphOutcome(400) === "failed", "400 ambiguous");
  assert(instagramGraphOutcome(429) === "failed", "429 ambiguous");
  assert(instagramGraphOutcome(500) === "reconcile_required", "500 retryable");
  const reflected =
    "https://storage.example/private?token=secret _social/private.jpg";
  const failure = instagramGraphFailure(
    {
      error: {
        message: reflected,
        type: `OAuthException ${reflected}`,
        code: 100,
        error_subcode: 36003,
      },
    },
    400,
    "container_create",
  );
  const serialized = JSON.stringify(failure);
  assert(failure.details.provider_error_code === 100, "safe code lost");
  for (const value of ["secret", "_social", "storage.example"]) {
    assert(
      !serialized.includes(value),
      `reflected evidence survived: ${value}`,
    );
  }
});
