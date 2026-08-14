import assert from "node:assert/strict";
import test from "node:test";
import { resolveForumsMember } from "./discourse-connect-member.ts";

const nowMs = Date.parse("2026-08-13T12:00:00.000Z");
const memberId = "00000000-0000-4000-8000-000000000001";
const user = {
  id: memberId,
  email: "member@example.com",
  email_confirmed_at: "2026-08-12T12:00:00.000Z",
};
const access = {
  ok: true,
  data: {
    memberStatus: "active",
    discordVerified: true,
    profile: {
      id: memberId,
      member_status: "active",
      display_name: "Moon Pearl",
    },
  },
};

test("accepts only a confirmed active and currently Discord-verified member", () => {
  assert.deepEqual(resolveForumsMember({ user, accessEnvelope: access, nowMs }), {
    ok: true,
    member: {
      id: memberId,
      email: "member@example.com",
      displayName: "Moon Pearl",
    },
  });
});

test("rejects an absent, malformed, or future email confirmation", () => {
  for (const email_confirmed_at of [null, "not-a-time", "2026-08-14T12:00:00.000Z"]) {
    assert.deepEqual(
      resolveForumsMember({ user: { ...user, email_confirmed_at }, accessEnvelope: access, nowMs }),
      { ok: false, status: 403 },
    );
  }
  assert.deepEqual(
    resolveForumsMember({ user: { ...user, email: "invalid" }, accessEnvelope: access, nowMs }),
    { ok: false, status: 403 },
  );
});

test("rejects inactive, unverified, mismatched, or manually approved identities", () => {
  const variants = [
    { ...access, data: { ...access.data, memberStatus: "suspended" } },
    { ...access, data: { ...access.data, discordVerified: false, manualApproved: true } },
    { ...access, data: { ...access.data, profile: { ...access.data.profile, member_status: "pending" } } },
    { ...access, data: { ...access.data, profile: { ...access.data.profile, id: "00000000-0000-4000-8000-000000000002" } } },
  ];
  for (const accessEnvelope of variants) {
    assert.deepEqual(resolveForumsMember({ user, accessEnvelope, nowMs }), { ok: false, status: 403 });
  }
});

test("fails closed on malformed authority data or unsafe display names", () => {
  assert.deepEqual(resolveForumsMember({ user, accessEnvelope: { ok: false }, nowMs }), { ok: false, status: 503 });
  assert.deepEqual(
    resolveForumsMember({
      user,
      accessEnvelope: {
        ...access,
        data: { ...access.data, profile: { ...access.data.profile, display_name: "bad\u202ename" } },
      },
      nowMs,
    }),
    { ok: false, status: 503 },
  );
});
