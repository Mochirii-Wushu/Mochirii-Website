import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookPagePublishFingerprint,
  facebookPageReconciliationFingerprint,
} from "./facebook-action-confirmation.ts";

const job = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "failed",
  attemptCount: 2,
  updatedAt: "2026-07-29T01:02:03.123456Z",
};

test("publish confirmation is bound to job state, attempt, and normalized caption", () => {
  const armed = facebookPagePublishFingerprint(job, "  Exact caption  ");
  assert.equal(armed, facebookPagePublishFingerprint(job, "Exact caption"));
  assert.notEqual(armed, facebookPagePublishFingerprint(job, "Changed caption"));
  assert.notEqual(armed, facebookPagePublishFingerprint({ ...job, attemptCount: 3 }, "Exact caption"));
  assert.notEqual(armed, facebookPagePublishFingerprint({ ...job, status: "queued" }, "Exact caption"));
  assert.notEqual(armed, facebookPagePublishFingerprint({ ...job, id: crypto.randomUUID() }, "Exact caption"));
});

test("reconciliation confirmation is bound to exact queue state and inspected draft", () => {
  const draft = {
    resolution: "confirmed_published",
    note: " Inspected official Page ",
    facebookPhotoId: "photo-1",
    facebookPostId: "post-1",
    facebookPermalink: "https://www.facebook.com/example",
  };
  const armed = facebookPageReconciliationFingerprint(job, draft);
  assert.equal(
    armed,
    facebookPageReconciliationFingerprint(job, {
      ...draft,
      note: "Inspected official Page",
    }),
  );
  assert.notEqual(
    armed,
    facebookPageReconciliationFingerprint({ ...job, updatedAt: "2026-07-29T01:02:04Z" }, draft),
  );
  assert.notEqual(
    armed,
    facebookPageReconciliationFingerprint(job, { ...draft, resolution: "confirmed_not_published" }),
  );
});
