import {
  getRafflePublicSession,
  onRafflePublicAuthStateChange,
} from "@/lib/supabase/raffle-public-auth-session";

export async function readRaffleWinnerAccessToken() {
  const result = await getRafflePublicSession();
  return result.ok ? result.data?.session?.access_token ?? null : null;
}

export function subscribeToRaffleWinnerAuth(
  refresh: (event: string, accessToken: string | null) => void,
) {
  const result = onRafflePublicAuthStateChange((event, session) => {
    refresh(event, session?.access_token ?? null);
  });
  return () => result.data?.subscription?.unsubscribe();
}
