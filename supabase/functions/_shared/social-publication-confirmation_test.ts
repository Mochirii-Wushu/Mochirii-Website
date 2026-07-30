import {
  constantTimeHexEqual,
  socialPublicationConfirmationFingerprint,
} from "./social-publication-confirmation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

Deno.test("confirmation is deterministic across approved text normalization", async () => {
  const one = await socialPublicationConfirmationFingerprint(base);
  assert(
    one.copyHash ===
      "d06ebe3f2589609d258c76abeca0403c9f61f4d31e58a3233a808dbffe348485",
    "authoritative copy hash changed",
  );
  assert(
    one.fingerprint ===
      "74003118ae20aa1086cd77150becd5586164b5a3492a37279488866858837d0d",
    "authoritative confirmation fingerprint changed",
  );
  const two = await socialPublicationConfirmationFingerprint({
    ...base,
    primaryCopy: "Pretty photo\nfrom Wushu land",
    updatedAt: "2026-07-29T05:34:56.123456-07:00",
  });
  assert(one.copyHash === two.copyHash, "copy normalization drifted");
  assert(
    one.fingerprint === two.fingerprint,
    "fingerprint normalization drifted",
  );
  assert(
    constantTimeHexEqual(one.fingerprint, two.fingerprint),
    "equal rejected",
  );
});

Deno.test("destination, state, copy, and moderator changes invalidate confirmation", async () => {
  const expected = await socialPublicationConfirmationFingerprint(base);
  const variants = [
    { ...base, destination: "facebook_page" as const },
    { ...base, status: "failed" },
    { ...base, attemptCount: 1 },
    { ...base, updatedAt: "2026-07-29T12:34:56.124456+00:00" },
    { ...base, moderatorUserId: "62222222-2222-4222-8222-222222222222" },
    { ...base, primaryCopy: "Edited caption" },
    { ...base, altText: "Edited alt text" },
  ];
  for (const variant of variants) {
    const actual = await socialPublicationConfirmationFingerprint(variant);
    assert(
      !constantTimeHexEqual(expected.fingerprint, actual.fingerprint),
      "stale or mismatched confirmation remained valid",
    );
  }
});

Deno.test("malformed confirmation state fails closed", async () => {
  let threw = false;
  try {
    await socialPublicationConfirmationFingerprint({
      ...base,
      jobId: "not-a-job",
    });
  } catch {
    threw = true;
  }
  assert(threw, "malformed state was hashed");
  assert(!constantTimeHexEqual("x", "x"), "malformed digest compared equal");
});
