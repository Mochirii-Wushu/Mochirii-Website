import assert from "node:assert/strict";
import { parseSupabaseMigrationList } from "./lib/supabase-migration-list.mjs";

const jsonResult = parseSupabaseMigrationList(JSON.stringify({
  migrations: [
    { local: "20260513081523", remote: "20260513081523", time: "2026-05-13 08:15:23" },
    { local: "20260513193110", remote: "", time: "2026-05-13 19:31:10" },
    { local: "", remote: "20260513195853", time: "2026-05-13 19:58:53" },
  ],
}));

assert.deepEqual(jsonResult, {
  totalRows: 3,
  versions: ["20260513081523", "20260513195853"],
  rows: [
    { local: "20260513081523", remote: "20260513081523" },
    { local: "20260513193110", remote: "" },
    { local: "", remote: "20260513195853" },
  ],
});

const tableResult = parseSupabaseMigrationList(`
        LOCAL          |        REMOTE         |      TIME (UTC)
  ---------------------|-----------------------|---------------------
   20260607094500      | 20260607094500        | 2026-06-07 09:45:00
   20260607125027      |                       | 2026-06-07 12:50:27
                      | 20260608093407        | 2026-06-08 09:34:07
`);

assert.deepEqual(tableResult.versions, ["20260607094500", "20260608093407"]);
assert.equal(tableResult.totalRows, 3);
const currentCliTableResult = parseSupabaseMigrationList(`
\u001b[31mConnecting to local database...\u001b[0m
   Local            | Remote           | Time (UTC)
  ------------------|------------------|-----------------------
   \`20260727211442\` | \`20260727211442\` | \`2026-07-27 21:14:42\`
   \`20260727212838\` | \`20260727212838\` | \`2026-07-27 21:28:38\`
`);
assert.deepEqual(currentCliTableResult, {
  totalRows: 2,
  versions: ["20260727211442", "20260727212838"],
  rows: [
    { local: "20260727211442", remote: "20260727211442" },
    { local: "20260727212838", remote: "20260727212838" },
  ],
});
assert.deepEqual(parseSupabaseMigrationList("not migration output"), {
  totalRows: 0,
  versions: [],
  rows: [],
});

console.log("Supabase migration-list parser tests OK.");
