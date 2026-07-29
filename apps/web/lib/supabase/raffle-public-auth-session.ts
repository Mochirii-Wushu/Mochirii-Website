import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { requireRafflePublicClient } from "./raffle-public-client";
import { failedResult, okResult, type AuthSessionResult } from "./types";

export async function getRafflePublicSession() {
  try {
    const client = requireRafflePublicClient();
    const { data, error } = await client.auth.getSession();
    if (error) return failedResult<AuthSessionResult>(error);
    return okResult<AuthSessionResult>({ session: data.session || null });
  } catch (error) {
    return failedResult<AuthSessionResult>(error);
  }
}

export function onRafflePublicAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  try {
    const client = requireRafflePublicClient();
    return okResult(client.auth.onAuthStateChange(callback).data);
  } catch (error) {
    return failedResult(error);
  }
}
