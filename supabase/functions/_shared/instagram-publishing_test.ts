import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finishFailure,
  instagramAccountIdIsValid,
  instagramAccountIdMatchesCanonicalPin,
  instagramApiVersionIsValid,
  instagramAppSecretProof,
  instagramFeedImageIsCompatible,
  instagramGraphFailure,
  instagramGraphOutcome,
  instagramGraphUrl,
  instagramIdentityMatches,
  instagramJobIdIsValid,
  instagramProofUrl,
  instagramPublishFlagEnabled,
  instagramTokenRequestInit,
  normalizeInstagramPostPermalink,
} from "./instagram-publishing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Instagram identifiers use strict provider formats", () => {
  assert(
    instagramAccountIdIsValid("17841400000000000"),
    "valid Graph account id rejected",
  );
  assert(
    !instagramAccountIdIsValid("mochirii_guild"),
    "username accepted as an account id",
  );
  assert(
    !instagramAccountIdIsValid("1262341610290624/instagram"),
    "path-shaped account id accepted",
  );

  assert(instagramApiVersionIsValid("v25.0"), "current API version rejected");
  assert(!instagramApiVersionIsValid("25.0"), "unprefixed version accepted");
  assert(
    !instagramApiVersionIsValid("v25.0/media"),
    "version path accepted",
  );
  assert(
    instagramGraphUrl("latest", "17841400000000000/media") === "",
    "invalid version produced a Graph URL",
  );
  assert(
    instagramGraphUrl("v25.0", "17841400000000000/media") ===
      "https://graph.facebook.com/v25.0/17841400000000000/media",
    "valid Graph URL did not stay on Meta's fixed origin",
  );
  assert(
    instagramJobIdIsValid("63333333-3333-4333-8333-333333333333"),
    "a valid Instagram job UUID was rejected",
  );
  assert(
    !instagramJobIdIsValid("63333333-3333-4333-833333333333"),
    "a malformed Instagram job UUID was accepted",
  );
});

Deno.test("Instagram post evidence uses canonical post or reel permalinks", () => {
  assert(
    normalizeInstagramPostPermalink(
      "https://instagram.com/p/AbC_123/?igsh=tracking",
    ) === "https://www.instagram.com/p/AbC_123/",
    "a canonicalizable Instagram post permalink was rejected",
  );
  assert(
    normalizeInstagramPostPermalink(
      "https://www.instagram.com/reel/Reel-123",
    ) === "https://www.instagram.com/reel/Reel-123/",
    "a canonicalizable Instagram reel permalink was rejected",
  );
  for (
    const invalid of [
      "http://www.instagram.com/p/example/",
      "https://user@www.instagram.com/p/example/",
      "https://www.instagram.com/p/example/#fragment",
      "https://m.instagram.com/p/example/",
      "https://www.instagram.com/stories/example/123/",
      "https://instagram.example/p/example/",
    ]
  ) {
    assert(
      normalizeInstagramPostPermalink(invalid) === null,
      `unsafe Instagram permalink was accepted: ${invalid}`,
    );
  }
});

Deno.test("Instagram Graph account activation requires an exact expected-id secret", () => {
  assert(
    !instagramAccountIdMatchesCanonicalPin("17841400000000000", ""),
    "a missing expected-id secret was treated as pinned",
  );
  assert(
    !instagramAccountIdMatchesCanonicalPin(
      "17841400000000000",
      "not-a-graph-id",
    ),
    "an invalid expected-id secret was treated as pinned",
  );
  assert(
    !instagramAccountIdMatchesCanonicalPin(
      "17841443491948862",
      "17841400000000000",
    ),
    "a mismatched expected-id secret was treated as pinned",
  );
  assert(
    instagramAccountIdMatchesCanonicalPin(
      "17841400000000000",
      "17841400000000000",
    ),
    "the exact expected-id secret match was rejected",
  );
});

Deno.test("Instagram publishing activation requires the exact server flag", () => {
  assert(instagramPublishFlagEnabled("true"), "true flag was rejected");
  assert(!instagramPublishFlagEnabled("false"), "false flag was enabled");
  assert(!instagramPublishFlagEnabled("TRUE"), "uppercase flag was enabled");
  assert(!instagramPublishFlagEnabled(" true "), "padded flag was enabled");
  assert(
    !instagramPublishFlagEnabled(undefined),
    "missing flag was enabled",
  );
});

Deno.test("Instagram identity is pinned to the new Business account", () => {
  const accountId = "17841400000000000";
  assert(
    instagramIdentityMatches(
      {
        id: accountId,
        username: "mochirii_guild",
        account_type: "BUSINESS",
      },
      accountId,
    ),
    "canonical Business identity was rejected",
  );
  assert(
    !instagramIdentityMatches(
      {
        id: accountId,
        username: "mochiriiguild",
        account_type: "BUSINESS",
      },
      accountId,
    ),
    "old Instagram username matched",
  );
  assert(
    !instagramIdentityMatches(
      {
        id: accountId,
        username: "mochirii_guild",
        account_type: "MEDIA_CREATOR",
      },
      accountId,
    ),
    "non-Business account type matched",
  );
  assert(
    !instagramIdentityMatches(
      {
        id: "1262340000000000",
        username: "mochirii_guild",
        account_type: "BUSINESS",
      },
      accountId,
    ),
    "Business Settings asset id substituted for the Graph account id",
  );
});

Deno.test("token-bearing Instagram Graph requests reject redirects", () => {
  const init = instagramTokenRequestInit("placeholder-token", {
    headers: { Accept: "application/json" },
  });
  const headers = new Headers(init.headers);
  assert(init.redirect === "error", "redirects were not rejected");
  assert(
    headers.get("Authorization") === "Bearer placeholder-token",
    "bearer authorization was not installed",
  );
  assert(headers.get("Accept") === "application/json", "headers were lost");
});

Deno.test("Instagram Graph requests carry a server-computed app secret proof", async () => {
  const proof = await instagramAppSecretProof(
    "key",
    "The quick brown fox jumps over the lazy dog",
  );
  assert(
    proof ===
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    "HMAC-SHA256 app secret proof did not match the known vector",
  );
  const proofUrl = new URL(instagramProofUrl(
    "https://graph.facebook.com/v25.0/123?fields=id,username",
    proof,
  ));
  assert(proofUrl.origin === "https://graph.facebook.com", "origin changed");
  assert(proofUrl.searchParams.get("fields") === "id,username", "fields lost");
  assert(proofUrl.searchParams.get("appsecret_proof") === proof, "proof lost");
});

Deno.test("Instagram feed derivative compatibility is fail closed", () => {
  assert(
    instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 2 * 1024 * 1024,
      width: 1080,
      height: 1350,
    }),
    "4:5 social JPEG was rejected",
  );
  assert(
    instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 1440,
      height: 754,
    }),
    "near-1.91:1 social JPEG was rejected",
  );
  assert(
    !instagramFeedImageIsCompatible({
      mimeType: "image/png",
      sizeBytes: 1024,
      width: 1080,
      height: 1080,
    }),
    "PNG derivative was accepted",
  );
  assert(
    !instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 8 * 1024 * 1024 + 1,
      width: 1080,
      height: 1080,
    }),
    "oversized provider derivative was accepted",
  );
  assert(
    !instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 319,
      height: 319,
    }),
    "undersized width was accepted",
  );
  assert(
    !instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 1080,
      height: 1400,
    }),
    "taller-than-4:5 image was accepted",
  );
  assert(
    !instagramFeedImageIsCompatible({
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 1440,
      height: 753,
    }),
    "wider-than-1.91:1 image was accepted",
  );
});

Deno.test("ambiguous Instagram publish server outcomes require reconciliation", () => {
  assert(instagramGraphOutcome(400) === "failed", "400 became ambiguous");
  assert(instagramGraphOutcome(429) === "failed", "429 became ambiguous");
  assert(
    instagramGraphOutcome(500) === "reconcile_required",
    "500 stayed retryable",
  );
  assert(
    instagramGraphOutcome(503) === "reconcile_required",
    "503 stayed retryable",
  );
});

Deno.test("reflected Meta errors never expose signed media evidence", async () => {
  const signedUrl =
    "https://deyvmtncimmcinldjyqe.supabase.co/storage/v1/object/sign/member-gallery/_social/submissions/62222222-2222-4222-8222-222222222221/65555555-5555-4555-8555-555555555555.jpg?token=fake-secret-token";
  const objectPath =
    "_social/submissions/62222222-2222-4222-8222-222222222221/65555555-5555-4555-8555-555555555555.jpg";
  const providerFailure = instagramGraphFailure(
    {
      error: {
        message:
          `Invalid image_url ${signedUrl}; object ${objectPath}; token fake-secret-token`,
        type: "OAuthException",
        code: 100,
        error_subcode: 36003,
      },
    },
    400,
    "container_create",
  );
  let capturedRpc: Record<string, unknown> | null = null;
  const adminClient = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      capturedRpc = { name, params };
      return {
        data: { committed: true, job: { status: "failed" } },
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  const publishResult = await finishFailure(adminClient, {
    jobId: "63333333-3333-4333-8333-333333333333",
    actorId: "61111111-1111-4111-8111-111111111111",
    attempted: true,
    outcome: "failed",
    error: "instagram_container_failed",
    message: providerFailure.message,
    details: providerFailure.details,
  });
  const serialized = JSON.stringify({
    providerFailure,
    publishResult,
    capturedRpc,
  });

  assert(
    providerFailure.message === "Instagram rejected the media container.",
    "provider error text replaced the fixed stage message",
  );
  assert(
    providerFailure.details.provider_error_type === "OAuthException" &&
      providerFailure.details.provider_error_code === 100 &&
      providerFailure.details.provider_error_subcode === 36003,
    "safe provider error identifiers were not retained",
  );
  for (const secretEvidence of [signedUrl, objectPath, "fake-secret-token"]) {
    assert(
      !serialized.includes(secretEvidence),
      `reflected provider evidence escaped into result or RPC params: ${secretEvidence}`,
    );
  }
});
