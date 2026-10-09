import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileModule, ModuleKind, JsxEmit, ScriptTarget } from "typescript";
import authority from "../../public/data/guild-schedule.json" with { type: "json" };
import publicUrls from "../../config/public-urls.json" with { type: "json" };

const appRoot = new URL("../../", import.meta.url);
const nextModules = new Set(["next/image", "next/link"]);
// Exercise the actual TSX components with the same local module resolution as Next.
// Native Node needs Next's CommonJS image default unwrapped, without mocking the renderer.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const ownedSource = context.parentURL?.startsWith(appRoot.href) && !context.parentURL.includes("/node_modules/");
    if (specifier === "react/jsx-runtime" && ownedSource) {
      const runtimeUrl = new URL("node_modules/react/jsx-runtime.js", appRoot);
      return {
        url: `data:text/javascript,${encodeURIComponent(`import runtime from ${JSON.stringify(runtimeUrl.href)}; export const { jsx, jsxs, Fragment } = runtime;`)}`,
        shortCircuit: true,
      };
    }
    if (nextModules.has(specifier) && ownedSource) {
      const nextModuleUrl = new URL(`node_modules/${specifier}.js`, appRoot);
      return {
        url: `data:text/javascript,${encodeURIComponent(`import component from ${JSON.stringify(nextModuleUrl.href)}; export default component.default;`)}`,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/") || (specifier.startsWith(".") && ownedSource)) {
      const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), appRoot) : new URL(specifier, context.parentURL);
      for (const suffix of ["", ".ts", ".tsx"]) {
        const candidate = new URL(target.href + suffix);
        if (!existsSync(fileURLToPath(candidate))) continue;
        return {
          ...nextResolve(candidate.href, context),
          ...(candidate.pathname.endsWith(".json") ? { importAttributes: { type: "json" } } : {}),
        };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(appRoot.href) && url.endsWith(".tsx") && !url.includes("/node_modules/")) {
      return {
        format: "module",
        shortCircuit: true,
        source: transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022 },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { EventsSchedule } = await import("../../components/public-pages/EventsSchedule.tsx");
hooks.deregister();

const referenceTime = "2026-10-09T12:00:00.000Z";
const featured = { href: "https://mochirii.com/events", linkLabel: "RSVP & details in Discord" };
const scheduleData = { timezone: authority.timezone, weekly: [authority.weekly[0]] };

function links(html: string) {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map((match) => ({ href: match[1], label: match[2].replaceAll("&amp;", "&") }));
}

test("featured and board participation use the invite even when shell fallback points to this page", () => {
  const html = renderToStaticMarkup(createElement(EventsSchedule, { referenceTime, featured, scheduleData }));
  assert.deepEqual(links(html), [
    { href: publicUrls.discordInviteUrl, label: "RSVP & details in Discord" },
    { href: publicUrls.discordInviteUrl, label: "RSVP & details in Discord" },
  ]);
  assert.match(html, /role="group" aria-label="Event Board results" tabindex="0"/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /class="events-upcoming" aria-live/);
});

test("explicit event details URLs keep their destination and an accurate details label", () => {
  const explicit = {
    ...scheduleData,
    weekly: [{ ...authority.weekly[0], href: "https://example.com/event-details" }],
  };
  const html = renderToStaticMarkup(createElement(EventsSchedule, { referenceTime, featured, scheduleData: explicit }));
  assert.deepEqual(links(html), [
    { href: "https://example.com/event-details", label: "Open details" },
    { href: "https://example.com/event-details", label: "Open details" },
  ]);
});
