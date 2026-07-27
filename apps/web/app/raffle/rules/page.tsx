import "../../styles/public-side-pages.css";
import "../../styles/public-content-shared.css";
import Link from "next/link";
import { rafflePublicModel } from "@/lib/raffle/public-view";
import { metadataFor } from "@/components/public-pages/metadata";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";

export const metadata = metadataFor("raffleRules");

export default function RaffleRulesPage() {
  const model = rafflePublicModel;
  const view = model.publicView;

  return (
    <>
      <BodyPageMarker page="raffles" />
      <main className="page-main" id="main">
        <div className="container raffle-public-layout">
          <section className="glass-card glass-card--primary glass-pad" aria-labelledby="raffleRulesHeading">
            <p className="kicker">Mochirii Monthly Raffle</p>
            <h1 className="display-title" id="raffleRulesHeading">Raffle rules</h1>
            <p className="lede">Standing program principles remain available between drawings. Each active drawing has separate official rules.</p>
            <div className="badge-row u-mt-18" role="status" aria-label="Current drawing rules status">
              <span>{model.rules.currentRulesLabel}</span>
              <span>No purchase necessary</span>
            </div>
          </section>

          <div className="grid-12 grid-gap u-mt-24 raffle-program-grid">
            <section className="col-7">
              <div className="glass-card glass-card--primary glass-pad raffle-fill-card">
                <p className="kicker">Standing program principles</p>
                <h2 className="section-title">Eligibility and fairness</h2>
                <p><strong>Eligibility:</strong> {model.eligibility}</p>
                <ul className="list-stack u-mt-18">
                  {model.standingPrinciples.map((principle) => <li key={principle}>{principle}</li>)}
                </ul>
              </div>
            </section>

            <aside className="col-5" aria-labelledby="entryLimitsHeading">
              <div className="glass-card glass-card--soft glass-pad raffle-fill-card">
                <p className="kicker">Entry limits</p>
                <h2 className="section-title section-title--sm" id="entryLimitsHeading">Five standard, up to five bonus</h2>
                <p>{model.entryModel.standardEntrySummary}</p>
                <p>{model.entryModel.bonusEntrySummary}</p>
                <p className="muted">Maximum: {view.maximumEntries} entries per person in one drawing.</p>
              </div>
            </aside>
          </div>

          <section className="glass-card glass-card--primary glass-pad u-mt-24" aria-labelledby="standingMethodsHeading">
            <p className="kicker">Standing bonus methods</p>
            <h2 className="section-title" id="standingMethodsHeading">Permanent participation choices</h2>
            <ol className="raffle-method-grid u-mt-18">
              {model.entryModel.permanentBonusMethods.map((method) => (
                <li key={method.title}>
                  <h3>{method.title}</h3>
                  <p>{method.primaryPath}</p>
                  <p className="muted">{method.equivalentFreePath}</p>
                  <p className="raffle-method-limit">Maximum one bonus entry.</p>
                </li>
              ))}
            </ol>
            <ul className="list-stack u-mt-18">
              {model.entryModel.noAdvantageRules.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </section>

          <div className="grid-12 grid-gap u-mt-24 raffle-rules-state-grid">
            <section className="col-7">
              <div className="glass-card glass-card--primary glass-pad raffle-fill-card">
                <p className="kicker">Current official drawing rules</p>
                <h2 className="section-title">{model.rules.currentRulesLabel}</h2>
                {view.rulesUrl ? (
                  <>
                    <p>The current drawing has its own immutable dates, reward, eligibility, claim period, and location-specific terms.</p>
                    <div className="hero-cta-row u-mt-18">
                      <Link className="hero-cta" href={view.rulesUrl}>Read current drawing rules</Link>
                    </div>
                  </>
                ) : (
                  <p>No raffle is active. No dates, reward, eligible locations, claim period, or location-specific terms are currently in effect.</p>
                )}
              </div>
            </section>

            <aside className="col-5" aria-labelledby="rulesArchiveHeading">
              <div className="glass-card glass-card--soft glass-pad raffle-fill-card">
                <p className="kicker">Completed drawings</p>
                <h2 className="section-title section-title--sm" id="rulesArchiveHeading">Rules archive</h2>
                {model.rules.archive.length ? (
                  <ul className="list-stack">
                    {model.rules.archive.map((entry) => (
                      <li key={entry.cycleLabel}>
                        <Link href={entry.rulesUrl}>{entry.cycleLabel}</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No archived drawing rules are available.</p>
                )}
              </div>
            </aside>
          </div>

          <section className="glass-card glass-card--soft glass-pad u-mt-24 raffle-no-purchase" aria-labelledby="rulesNoPurchaseHeading">
            <p className="kicker">Important</p>
            <h2 className="section-title section-title--sm" id="rulesNoPurchaseHeading">No purchase necessary</h2>
            <p>Do not pay to enter. Purchases, donations, referrals, early entry, and daily logins never increase entries or improve odds.</p>
            <div className="hero-cta-row u-mt-18">
              <Link className="hero-cta" href="/raffle">Back to raffle status</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
