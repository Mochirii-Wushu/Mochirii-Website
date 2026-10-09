import Link from "next/link";
import eventsData from "@/public/data/events.json";
import { DISCORD_INVITE_URL } from "@/lib/public-urls";
import { publicGuildSchedule } from "@/lib/events/public-schedule";
import { BodyPageMarker } from "../BodyPageMarker";
import { EventsSchedule } from "../EventsSchedule";
import { BadgeRow, formatDateUTC, MetaRow, PageHero, text } from "../common";
import { record, records, strings } from "../page-helpers";

type EventsPageProps = {
  referenceTime: string;
};

export function EventsPage(props: EventsPageProps) {
  const { referenceTime } = props;
  const data = record(eventsData);
  const meta = record(data.meta);
  const featured = record(data.featured);
  const recurring = record(data.recurring);

  return (
    <div className="events-page">
      <BodyPageMarker page="events" />
      <PageHero
        page="events"
        ariaLabel="Events hero"
        image={text(record(meta.hero).image, "./assets/img/events/hero.webp")}
        imageAlt="Events banner artwork"
        atmosphere={text(record(meta.hero).atmosphere)}
        kicker={text(meta.kicker, "Guild calendar")}
        title={text(meta.title, "Events")}
        meta={<MetaRow label="Events metadata" items={[meta.updated ? `Updated ${formatDateUTC(meta.updated)}` : "", meta.timezoneLabel]} />}
        intro={
          <p className="lede" id="eventsIntro">
            {text(meta.intro)}
          </p>
        }
        badges={<BadgeRow id="eventsBadges" items={strings(meta.badges)} label="Event notes" />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <EventsSchedule referenceTime={referenceTime} featured={featured} scheduleData={publicGuildSchedule} />

          <div className="grid-12 grid-gap u-mt-24">
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title">Recurring Events</h2>
                <p className="muted" id="eventsRhythmIntro">
                  {text(recurring.intro)}
                </p>
                <div id="eventsRecurring" className="events-recurring">
                  {records(recurring.items).length ? (
                    <ul className="list-stack">
                      {records(recurring.items).map((item) => (
                        <li key={text(item.title)}>
                          <strong>{text(item.title)}</strong> — {text(item.summary)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No recurring events posted yet.</p>
                  )}
                </div>
              </div>
            </section>
            <aside className="col-4" aria-labelledby="eventsParticipationTitle">
              <div className="glass-card glass-card--soft glass-pad">
                <h2 className="section-title section-title--sm" id="eventsParticipationTitle">Participation</h2>
                <div id="eventsParticipation" className="prose-stack">
                  {records(data.participation).map((block) => (
                    <div key={text(block.title)}>
                      <p>
                        <strong>{text(block.title)}</strong>
                      </p>
                      <p className="muted">{text(block.body)}</p>
                    </div>
                  ))}
                </div>
                <div className="badge-row u-mt-14">
                  <span>
                    <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
                      Discord RSVP
                    </a>
                  </span>
                  <span>
                    <Link href="/join">How to join</Link>
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
