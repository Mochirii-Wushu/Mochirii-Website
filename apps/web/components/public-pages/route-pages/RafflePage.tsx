import Link from "next/link";
import {
  raffleEntryHeadingForView,
  rafflePublicModel,
  raffleStatusForView,
  resultLabelForViewer,
  type RafflePageModel,
  type RafflePublicEvidence,
  type RafflePublicResult,
  type RaffleViewerResultNames,
} from "@/lib/raffle/public-view";
import { RaffleDateTime } from "../RaffleDateTime";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, MetaRow, PageHero } from "../common";

type RafflePageProps = {
  model?: RafflePageModel;
  viewerResultNames?: RaffleViewerResultNames;
};

export function RafflePage({
  model = rafflePublicModel,
  viewerResultNames,
}: RafflePageProps = {}) {
  const view = model.publicView;
  const status = raffleStatusForView(view);
  const resultSection = raffleResultSectionLabels(model.results.current, model.results.previous);

  return (
    <>
      <BodyPageMarker page="raffles" />
      <PageHero
        page="raffles"
        ariaLabel="Mochirii monthly raffle"
        image={model.meta.hero.image}
        imageAlt="Mochirii raffle banner artwork"
        atmosphere={model.meta.hero.atmosphere}
        kicker={model.meta.kicker}
        title={model.meta.title}
        meta={
          <MetaRow
            label="Raffle program details"
            items={[model.meta.frequency, "Singapore time"]}
          />
        }
        intro={<p className="lede" id="rafflesIntro">{model.meta.intro}</p>}
        badges={<BadgeRow id="rafflesBadges" items={model.meta.badges} label="Current raffle notices" />}
      />

      <main className="page-main" id="main">
        <div className="container raffle-public-layout">
          <div className="grid-12 grid-gap raffle-status-grid">
            <section className="col-8" data-raffle-state={view.cycleStatus}>
              <div className="glass-card glass-card--primary glass-pad raffle-fill-card">
                <p className="kicker">Current drawing</p>
                <h2 className="section-title">{status.drawing}</h2>
                <p className="lede">{status.submissions}</p>
                <p className="muted">{status.detail}</p>
                <RaffleCycleDetails model={model} />
              </div>
            </section>

            <aside className="col-4" aria-labelledby="entryStatusHeading">
              <div className="glass-card glass-card--soft glass-pad raffle-fill-card">
                <p className="kicker">Entry status</p>
                <h2 className="section-title section-title--sm" id="entryStatusHeading">
                  {raffleEntryHeadingForView(view)}
                </h2>
                <dl className="raffle-status-list">
                  <div>
                    <dt>Standard entries</dt>
                    <dd>{status.standardEntries}</dd>
                  </div>
                  <div>
                    <dt>Bonus entries</dt>
                    <dd>{status.bonusEntries}</dd>
                  </div>
                </dl>
                <div className="hero-cta-row u-mt-18">
                  <Link className="hero-cta" href={view.rulesUrl || model.rules.standingRulesUrl}>Read raffle rules</Link>
                </div>
              </div>
            </aside>
          </div>

          <div className="grid-12 grid-gap u-mt-24 raffle-program-grid">
            <section className="col-7">
              <div className="glass-card glass-card--primary glass-pad raffle-fill-card">
                <p className="kicker">How monthly drawings work</p>
                <h2 className="section-title">One monthly opt-in, clear entry limits</h2>
                <p>{model.entryModel.standardEntrySummary}</p>
                <p>{model.entryModel.bonusEntrySummary}</p>
                <ul className="list-stack u-mt-18">
                  <li>{view.baseEntries} standard entries after one eligible monthly opt-in.</li>
                  <li>Up to {view.maximumBonusEntries} optional bonus entries.</li>
                  <li>Maximum {view.maximumEntries} entries per person in one drawing.</li>
                </ul>
              </div>
            </section>

            <aside className="col-5" aria-labelledby="noPurchaseHeading">
              <div className="glass-card glass-card--soft glass-pad raffle-fill-card raffle-no-purchase">
                <p className="kicker">Standing principle</p>
                <h2 className="section-title section-title--sm" id="noPurchaseHeading">No purchase necessary</h2>
                <p>A purchase, donation, or payment never improves eligibility, entry counts, or odds.</p>
                <p className="muted">Referrals, early entry, and daily logins also provide no entry advantage.</p>
              </div>
            </aside>
          </div>

          <section className="glass-card glass-card--primary glass-pad u-mt-24" aria-labelledby="bonusMethodsHeading">
            <p className="kicker">Permanent participation methods</p>
            <h2 className="section-title" id="bonusMethodsHeading">Optional bonus entries</h2>
            <p className="lede">Each method provides no more than one bonus entry per drawing and includes an equivalent free path.</p>
            <ol className="raffle-method-grid u-mt-18">
              {model.entryModel.permanentBonusMethods.map((method) => (
                <li key={method.title}>
                  <h3>{method.title}</h3>
                  <p>{method.primaryPath}</p>
                  <p className="muted">{method.equivalentFreePath}</p>
                </li>
              ))}
            </ol>
          </section>

          <div className="grid-12 grid-gap u-mt-24 raffle-reward-grid">
            <section className="col-7">
              <div className="glass-card glass-card--primary glass-pad raffle-fill-card">
                <p className="kicker">Possible rewards</p>
                <h2 className="section-title">Electronic gifts, in-game gifts, and community honors</h2>
                <p>{model.rewards.summary}</p>
                <p className="muted">{model.rewards.activeDrawingNotice}</p>
                <div className="raffle-reward-list u-mt-18">
                  {model.rewards.categories.map((category) => (
                    <section key={category.title}>
                      <h3>{category.title}</h3>
                      <p>{category.description}</p>
                    </section>
                  ))}
                </div>
              </div>
            </section>

            <aside className="col-5" aria-labelledby="raffleResultsHeading">
              <div className="glass-card glass-card--soft glass-pad raffle-fill-card">
                <p className="kicker">{resultSection.kicker}</p>
                <h2 className="section-title section-title--sm" id="raffleResultsHeading">{resultSection.heading}</h2>
                <RaffleResults
                  current={model.results.current}
                  previous={model.results.previous}
                  emptyMessage={model.results.emptyMessage}
                  evidence={model.results.publicEvidence}
                  entrantCount={view.entrantCount}
                  totalEntryCount={view.totalEntryCount}
                  viewerResultNames={viewerResultNames}
                />
              </div>
            </aside>
          </div>

          <section className="glass-card glass-card--primary glass-pad u-mt-24" aria-labelledby="standingRulesHeading">
            <p className="kicker">Standing rules</p>
            <h2 className="section-title" id="standingRulesHeading">Eligibility and drawing principles</h2>
            <p><strong>Eligibility:</strong> {model.eligibility}</p>
            <ul className="list-stack u-mt-18">
              {model.standingPrinciples.map((principle) => <li key={principle}>{principle}</li>)}
            </ul>
            <div className="hero-cta-row u-mt-18">
              <Link className="hero-cta" href={model.rules.standingRulesUrl}>Read standing and drawing rules</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function RaffleCycleDetails({ model }: { model: RafflePageModel }) {
  const view = model.publicView;
  const dates = [
    ["Entries open", view.opensAt],
    ["Entries close", view.closesAt],
    ["Drawing", view.drawAt],
    ["Claim deadline", view.claimEndsAt],
  ] as const;

  if (!view.publicReward && dates.every(([, instant]) => instant === null)) return null;

  return (
    <div className="raffle-cycle-details u-mt-18">
      {view.publicReward ? <p><strong>Current reward:</strong> {view.publicReward}</p> : null}
      {dates.some(([, instant]) => instant !== null) ? (
        <dl className="raffle-date-list">
          {dates.map(([label, instant]) => instant ? (
            <RaffleDateTime instant={instant} key={label} label={label} />
          ) : null)}
        </dl>
      ) : null}
    </div>
  );
}

function RaffleResults({
  current,
  previous,
  emptyMessage,
  evidence,
  entrantCount,
  totalEntryCount,
  viewerResultNames,
}: {
  current: RafflePublicResult[] | null;
  previous: RafflePublicResult[];
  emptyMessage: string;
  evidence: RafflePublicEvidence | null;
  entrantCount: number | null;
  totalEntryCount: number | null;
  viewerResultNames?: RaffleViewerResultNames;
}) {
  const currentResults = current ?? [];

  if (!currentResults.length && !previous.length) return <p className="muted">{emptyMessage}</p>;

  const showGroupHeadings = currentResults.length > 0 && previous.length > 0;

  return (
    <>
      {currentResults.length ? (
        <RaffleResultList
          heading={showGroupHeadings ? "Current drawing" : null}
          headingId="raffleCurrentResultsHeading"
          results={currentResults}
          viewerResultNames={viewerResultNames}
        />
      ) : null}
      {previous.length ? (
        <RaffleResultList
          heading={showGroupHeadings ? "Previous drawings" : null}
          headingId="rafflePreviousResultsHeading"
          results={previous}
          viewerResultNames={viewerResultNames}
        />
      ) : null}
      {evidence ? (
        <div className="raffle-public-evidence">
          <h3>Public drawing evidence</h3>
          <dl>
            <RaffleDateTime instant={evidence.drawingAt} label="Drawing completed" />
            <div><dt>Eligible entrants</dt><dd>{entrantCount}</dd></div>
            <div><dt>Valid entries</dt><dd>{totalEntryCount}</dd></div>
            <div><dt>Method version</dt><dd>{evidence.methodVersion}</dd></div>
            <div><dt>Ledger commitment</dt><dd><code>{evidence.ledgerCommitment}</code></dd></div>
            <div><dt>Result commitment</dt><dd><code>{evidence.resultCommitment}</code></dd></div>
          </dl>
        </div>
      ) : null}
    </>
  );
}

function RaffleResultList({
  heading,
  headingId,
  results,
  viewerResultNames,
}: {
  heading: string | null;
  headingId: string;
  results: RafflePublicResult[];
  viewerResultNames?: RaffleViewerResultNames;
}) {
  const list = (
    <ul className="raffle-result-list">
      {results.map((result) => (
        <li key={result.resultKey}>
          <span>{result.cycleLabel}</span>
          <strong>{resultLabelForViewer(result, viewerResultNames)}</strong>
          <span>{result.rewardLabel}</span>
        </li>
      ))}
    </ul>
  );

  if (!heading) return list;

  return (
    <section className="raffle-result-group" aria-labelledby={headingId}>
      <h3 id={headingId}>{heading}</h3>
      {list}
    </section>
  );
}

function raffleResultSectionLabels(
  current: RafflePublicResult[] | null,
  previous: RafflePublicResult[],
) {
  const hasCurrent = Boolean(current?.length);
  const hasPrevious = previous.length > 0;

  if (hasCurrent && hasPrevious) {
    return { kicker: "Drawing history", heading: "Current and previous results" };
  }
  if (hasPrevious) {
    return { kicker: "Previous results", heading: "Previous drawing results" };
  }
  return { kicker: "Current result", heading: "Drawing results" };
}
