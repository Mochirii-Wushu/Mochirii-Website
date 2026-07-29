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

test("route groups above or between private segments cannot bypass operation discovery", () => {
  const root = fixture();
  try {
    const groupedClaim = path.join(root, "app", "(member)", "raffle", "claim");
    const groupedBetweenSegments = path.join(root, "app", "leader-dashboard", "(private)", "raffle", "nested");
    const groupedInsideClaim = path.join(root, "app", "raffle", "(member)", "claim");
    fs.mkdirSync(groupedClaim, { recursive: true });
    fs.mkdirSync(groupedBetweenSegments, { recursive: true });
    fs.mkdirSync(groupedInsideClaim, { recursive: true });
    fs.writeFileSync(path.join(groupedClaim, "actions.ts"), '"use server";\nexport async function claim() {}\n');
    fs.writeFileSync(path.join(groupedBetweenSegments, "route.ts"), "export async function POST() {}\n");
    fs.writeFileSync(path.join(groupedInsideClaim, "inline.ts"), 'export async function claimInline() {\n  "use server";\n}\n');

    assert.deepEqual(discoverPrivateRaffleOperations(root), [
      "app/(member)/raffle/claim/actions.ts",
      "app/leader-dashboard/(private)/raffle/nested/route.ts",
      "app/raffle/(member)/claim/inline.ts",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parallel slots above or between private segments cannot bypass operation discovery", () => {
  const root = fixture();
  try {
    const slotAbove = path.join(root, "app", "@member", "raffle", "claim");
    const slotBetweenSegments = path.join(root, "app", "leader-dashboard", "@private", "raffle");
    const slotInsideClaim = path.join(root, "app", "raffle", "@member", "claim");
    fs.mkdirSync(slotAbove, { recursive: true });
    fs.mkdirSync(slotBetweenSegments, { recursive: true });
    fs.mkdirSync(slotInsideClaim, { recursive: true });
    fs.writeFileSync(path.join(slotAbove, "actions.ts"), '"use server";\nexport async function claim() {}\n');
    fs.writeFileSync(path.join(slotBetweenSegments, "route.ts"), "export async function POST() {}\n");
    fs.writeFileSync(path.join(slotInsideClaim, "inline.ts"), 'export async function claimInline() {\n  "use server";\n}\n');

    assert.deepEqual(discoverPrivateRaffleOperations(root), [
      "app/@member/raffle/claim/actions.ts",
      "app/leader-dashboard/@private/raffle/route.ts",
      "app/raffle/@member/claim/inline.ts",
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
