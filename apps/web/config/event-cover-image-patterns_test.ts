import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import schedule from "../public/data/guild-schedule.json" with { type: "json" };

const nextConfigUrl = new URL("../next.config.ts", import.meta.url);
// Resolve the same local imports that Next's config loader handles.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === nextConfigUrl.href) {
      if (specifier === "./config/public-urls.json") {
        return {
          ...nextResolve(new URL(specifier, nextConfigUrl).href, context),
          importAttributes: { type: "json" },
        };
      }
      if (["./config/forums-connect-private-headers", "./config/event-cover-image-patterns"].includes(specifier)) {
        return nextResolve(new URL(`${specifier}.ts`, nextConfigUrl).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
const { default: nextConfig } = await import("../next.config.ts");
hooks.deregister();
const require = createRequire(import.meta.url);
const { hasLocalMatch } = require("next/dist/shared/lib/match-local-pattern");
const patterns = nextConfig.images?.localPatterns;
const version = `?v=${encodeURIComponent(schedule.discordCoverVersion)}`;
const covers = [...Object.values(schedule.monthly), ...schedule.weekly.filter((event) => event.discord)]
  .map((event) => `/${event.discordCoverImage.replace(/^\.?\//, "")}`);

test("the real Next configuration permits exactly the eight current versioned covers", () => {
  assert.equal(covers.length, 8);
  assert.deepEqual(patterns, [
    { pathname: "/**", search: "" },
    ...covers.map((pathname) => ({ pathname, search: version })),
  ]);
  for (const cover of covers) {
    assert.equal(hasLocalMatch(patterns, cover + version), true, cover);
    assert.equal(hasLocalMatch(patterns, cover), true, `${cover}: existing unqueried source`);
  }
  assert.equal(hasLocalMatch(patterns, "/assets/img/events/hero.webp"), true);
});

test("Next rejects wrong versions, extra queries and unrelated versioned image paths", () => {
  for (const cover of covers) {
    for (const search of ["?v=wrong", `${version}&extra=1`, "?extra=1", `?extra=1&${version.slice(1)}`]) {
      assert.equal(hasLocalMatch(patterns, cover + search), false, cover + search);
    }
  }
  for (const pathname of [
    "/assets/img/events/hero.webp", "/assets/img/discord-events/united-resolve.png",
    "/assets/img/discord-events/unreviewed.png", "/private/cover.png",
  ]) {
    assert.equal(hasLocalMatch(patterns, pathname + version), false, pathname);
  }
});
