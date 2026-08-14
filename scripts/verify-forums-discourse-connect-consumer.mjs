import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixtureUrl = new URL(
  "../apps/web/lib/forums/fixtures/discourse-connect-consumer-cbf996f.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const revision = "cbf996f65aae3da1843224aa624bcd9a225931ac";
const rawSourceBase = `https://raw.githubusercontent.com/discourse/discourse/${revision}/`;

assert.equal(fixture.revision, revision, "consumer fixture revision drifted");
assert.equal(fixture.consumerContract.nonceLifetimeSeconds, 30 * 60);
assert.equal(fixture.consumerContract.usedNonceLifetimeSeconds, 24 * 60 * 60);
assert.equal(fixture.consumerContract.invalidNonceHttpStatus, 419);
assert.equal(fixture.consumerContract.csrfProtectionDefault, true);
assert.equal(fixture.consumerContract.nonceBoundToServerSession, true);

const sourceContracts = new Map([
  [
    "lib/discourse_connect_base.rb",
    {
      includes: ["@nonce_expiry_time ||= 30.minutes", "def self.used_nonce_expiry_time", "24.hours"],
    },
  ],
  [
    "app/models/discourse_connect.rb",
    {
      includes: [
        "sso.nonce = SecureRandom.hex",
        "def nonce_valid?",
        "@server_session[nonce_key].present?",
        "def expire_nonce!",
        "@server_session.delete(nonce_key)",
        "expires_in: DiscourseConnectBase.used_nonce_expiry_time",
      ],
    },
  ],
  [
    "app/controllers/session_controller.rb",
    {
      ordered: [
        "if !sso.nonce_valid?",
        "status: 419",
        "sso.expire_nonce!",
        "sso.lookup_or_create_user(request.remote_ip)",
      ],
    },
  ],
  [
    "config/site_settings.yml",
    {
      ordered: [
        "discourse_connect_csrf_protection:",
        "default: true",
        "hidden: true",
      ],
    },
  ],
  [
    "spec/models/discourse_connect_spec.rb",
    {
      includes: [
        'it "validates nonce" do',
        "sso.expire_nonce!",
        "expect(sso.nonce_valid?).to eq false",
        'it "generates correct error message when nonce has already been used" do',
      ],
    },
  ],
  [
    "spec/requests/session_controller_spec.rb",
    {
      includes: ["# nonce is bad now", "expect(response.status).to eq(419)"],
    },
  ],
]);

for (const sourceFile of fixture.sourceFiles) {
  assert.match(sourceFile.sha256, /^[a-f0-9]{64}$/);
  assert.ok(sourceContracts.has(sourceFile.path), `unexpected source file ${sourceFile.path}`);
}
assert.equal(fixture.sourceFiles.length, sourceContracts.size);

if (process.argv.includes("--online")) {
  for (const sourceFile of fixture.sourceFiles) {
    const response = await fetch(`${rawSourceBase}${sourceFile.path}`, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.ok, true, `failed to fetch pinned ${sourceFile.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const source = bytes.toString("utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, sourceFile.sha256, `${sourceFile.path} hash mismatch`);

    const contract = sourceContracts.get(sourceFile.path);
    for (const marker of contract.includes ?? []) {
      assert.ok(source.includes(marker), `${sourceFile.path} is missing ${marker}`);
    }

    let previousIndex = -1;
    for (const marker of contract.ordered ?? []) {
      const index = source.indexOf(marker, previousIndex + 1);
      assert.ok(index > previousIndex, `${sourceFile.path} order drifted at ${marker}`);
      previousIndex = index;
    }
  }

  console.log(`Pinned Forums consumer ${revision} source contract verified online.`);
} else {
  console.log(`Pinned Forums consumer ${revision} fixture verified.`);
}
