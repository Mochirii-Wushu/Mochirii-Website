import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_AUTH_MAX_BYTES,
  clearLegacyAuthStorage,
  legacyOAuthCutoverForUrl,
  parseLegacyAuthSession,
  runLegacyAuthCutover,
  safeLegacyAuthStorage,
  shouldRetireLegacyAuthForEvent,
} from "./legacy-auth-cutover.ts";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "./raffle-auth-paths.ts";

const key = "sb-reviewed-auth-token";
const accessToken = `a.${"b".repeat(60)}.c`;
const refreshToken = "r".repeat(64);

class MemoryStorage {
  values = new Map<string, string>();
  getItem(name: string) { return this.values.get(name) ?? null; }
  setItem(name: string, value: string) { this.values.set(name, value); }
  removeItem(name: string) { this.values.delete(name); }
}

test("a blocked browser storage accessor fails closed instead of crashing auth", () => {
  assert.equal(safeLegacyAuthStorage(() => {
    throw new DOMException("blocked", "SecurityError");
  }), null);
});

test("OAuth bearer material is scrubbed even when browser storage is blocked", async () => {
  const client = fakeAuth();
  const cleanPaths: string[] = [];
  const result = await runLegacyAuthCutover({
    auth: client.auth,
    storage: null,
    storageKey: key,
    href: `https://mochirii.com/auth?redirect=%2Fraffle%2Fclaim#access_token=${accessToken}&refresh_token=${refreshToken}`,
    replaceUrl: (value) => cleanPaths.push(value),
    additionalSimplePaths: PRIVATE_RAFFLE_AUTH_RETURN_PATHS,
  });
  assert.deepEqual(result, {
    status: "legacy-oauth",
    reauthPath: "/auth?redirect=%2Fraffle%2Fclaim&reauth=1",
  });
  assert.deepEqual(cleanPaths, ["/auth?redirect=%2Fraffle%2Fclaim"]);
  assert.equal(client.calls.signOut, 1);
});

function fakeAuth(options: {
  claims?: unknown;
  setSessionError?: boolean;
} = {}) {
  const calls = { setSession: [] as unknown[], signOut: 0 };
  return {
    calls,
    auth: {
      async getClaims() {
        return options.claims
          ? { data: { claims: options.claims }, error: null }
          : { data: null, error: new Error("no session") };
      },
      async setSession(session: unknown) {
        calls.setSession.push(session);
        return options.setSessionError
          ? { data: { session: null }, error: new Error("rejected") }
          : { data: { session: { user: { id: "member" } } }, error: null };
      },
      async signOut() {
        calls.signOut += 1;
        return { error: null };
      },
    },
  };
}

test("an ordinary signed-out page with no legacy session performs no auth request", async () => {
  const storage = new MemoryStorage();
  let claimReads = 0;
  const client = fakeAuth();
  const auth = {
    ...client.auth,
    async getClaims() {
      claimReads += 1;
      return client.auth.getClaims();
    },
  };
  const result = await runLegacyAuthCutover({ auth, storage, storageKey: key });
  assert.equal(result.status, "none");
  assert.equal(result.reauthPath, undefined);
  assert.equal(claimReads, 0);
  assert.equal(client.calls.setSession.length, 0);
  assert.equal(client.calls.signOut, 0);
});

function seedLegacy(storage: MemoryStorage, value = JSON.stringify({
  access_token: accessToken,
  refresh_token: refreshToken,
})) {
  storage.setItem(key, value);
  storage.setItem(`${key}-code-verifier`, "legacy-verifier");
  storage.setItem(`${key}-user`, "legacy-user");
}

function assertLegacyCleared(storage: MemoryStorage) {
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem(`${key}-code-verifier`), null);
  assert.equal(storage.getItem(`${key}-user`), null);
}

test("an already verified cookie session retires every legacy storage entry", async () => {
  const storage = new MemoryStorage();
  seedLegacy(storage);
  const client = fakeAuth({ claims: { sub: "member-id" } });
  const result = await runLegacyAuthCutover({ auth: client.auth, storage, storageKey: key });
  assert.equal(result.status, "cookie-session");
  assert.equal(client.calls.setSession.length, 0);
  assertLegacyCleared(storage);
});

test("a bounded legacy session migrates once through setSession and is then removed", async () => {
  const storage = new MemoryStorage();
  seedLegacy(storage);
  const client = fakeAuth();
  const result = await runLegacyAuthCutover({ auth: client.auth, storage, storageKey: key });
  assert.equal(result.status, "migrated");
  assert.deepEqual(client.calls.setSession, [{ access_token: accessToken, refresh_token: refreshToken }]);
  assertLegacyCleared(storage);
});

test("corrupt and oversized legacy data is removed without reaching setSession", async () => {
  for (const value of ["{", "x".repeat(LEGACY_AUTH_MAX_BYTES + 1)]) {
    const storage = new MemoryStorage();
    seedLegacy(storage, value);
    const client = fakeAuth();
    const result = await runLegacyAuthCutover({ auth: client.auth, storage, storageKey: key });
    assert.equal(result.status, "invalid");
    assert.equal(client.calls.setSession.length, 0);
    assert.equal(client.calls.signOut, 1);
    assertLegacyCleared(storage);
  }
  assert.equal(parseLegacyAuthSession(JSON.stringify({ access_token: "short", refresh_token: refreshToken })), null);
});

test("failed migration removes all token material and forces fresh authentication", async () => {
  const storage = new MemoryStorage();
  seedLegacy(storage);
  const client = fakeAuth({ setSessionError: true });
  const result = await runLegacyAuthCutover({ auth: client.auth, storage, storageKey: key });
  assert.equal(result.status, "reauth-required");
  assert.equal(result.reauthPath, "/auth?redirect=%2Faccount&reauth=1");
  assert.equal(client.calls.signOut, 1);
  assertLegacyCleared(storage);
});

test("old in-flight OAuth codes and fragments are stripped before fresh sign-in", async () => {
  const code = legacyOAuthCutoverForUrl("https://mochirii.com/oauth/consent?authorization_id=reviewed&code=secret");
  assert.deepEqual(code, {
    cleanPath: "/oauth/consent?authorization_id=reviewed",
    reauthPath: "/auth?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dreviewed&reauth=1",
  });
  const fragment = legacyOAuthCutoverForUrl(`https://mochirii.com/account#access_token=${accessToken}&refresh_token=${refreshToken}`);
  assert.deepEqual(fragment, {
    cleanPath: "/account",
    reauthPath: "/auth?redirect=%2Faccount&reauth=1",
  });

  for (const destination of ["/raffle/claim", "/leader-dashboard/raffle"]) {
    const encoded = encodeURIComponent(destination);
    assert.deepEqual(
      legacyOAuthCutoverForUrl(
        `https://mochirii.com/auth?redirect=${encoded}#access_token=${accessToken}&refresh_token=${refreshToken}`,
        PRIVATE_RAFFLE_AUTH_RETURN_PATHS,
      ),
      {
        cleanPath: `/auth?redirect=${encoded}`,
        reauthPath: `/auth?redirect=${encoded}&reauth=1`,
      },
    );
  }

  for (const malformed of [
    `https://mochirii.com/auth?redirect=%2Fraffle%2Fclaim&redirect=%2Faccount#access_token=${accessToken}`,
    `https://mochirii.com/auth?redirect=https%3A%2F%2Fexample.com#access_token=${accessToken}`,
    `https://mochirii.com/auth?redirect=%2Fraffle%2Fclaim&extra=1#access_token=${accessToken}`,
  ]) {
    assert.deepEqual(
      legacyOAuthCutoverForUrl(malformed, PRIVATE_RAFFLE_AUTH_RETURN_PATHS),
      {
        cleanPath: "/auth",
        reauthPath: "/auth?redirect=%2Faccount&reauth=1",
      },
    );
  }
  assert.deepEqual(
    legacyOAuthCutoverForUrl(
      `https://mochirii.com/auth?redirect=%2Fraffle%2Fclaim#access_token=${accessToken}`,
    ),
    {
      cleanPath: "/auth",
      reauthPath: "/auth?redirect=%2Faccount&reauth=1",
    },
  );
  assert.equal(legacyOAuthCutoverForUrl("https://mochirii.com/events?code=ordinary-filter"), null);

  const storage = new MemoryStorage();
  seedLegacy(storage);
  const client = fakeAuth();
  const cleanPaths: string[] = [];
  const result = await runLegacyAuthCutover({
    auth: client.auth,
    storage,
    storageKey: key,
    href: "https://mochirii.com/account?code=secret",
    replaceUrl: (value) => cleanPaths.push(value),
  });
  assert.equal(result.status, "legacy-oauth");
  assert.deepEqual(cleanPaths, ["/account"]);
  assertLegacyCleared(storage);
});

test("fresh OAuth, identity linking, refresh, and sign-out use cookie-era cleanup", () => {
  assert.equal(legacyOAuthCutoverForUrl("https://mochirii.com/auth/callback?code=server-code&next=%2Faccount"), null);
  assert.equal(shouldRetireLegacyAuthForEvent("SIGNED_IN"), true);
  assert.equal(shouldRetireLegacyAuthForEvent("TOKEN_REFRESHED"), true);
  assert.equal(shouldRetireLegacyAuthForEvent("SIGNED_OUT"), true);
  assert.equal(shouldRetireLegacyAuthForEvent("INITIAL_SESSION"), false);

  const storage = new MemoryStorage();
  seedLegacy(storage);
  clearLegacyAuthStorage(storage, key);
  assertLegacyCleared(storage);
});
