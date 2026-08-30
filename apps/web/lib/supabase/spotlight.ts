import "server-only";

import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config";
import type { CurrentSpotlightWinner } from "./types";
import { fetchCurrentSpotlightWinner } from "./spotlight-response";

export async function getCurrentSpotlightWinner(): Promise<CurrentSpotlightWinner | null> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  return fetchCurrentSpotlightWinner({
    endpoint: `${SUPABASE_URL}/functions/v1/get-current-spotlight-winner`,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  });
}
