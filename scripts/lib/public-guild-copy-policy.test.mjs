import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APPROVED_HOME_SUBTITLE,
  PROTECTED_EDITORIAL_FIELDS,
  TARGETED_PUBLIC_PAGE_SHELL_FILES,
  discoverPublicJsonFiles,
  formatPolicyIssue,
  scanEditorialText,
  scanExactGameName,
  scanJsonExactGameName,
  stripStylingTokens,
} from "./public-guild-copy-policy.mjs";

test("exact game-name authorization is location- and value-bound", () => {
  assert.deepEqual(
    scanExactGameName("apps/web/public/data/home.json", "$.hero.subtitle", APPROVED_HOME_SUBTITLE),
    { count: 1, issues: [] },
  );
  for (const [pathName, pointer, value] of [
    ["apps/web/public/data/events.json", "$.intro", APPROVED_HOME_SUBTITLE],
    ["apps/web/public/data/gallery.json", "$.albums[0].items[0].caption", APPROVED_HOME_SUBTITLE],
    ["apps/web/public/data/home.json", "$.hero.subtitle", `${APPROVED_HOME_SUBTITLE} Community`],
  ]) {
    const result = scanExactGameName(pathName, pointer, value);
    assert.equal(result.count, 1);
    assert.equal(result.issues.length, 1);
    assert.equal(formatPolicyIssue(result.issues[0]).includes(value), false);
  }
});

test("JSON identity scanning walks every nested string without mood-linting captions", () => {
  const result = scanJsonExactGameName("apps/web/public/data/gallery.json", {
    items: [{ caption: "warm sunlight" }, { caption: APPROVED_HOME_SUBTITLE }],
  });
  assert.equal(result.count, 1);
  assert.deepEqual(result.issues.map((issue) => issue.location), ["$.items[1].caption"]);
});

test("public JSON discovery is recursive and automatically includes new files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mochirii-public-copy-"));
  try {
    const data = path.join(root, "apps", "web", "public", "data");
    mkdirSync(path.join(data, "nested"), { recursive: true });
    writeFileSync(path.join(data, "home.json"), "{}\n");
    writeFileSync(path.join(data, "nested", "fixture.json"), "{}\n");
    assert.deepEqual(discoverPublicJsonFiles(root), [
      "apps/web/public/data/home.json",
      "apps/web/public/data/nested/fixture.json",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("editorial rules cover Gallery shell copy while ignoring styling tokens", () => {
  assert.deepEqual(
    scanEditorialText("GalleryPage.tsx", 1, "Portraits, gatherings, and road scenes from the guild album."),
    [],
  );
  assert.deepEqual(
    scanEditorialText("GalleryPage.tsx", 2, "Shared runs, quiet roads, and little guild memories."),
    [
      { path: "GalleryPage.tsx", location: 2, category: "mood-filler-wording" },
      { path: "GalleryPage.tsx", location: 2, category: "generic-non-game-wording" },
    ],
  );
  assert.deepEqual(
    scanEditorialText("GalleryPage.tsx", 3, "A tiny guild moment."),
    [{ path: "GalleryPage.tsx", location: 3, category: "generic-non-game-wording" }],
  );
  assert.equal(scanEditorialText("GalleryPage.tsx", 4, stripStylingTokens('className="glass-card--soft"')).length, 0);
  assert.deepEqual(TARGETED_PUBLIC_PAGE_SHELL_FILES, [
    "apps/web/components/public-pages/route-pages/GalleryPage.tsx",
  ]);
  assert.equal(TARGETED_PUBLIC_PAGE_SHELL_FILES.some((file) => file.endsWith("SpotifyPage.tsx")), false);
});

test("later editorial preferences never rewrite protected Recruitment copy", () => {
  assert.equal(PROTECTED_EDITORIAL_FIELDS.size, 8);
  assert.deepEqual(
    scanEditorialText(
      "apps/web/public/data/recruitment.json",
      "$.content.paragraphs[0]",
      "This protected historical sentence may feel at home.",
    ),
    [],
  );
  assert.deepEqual(
    scanEditorialText(
      "apps/web/public/data/recruitment.json",
      "$.content.conclusion[0]",
      "This protected conclusion remains warm.",
    ),
    [],
  );
  assert.deepEqual(
    scanEditorialText("apps/web/public/data/recruitment.json", "$.meta.intro", "A warm supporting line."),
    [{
      path: "apps/web/public/data/recruitment.json",
      location: "$.meta.intro",
      category: "mood-filler-wording",
    }],
  );
});
