import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalizeCheckoutTextBytes } from "./canonical-checkout-text.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const canonicalSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0 0h1v1z"/>\n</svg>\n',
  "utf8",
);

test("preserves canonical LF bytes and normalizes only CRLF checkout bytes", () => {
  const crlfSvg = Buffer.from(canonicalSvg.toString("utf8").replaceAll("\n", "\r\n"), "utf8");
  const mixedSvg = Buffer.from(
    canonicalSvg.toString("utf8").replace("\n", "\r\n"),
    "utf8",
  );

  assert.deepEqual(canonicalizeCheckoutTextBytes(canonicalSvg), canonicalSvg);
  assert.deepEqual(canonicalizeCheckoutTextBytes(crlfSvg), canonicalSvg);
  assert.deepEqual(canonicalizeCheckoutTextBytes(mixedSvg), canonicalSvg);
});

test("rejects unsupported carriage-return bytes", () => {
  assert.throws(
    () => canonicalizeCheckoutTextBytes(Buffer.from("<svg>\r<path/></svg>", "utf8")),
    /unsupported bare carriage return/,
  );
});

test("does not hide markup, whitespace, or trailing-newline changes", () => {
  const expectedHash = sha256(canonicalizeCheckoutTextBytes(canonicalSvg));
  const mutations = [
    Buffer.from(canonicalSvg.toString("utf8").replace("h1v1z", "h2v2z"), "utf8"),
    Buffer.from(canonicalSvg.toString("utf8").replace("<path", " <path"), "utf8"),
    Buffer.from(canonicalSvg.subarray(0, canonicalSvg.length - 1)),
  ];

  for (const mutation of mutations) {
    assert.notEqual(sha256(canonicalizeCheckoutTextBytes(mutation)), expectedHash);
  }
});
