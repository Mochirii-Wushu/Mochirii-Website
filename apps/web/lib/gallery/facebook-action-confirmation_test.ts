import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookPagePublishConfirmation,
  facebookPageReconciliationFingerprint,
} from "./facebook-action-confirmation.ts";

const job = {
  id: "63333333-3333-4333-8333-333333333333",
  status: "queued",
  attemptCount: 0,
  updatedAt: "2026-07-29T12:34:56.123456+00:00",
};
const moderator = "61111111-1111-4111-8111-111111111111";

test("Facebook publication confirmation binds final message and queue revision", async () => {
  const armed = await facebookPagePublishConfirmation(job, moderator, "Final message");
  assert.notEqual(
    armed.confirmation_fingerprint,
    (await facebookPagePublishConfirmation(job, moderator, "Edited message")).confirmation_fingerprint,
  );
  assert.notEqual(
    armed.confirmation_fingerprint,
    (await facebookPagePublishConfirmation({ ...job, status: "failed" }, moderator, "Final message")).confirmation_fingerprint,
  );
});

test("Facebook reconciliation confirmation binds inspected evidence", async () => {
  const draft = {
    resolution: "confirmed_published" as const,
    note: "Inspected official Page",
    facebookPhotoId: "photo_1",
    facebookPostId: "post_1",
    facebookPermalink: "https://www.facebook.com/example/posts/1",
  };
  const armed = await facebookPageReconciliationFingerprint(job, draft);
  assert.notEqual(armed, await facebookPageReconciliationFingerprint(job, {
    ...draft,
    facebookPostId: "post_2",
  }));
  assert.notEqual(armed, await facebookPageReconciliationFingerprint({ ...job, attemptCount: 1 }, draft));
});
