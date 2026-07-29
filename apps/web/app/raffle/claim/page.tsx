import "../../styles/public-content-shared.css";
import "../../styles/member-workflow.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";
import { authLoginPath } from "@/lib/supabase/auth-redirect";
import { getRaffleClaimPageDecision } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mōchirīī Raffle Reward",
  description: "Private reward claim page for an eligible Mōchirīī raffle winner.",
  alternates: { canonical: null },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
  openGraph: null,
  twitter: null,
};

export default async function RaffleClaimPage() {
  const decision = await getRaffleClaimPageDecision();
  if (decision === "redirect-auth") redirect(authLoginPath("/raffle/claim"));
  if (decision === "not-found") notFound();

  return (
    <>
      <BodyPageMarker page="raffle" />
      <PageHero
        page="raffle"
        ariaLabel="Raffle reward hero"
        image="/assets/img/raffles/hero.webp"
        imageAlt="Mōchirīī raffle banner artwork"
        kicker="Monthly Raffle"
        title="Reward Claim"
        center={false}
        intro={<p className="lede">Eligible winners retrieve their reward from this private page.</p>}
      />
      <main className="page-main" id="main">
        <div className="container">
          <section className="glass-card glass-card--primary glass-pad auth-panel" aria-labelledby="raffleClaimTitle">
            <p className="kicker">Claim Status</p>
            <h2 className="section-title" id="raffleClaimTitle">No reward available</h2>
            <div className="prose-stack auth-copy">
              <p>No raffle reward is available to claim for this account.</p>
            </div>
            <div className="auth-actions u-mt-18">
              <Link className="hero-cta" href="/raffle" prefetch={false}>Return to Monthly Raffle</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
