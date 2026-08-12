import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPendingAuthorizationShape,
  pendingAuthorizationDetailsAreApproved,
  priorConsentRedirect,
} from "./prior-consent-redirect.ts";

test("a prior consent redirects only after current member access passes", () => {
  const details = {
    redirect_url: "https://social.mochirii.com/auth/oidc/callback?code=opaque",
  };

  assert.equal(priorConsentRedirect(details, false), "");
  assert.equal(priorConsentRedirect(details, true), details.redirect_url);
  assert.equal(hasPendingAuthorizationShape(details), false);
});

test("a pending authorization never uses the prior-consent redirect path", () => {
  const details = {
    authorization_id: "authorization-id",
    redirect_uri: "https://social.mochirii.com/auth/oidc/callback",
    scope: "openid profile email",
  };

  assert.equal(hasPendingAuthorizationShape(details), true);
  assert.equal(
    pendingAuthorizationDetailsAreApproved(details, "authorization-id"),
    true,
  );
  assert.equal(priorConsentRedirect(details, true), "");
});

test("authorization detail union shapes fail closed when mixed or malformed", () => {
  const redirectUrl =
    "https://social.mochirii.com/auth/oidc/callback?code=opaque";

  assert.equal(
    priorConsentRedirect({ redirect_url: redirectUrl, scope: "openid" }, true),
    "",
  );
  assert.equal(
    pendingAuthorizationDetailsAreApproved(
      {
        authorization_id: "authorization-id",
        redirect_uri: "https://social.mochirii.com/auth/oidc/callback",
      },
      "different-id",
    ),
    false,
  );
  assert.equal(
    pendingAuthorizationDetailsAreApproved(
      { authorization_id: "authorization-id", redirect_uri: redirectUrl },
      "authorization-id",
    ),
    false,
  );
});
