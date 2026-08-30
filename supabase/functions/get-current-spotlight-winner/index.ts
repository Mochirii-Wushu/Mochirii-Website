import "@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  cycleMonthFor,
  jsonResponse,
} from "../_shared/spotlight-polls.ts";
import { asRecord, type JsonRecord } from "../_shared/vote-reminders.ts";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;
type QueryResult = {
  data: unknown;
  error: { code?: string | null } | null;
};
type WinnerLookup = (
  client: AdminClient,
  currentMonth: string,
) => Promise<unknown>;

export type CurrentSpotlightWinnerDependencies = {
  createAdminClientImpl?: typeof createAdminClient;
  cycleMonthForImpl?: typeof cycleMonthFor;
  currentSelectionLookup?: WinnerLookup;
  legacyWinnerLookup?: WinnerLookup;
};

const MONTH_KEY = /^\d{4}-(?:0[1-9]|1[0-2])-01$/u;
const CONTROL_OR_BIDI =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u;

function publicWinnerName(value: unknown): string | null {
  if (
    typeof value !== "string" || CONTROL_OR_BIDI.test(value) ||
    UNPAIRED_SURROGATE.test(value)
  ) return null;
  const name = value.trim().replace(/\s+/gu, " ");
  return name && name.length <= 120 ? name : null;
}

function winnerNameForExactMonth(
  value: unknown,
  currentMonth: string,
): string | null {
  const record = asRecord(value);
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "cycle_month" ||
    keys[1] !== "winner_display_name" ||
    record.cycle_month !== currentMonth
  ) {
    return null;
  }
  return publicWinnerName(record.winner_display_name);
}

function normalizedQueryResult(value: unknown): QueryResult | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    if (!Object.hasOwn(record, "data") || !Object.hasOwn(record, "error")) {
      return null;
    }

    const errorValue = record.error;
    if (errorValue === null) {
      return { data: record.data, error: null };
    }
    if (
      !errorValue || typeof errorValue !== "object" ||
      Array.isArray(errorValue)
    ) {
      return null;
    }

    const errorRecord = errorValue as Record<string, unknown>;
    const code = errorRecord.code;
    if (code !== undefined && code !== null && typeof code !== "string") {
      return null;
    }
    return {
      data: record.data,
      error: { code: code ?? null },
    };
  } catch {
    return null;
  }
}

async function loadCurrentSelection(
  client: AdminClient,
  currentMonth: string,
): Promise<QueryResult> {
  return await client
    .from("member_spotlight_selections")
    .select("cycle_month,winner_display_name")
    .eq("cycle_month", currentMonth)
    .maybeSingle();
}

async function loadLegacyWinner(
  client: AdminClient,
  currentMonth: string,
): Promise<QueryResult> {
  return await client
    .from("spotlight_poll_cycles")
    .select("cycle_month,winner_display_name")
    .eq("cycle_month", currentMonth)
    .eq("status", "published")
    .not("winner_display_name", "is", null)
    .maybeSingle();
}

function noStoreJsonResponse(body: JsonRecord, status = 200): Response {
  const response = jsonResponse(body, status);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function fixedFailure(message: string): Response {
  return noStoreJsonResponse({ ok: false, message }, 500);
}

export async function handleCurrentSpotlightWinner(
  req: Request,
  dependencies: CurrentSpotlightWinnerDependencies = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return noStoreJsonResponse({ ok: true });
  if (!["GET", "POST"].includes(req.method)) {
    return noStoreJsonResponse(
      { ok: false, message: "Method not allowed." },
      405,
    );
  }

  let currentMonth: string;
  let adminClient: AdminClient;
  try {
    currentMonth = (dependencies.cycleMonthForImpl ?? cycleMonthFor)();
    if (!MONTH_KEY.test(currentMonth)) {
      return fixedFailure("Current spotlight winner could not be loaded.");
    }

    const configuredClient =
      (dependencies.createAdminClientImpl ?? createAdminClient)();
    if (!configuredClient) {
      return fixedFailure("Spotlight winner lookup is not configured yet.");
    }
    adminClient = configuredClient;
  } catch {
    console.error("current spotlight setup failed");
    return fixedFailure("Current spotlight winner could not be loaded.");
  }

  let selectionResult: QueryResult;
  try {
    const rawSelectionResult =
      await (dependencies.currentSelectionLookup ?? loadCurrentSelection)(
        adminClient,
        currentMonth,
      );
    const normalizedSelectionResult = normalizedQueryResult(rawSelectionResult);
    if (!normalizedSelectionResult) {
      throw new Error("invalid current selection result");
    }
    selectionResult = normalizedSelectionResult;
  } catch {
    console.error("current spotlight selection lookup failed");
    return fixedFailure("Current spotlight winner could not be loaded.");
  }

  if (!selectionResult.error) {
    if (selectionResult.data === null) {
      return noStoreJsonResponse({
        ok: true,
        data: {
          winnerName: null,
          monthKey: currentMonth,
        },
      });
    }
    const selectedWinnerName = winnerNameForExactMonth(
      selectionResult.data,
      currentMonth,
    );
    if (!selectedWinnerName) {
      return fixedFailure("Current spotlight winner could not be loaded.");
    }
    return noStoreJsonResponse({
      ok: true,
      data: {
        winnerName: selectedWinnerName,
        monthKey: currentMonth,
      },
    });
  }

  if (!["42P01", "PGRST205"].includes(selectionResult.error.code || "")) {
    console.error("current spotlight selection lookup failed");
    return fixedFailure("Current spotlight winner could not be loaded.");
  }

  let legacyResult: QueryResult;
  try {
    const rawLegacyResult =
      await (dependencies.legacyWinnerLookup ?? loadLegacyWinner)(
        adminClient,
        currentMonth,
      );
    const normalizedLegacyResult = normalizedQueryResult(rawLegacyResult);
    if (!normalizedLegacyResult) {
      throw new Error("invalid legacy winner result");
    }
    legacyResult = normalizedLegacyResult;
  } catch {
    console.error("legacy current spotlight winner lookup failed");
    return fixedFailure("Current spotlight winner could not be loaded.");
  }

  if (legacyResult.error) {
    console.error("legacy current spotlight winner lookup failed");
    return fixedFailure("Current spotlight winner could not be loaded.");
  }

  if (legacyResult.data === null) {
    return noStoreJsonResponse({
      ok: true,
      data: {
        winnerName: null,
        monthKey: currentMonth,
      },
    });
  }

  const winnerName = winnerNameForExactMonth(legacyResult.data, currentMonth);
  if (!winnerName) {
    return fixedFailure("Current spotlight winner could not be loaded.");
  }

  return noStoreJsonResponse({
    ok: true,
    data: {
      winnerName,
      monthKey: currentMonth,
    },
  });
}

if (import.meta.main) {
  Deno.serve((req: Request) => handleCurrentSpotlightWinner(req));
}
