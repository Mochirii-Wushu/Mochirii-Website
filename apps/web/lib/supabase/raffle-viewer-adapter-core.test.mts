import assert from "node:assert/strict";
import test from "node:test";
import { loadRaffleViewerResultNames } from "./raffle-viewer-adapter.ts";
import { PRIVATE_AUTH_HEADERS } from "./raffle-response-policy.ts";

type FixtureSession = "session-a" | "session-b" | "signed-out" | "unverified";

function clientForSession(session: FixtureSession) {
  const authenticated = session !== "signed-out";
  const verified = session === "session-a" || session === "session-b";
  const names = session === "session-a"
    ? { "monthly-2026-08:1": "Aster Vale" }
    : session === "session-b"
    ? { "monthly-2026-08:1": "Briar Moon" }
    : {};
  return {
    auth: {
      getClaims: async () => ({
        data: {
          claims: authenticated
            ? { sub: `member-${session}`, role: "authenticated" }
            : null,
        },
        error: null,
      }),
    },
    functions: {
      invoke: async () => verified
        ? { data: { data: { resultNames: names } }, error: null }
        : { data: null, error: { message: "member verification required" } },
    },
  };
}

test("production viewer adapter isolates alternating cookie-scoped sessions without shared state", async () => {
  let cookieHeader = "sb-local-auth-token=session-a";
  let clientCreations = 0;
  const dependencies = {
    createClient: async () => {
      clientCreations += 1;
      const value = /(?:^|;\s*)sb-local-auth-token=([^;]+)/.exec(cookieHeader)?.[1]
        ?? "signed-out";
      return clientForSession(value as FixtureSession);
    },
  };

  const first = await loadRaffleViewerResultNames(dependencies);
  cookieHeader = "";
  const signedOut = await loadRaffleViewerResultNames(dependencies);
  cookieHeader = "sb-local-auth-token=session-b";
  const second = await loadRaffleViewerResultNames(dependencies);
  cookieHeader = "sb-local-auth-token=unverified";
  const unverified = await loadRaffleViewerResultNames(dependencies);
  cookieHeader = "sb-local-auth-token=session-a";
  const firstAgain = await loadRaffleViewerResultNames(dependencies);

  assert.deepEqual(first, { "monthly-2026-08:1": "Aster Vale" });
  assert.equal(signedOut, undefined, "signed-out request reused a prior member result");
  assert.deepEqual(second, { "monthly-2026-08:1": "Briar Moon" });
  assert.equal(unverified, undefined, "unverified request received a member result");
  assert.deepEqual(firstAgain, { "monthly-2026-08:1": "Aster Vale" });
  assert.equal(clientCreations, 5, "adapter reused a client across request-scoped cookie sessions");
});

test("personalized raffle responses use the production private no-store policy", () => {
  assert.match(PRIVATE_AUTH_HEADERS["Cache-Control"], /\bprivate\b/i);
  assert.match(PRIVATE_AUTH_HEADERS["Cache-Control"], /\bno-store\b/i);
  assert.equal(PRIVATE_AUTH_HEADERS["Referrer-Policy"], "no-referrer");
});
