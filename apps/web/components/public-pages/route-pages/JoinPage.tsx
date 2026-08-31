import joinData from "@/public/data/join.json";
import { BodyPageMarker } from "../BodyPageMarker";
import { DiscordServerPreview } from "../DiscordServerPreview";
import { BadgeRow, cleanRoute, formatDateUTC, MetaRow, PageHero, ProseStack, text } from "../common";
import { badgeItems, linkProps, record, records } from "../page-helpers";

export function JoinPage() {
  const data = record(joinData);
  const hero = record(data.hero);
  const steps = record(data.steps);
  const quickStart = record(data.quickStart);
  const checklist = record(data.checklist);
  const culture = record(data.culture);
  const notes = record(data.notes);

  return (
    <>
      <BodyPageMarker page="join" />
      <PageHero
        page="join"
        ariaLabel="Join hero"
        image={text(hero.image, "./assets/img/join/hero.webp")}
        imageAlt={text(hero.imageAlt, "Join Mōchirīī banner artwork")}
        atmosphere={text(hero.atmosphereImage)}
        kicker={text(hero.kicker, "Join")}
        title={text(hero.title, "Join Mōchirīī")}
        center={false}
        meta={
          <MetaRow
            label="Join metadata"
            items={[hero.updated ? `Updated ${formatDateUTC(hero.updated)}` : "", hero.timezone]}
          />
        }
        intro={
          <p className="lede" id="joinIntro">
            {text(hero.intro)}
          </p>
        }
        badges={<BadgeRow id="joinBadges" items={badgeItems(hero.badges)} label="Join notes" />}
      />

      <main className="page-main" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title" id="joinStepsTitle">
                  {text(steps.title, "The Joining Path")}
                </h2>
                <ProseStack id="joinStepsIntro" lines={steps.intro} />
                <ol id="joinStepsList" className="list-stack" aria-label="Joining steps">
                  {records(steps.items).map((step, index) => (
                    <li key={`${text(step.number, String(index + 1))}-${text(step.title, "Step")}`}>
                      <strong>
                        {text(step.number, String(index + 1))}. {text(step.title, "Step")}
                      </strong>
                      {text(step.description) ? <p className="muted">{text(step.description)}</p> : null}
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <aside className="col-4">
              <div className="glass-card glass-card--soft glass-pad">
                <h3 className="section-title section-title--sm" id="joinQuickTitle">
                  {text(quickStart.title, "Quick Start")}
                </h3>
                <ProseStack id="joinQuickBody" lines={quickStart.body} />
                <BadgeRow id="joinLinks" items={badgeItems(quickStart.links)} label="Join links" />
                <DiscordServerPreview />
              </div>
            </aside>

            <section className="col-12 join-checklist" aria-labelledby="joinChecklistTitle">
              <div className="glass-card glass-card--soft glass-pad">
                <p className="kicker" id="joinChecklistEyebrow">
                  {text(checklist.eyebrow, "Before You Join")}
                </p>
                <h2 className="section-title" id="joinChecklistTitle">
                  {text(checklist.title, "New Cupcake Checklist")}
                </h2>
                <p className="muted join-checklist__intro" id="joinChecklistIntro">
                  {text(checklist.intro)}
                </p>
                <ul className="join-checklist__grid" id="joinChecklistItems">
                  {records(checklist.items).map((item, index) => {
                    const href = cleanRoute(item.href, "");
                    return (
                      <li className="join-checklist__item" key={`${index}-${text(item.title, "Checklist item")}`}>
                        <span className="join-checklist__marker" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="join-checklist__body">
                          <h3 className="join-checklist__title">{text(item.title, "Checklist item")}</h3>
                          {text(item.text) ? <p className="join-checklist__text">{text(item.text)}</p> : null}
                          {href && text(item.label) ? (
                            <a className="join-checklist__link" {...linkProps(href)}>
                              {text(item.label)}
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            <div className="col-divider" aria-hidden="true" />
          </div>

          <div className="grid-12 grid-gap u-mt-24">
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title" id="joinCultureTitle">
                  {text(culture.title, "Expectations & Culture")}
                </h2>
                <ProseStack id="joinCultureIntro" lines={culture.intro} />
                <div id="joinCultureCards" className="prose-stack" aria-live="polite">
                  {records(culture.cards).map((item) => (
                    <div key={text(item.title, "Note")}>
                      <h3 className="section-title section-title--sm">{text(item.title, "Note")}</h3>
                      <p className="muted">{text(item.description)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <aside className="col-4">
              <div className="glass-card glass-card--soft glass-pad">
                <h3 className="section-title section-title--sm" id="joinFaqTitle">
                  {text(notes.title, "Notes")}
                </h3>
                <ProseStack id="joinNotes" lines={notes.body} />
                <BadgeRow id="joinNotesBadges" items={badgeItems(notes.links)} label="Helpful links" />
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
