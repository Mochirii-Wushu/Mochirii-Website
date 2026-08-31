import Link from "next/link";
import eventsData from "@/public/data/events.json";
import guildScheduleData from "@/public/data/guild-schedule.json";
import { DISCORD_INVITE_URL } from "@/lib/public-urls";
import { scheduleTimezoneLabel, websiteEventCardsFromSchedule } from "@/lib/guild-schedule";
import { BodyPageMarker } from "../BodyPageMarker";
import { EventsBoard } from "../EventsBoard";
import { BadgeRow, formatDateUTC, MetaRow, PageHero, publicPath, StaticImage, text } from "../common";
import { linkProps, record, records, strings } from "../page-helpers";

type EventsPageProps = {
  referenceTime: string;
};

export function EventsPage(props: EventsPageProps) {
  const { referenceTime } = props;
  const data = record(eventsData);
  const meta = record(data.meta);
  const featured = record(data.featured);
  const recurring = record(data.recurring);
  const eventBoardItems = websiteEventCardsFromSchedule(guildScheduleData, new Date(referenceTime));
  const featuredEvent = eventBoardItems[0];
  const featuredHref = text(featuredEvent?.href || featured.href);
  const featuredMeta = [
    featured.tag,
    formatDateUTC(featuredEvent?.date || featured.date),
    featuredEvent?.dayText,
    featuredEvent?.timeText || featured.time,
    featuredEvent?.timezone || featured.timezone || scheduleTimezoneLabel(guildScheduleData),
  ];
  const featuredImage = text(featuredEvent?.image || featured.image);
  const featuredTitle = text(featuredEvent?.title || featured.title);
  const featuredSummary = text(featuredEvent?.summary || featured.summary);

  return (
    <>
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
          <div className="grid-12 grid-gap">
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title">Featured Event</h2>
                <div className="prose-stack">
                  <p className="muted" id="featuredLead">
                    {text(featured.lead)}
                  </p>
                </div>
                <div id="featuredCard" className="events-featured" aria-live="polite">
                  <div className="glass-card glass-card--soft glass-pad">
                    <p className="kicker">
                      {featuredMeta
                        .map((value) => text(value))
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                    {featuredImage ? (
                      <div className="u-mt-12">
                        <StaticImage
                          src={publicPath(featuredImage, "./assets/img/events/featured.webp")}
                          alt={text(featuredTitle, "Featured event")}
                          width={1600}
                          height={640}
                          className="events-featured__img"
                          sizes="(max-width: 980px) calc(100vw - 68px), 760px"
                        />
                      </div>
                    ) : null}
                    <h3 className="section-title section-title--sm u-mt-14">
                      {featuredTitle}
                    </h3>
                    <p className="lede">{featuredSummary}</p>
                    {strings(featured.bullets).length ? (
                      <ul className="list-stack">
                        {strings(featured.bullets).map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}
                    {featuredHref ? (
                      <div className="badge-row u-mt-14">
                        <span>
                          <a {...linkProps(featuredHref)}>{text(featured.linkLabel, "Open details")}</a>
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <aside className="col-4">
              <div className="glass-card glass-card--soft glass-pad events-board-card">
                <h3 className="section-title section-title--sm" id="eventsBoardTitle">
                  Event Board
                </h3>
                <EventsBoard
                  items={eventBoardItems}
                  referenceTime={referenceTime}
                />
              </div>
            </aside>
            <div className="col-divider" aria-hidden="true" />
          </div>

          <div className="grid-12 grid-gap u-mt-24">
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title">Recurring Events</h2>
                <p className="muted" id="eventsRhythmIntro">
                  {text(recurring.intro)}
                </p>
                <div id="eventsRecurring" className="events-recurring" aria-live="polite">
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
            <aside className="col-4">
              <div className="glass-card glass-card--soft glass-pad">
                <h3 className="section-title section-title--sm">Participation</h3>
                <div id="eventsParticipation" className="prose-stack" aria-live="polite">
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
    </>
  );
}
