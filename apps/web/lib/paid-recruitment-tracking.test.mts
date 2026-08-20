import assert from "node:assert/strict";
import test from "node:test";

import { paidRecruitmentJoinHref } from "./paid-recruitment-tracking.ts";

test("preserves only exact approved campaign attribution on the internal join path", () => {
  assert.equal(
    paidRecruitmentJoinHref(
      "?utm_source=fb&utm_medium=paid_social&utm_campaign=mochirii_recruitment_apac_2026_08&utm_content=v3_home_control&utm_term=Facebook_Feed&member=private",
    ),
    "/join?utm_source=fb&utm_medium=paid_social&utm_campaign=mochirii_recruitment_apac_2026_08&utm_content=v3_home_control",
  );
  assert.equal(
    paidRecruitmentJoinHref(
      "?utm_source=ig&utm_medium=paid_social&utm_campaign=mochirii_recruitment_apac_2026_08&utm_content=v3_home_enhanced",
    ),
    "/join?utm_source=ig&utm_medium=paid_social&utm_campaign=mochirii_recruitment_apac_2026_08&utm_content=v3_home_enhanced",
  );
});

test("drops unapproved attribution and fails closed for missing or duplicate campaign variants", () => {
  assert.equal(
    paidRecruitmentJoinHref("?utm_source=other&utm_medium=organic&utm_content=v3_home_control&next=https://example.com"),
    "/join?utm_content=v3_home_control",
  );
  assert.equal(paidRecruitmentJoinHref("?utm_source=fb"), "/join");
  assert.equal(
    paidRecruitmentJoinHref("?utm_content=v3_home_control&utm_content=v3_home_control"),
    "/join",
  );
  assert.equal(
    paidRecruitmentJoinHref("?utm_content=v3_home_enhanced&utm_content=arbitrary"),
    "/join",
  );
  assert.equal(
    paidRecruitmentJoinHref("?utm_content=arbitrary&utm_content=v3_home_enhanced"),
    "/join",
  );
});
