import assert from "node:assert/strict";
import test from "node:test";
import {
  socialPublicationCopyContainsUrlLikeReference,
  validateSocialPublicationCopy,
} from "./social-publication-copy.ts";

test("both Meta destinations reject URL-like publication copy", () => {
  for (const value of [
    "https://example.com/path",
    "www.example.com",
    "example.com",
    "support@example.com",
    "mochirii [dot] com",
    "h t t p s : / / example.com",
    "www\u200b.example.com",
  ]) {
    assert.equal(socialPublicationCopyContainsUrlLikeReference(value), true, value);
    assert.equal(validateSocialPublicationCopy([value]).ok, false, value);
  }
});

test("ordinary sparse guild copy remains allowed", () => {
  for (const value of [
    "A member portrait from Wushu land.",
    "Pretty armor beneath the pavilion lanterns.",
    "Cupcake won the duel 3 to 0.",
  ]) assert.equal(validateSocialPublicationCopy([value]).ok, true, value);
});
