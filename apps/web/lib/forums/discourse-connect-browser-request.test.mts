import assert from "node:assert/strict";
import test from "node:test";
import {
  FORUMS_CONNECT_LOGIN_HREF,
  opaqueForumsConnectRequestFromSearch,
  parseStoredOpaqueForumsConnectRequest,
  plausibleOpaqueForumsConnectRequest,
  resolveOpaqueForumsConnectBrowserRequest,
  serializeOpaqueForumsConnectRequest,
} from "./discourse-connect-browser-request.ts";

const request = {
  sso: "bm9uY2U9c3ludGhldGlj",
  sig: "a".repeat(64),
};

test("stores and resumes only an exact opaque request envelope", () => {
  const parsed = plausibleOpaqueForumsConnectRequest(request.sso, request.sig);
  assert.deepEqual(parsed, request);
  assert.deepEqual(parseStoredOpaqueForumsConnectRequest(serializeOpaqueForumsConnectRequest(request)), request);

  for (const hostile of [
    null,
    "not-json",
    JSON.stringify({ ...request, extra: true }),
    JSON.stringify({ ...request, sig: "A".repeat(64) }),
    JSON.stringify({ ...request, sig: "a".repeat(63) }),
    JSON.stringify({ ...request, sso: "a".repeat(4_097) }),
  ]) {
    assert.equal(parseStoredOpaqueForumsConnectRequest(hostile), null);
  }
});

test("accepts only one exact sso and sig query pair", () => {
  assert.deepEqual(
    opaqueForumsConnectRequestFromSearch(new URLSearchParams(request)),
    request,
  );
  for (const hostile of [
    new URLSearchParams({ ...request, extra: "value" }),
    new URLSearchParams([["sso", request.sso], ["sso", request.sso], ["sig", request.sig]]),
    new URLSearchParams([["sso", request.sso], ["sig", request.sig], ["sig", request.sig]]),
    new URLSearchParams({ sso: request.sso }),
  ]) {
    assert.equal(opaqueForumsConnectRequestFromSearch(hostile), null);
  }
});

test("the authentication resume URL never carries the signed request", () => {
  const loginUrl = new URL(FORUMS_CONNECT_LOGIN_HREF, "https://mochirii.com");
  assert.equal(loginUrl.pathname, "/auth");
  assert.equal(loginUrl.searchParams.get("redirect"), "/forums/connect");
  assert.equal(loginUrl.searchParams.has("sso"), false);
  assert.equal(loginUrl.searchParams.has("sig"), false);
  assert.equal(FORUMS_CONNECT_LOGIN_HREF.includes(request.sso), false);
  assert.equal(FORUMS_CONNECT_LOGIN_HREF.includes(request.sig), false);
});

test("scrubs the signed query before storage and fails closed when storage is unavailable", () => {
  const events: string[] = [];
  const resolution = resolveOpaqueForumsConnectBrowserRequest({
    searchParams: new URLSearchParams(request),
    scrubQuery: () => events.push("scrub"),
    storage: {
      getItem: () => null,
      setItem: () => {
        events.push("set");
        throw new Error("synthetic unavailable storage");
      },
      removeItem: () => events.push("remove"),
    },
  });

  assert.deepEqual(events, ["scrub", "set", "remove"]);
  assert.deepEqual(resolution, { request: null, storageAvailable: false });
});

test("requires query scrubbing before storing or processing a request", () => {
  const events: string[] = [];
  const failed = resolveOpaqueForumsConnectBrowserRequest({
    searchParams: new URLSearchParams(request),
    scrubQuery: () => {
      events.push("scrub");
      throw new Error("synthetic unavailable history boundary");
    },
    storage: {
      getItem: () => null,
      setItem: () => events.push("set"),
      removeItem: () => events.push("remove"),
    },
  });
  assert.deepEqual(events, ["scrub", "remove"]);
  assert.deepEqual(failed, { request: null, storageAvailable: false });

  const succeeded = resolveOpaqueForumsConnectBrowserRequest({
    searchParams: new URLSearchParams(request),
    scrubQuery: () => events.push("scrub-success"),
    storage: {
      getItem: () => null,
      setItem: () => events.push("set-success"),
      removeItem: () => events.push("remove-success"),
    },
  });
  assert.deepEqual(events.slice(2), ["scrub-success", "set-success"]);
  assert.deepEqual(succeeded, { request, storageAvailable: true });
});
