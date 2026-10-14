import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { galleryExactPixelAssets, galleryStaticImageBudget } from "./gallery-static-image-budget.mjs";

test("ordinary gallery files retain their existing budgets", () => {
  assert.equal(galleryStaticImageBudget("assets/img/gallery/shot-43.webp", null, "full").maximumBytes, 2 * 1024 * 1024);
  assert.equal(galleryStaticImageBudget("assets/img/gallery/thumbs/shot-43.webp", null, "thumbnail").maximumBytes, 300 * 1024);
  assert.throws(() => galleryStaticImageBudget("anything", null, "unknown"));
});

test("localized pixel exceptions require the exact reviewed bytes, not only a matching path", () => {
  for (const [assetPath, policy] of Object.entries(galleryExactPixelAssets)) {
    const bytes = readFileSync(`apps/web/public/${assetPath}`);
    const kind = assetPath.includes("/thumbs/") ? "thumbnail" : "full";
    assert.equal(galleryStaticImageBudget(assetPath, bytes, kind), policy);
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    assert.throws(() => galleryStaticImageBudget(assetPath, changed, kind));
    assert.throws(() => galleryStaticImageBudget(assetPath, bytes.subarray(1), kind));
    assert.equal(galleryStaticImageBudget(`${assetPath}?copied`, bytes, kind).maximumBytes,
      kind === "full" ? 2 * 1024 * 1024 : 300 * 1024);
  }
});
