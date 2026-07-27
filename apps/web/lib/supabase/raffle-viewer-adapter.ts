import type { RaffleViewerResultNames } from "../raffle/public-view";
import { verifiedClaimsSubject } from "./raffle-access-policy.ts";
import { parseRaffleViewerResultNames } from "./raffle-viewer-results.ts";

type JsonRecord = Record<string, unknown>;

type RaffleViewerClient = {
  auth: {
    getClaims(): Promise<{
      data?: { claims?: unknown } | null;
      error?: unknown;
    }>;
  };
  functions: {
    invoke(
      name: string,
      options: { body: { action: "member_results" } },
    ): Promise<{ data?: unknown; error?: unknown }>;
  };
};

export type RaffleViewerAdapterDependencies = {
  createClient: () => Promise<RaffleViewerClient | null>;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function functionPayload(value: unknown) {
  const direct = record(value);
  const nested = record(direct.data);
  return Object.keys(nested).length ? nested : direct;
}

export async function loadRaffleViewerResultNames(
  dependencies: RaffleViewerAdapterDependencies,
): Promise<RaffleViewerResultNames | undefined> {
  try {
    const client = await dependencies.createClient();
    if (!client) return undefined;
    const { data: claimsData, error: claimsError } = await client.auth
      .getClaims();
    if (claimsError || !verifiedClaimsSubject(claimsData?.claims)) {
      return undefined;
    }
    const { data, error } = await client.functions.invoke(
      "get-current-raffle",
      { body: { action: "member_results" } },
    );
    if (error) return undefined;
    return parseRaffleViewerResultNames(functionPayload(data));
  } catch {
    return undefined;
  }
}
