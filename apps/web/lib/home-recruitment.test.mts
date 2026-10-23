import assert from "node:assert/strict";
import test from "node:test";
import publicUrls from "../config/public-urls.json" with { type: "json" };
import { getHomeRecruitment } from "./home-recruitment.ts";

test("open and limited recruitment retain the canonical Discord invite", () => {
  for (const [status, statusLabel] of [
    ["open", "Recruitment Open"],
    ["limited", "Limited Recruitment"],
    [" OPEN ", "Recruitment Open"],
    ["Limited", "Limited Recruitment"],
  ]) {
    assert.deepEqual(getHomeRecruitment(status), {
      label: "Join on Discord",
      href: publicUrls.discordInviteUrl,
      open: true,
      statusLabel,
    });
  }
});

test("paused, unknown and malformed recruitment states fail closed", () => {
  for (const status of ["paused", "closed", "opening", "", " ", null, undefined, 1, true, {}, ["open"], Symbol("open")]) {
    assert.deepEqual(getHomeRecruitment(status), {
      label: "Recruitment Paused",
      href: "/recruitment",
      open: false,
      statusLabel: "Recruitment Paused",
    });
  }
});
