import "../../styles/public-side-pages.css";
import "../../styles/public-content-shared.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RafflePage } from "@/components/public-pages/route-pages/RafflePage";
import { getRaffleRenderFixture } from "@/lib/raffle/public-render-fixtures";

type RaffleFixturePageProps = {
  params: Promise<{ scenario: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Raffle rendering fixture",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export default async function RaffleFixturePage({ params }: RaffleFixturePageProps) {
  if (process.env.VERCEL === "1" || process.env.RAFFLE_PUBLIC_RENDER_FIXTURES !== "1") notFound();
  const { scenario } = await params;
  const fixture = getRaffleRenderFixture(scenario);
  if (!fixture) notFound();

  return (
    <RafflePage
      model={fixture.model}
      viewerResultNames={fixture.viewerResultNames}
      featuredWinner={fixture.featuredWinner}
      enableWinnerRefresh={false}
      leaderboardFixture={fixture.leaderboard ?? null}
    />
  );
}
