import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { forumsConnectPrivateHeaders } from "../../config/forums-connect-private-headers.ts";

const expectedHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
};

test("the query-bearing Forums connection page has an exact private response contract", () => {
  assert.deepEqual(
    Object.fromEntries(forumsConnectPrivateHeaders.map(({ key, value }) => [key, value])),
    expectedHeaders,
  );
});

test("the scoped private response contract overrides the global header rule", async () => {
  const configSource = await readFile(new URL("../../next.config.ts", import.meta.url), "utf8");
  const globalRuleIndex = configSource.indexOf('source: "/(.*)"');
  const forumsRuleIndex = configSource.indexOf('source: "/forums/connect"');

  assert.notEqual(globalRuleIndex, -1);
  assert.ok(forumsRuleIndex > globalRuleIndex);
  assert.match(
    configSource.slice(forumsRuleIndex),
    /source: "\/forums\/connect",\s+headers: \[\.\.\.forumsConnectPrivateHeaders\]/,
  );
});

test("the sign-in resume path keeps the signed request out of the authentication URL", async () => {
  const [panelSource, helperSource] = await Promise.all([
    readFile(
      new URL("../../components/member-workflow/ForumsConnectPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("./discourse-connect-browser-request.ts", import.meta.url), "utf8"),
  ]);

  assert.match(panelSource, /window\.history\.replaceState\(window\.history\.state, "", "\/forums\/connect"\)/);
  assert.match(panelSource, /FORUMS_CONNECT_REQUEST_STORAGE_KEY/);
  assert.match(panelSource, /setResumeStorageAvailable\(resolution\.storageAvailable\)/);
  assert.doesNotMatch(panelSource, /\/auth\?redirect=.*(?:sso|sig)/);
  assert.match(helperSource, /storageAvailable: false/);
  assert.ok(helperSource.indexOf("scrubQuery();") < helperSource.indexOf("storage.setItem("));
});
