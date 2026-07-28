import "server-only";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import {
  parseRaffleLeaderboardApi,
  raffleLeaderboardApiIsEmpty,
  type RaffleLeaderboardRead,
} from "./leaderboard-core";

const MAX_RESPONSE_BYTES = 64 * 1024;

export async function readRaffleLeaderboard(
  accessToken: string,
): Promise<RaffleLeaderboardRead> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !accessToken) {
    return { ok: false, data: null };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/get-current-raffle`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "member_leaderboard" }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (!response.ok) return { ok: false, data: null };
    const raw = await response.text();
    if (
      !raw ||
      new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES
    ) return { ok: false, data: null };
    const payload = JSON.parse(raw) as unknown;
    const leaderboard = parseRaffleLeaderboardApi(payload);
    if (leaderboard) return { ok: true, data: leaderboard };
    if (raffleLeaderboardApiIsEmpty(payload)) return { ok: true, data: null };
    return { ok: false, data: null };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timeout);
  }
}
