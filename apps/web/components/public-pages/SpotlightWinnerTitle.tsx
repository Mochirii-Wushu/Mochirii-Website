import { getCurrentSpotlightWinner } from "@/lib/supabase/spotlight";
import type { CurrentSpotlightWinner } from "@/lib/supabase/types";
import { spotlightWinnerTitle } from "./spotlight-content";

export async function SpotlightWinnerTitle({
  fallbackTitle,
  template,
  winner,
}: {
  fallbackTitle: string;
  template: "home" | "spotlight";
  winner?: CurrentSpotlightWinner | null;
}) {
  const resolvedWinner = winner === undefined ? await getCurrentSpotlightWinner() : winner;
  const title = spotlightWinnerTitle(template, fallbackTitle, resolvedWinner);

  return <>{title}</>;
}
