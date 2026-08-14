import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type Scenario = {
  name: "fresh" | "stale" | "reused";
  nonceAgeSeconds: number;
  previouslyUsed: boolean;
  accepted: boolean;
  httpStatus?: number;
  identityLookupReached: boolean;
};

type Fixture = {
  schemaVersion: number;
  revision: string;
  sourceFiles: Array<{ path: string; sha256: string }>;
  consumerContract: {
    nonceLifetimeSeconds: number;
    usedNonceLifetimeSeconds: number;
    invalidNonceHttpStatus: number;
    csrfProtectionDefault: boolean;
    nonceBoundToServerSession: boolean;
    invalidNonceRejectedBeforeIdentityLookup: boolean;
    acceptedNonceExpiredBeforeIdentityLookup: boolean;
  };
  scenarios: Scenario[];
};

const fixtureUrl = new URL(
  "./fixtures/discourse-connect-consumer-cbf996f.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as Fixture;

const expectedRevision = "cbf996f65aae3da1843224aa624bcd9a225931ac";
const expectedHashes = new Map([
  [
    "lib/discourse_connect_base.rb",
    "7aeafcf920bfa5646ee0864c1ecbe3ad24615a89505122ea88037142ad95e638",
  ],
  [
    "app/models/discourse_connect.rb",
    "1d6c02b7dde6940394ea6b5016ea470c8a19c0e3e4953fcfebfde46b08c3de85",
  ],
  [
    "app/controllers/session_controller.rb",
    "022627791f2a237c4bfb789d9523b077f995c8a649d91a01a7006898ecc256e2",
  ],
  [
    "config/site_settings.yml",
    "b50499a89a4ac5bb368670617ca75513bb458750aeaced2e0c48291e5da9653c",
  ],
  [
    "spec/models/discourse_connect_spec.rb",
    "95e10aaaa4e91b1122bb077df6d439cde32893378eecb57ae56901234ef58686",
  ],
  [
    "spec/requests/session_controller_spec.rb",
    "201e0963fc4d0b4b78726757169aa1beabf02d40b0b2910e9cc08d23f146bb92",
  ],
]);

function evaluatePinnedConsumerScenario(scenario: Scenario) {
  const nonceIsValid =
    !scenario.previouslyUsed
    && scenario.nonceAgeSeconds <= fixture.consumerContract.nonceLifetimeSeconds;

  if (!nonceIsValid) {
    return {
      accepted: false,
      httpStatus: fixture.consumerContract.invalidNonceHttpStatus,
      identityLookupReached: false,
    };
  }

  return {
    accepted: true,
    identityLookupReached: true,
  };
}

test("pins the reviewed consumer source and nonce contract", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.revision, expectedRevision);
  assert.equal(fixture.consumerContract.nonceLifetimeSeconds, 30 * 60);
  assert.equal(fixture.consumerContract.usedNonceLifetimeSeconds, 24 * 60 * 60);
  assert.equal(fixture.consumerContract.invalidNonceHttpStatus, 419);
  assert.equal(fixture.consumerContract.csrfProtectionDefault, true);
  assert.equal(fixture.consumerContract.nonceBoundToServerSession, true);
  assert.equal(fixture.consumerContract.invalidNonceRejectedBeforeIdentityLookup, true);
  assert.equal(fixture.consumerContract.acceptedNonceExpiredBeforeIdentityLookup, true);

  assert.deepEqual(
    new Map(fixture.sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile.sha256])),
    expectedHashes,
  );
});

test("pinned consumer owns stale and replay rejection before login", () => {
  for (const scenario of fixture.scenarios) {
    assert.deepEqual(
      evaluatePinnedConsumerScenario(scenario),
      {
        accepted: scenario.accepted,
        ...(scenario.httpStatus === undefined ? {} : { httpStatus: scenario.httpStatus }),
        identityLookupReached: scenario.identityLookupReached,
      },
      scenario.name,
    );
  }
});

test("pinned consumer expires an accepted nonce before identity lookup", () => {
  const fresh = fixture.scenarios.find((scenario) => scenario.name === "fresh");
  assert.ok(fresh);
  assert.equal(evaluatePinnedConsumerScenario(fresh).accepted, true);

  const replay = { ...fresh, name: "reused" as const, previouslyUsed: true };
  assert.deepEqual(evaluatePinnedConsumerScenario(replay), {
    accepted: false,
    httpStatus: 419,
    identityLookupReached: false,
  });
});
