import Link from "next/link";
import ranksData from "@/public/data/ranks.json";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, ImagePanel, PageHero, ProseStack, text } from "../common";
import { RankCards, record, strings } from "../page-helpers";

export function RanksPage() {
  const data = record(ranksData);
  const hero = record(data.hero);
  const progression = record(data.progression);
  const tiers = record(data.tiers);
  const senior = record(tiers.senior);
  const middle = record(tiers.middle);
  const members = record(tiers.members);

  return (
    <>
      <BodyPageMarker page="ranks" />
      <PageHero
        page="ranks"
        ariaLabel="Ranks hero"
        image={text(hero.image, "./assets/img/ranks/hero.webp")}
        imageAlt="Ranks and progression banner artwork"
        atmosphere={text(hero.atmosphereImage)}
        kicker={text(hero.kicker, "Ranks")}
        title={text(hero.title, "Ranks & Progression")}
        intro={
          <p className="lede" id="ranksIntro">
            {text(hero.intro)}
          </p>
        }
        badges={<BadgeRow id="ranksHeroPills" items={strings(hero.pills, 10)} label="Rank notes" />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <section>
            <div className="glass-card glass-card--primary glass-pad">
              <h2 className="section-title" id="progressionTitle">
                {text(progression.title, "Progression")}
              </h2>
              <BadgeRow id="progressionPills" items={strings(progression.pills, 10)} label="Progression categories" />
              <ProseStack id="progressionBody" lines={progression.body} className="prose-stack" />
            </div>
          </section>

          {[
            { id: "senior", data: senior, asideTitle: "Direction & Stewardship", label: "Senior Leadership artwork" },
            { id: "middle", data: middle, asideTitle: "Guardianship & Mentorship", label: "Middle Leadership artwork" },
            { id: "members", data: members, asideTitle: "Growth & Fellowship", label: "Members artwork" },
          ].map((tier) => (
            <div className="grid-12 grid-gap u-mt-24" key={tier.id}>
              <section className="col-8">
                <div className="glass-card glass-card--primary glass-pad">
                  <h2 className="section-title" id={`${tier.id}Title`}>
                    {text(tier.data.title)}
                  </h2>
                  <p className="muted" id={`${tier.id}Desc`}>
                    {text(tier.data.description)}
                  </p>
                  {tier.id !== "senior" ? (
                    <BadgeRow id={`${tier.id}Pills`} items={strings(tier.data.pills, 10)} label={`${text(tier.data.title)} categories`} />
                  ) : null}
                  <div id={`${tier.id}Ranks`} className="prose-stack u-mt-14">
                    <RankCards ranks={tier.data.ranks} />
                  </div>
                  <p className="muted u-mt-14" id={`${tier.id}Note`}>
                    {text(tier.data.note)}
                  </p>
                  {tier.id === "members" ? (
                    <div className="u-mt-18">
                      <Link href="/leaders" className="footer-link">
                        Meet the Leaders
                      </Link>
                    </div>
                  ) : null}
                </div>
              </section>
              <aside className="col-4">
                <ImagePanel id={`${tier.id}Image`} src={text(tier.data.image)} alt={tier.label} title={tier.asideTitle} />
              </aside>
              <div className="col-divider" aria-hidden="true" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
