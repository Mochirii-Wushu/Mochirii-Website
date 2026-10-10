import announcementsData from "@/public/data/announcements.json";
import guildScheduleData from "@/public/data/guild-schedule.json";
import { announcementScheduleLines } from "@/lib/announcements/schedule";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, formatDateUTC, MetaRow, PageHero, text } from "../common";
import { type DataRecord, record, records, strings } from "../page-helpers";

const scheduleDetails = announcementScheduleLines(guildScheduleData);

function announcementDetails(item: DataRecord) {
  return text(item.id) === "weekly-schedule" && scheduleDetails.length ? scheduleDetails : strings(item.details);
}

export function AnnouncementsPage() {
  const data = record(announcementsData);
  const meta = record(data.meta);
  const items = records(data.items).sort((a, b) => {
    const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    return pinned || text(b.date).localeCompare(text(a.date));
  });

  return (
    <>
      <BodyPageMarker page="announcements" />
      <PageHero
        page="announcements"
        ariaLabel="Announcements hero"
        image={text(record(meta.hero).image, "./assets/img/announcements/hero.webp")}
        imageAlt="Announcements banner artwork"
        atmosphere={text(record(meta.hero).atmosphere)}
        kicker="Announcements"
        title={text(meta.title, "Mōchirīī Announcements")}
        meta={<MetaRow label="Announcements metadata" items={[meta.updated ? `Updated ${formatDateUTC(meta.updated)}` : "", meta.tagline]} />}
        intro={
          <p className="lede" id="announcementsIntro">
            {text(meta.intro)}
          </p>
        }
        badges={<BadgeRow id="announcementsBadges" items={strings(meta.badges)} label="Announcements badges" />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <section className="glass-card glass-card--primary glass-pad">
            <h2 className="section-title">Latest Notices</h2>
            <div id="announcementsList" className="prose-stack" aria-live="polite">
              {items.length ? (
                items.map((item) => (
                  <section className="glass-card glass-card--soft glass-pad" data-announcement={text(item.id)} key={text(item.id, text(item.title))}>
                    <p className="kicker">
                      {item.pinned ? "Pinned" : "Notice"}
                      {text(item.date) ? ` • ${formatDateUTC(item.date)}` : ""}
                    </p>
                    <h3 className="section-title section-title--sm">{text(item.title, "Announcement")}</h3>
                    {text(item.summary) ? <p className="lede">{text(item.summary)}</p> : null}
                    {announcementDetails(item).length ? (
                      <ul className="list-stack">
                        {announcementDetails(item).map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    ) : null}
                    <BadgeRow items={strings(item.tags)} label="Tags" />
                  </section>
                ))
              ) : (
                <p className="muted">No announcements yet.</p>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
