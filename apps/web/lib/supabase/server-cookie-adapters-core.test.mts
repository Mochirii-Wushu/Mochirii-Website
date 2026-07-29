import assert from "node:assert/strict";
import test from "node:test";
import { exchangeAuthCodeForCookieSession } from "./auth-callback-exchange.ts";
import {
  strictRouteHandlerCookieMethods,
  tolerantServerComponentCookieMethods,
} from "./server-cookie-adapters.ts";

function cookieStore({ failWrites = false } = {}) {
  const values = new Map<string, string>();
  return {
    values,
    getAll() {
      return [...values].map(([name, value]) => ({ name, value }));
    },
    set(name: string, value: string) {
      if (failWrites) throw new Error("response already committed");
      values.set(name, value);
    },
  };
}

test("strict Route Handler cookies persist a callback session for a protected follow-up", async () => {
  const store = cookieStore();
  const cookies = strictRouteHandlerCookieMethods(store);
  const exchanged = await exchangeAuthCodeForCookieSession({
    async exchangeCodeForSession() {
      cookies.setAll([{ name: "sb-reviewed-auth-token", value: "opaque-cookie" }]);
      return { error: null };
    },
  }, "one-time-code");
  assert.equal(exchanged, true);
  assert.deepEqual(cookies.getAll(), [{ name: "sb-reviewed-auth-token", value: "opaque-cookie" }]);
  assert.equal(cookies.getAll().some(({ name }) => name === "code"), false);
});

test("strict callback cookie failures propagate and fail authentication", async () => {
  const cookies = strictRouteHandlerCookieMethods(cookieStore({ failWrites: true }));
  const exchanged = await exchangeAuthCodeForCookieSession({
    async exchangeCodeForSession() {
      cookies.setAll([{ name: "sb-reviewed-auth-token", value: "opaque-cookie" }]);
      return { error: null };
    },
  }, "one-time-code");
  assert.equal(exchanged, false);
});

test("Server Component cookie writes remain tolerant while reads are preserved", () => {
  const store = cookieStore({ failWrites: true });
  store.values.set("existing", "cookie");
  const cookies = tolerantServerComponentCookieMethods(store);
  assert.doesNotThrow(() => cookies.setAll([{ name: "new", value: "cookie" }]));
  assert.deepEqual(cookies.getAll(), [{ name: "existing", value: "cookie" }]);
});
