const MIGRATION_VERSION = /^\d{14}$/;

export function parseSupabaseMigrationList(text) {
  const source = String(text || "");
  const rows = parseJsonRows(source) ?? parseTableRows(source);
  const versions = [...new Set(rows.map((row) => row.remote).filter(Boolean))].sort();

  return {
    totalRows: rows.length,
    versions,
    rows,
  };
}

function parseJsonRows(source) {
  try {
    const payload = JSON.parse(source);
    if (!Array.isArray(payload?.migrations)) return null;
    return payload.migrations.map(normalizeRow).filter((row) => row.local || row.remote);
  } catch {
    return null;
  }
}

function parseTableRows(source) {
  const rows = [];
  const withoutAnsi = source.replace(/\u001b\[[0-9;]*m/gu, "");
  for (const line of withoutAnsi.split(/\r?\n/)) {
    const match = line.match(/^\s*`?(\d{14})?`?\s*\|\s*`?(\d{14})?`?\s*\|/u);
    if (!match) continue;
    const row = normalizeRow({ local: match[1], remote: match[2] });
    if (row.local || row.remote) rows.push(row);
  }
  return rows;
}

function normalizeRow(row) {
  const local = String(row?.local || "");
  const remote = String(row?.remote || "");
  return {
    local: MIGRATION_VERSION.test(local) ? local : "",
    remote: MIGRATION_VERSION.test(remote) ? remote : "",
  };
}
