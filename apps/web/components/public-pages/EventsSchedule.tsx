"use client";

import { type GuildScheduleData, currentOrUpcomingEvent } from "@/lib/guild-schedule";
import { useGuildSchedule } from "@/lib/events/use-guild-schedule";
import { DISCORD_INVITE_URL } from "@/lib/public-urls";
import { EventsBoard } from "./EventsBoard";
import { formatDateUTC, publicPath, StaticImage, text } from "./common";
import { type DataRecord, linkProps, strings } from "./page-helpers";

export function EventsSchedule({ referenceTime, featured, scheduleData }: {
  referenceTime: string;
  featured: DataRecord;
  scheduleData: GuildScheduleData;
}) {
  const schedule = useGuildSchedule(scheduleData, referenceTime);
  const featuredEvent = currentOrUpcomingEvent(schedule.items, new Date(schedule.referenceTime));
  const featuredHref = text(featuredEvent ? featuredEvent.href || DISCORD_INVITE_URL : featured.href, DISCORD_INVITE_URL);
  const featuredLinkLabel = featuredEvent && featuredHref !== DISCORD_INVITE_URL
    ? "Open details"
    : text(featured.linkLabel, "RSVP & details in Discord");
  const featuredMeta = [
    featured.tag,
    formatDateUTC(featuredEvent?.date || featured.date),
    featuredEvent?.dayText,
    featuredEvent?.timeText || featured.time,
    featuredEvent?.timezone || "UTC+8",
  ];
  const featuredImage = text(featuredEvent?.image || featured.image);
  const featuredTitle = text(featuredEvent?.title || featured.title);
  const featuredSummary = text(featuredEvent?.summary || featured.summary);

  return (
    <div className="grid-12 grid-gap">
      <section className="col-8">
        <div className="glass-card glass-card--primary glass-pad">
          <h2 className="section-title">Featured Event</h2>
          <div className="prose-stack">
            <p className="muted" id="featuredLead">{text(featured.lead)}</p>
          </div>
          <div id="featuredCard" className="events-featured" aria-live="polite">
            <div className="glass-card glass-card--soft glass-pad">
              <p className="kicker">
                {featuredMeta.map((value) => text(value)).filter(Boolean).join(" • ")}
              </p>
              {featuredImage ? (
                <div className="u-mt-12">
                  <StaticImage
                    src={publicPath(featuredImage, "./assets/img/events/featured.webp")}
                    alt={text(featuredTitle, "Featured event")}
                    width={1600}
                    height={640}
                    className="events-featured__img"
                    sizes="(max-width: 980px) calc(100vw - 36px - clamp(80px, 12vw, 120px)), calc((min(100vw, 1200px) - 32px) * 2 / 3 - clamp(22px, 3vw, 34px) / 3 - 4px - clamp(80px, 12vw, 120px))"
                  />
                </div>
              ) : null}
              <h3 className="section-title section-title--sm u-mt-14">{featuredTitle}</h3>
              <p className="lede">{featuredSummary}</p>
              {strings(featured.bullets).length ? (
                <ul className="list-stack">
                  {strings(featured.bullets).map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              ) : null}
              {featuredHref ? (
                <div className="badge-row u-mt-14">
                  <span><a {...linkProps(featuredHref)}>{featuredLinkLabel}</a></span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <aside className="col-4" aria-labelledby="eventsBoardTitle">
        <div className="glass-card glass-card--soft glass-pad events-board-card">
          <h2 className="section-title section-title--sm" id="eventsBoardTitle">Event Board</h2>
          <EventsBoard items={schedule.items} referenceTime={schedule.referenceTime} />
        </div>
      </aside>
      <div className="col-divider" aria-hidden="true" />
    </div>
  );
}
