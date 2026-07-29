import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverPrivateRaffleOperations } from "./private-raffle-operation-policy.mjs";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mochirii-raffle-operations-"));
}

test("recursive private operation discovery catches nested handlers and Server Actions", () => {
  const root = fixture();
  try {
    const claim = path.join(root, "app", "raffle", "claim");
    const nested = path.join(root, "app", "leader-dashboard", "raffle", "nested");
    fs.mkdirSync(claim, { recursive: true });
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(claim, "page.tsx"), "export default function Page() {}\n");
    fs.writeFileSync(path.join(nested, "route.ts"), "export async function POST() {}\n");
    fs.writeFileSync(path.join(claim, "actions.ts"), '"use server";\nexport async function claim() {}\n');
    fs.writeFileSync(path.join(claim, "inline.ts"), 'export async function claimInline() {\n  "use server";\n}\n');
    assert.deepEqual(discoverPrivateRaffleOperations(root), [
      "app/leader-dashboard/raffle/nested/route.ts",
      "app/raffle/claim/actions.ts",
      "app/raffle/claim/inline.ts",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("test files and ordinary Server Components never become operation evidence", () => {
  const root = fixture();
  try {
    const claim = path.join(root, "app", "raffle", "claim");
    fs.mkdirSync(claim, { recursive: true });
    fs.writeFileSync(path.join(claim, "page.tsx"), "export default function Page() {}\n");
    fs.writeFileSync(path.join(claim, "behavior.test.mts"), '"use server";\n');
    assert.deepEqual(discoverPrivateRaffleOperations(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
