import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGallerySocialWithdrawalRequest,
  gallerySocialWithdrawalLabel,
} from "./social-consent-withdrawal.ts";

test("withdrawal request is destination-specific and snake-case", () => {
  assert.deepEqual(
    buildGallerySocialWithdrawalRequest(
      "74444444-4444-4444-8444-444444444441",
      "facebook_page",
    ),
    {
      submission_id: "74444444-4444-4444-8444-444444444441",
      destination: "facebook_page",
    },
  );
  assert.throws(() => buildGallerySocialWithdrawalRequest("invalid", "instagram"));
});

test("withdrawal labels never claim an external post was removed", () => {
  assert.equal(gallerySocialWithdrawalLabel(null), "Consent active");
  assert.equal(gallerySocialWithdrawalLabel({
    submission_id: "74444444-4444-4444-8444-444444444441",
    destination: "instagram",
    state: "quarantined",
    external_removal_required: false,
  }), "Withdrawn; moderator inspection required");
  assert.equal(gallerySocialWithdrawalLabel({
    submission_id: "74444444-4444-4444-8444-444444444441",
    destination: "instagram",
    state: "removal_requested",
    external_removal_required: true,
  }), "Removal requested; external copies may remain");
});
