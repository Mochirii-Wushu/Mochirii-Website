import "../styles/public-side-pages.css";
import "../styles/public-content-shared.css";
import { metadataFor } from "@/components/public-pages/metadata";
import { RafflePage } from "@/components/public-pages/pages";
import { getRaffleViewerResultNames } from "@/lib/supabase/server-auth";

export const metadata = metadataFor("raffle");
export const dynamic = "force-dynamic";

export default async function MonthlyRafflePage() {
  const viewerResultNames = await getRaffleViewerResultNames();
  return <RafflePage viewerResultNames={viewerResultNames} />;
}
