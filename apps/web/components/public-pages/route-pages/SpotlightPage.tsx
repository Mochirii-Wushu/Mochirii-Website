import spotlightData from "@/public/data/spotlight.json";
import guildScheduleData from "@/public/data/guild-schedule.json";
import { spotlightScheduleDate } from "@/lib/guild-schedule";
import { getCurrentSpotlightWinner } from "@/lib/supabase/spotlight";
import { BodyPageMarker } from "../BodyPageMarker";
import { spotlightAppreciationLines, spotlightMonthKey } from "../spotlight-content";
import { SpotlightWinnerTitle } from "../SpotlightWinnerTitle";
import { BadgeRow, formatDateUTC, MetaRow, PageHero, ProseStack, text } from "../common";
import { record, strings } from "../page-helpers";

export async function SpotlightPage() {
  const data = record(spotlightData);
  const hero = record(data.hero);
  const spotlight = record(data.spotlight);
  const winner = await getCurrentSpotlightWinner();
  const winnerMonth = spotlightMonthKey(winner, "");
  const spotlightDate = winnerMonth || spotlightScheduleDate(guildScheduleData, spotlight.date);
  const appreciation = spotlightAppreciationLines(spotlight.body, winner);

  return (
    <>
      <BodyPageMarker page="spotlight" />
      <PageHero
        page="spotlight"
        ariaLabel="Spotlight hero"
        image={text(hero.image, "./assets/img/spotlight/hero.webp")}
        imageAlt={text(hero.alt, "Member Spotlight banner artwork")}
        atmosphere={text(hero.atmosphereImage)}
        kicker={text(spotlight.kicker, "Member Spotlight")}
        title={
          <SpotlightWinnerTitle
            fallbackTitle={text(spotlight.title, "This Month's Spotlight")}
            template="spotlight"
            winner={winner}
          />
        }
        meta={<MetaRow items={[spotlightDate ? formatDateUTC(spotlightDate, { year: "numeric", month: "long", day: "2-digit" }) : "", spotlight.tag]} />}
        intro={
          <p id="spotlightIntro" className="lede">
            {text(spotlight.intro)}
          </p>
        }
        badges={<BadgeRow id="spotlightBadges" items={strings(spotlight.badges, 10)} />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title">Appreciation</h2>
                <ProseStack id="spotlightBody" lines={appreciation} fallback="This month's member will be announced soon." />
                <ProseStack id="spotlightConclusion" lines={spotlight.conclusion} fallback="" />
              </div>
            </section>
            <aside className="col-4">
              <div className="glass-card glass-card--soft glass-pad">
                <h3 className="section-title section-title--sm">Highlights</h3>
                <ul id="spotlightHighlights" className="list-stack">
                  {strings(spotlight.highlights, 10).map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              </div>
            </aside>
            <div className="col-divider" aria-hidden="true" />
          </div>
        </div>
      </main>
    </>
  );
}
