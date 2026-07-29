import assert from "node:assert/strict";
import test from "node:test";
import {
  authCallbackPath,
  authLoginPath,
  reauthLoginPathForLocation,
  resolveAuthReturnPath,
} from "./auth-redirect.ts";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "./raffle-auth-paths.ts";

test("auth return paths are restricted to reviewed local destinations", () => {
  for (const path of [
    "/account",
    "/gallery-submit",
    "/games/mochi-pets",
    "/leader-dashboard",
    "/leader-dashboard/raffle",
    "/raffle/claim",
    "/social",
  ]) assert.equal(resolveAuthReturnPath(path, PRIVATE_RAFFLE_AUTH_RETURN_PATHS), path);
});

test("auth return paths reject external, malformed, and unreviewed destinations", () => {
  for (const path of [
    "https://example.com/account",
    "//example.com/account",
    "/\\example.com",
    "/account?next=https://example.com",
    "/leader-dashboard/raffle",
    "/raffle/claim",
    "/unknown",
    "/%2f%2fexample.com",
    "\u0000/account",
  ]) assert.equal(resolveAuthReturnPath(path), "/account");
});

test("OAuth consent preserves only one bounded authorization identifier", () => {
  assert.equal(
    resolveAuthReturnPath("/oauth/consent?authorization_id=abc-123_def.xyz~value"),
    "/oauth/consent?authorization_id=abc-123_def.xyz~value",
  );
  assert.equal(
    resolveAuthReturnPath("/oauth/consent?authorization_id=opaque%2Bvalue%2Fwith%3Dpadding"),
    "/oauth/consent?authorization_id=opaque%2Bvalue%2Fwith%3Dpadding",
  );
  assert.equal(resolveAuthReturnPath("/oauth/consent?authorization_id=abc&extra=value"), "/account");
  assert.equal(resolveAuthReturnPath("/oauth/consent?authorization_id=abc&authorization_id=def"), "/account");
});

test("callback and login paths encode the reviewed destination", () => {
  assert.equal(
    authCallbackPath("/raffle/claim", PRIVATE_RAFFLE_AUTH_RETURN_PATHS),
    "/auth/callback?next=%2Fraffle%2Fclaim",
  );
  assert.equal(
    authLoginPath("/leader-dashboard/raffle", PRIVATE_RAFFLE_AUTH_RETURN_PATHS),
    "/auth?redirect=%2Fleader-dashboard%2Fraffle",
  );
});

test("fresh reauthentication follows only the current reviewed auth destination", () => {
  assert.equal(
    reauthLoginPathForLocation("https://preview.example/account"),
    "/auth?redirect=%2Faccount&reauth=1",
  );
  assert.equal(
    reauthLoginPathForLocation("/oauth/consent?authorization_id=reviewed"),
    "/auth?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dreviewed&reauth=1",
  );
  assert.equal(
    reauthLoginPathForLocation(
      "/auth?redirect=%2Fraffle%2Fclaim&error=sign_in_failed",
      PRIVATE_RAFFLE_AUTH_RETURN_PATHS,
    ),
    "/auth?redirect=%2Fraffle%2Fclaim&reauth=1",
  );
  assert.equal(
    reauthLoginPathForLocation("https://example.com/unreviewed"),
    "/auth?redirect=%2Faccount&reauth=1",
  );
});
