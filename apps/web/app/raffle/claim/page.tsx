import "../../styles/public-content-shared.css";
import "../../styles/member-workflow.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";
import { authLoginPath } from "@/lib/supabase/auth-redirect";
import { getRaffleClaimPageState } from "@/lib/supabase/server-auth";
import {
  claimElectronicReward,
  claimInGameReward,
  declineRaffleReward,
} from "./actions";

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
  const { decision, status } = await getRaffleClaimPageState();
  if (decision === "redirect-auth") redirect(authLoginPath("/raffle/claim"));
  if (decision === "not-found") notFound();

  const claimable = decision === "claim" && status?.selectedClaimId
    ? { ...status, selectedClaimId: status.selectedClaimId }
    : null;
  const completed = status?.claimState === "claimed";
  const heading = claimable
    ? "Choose your reward"
    : completed
    ? "Reward choice received"
    : "No reward available";
  const detail = claimable
    ? "Select one available reward path. Your choice is recorded only after you submit it."
    : completed
    ? "Your selection is recorded. Return here for the current delivery status."
    : "No raffle reward is available to claim for this account.";

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
            <h2 className="section-title" id="raffleClaimTitle">{heading}</h2>
            <div className="prose-stack auth-copy">
              <p>{detail}</p>
              {claimable?.claimDeadline ? (
                <p>
                  <strong>Claim by:</strong>{" "}
                  <time dateTime={claimable.claimDeadline}>
                    {new Intl.DateTimeFormat("en-SG", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "Asia/Singapore",
                      timeZoneName: "short",
                    }).format(new Date(claimable.claimDeadline))}
                  </time>
                </p>
              ) : null}
            </div>
            {claimable ? (
              <div className="auth-actions" aria-label="Reward choices">
                <form action={claimElectronicReward}>
                  <input type="hidden" name="claim_id" value={claimable.selectedClaimId} />
                  <button className="hero-cta hero-cta--primary" type="submit">Choose electronic reward</button>
                </form>
                {claimable.inGameRewardAvailable ? (
                  <form action={claimInGameReward}>
                    <input type="hidden" name="claim_id" value={claimable.selectedClaimId} />
                    <button className="hero-cta" type="submit">Choose in-game gift</button>
                  </form>
                ) : null}
                <form action={declineRaffleReward}>
                  <input type="hidden" name="claim_id" value={claimable.selectedClaimId} />
                  <button className="hero-cta" type="submit">Decline this reward</button>
                </form>
              </div>
            ) : null}
            <div className="auth-actions u-mt-18">
              <Link className="hero-cta" href="/raffle">Return to Monthly Raffle</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
