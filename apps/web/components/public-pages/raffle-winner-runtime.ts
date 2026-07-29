import { getCurrentSession, onAuthStateChange } from "@/lib/supabase/auth-session";

export async function readRaffleWinnerAccessToken() {
  const result = await getCurrentSession();
  return result.ok ? result.data?.session?.access_token ?? null : null;
}

export function subscribeToRaffleWinnerAuth(
  refresh: (event: string, accessToken: string | null) => void,
) {
  const result = onAuthStateChange((event, session) => {
    refresh(event, session?.access_token ?? null);
  });
  return () => result.data?.subscription?.unsubscribe();
}
