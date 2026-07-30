import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFacebookPagePublicationRequest,
  buildInstagramPublicationRequest,
} from "./social-publication-request.ts";

const job = {
  id: "63333333-3333-4333-8333-333333333333",
  status: "queued",
  attemptCount: 0,
  updatedAt: "2026-07-29T12:34:56.123456+00:00",
};
const moderatorUserId = "61111111-1111-4111-8111-111111111111";

test("Instagram browser request uses the exact snake-case Edge contract", async () => {
  const request = await buildInstagramPublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: "Pretty photo\r\nfrom Wushu land",
    altText: "A member character near a pavilion.",
  });
  assert.deepEqual(Object.keys(request).sort(), [
    "alt_text",
    "caption",
    "confirm_instagram_publish",
    "confirmation_fingerprint",
    "expected_updated_at",
    "job_id",
  ]);
  assert.equal(request.confirm_instagram_publish, true);
  assert.equal(
    request.confirmation_fingerprint,
    "74003118ae20aa1086cd77150becd5586164b5a3492a37279488866858837d0d",
  );
});

test("Facebook browser request uses the exact snake-case Edge contract", async () => {
  const request = await buildFacebookPagePublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: "Final Page caption",
  });
  assert.deepEqual(Object.keys(request).sort(), [
    "confirm_facebook_publish",
    "confirmation_fingerprint",
    "expected_updated_at",
    "job_id",
    "message",
  ]);
  assert.equal(request.confirm_facebook_publish, true);
});

test("caption, alt-text, and revision edits change the outgoing fingerprint", async () => {
  const original = await buildInstagramPublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: "Caption",
    altText: "Alt text",
  });
  for (const input of [
    { job, moderatorUserId, primaryCopy: "Changed", altText: "Alt text" },
    { job, moderatorUserId, primaryCopy: "Caption", altText: "Changed" },
    {
      job: { ...job, updatedAt: "2026-07-29T12:34:57.123456+00:00" },
      moderatorUserId,
      primaryCopy: "Caption",
      altText: "Alt text",
    },
  ]) {
    assert.notEqual(
      (await buildInstagramPublicationRequest(input)).confirmation_fingerprint,
      original.confirmation_fingerprint,
    );
  }
});

test("Instagram requires reviewed alt text", async () => {
  await assert.rejects(() => buildInstagramPublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: "Caption",
    altText: "",
  }));
});

test("both destinations require explicit non-empty final copy", async () => {
  await assert.rejects(() => buildInstagramPublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: "   ",
    altText: "Visible image description.",
  }), /final Instagram caption is required/u);
  await assert.rejects(() => buildFacebookPagePublicationRequest({
    job,
    moderatorUserId,
    primaryCopy: "\n\t",
  }), /final Facebook Page caption is required/u);
});
