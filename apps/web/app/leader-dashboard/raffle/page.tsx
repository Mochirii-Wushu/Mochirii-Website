import "../../styles/public-content-shared.css";
import "../../styles/member-workflow.css";
import "../../styles/member-forms.css";
import "../../styles/member-leader-dashboard.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";
import { authLoginPath } from "@/lib/supabase/auth-redirect";
import { PRIVATE_RAFFLE_AUTH_RETURN_PATHS } from "@/lib/supabase/raffle-auth-paths";
import { getRaffleModeratorPageDecision } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mōchirīī Leader Dashboard • Monthly Raffle",
  description: "Private monthly raffle administration for authorized Mōchirīī leaders.",
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

export default async function RaffleLeaderPage() {
  const decision = await getRaffleModeratorPageDecision();
  if (decision === "redirect-auth") redirect(authLoginPath("/leader-dashboard/raffle", PRIVATE_RAFFLE_AUTH_RETURN_PATHS));
  if (decision === "not-found") notFound();

  return (
    <>
      <BodyPageMarker page="leader-dashboard" />
      <PageHero
        page="leader-dashboard"
        ariaLabel="Monthly raffle administration hero"
        image="/assets/img/raffles/hero.webp"
        imageAlt="Mōchirīī raffle banner artwork"
        kicker="Leader Dashboard"
        title="Monthly Raffle"
        center={false}
        intro={<p className="lede">Review the current drawing only when raffle administration is available.</p>}
      />
      <main className="page-main" id="main">
        <div className="container">
          <section className="glass-card glass-card--primary glass-pad auth-panel" aria-labelledby="raffleAdminTitle">
            <p className="kicker">Drawing Administration</p>
            <h2 className="section-title" id="raffleAdminTitle">No active administration</h2>
            <div className="prose-stack auth-copy">
              <p>No raffle administration is available right now.</p>
            </div>
            <div className="auth-actions">
              <Link className="hero-cta" href="/leader-dashboard" prefetch={false}>Return to Leader Dashboard</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
