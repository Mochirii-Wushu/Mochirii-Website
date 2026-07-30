import type { SupabaseClient } from "@supabase/supabase-js";
import {
  facebookApiVersionIsValid,
  facebookGraphErrorDetails,
  facebookGraphOutcome,
  facebookGraphUrl,
  facebookPageIdentityMatches,
  facebookPageIdIsValid,
  facebookPageObjectEvidence,
  facebookPagePublishFlagEnabled,
  facebookTasksCanPublish,
  normalizeFacebookPermalink,
  publishFacebookPageJob,
} from "./facebook-page-publishing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actorId = "61111111-1111-4111-8111-111111111111";
const jobId = "63333333-3333-4333-8333-333333333333";
const expectedUpdatedAt = "2026-07-29T20:00:00.000000+00:00";
const digest = "a".repeat(64);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.test("Facebook identifiers and Graph URL are v26-only", () => {
  assert(facebookPageIdIsValid("111111111111111"), "numeric id rejected");
  assert(!facebookPageIdIsValid("page-name"), "named id accepted");
  assert(facebookApiVersionIsValid("v26.0"), "v26 rejected");
  assert(!facebookApiVersionIsValid("v25.0"), "v25 accepted");
  assert(!facebookApiVersionIsValid("latest"), "floating version accepted");
  assert(
    facebookGraphUrl("v26.0", "111111111111111/photos") ===
      "https://graph.facebook.com/v26.0/111111111111111/photos",
    "Graph URL drifted",
  );
  assert(
    facebookGraphUrl("v26.0", "https://evil.example") === "",
    "origin escaped",
  );
});

Deno.test("Facebook runtime identity uses an independent expected id", () => {
  assert(
    facebookPageIdentityMatches("111111111111111", "111111111111111"),
    "exact runtime pin rejected",
  );
  assert(
    !facebookPageIdentityMatches("111111111111111", "222222222222222"),
    "mismatched runtime pin accepted",
  );
});

Deno.test("Facebook copy is rejected before database and provider access", async () => {
  let databaseCalls = 0;
  let providerCalls = 0;
  const result = await publishFacebookPageJob({
    adminClient: {
      rpc: () => {
        databaseCalls += 1;
        throw new Error("database must not run");
      },
    } as unknown as SupabaseClient,
    actorId,
    jobId,
    message: "Visit mochirii [dot] com",
    expectedUpdatedAt,
    confirmationFingerprint: digest,
    confirmationCopyHash: digest,
    fetchImpl: () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  });
  assert(!result.ok && !result.attempted, "blocked copy was attempted");
  assert(databaseCalls === 0, "blocked copy reached database");
  assert(providerCalls === 0, "blocked copy reached provider");
});

Deno.test("Facebook disabled flag prevents every database and Graph request", async () => {
  let databaseCalls = 0;
  let providerCalls = 0;
  const result = await publishFacebookPageJob({
    adminClient: {
      rpc: () => {
        databaseCalls += 1;
        throw new Error("database must not run");
      },
    } as unknown as SupabaseClient,
    actorId,
    jobId,
    message: "Reviewed caption",
    expectedUpdatedAt,
    confirmationFingerprint: digest,
    confirmationCopyHash: digest,
    config: {
      appId: "333333333333333",
      expectedAppId: "333333333333333",
      appSecret: "app-secret",
      pageId: "111111111111111",
      expectedPageId: "111111111111111",
      accessToken: "page-token",
      apiVersion: "v26.0",
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
  assert(result.error === "facebook_page_publish_disabled", "wrong blocker");
  assert(databaseCalls === 0, "disabled publisher reached database");
  assert(providerCalls === 0, "disabled publisher reached Graph");
});

Deno.test("Facebook success accepts the DB destination class without a numeric Page id in DB payloads", async () => {
  const expectedPageId = "111111111111111";
  const photoId = "222222222222222";
  const postId = "111111111111111_222222222222222";
  const submissionId = "62222222-2222-4222-8222-222222222222";
  const revisionId = "65555555-5555-4555-8555-555555555555";
  const objectName = `_social/submissions/${submissionId}/${revisionId}.jpg`;
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const expectedSha256 = await sha256Hex(bytes);
  const rpcCalls: string[] = [];
  const adminClient = {
    rpc: (name: string) => {
      rpcCalls.push(name);
      if (name === "gallery_facebook_page_begin_publish") {
        return Promise.resolve({
          data: {
            committed: true,
            job: { status: "publishing", message: "Reviewed caption" },
          },
          error: null,
        });
      }
      if (name === "gallery_facebook_page_publish_source") {
        return Promise.resolve({
          data: {
            ok: true,
            bucket_id: "member-gallery",
            object_name: objectName,
            mime_type: "image/jpeg",
            sha256: expectedSha256,
            size_bytes: bytes.byteLength,
            width: 1080,
            height: 1080,
            destination_page_id: "facebook_page",
            sanitizer_version: "gallery-social-jpeg-v1",
            metadata_policy: "jfif-only-no-app-metadata-v1",
            submission_id: submissionId,
          },
          error: null,
        });
      }
      if (name === "gallery_facebook_page_finish_publish") {
        return Promise.resolve({
          data: {
            committed: true,
            job: {
              status: "published",
              published_at: "2026-07-29T20:01:00.000Z",
            },
          },
          error: null,
        });
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    storage: {
      from: () => ({
        download: () =>
          Promise.resolve({
            data: new Blob([bytes], { type: "image/jpeg" }),
            error: null,
          }),
      }),
    },
  } as unknown as SupabaseClient;

  let providerCalls = 0;
  const result = await publishFacebookPageJob({
    adminClient,
    actorId,
    jobId,
    message: "Reviewed caption",
    expectedUpdatedAt,
    confirmationFingerprint: digest,
    confirmationCopyHash: digest,
    config: {
      appId: "333333333333333",
      expectedAppId: "333333333333333",
      appSecret: "app-secret",
      pageId: expectedPageId,
      expectedPageId,
      accessToken: "page-token",
      apiVersion: "v26.0",
      publishEnabled: true,
      configured: true,
      missingSecrets: [],
      invalidFields: [],
    },
    fetchImpl: (input, init) => {
      providerCalls += 1;
      const url = new URL(String(input));
      if (init?.method === "POST") {
        return Promise.resolve(Response.json({ id: photoId, post_id: postId }));
      }
      if (url.pathname.endsWith(`/${postId}`)) {
        return Promise.resolve(Response.json({
          id: postId,
          from: { id: expectedPageId },
          permalink_url:
            `https://www.facebook.com/${expectedPageId}/posts/${photoId}`,
        }));
      }
      return Promise.resolve(Response.json({ id: expectedPageId }));
    },
  });

  assert(result.ok && result.status === "published", "valid class failed");
  assert(providerCalls === 3, "unexpected provider request count");
  assert(
    rpcCalls.join(",") ===
      "gallery_facebook_page_begin_publish,gallery_facebook_page_publish_source,gallery_facebook_page_finish_publish",
    "database workflow drifted",
  );
});

Deno.test("Facebook Page task evidence is least privilege", () => {
  assert(facebookTasksCanPublish(["CREATE_CONTENT"]), "task rejected");
  assert(
    facebookTasksCanPublish(["PROFILE_PLUS_CREATE_CONTENT"]),
    "profile task rejected",
  );
  assert(!facebookTasksCanPublish(["MODERATE"]), "moderation implied posting");
  assert(facebookPagePublishFlagEnabled("true"), "exact flag rejected");
  assert(!facebookPagePublishFlagEnabled("TRUE"), "loose flag accepted");
});

Deno.test("Facebook permalink and ownership evidence are canonical", () => {
  const expectedPageId = "111111111111111";
  const objectId = "111111111111111_222222222222222";
  const evidence = facebookPageObjectEvidence(
    {
      id: objectId,
      from: { id: expectedPageId },
      permalink_url:
        "https://m.facebook.com/111111111111111/posts/222222222222222?utm_source=x",
    },
    objectId,
    expectedPageId,
  );
  assert(evidence.verified, "official object rejected");
  assert(
    evidence.permalink ===
      "https://www.facebook.com/111111111111111/posts/222222222222222",
    "permalink not canonical",
  );
  assert(
    !facebookPageObjectEvidence(
      {
        id: objectId,
        from: { id: "999999999999999" },
        permalink_url: "https://www.facebook.com/other/posts/222222222222222",
      },
      objectId,
      expectedPageId,
    ).verified,
    "foreign Page accepted",
  );
  assert(
    normalizeFacebookPermalink("https://evil.example/post") === null,
    "foreign permalink accepted",
  );
});

Deno.test("ambiguous server outcomes reconcile and Graph errors are redacted", () => {
  assert(facebookGraphOutcome(400) === "failed", "400 ambiguous");
  assert(facebookGraphOutcome(429) === "failed", "429 ambiguous");
  assert(facebookGraphOutcome(500) === "reconcile_required", "500 retryable");
  const reflected = "token=secret appsecret_proof=proof _social/private.jpg";
  const details = facebookGraphErrorDetails({
    error: {
      message: reflected,
      type: `OAuthException ${reflected}`,
      code: 190,
      error_subcode: 463,
    },
  }, 401);
  const serialized = JSON.stringify(details);
  assert(details.provider_error_code === 190, "safe code lost");
  for (const value of ["secret", "appsecret_proof", "_social"]) {
    assert(
      !serialized.includes(value),
      `reflected evidence survived: ${value}`,
    );
  }
});
