import {
  FACEBOOK_CANONICAL_PAGE_ID,
  FACEBOOK_CANONICAL_PAGE_NAME,
  facebookApiVersionIsValid,
  facebookAppSecretProof,
  facebookAuthenticatedGraphUrl,
  facebookGraphErrorDetails,
  facebookGraphOutcome,
  facebookGraphUrl,
  facebookPageIdentityMatches,
  facebookPageIdIsValid,
  facebookPageObjectEvidence,
  facebookPagePublishFlagEnabled,
  facebookTasksCanPublish,
  facebookTokenRequestInit,
  normalizeFacebookPermalink,
} from "./facebook-page-publishing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Facebook identifiers use strict provider formats", () => {
  assert(facebookPageIdIsValid("123456789012345"), "valid Page id rejected");
  assert(!facebookPageIdIsValid("page-name"), "named Page id accepted");
  assert(!facebookPageIdIsValid("123/456"), "path-shaped Page id accepted");
  assert(!facebookPageIdIsValid("1234"), "short Page id accepted");

  assert(facebookApiVersionIsValid("v25.0"), "current API version rejected");
  assert(!facebookApiVersionIsValid("25.0"), "unprefixed version accepted");
  assert(!facebookApiVersionIsValid("v25.0/photos"), "version path accepted");
  assert(!facebookApiVersionIsValid("latest"), "floating version accepted");
  assert(
    facebookGraphUrl("latest", "123/photos") === "",
    "invalid version produced a Graph URL",
  );
  assert(
    facebookGraphUrl("v25.0", "123456/photos") ===
      "https://graph.facebook.com/v25.0/123456/photos",
    "valid Graph URL did not stay on Meta's fixed origin",
  );
});

Deno.test("Facebook inventory is hard-pinned to the official Page identity", () => {
  assert(
    facebookPageIdentityMatches(
      FACEBOOK_CANONICAL_PAGE_ID,
      FACEBOOK_CANONICAL_PAGE_NAME,
    ),
    "canonical Page identity was rejected",
  );
  assert(
    !facebookPageIdentityMatches(
      FACEBOOK_CANONICAL_PAGE_ID,
      "Mochirii",
    ),
    "wrong Page name was accepted",
  );
  assert(
    !facebookPageIdentityMatches(
      "999999999999999",
      FACEBOOK_CANONICAL_PAGE_NAME,
    ),
    "wrong Page id was accepted",
  );
});

Deno.test("token-bearing Graph URLs include a server-derived appsecret proof", async () => {
  const proof = await facebookAppSecretProof(
    "The quick brown fox jumps over the lazy dog",
    "key",
  );
  assert(
    proof ===
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    "HMAC-SHA256 proof did not match the known vector",
  );

  const graphUrl = await facebookAuthenticatedGraphUrl(
    "v25.0",
    `${FACEBOOK_CANONICAL_PAGE_ID}?fields=id,name`,
    "token",
    "secret",
  );
  const parsed = new URL(graphUrl);
  assert(
    parsed.origin === "https://graph.facebook.com",
    "Graph origin drifted",
  );
  assert(
    /^[0-9a-f]{64}$/.test(parsed.searchParams.get("appsecret_proof") || ""),
    "authenticated Graph URL omitted appsecret proof",
  );
  assert(!graphUrl.includes("token"), "access token leaked into the Graph URL");
});

Deno.test("Page task evidence recognizes create-content authority", () => {
  assert(facebookTasksCanPublish(["CREATE_CONTENT"]), "Page task was rejected");
  assert(
    facebookTasksCanPublish(["PROFILE_PLUS_CREATE_CONTENT"]),
    "profile-plus create task was rejected",
  );
  assert(
    !facebookTasksCanPublish(["MODERATE"]),
    "moderation implied publishing",
  );
  assert(!facebookTasksCanPublish([]), "missing tasks implied publishing");
  assert(!facebookTasksCanPublish(null), "invalid tasks implied publishing");
});

Deno.test("Page publishing activation requires the exact server flag", () => {
  assert(facebookPagePublishFlagEnabled("true"), "true flag was rejected");
  assert(!facebookPagePublishFlagEnabled("false"), "false flag was enabled");
  assert(!facebookPagePublishFlagEnabled("TRUE"), "uppercase flag was enabled");
  assert(!facebookPagePublishFlagEnabled(" true "), "padded flag was enabled");
  assert(
    !facebookPagePublishFlagEnabled(undefined),
    "missing flag was enabled",
  );
});

Deno.test("token-bearing Graph requests reject redirects", () => {
  const init = facebookTokenRequestInit("placeholder-token", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const headers = new Headers(init.headers);
  assert(init.method === "POST", "request method was not preserved");
  assert(init.redirect === "error", "redirects were not rejected");
  assert(
    headers.get("Authorization") === "Bearer placeholder-token",
    "bearer authorization was not installed",
  );
  assert(headers.get("Accept") === "application/json", "headers were lost");
});

Deno.test("ambiguous Graph server failures require reconciliation", () => {
  assert(
    facebookGraphOutcome(400) === "failed",
    "client rejection became ambiguous",
  );
  assert(facebookGraphOutcome(429) === "failed", "rate limit became ambiguous");
  assert(
    facebookGraphOutcome(500) === "reconcile_required",
    "server failure stayed retryable",
  );
  assert(
    facebookGraphOutcome(503) === "reconcile_required",
    "provider outage stayed retryable",
  );
});

Deno.test("Facebook permalinks are canonical and remain on known HTTPS hosts", () => {
  assert(
    normalizeFacebookPermalink(
      "https://m.facebook.com/story.php?story_fbid=12345&id=67890&utm_source=test",
    ) ===
      "https://www.facebook.com/story.php?story_fbid=12345&id=67890",
    "known mobile permalink was not normalized",
  );
  assert(
    normalizeFacebookPermalink("https://facebook.com/photo/?fbid=34") ===
      "https://www.facebook.com/photo.php?fbid=34",
    "legacy photo path did not use the database canonical form",
  );
  for (
    const value of [
      "javascript:alert(1)",
      "https://evil.facebook.com/post/1",
      "https://facebook.com.example.test/post/1",
      "https://user:pass@www.facebook.com/post/1",
      "https://www.facebook.com/post/1#fragment",
      "https://www.facebook.com:8443/post/1",
      "https://www.facebook.com/",
      "https://www.facebook.com/profile.php?id=61592841711452",
      "https://www.facebook.com/about",
      "https://www.facebook.com/?story_fbid=12345&id=67890",
    ]
  ) {
    assert(
      normalizeFacebookPermalink(value) === null,
      `unsafe permalink was accepted: ${value}`,
    );
  }
});

Deno.test("Facebook object evidence is bound to the pinned Page and requested id", () => {
  const verified = facebookPageObjectEvidence({
    id: "1222888660907862_987654321",
    from: { id: FACEBOOK_CANONICAL_PAGE_ID },
    permalink_url:
      "https://www.facebook.com/1222888660907862/posts/987654321?utm_source=test",
  }, "1222888660907862_987654321");
  assert(verified.verified, "canonical Page object evidence was rejected");
  assert(
    verified.permalink ===
      "https://www.facebook.com/1222888660907862/posts/987654321",
    "tracking parameters were not removed",
  );

  assert(
    !facebookPageObjectEvidence({
      id: "1222888660907862_987654321",
      from: { id: "999999999999999" },
      permalink_url: "https://www.facebook.com/other-page/posts/987654321",
    }, "1222888660907862_987654321").verified,
    "unrelated Page ownership was accepted",
  );
  assert(
    !facebookPageObjectEvidence({
      id: "different-object",
      from: { id: FACEBOOK_CANONICAL_PAGE_ID },
      permalink_url:
        "https://www.facebook.com/1222888660907862/posts/987654321",
    }, "1222888660907862_987654321").verified,
    "substituted object id was accepted",
  );
});

Deno.test("reflected Graph messages cannot enter stored audit details", () => {
  const reflection =
    "token=secret appsecret_proof=proof https://graph.facebook.com/v25.0/object _social/submissions/private.jpg";
  const details = facebookGraphErrorDetails({
    error: {
      message: reflection,
      type: `OAuthException ${reflection}`,
      code: 190,
      error_subcode: 463,
    },
    message: reflection,
  }, 400);
  const serialized = JSON.stringify(details);
  assert(details.status_code === 400, "safe status code was lost");
  assert(details.provider_error_code === 190, "safe error code was lost");
  assert(details.provider_error_subcode === 463, "safe subcode was lost");
  assert(details.provider_error_type === null, "unsafe provider type survived");
  assert(!serialized.includes("secret"), "reflected token survived");
  assert(!serialized.includes("appsecret_proof"), "reflected proof survived");
  assert(!serialized.includes("_social/"), "reflected object path survived");
});
