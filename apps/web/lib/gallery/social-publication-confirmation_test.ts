import assert from "node:assert/strict";
import test from "node:test";
import {
  socialPublicationConfirmationFingerprint,
  socialPublicationFingerprintLooksValid,
} from "./social-publication-confirmation.ts";

const base = {
  destination: "instagram" as const,
  jobId: "63333333-3333-4333-8333-333333333333",
  status: "queued",
  attemptCount: 0,
  updatedAt: "2026-07-29T12:34:56.123456+00:00",
  moderatorUserId: "61111111-1111-4111-8111-111111111111",
  primaryCopy: "Pretty photo\r\nfrom Wushu land",
  altText: "A member character near a pavilion.",
};

test("browser confirmation matches the authoritative Edge vector", async () => {
  const confirmation = await socialPublicationConfirmationFingerprint(base);
  assert.equal(
    confirmation.copyHash,
    "d06ebe3f2589609d258c76abeca0403c9f61f4d31e58a3233a808dbffe348485",
  );
  assert.equal(
    confirmation.fingerprint,
    "74003118ae20aa1086cd77150becd5586164b5a3492a37279488866858837d0d",
  );
  assert.equal(socialPublicationFingerprintLooksValid(confirmation.fingerprint), true);
});

test("copy, destination, moderator, and revision changes invalidate confirmation", async () => {
  const expected = await socialPublicationConfirmationFingerprint(base);
  for (const variant of [
    { ...base, destination: "facebook_page" as const },
    { ...base, primaryCopy: "Edited caption" },
    { ...base, altText: "Edited alt text" },
    { ...base, attemptCount: 1 },
    { ...base, updatedAt: "2026-07-29T12:34:57.123456+00:00" },
    { ...base, moderatorUserId: "62222222-2222-4222-8222-222222222222" },
  ]) {
    assert.notEqual(
      (await socialPublicationConfirmationFingerprint(variant)).fingerprint,
      expected.fingerprint,
    );
  }
});

test("malformed state fails closed", async () => {
  await assert.rejects(() => socialPublicationConfirmationFingerprint({
    ...base,
    jobId: "not-a-job",
  }));
  assert.equal(socialPublicationFingerprintLooksValid("not-a-fingerprint"), false);
});
