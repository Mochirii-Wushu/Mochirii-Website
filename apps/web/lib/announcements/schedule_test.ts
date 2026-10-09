import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileModule, ModuleKind, JsxEmit, ScriptTarget } from "typescript";
import authority from "../../public/data/guild-schedule.json" with { type: "json" };
import announcements from "../../public/data/announcements.json" with { type: "json" };
import { websiteEventCardsFromSchedule } from "../guild-schedule.ts";
import { announcementScheduleLines } from "./schedule.ts";

const appRoot = new URL("../../", import.meta.url);
// Exercise the real server view and its shared formatting. Native Node needs
// the same local TSX/alias resolution and Next image default used by the app.
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
    if (["next/image", "next/link"].includes(specifier) && ownedSource) {
      const componentUrl = new URL(`node_modules/${specifier}.js`, appRoot);
      return { url: `data:text/javascript,${encodeURIComponent(`import component from ${JSON.stringify(componentUrl.href)}; export default component.default;`)}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/") || (specifier.startsWith(".") && ownedSource)) {
      const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), appRoot) : new URL(specifier, context.parentURL);
      for (const suffix of ["", ".ts", ".tsx"]) {
        const candidate = new URL(target.href + suffix);
        if (!existsSync(fileURLToPath(candidate))) continue;
        return { ...nextResolve(candidate.href, context), ...(candidate.pathname.endsWith(".json") ? { importAttributes: { type: "json" } } : {}) };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(appRoot.href) && url.endsWith(".tsx") && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022 },
      }).outputText };
    }
    return nextLoad(url, context);
  },
});
const { AnnouncementsPage } = await import("../../components/public-pages/route-pages/AnnouncementsPage.tsx");
hooks.deregister();

const expected = [
  "Guild Party: Every Day - 9:30 PM - 10:00 PM - UTC+8",
  "Breaking Army: Mondays & Wednesdays - 10:00 PM - 12:00 AM - UTC+8 (ends the following day)",
  "Showdown: Tuesdays & Thursdays - 10:00 PM - 12:00 AM - UTC+8 (ends the following day)",
  "Guild Wars: Saturdays & Sundays - 8:30 PM - 11:00 PM - UTC+8",
  "Guild Hero's Realm: Weekly Coordination: Fridays - 11:00 PM - 12:00 AM - UTC+8 (ends the following day)",
  "Skyward Bond: Fridays - 10:00 PM - 11:00 PM - UTC+8",
  "Monthly Guild Gathering: Monday after the first Sunday - 12:00 AM - 1:00 AM - UTC+8",
];
function decode(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}
const render = () => renderToStaticMarkup(createElement(AnnouncementsPage));
function pinnedSection(html: string) {
  const section = html.match(/<section\b[^>]*data-announcement="weekly-schedule"[^>]*>(.*?)<\/section>/s);
  assert(section, "Pinned schedule must be present in server HTML");
  return section[1];
}

test("announcements derive all six weekly activities and gathering, with identical JSON fallback", () => {
  assert.deepEqual(announcementScheduleLines(authority), expected);
  assert.deepEqual(announcements.items.find((item) => item.id === "weekly-schedule")?.details, expected);
  assert.equal(expected.filter((line) => line.includes("ends the following day")).length, 3);
  assert(expected.every((line) => line.includes("UTC+8")));
  assert(!expected.some((line) => /raffle/i.test(line)));
});

test("announcement clocks follow source fields instead of the fallback time strings", () => {
  const changed = structuredClone(authority);
  Object.assign(changed.weekly[0], { title: "Updated Party", dayText: "Mondays", startTime: "20:15", endTime: "21:45", timeText: "stale" });
  Object.assign(changed.monthly.gathering, { startTime: "00:30", endTime: "01:30" });
  const lines = announcementScheduleLines(changed);
  assert.equal(lines[0], "Updated Party: Mondays - 8:15 PM - 9:45 PM - UTC+8");
  assert.equal(lines.at(-1), "Monthly Guild Gathering: Monday after the first Sunday - 12:30 AM - 1:30 AM - UTC+8");
  assert.deepEqual(announcementScheduleLines({}), []);
  assert.deepEqual(announcementScheduleLines({ monthly: { raffle: authority.monthly.raffle }, weekly: [{ ...authority.weekly[0], discord: false }] }), []);
});

test("real Announcements SSR contains seven schedule bullets and the current pinned revision", () => {
  const html = render(), pinned = pinnedSection(html);
  assert.deepEqual([...pinned.matchAll(/<li>(.*?)<\/li>/gs)].map((match) => decode(match[1])), expected);
  assert(pinned.includes("Pinned • 9 Oct 2026"));
  assert(pinned.includes("Guild Schedule Updated"));
  assert(pinned.includes("first-Sunday 24:00–25:00"));
  assert(pinned.includes("following Monday, 12:00 AM–1:00 AM"));
  assert(html.includes("All times UTC+8"));
  assert(html.includes("Updated 9 Oct 2026"));
  assert(!/Monthly Guild Raffle|This month|first Monday/i.test(html));
  assert.deepEqual([...html.matchAll(/data-announcement="([^"]+)"/g)].map((match) => match[1]), ["weekly-schedule", "training-focus", "gallery-submissions"]);
  assert(html.includes("Training Focus: Fundamentals — February 2026"));
  assert(html.includes("Notice • 21 Feb 2026"));
});

test("server schedule and date-only notice output is identical across host timezones", () => {
  const previous = process.env.TZ;
  try {
    const outputs = ["UTC", "America/Los_Angeles", "Pacific/Auckland", "Asia/Singapore"].map((zone) => {
      process.env.TZ = zone;
      assert.deepEqual(announcementScheduleLines(authority), expected);
      return render();
    });
    assert(outputs.every((html) => html === outputs[0]));
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("gathering notice describes the first-Sunday shift rather than a first-Monday approximation", () => {
  assert.equal(websiteEventCardsFromSchedule(authority, new Date("2027-02-01T00:00:00.000Z")).find((event) => event.id === "monthly-gathering")?.date, "2027-02-08");
  assert(announcementScheduleLines(authority).at(-1)?.includes("Monday after the first Sunday"));
});
