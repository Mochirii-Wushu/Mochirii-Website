import {
  type CurrentSpotlightWinnerDependencies,
  handleCurrentSpotlightWinner,
} from "./index.ts";

const CURRENT_MONTH = "2026-08-01";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fakeDependencies({
  selection = { data: null, error: null },
  legacy = { data: null, error: null },
  month = CURRENT_MONTH,
}: {
  selection?: { data: unknown; error: { code?: string | null } | null };
  legacy?: { data: unknown; error: { code?: string | null } | null };
  month?: string;
} = {}) {
  const calls = { current: 0, legacy: 0 };
  const dependencies: CurrentSpotlightWinnerDependencies = {
    createAdminClientImpl: () => ({}) as never,
    cycleMonthForImpl: () => month,
    currentSelectionLookup: async () => {
      calls.current += 1;
      return selection;
    },
    legacyWinnerLookup: async () => {
      calls.legacy += 1;
      return legacy;
    },
  };
  return { calls, dependencies };
}

function recordingAdminClient({
  selection = { data: null, error: null },
  legacy = { data: null, error: null },
}: {
  selection?: { data: unknown; error: { code?: string | null } | null };
  legacy?: { data: unknown; error: { code?: string | null } | null };
} = {}) {
  const calls: string[] = [];
  const results = new Map([
    ["member_spotlight_selections", selection],
    ["spotlight_poll_cycles", legacy],
  ]);
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      const query = {
        select(columns: string) {
          calls.push(`select:${columns}`);
          return query;
        },
        eq(column: string, value: unknown) {
          calls.push(`eq:${column}:${String(value)}`);
          return query;
        },
        not(column: string, operator: string, value: unknown) {
          calls.push(`not:${column}:${operator}:${String(value)}`);
          return query;
        },
        async maybeSingle() {
          calls.push("maybeSingle");
          return results.get(table) ?? { data: null, error: null };
        },
      };
      return query;
    },
  } as never;
  return { calls, client };
}

async function json(response: Response) {
  assertNoStore(response);
  return await response.json() as Record<string, unknown>;
}

function assertNoStore(response: Response) {
  assert(
    response.headers.get("cache-control") === "no-store",
    "every public winner response must prohibit caching",
  );
}

Deno.test("current selection wins and returns only the two public fields", async () => {
  const { calls, dependencies } = fakeDependencies({
    selection: {
      data: {
        cycle_month: CURRENT_MONTH,
        winner_display_name: "  Nur   Syidah  ",
      },
      error: null,
    },
  });
  const response = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid", { method: "GET" }),
    dependencies,
  );
  const body = await json(response);
  const data = body.data as Record<string, unknown>;

  assert(
    response.status === 200 && body.ok === true,
    "the current selection must succeed",
  );
  assert(
    JSON.stringify(Object.keys(data).sort()) ===
      JSON.stringify(["monthKey", "winnerName"]),
    "the public field set must be exact",
  );
  assert(
    data.winnerName === "Nur Syidah" && data.monthKey === CURRENT_MONTH,
    "the response must use the bounded name and requested current month",
  );
  assert(
    calls.current === 1 && calls.legacy === 0,
    "a current selection must not query legacy history",
  );
});

Deno.test("missing-table transition uses only an exact current-month legacy row", async () => {
  for (
    const selection of [
      { data: null, error: { code: "42P01" } },
      { data: null, error: { code: "PGRST205" } },
    ]
  ) {
    const { calls, dependencies } = fakeDependencies({
      selection,
      legacy: {
        data: {
          cycle_month: CURRENT_MONTH,
          winner_display_name: "Legacy Member",
        },
        error: null,
      },
    });
    const response = await handleCurrentSpotlightWinner(
      new Request("https://example.invalid"),
      dependencies,
    );
    const body = await json(response);
    const data = body.data as Record<string, unknown>;
    assert(
      response.status === 200 && data.winnerName === "Legacy Member",
      "the compatible legacy fallback must succeed",
    );
    assert(
      data.monthKey === CURRENT_MONTH,
      "legacy fallback must never attest a historical month",
    );
    assert(
      calls.current === 1 && calls.legacy === 1,
      "the fallback must query each source once",
    );
  }
});

Deno.test("an empty current row never delegates to dormant legacy authority", async () => {
  const { calls, dependencies } = fakeDependencies({
    legacy: {
      data: {
        cycle_month: CURRENT_MONTH,
        winner_display_name: "Dormant Legacy Member",
      },
      error: null,
    },
  });
  const response = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    dependencies,
  );
  const body = await json(response);
  assert(
    JSON.stringify(body) === JSON.stringify({
      ok: true,
      data: { winnerName: null, monthKey: CURRENT_MONTH },
    }),
    "an empty authoritative table must return only the generic current-month DTO",
  );
  assert(
    calls.current === 1 && calls.legacy === 0,
    "legacy history must remain dormant after the new table exists",
  );
});

Deno.test("the actual query builders bind exact tables, columns, filters, and cardinality", async () => {
  const current = recordingAdminClient({
    selection: {
      data: {
        cycle_month: CURRENT_MONTH,
        winner_display_name: "Current Member",
      },
      error: null,
    },
  });
  const currentResponse = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    {
      createAdminClientImpl: () => current.client,
      cycleMonthForImpl: () => CURRENT_MONTH,
    },
  );
  assert(
    currentResponse.status === 200,
    "the production current query builder must succeed",
  );
  assertNoStore(currentResponse);
  assert(
    JSON.stringify(current.calls) === JSON.stringify([
      "from:member_spotlight_selections",
      "select:cycle_month,winner_display_name",
      `eq:cycle_month:${CURRENT_MONTH}`,
      "maybeSingle",
    ]),
    "the current query builder must remain exact",
  );

  const transition = recordingAdminClient({
    selection: { data: null, error: { code: "PGRST205" } },
    legacy: {
      data: {
        cycle_month: CURRENT_MONTH,
        winner_display_name: "Legacy Member",
      },
      error: null,
    },
  });
  const transitionResponse = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    {
      createAdminClientImpl: () => transition.client,
      cycleMonthForImpl: () => CURRENT_MONTH,
    },
  );
  assert(
    transitionResponse.status === 200,
    "the production transition query builder must succeed",
  );
  assertNoStore(transitionResponse);
  assert(
    JSON.stringify(transition.calls) === JSON.stringify([
      "from:member_spotlight_selections",
      "select:cycle_month,winner_display_name",
      `eq:cycle_month:${CURRENT_MONTH}`,
      "maybeSingle",
      "from:spotlight_poll_cycles",
      "select:cycle_month,winner_display_name",
      `eq:cycle_month:${CURRENT_MONTH}`,
      "eq:status:published",
      "not:winner_display_name:is:null",
      "maybeSingle",
    ]),
    "the legacy transition query builder must remain exact",
  );
});

Deno.test("stale current and legacy rows are rejected instead of being relabeled", async () => {
  const staleMonth = "2026-07-01";
  for (
    const dependencies of [
      fakeDependencies({
        selection: {
          data: {
            cycle_month: staleMonth,
            winner_display_name: "STALE_CURRENT_SENTINEL",
          },
          error: null,
        },
      }).dependencies,
      fakeDependencies({
        selection: { data: null, error: { code: "PGRST205" } },
        legacy: {
          data: {
            cycle_month: staleMonth,
            winner_display_name: "STALE_LEGACY_SENTINEL",
          },
          error: null,
        },
      }).dependencies,
    ]
  ) {
    const response = await handleCurrentSpotlightWinner(
      new Request("https://example.invalid"),
      dependencies,
    );
    const body = await response.text();
    assertNoStore(response);
    assert(response.status === 500, "a stale database row must fail closed");
    assert(
      !body.includes("STALE_"),
      "a stale winner must not reach the public response",
    );
  }
});

Deno.test("no current winner returns one exact generic current-month DTO", async () => {
  const { dependencies } = fakeDependencies();
  const response = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    dependencies,
  );
  const body = await json(response);
  assert(
    JSON.stringify(body) === JSON.stringify({
      ok: true,
      data: { winnerName: null, monthKey: CURRENT_MONTH },
    }),
    "the empty result must contain no member or provider data",
  );
});

Deno.test("query failures and malformed winner names fail behind fixed public categories", async () => {
  const sentinel = "PRIVATE_QUERY_SENTINEL";
  for (
    const dependencies of [
      fakeDependencies({ selection: { data: null, error: { code: sentinel } } })
        .dependencies,
      fakeDependencies({
        selection: { data: null, error: { code: "PGRST205" } },
        legacy: { data: null, error: { code: sentinel } },
      }).dependencies,
      {
        ...fakeDependencies().dependencies,
        currentSelectionLookup: async () => {
          throw new Error(sentinel);
        },
      },
    ]
  ) {
    const response = await handleCurrentSpotlightWinner(
      new Request("https://example.invalid"),
      dependencies,
    );
    const bodyText = await response.text();
    assertNoStore(response);
    assert(response.status === 500, "query failures must be unavailable");
    assert(
      !bodyText.includes(sentinel),
      "private diagnostics must never reach the response",
    );
  }

  const malformed = fakeDependencies({
    selection: {
      data: {
        cycle_month: CURRENT_MONTH,
        winner_display_name: "Alice\u200fInjected",
      },
      error: null,
    },
  });
  const malformedResponse = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    malformed.dependencies,
  );
  assert(
    malformedResponse.status === 500,
    "directional controls in an authoritative row must fail closed",
  );
  assertNoStore(malformedResponse);
});

Deno.test("setup and fulfilled-result hostiles resolve behind fixed no-store responses", async () => {
  const sentinel = "PRIVATE_SETUP_OR_RESULT_SENTINEL";
  const base = fakeDependencies().dependencies;
  const transition = fakeDependencies({
    selection: { data: null, error: { code: "PGRST205" } },
  }).dependencies;
  const hostiles: CurrentSpotlightWinnerDependencies[] = [
    {
      ...base,
      cycleMonthForImpl: () => {
        throw new Error(sentinel);
      },
    },
    {
      ...base,
      createAdminClientImpl: () => {
        throw new Error(sentinel);
      },
    },
    {
      ...base,
      currentSelectionLookup: async () => null,
    },
    {
      ...transition,
      legacyWinnerLookup: async () => null,
    },
  ];
  const diagnostics: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    diagnostics.push(values.map(String).join(" "));
  };

  try {
    for (const dependencies of hostiles) {
      const response = await handleCurrentSpotlightWinner(
        new Request("https://example.invalid"),
        dependencies,
      );
      const bodyText = await response.text();
      assert(response.status === 500, "dependency hostiles must fail closed");
      assertNoStore(response);
      assert(
        !bodyText.includes(sentinel),
        "dependency diagnostics must never reach the response",
      );
    }
  } finally {
    console.error = originalConsoleError;
  }

  assert(
    diagnostics.length === hostiles.length &&
      diagnostics.every((entry) => !entry.includes(sentinel)),
    "dependency hostiles must emit only fixed internal categories",
  );
});

Deno.test("method, configuration, and month guards fail closed", async () => {
  const method = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid", { method: "DELETE" }),
  );
  assert(method.status === 405, "unsupported methods must be rejected");
  assertNoStore(method);

  const missing = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    {
      createAdminClientImpl: () => null,
      cycleMonthForImpl: () => CURRENT_MONTH,
    },
  );
  assert(
    missing.status === 500,
    "missing service configuration must fail closed",
  );
  assertNoStore(missing);

  const invalidMonth = await handleCurrentSpotlightWinner(
    new Request("https://example.invalid"),
    {
      createAdminClientImpl: () => ({}) as never,
      cycleMonthForImpl: () => "2026-08-02",
    },
  );
  assert(
    invalidMonth.status === 500,
    "an invalid current month must fail before querying",
  );
  assertNoStore(invalidMonth);
});
