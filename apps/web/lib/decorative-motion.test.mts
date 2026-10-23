import assert from "node:assert/strict";
import test from "node:test";
import { DECORATIVE_MOTION_KEY, decorativeMotionPreference } from "./decorative-motion.ts";

test("decorative preferences remain separate from private raffle settings", () => {
  assert.equal(DECORATIVE_MOTION_KEY, "mochirii.decorative-motion.v1");
  assert.notEqual(DECORATIVE_MOTION_KEY, "mochirii.raffle.settings.v1");
});

test("an absent preference permits the OS-aware normal-motion default", () => {
  assert.equal(decorativeMotionPreference(null), "on");
  assert.equal(decorativeMotionPreference("on"), "on");
});

test("explicit Off and malformed or obsolete saved values fail to static decoration", () => {
  for (const raw of ["off", "", "ON", "true", "full", "{\"enabled\":true}", " on ", "<script>"]) {
    assert.equal(decorativeMotionPreference(raw), "off", raw);
  }
});
