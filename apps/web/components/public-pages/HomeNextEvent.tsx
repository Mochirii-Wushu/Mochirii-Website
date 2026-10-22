"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { type GuildScheduleData, currentOrUpcomingEvent } from "@/lib/guild-schedule";
import { useGuildSchedule } from "@/lib/events/use-guild-schedule";
import { formatPublicDate } from "@/lib/public-date";

export function HomeNextEvent({
  referenceTime,
  scheduleData,
  imageSizes,
  children,
  emptyState,
}: {
  referenceTime: string;
  scheduleData: GuildScheduleData;
  imageSizes: string;
  children: ReactNode;
  emptyState: ReactNode;
}) {
  const schedule = useGuildSchedule(scheduleData, referenceTime);
  const event = currentOrUpcomingEvent(schedule.items, new Date(schedule.referenceTime));
  if (!event) return emptyState;
  const current = Date.parse(event.startIso) <= Date.parse(schedule.referenceTime);
  // The public schedule requires its generated date, clock range and timezone.
  const eventMeta = [formatPublicDate(new Date(event.date)), event.timeText, event.timezone].join(" • ");

  return (
    <>
      {event.image ? (
        <div className="home-featured__media">
          <Image
            id="featuredBulletinImage"
            className="home-featured__img"
            src={event.image.replace(/^\.\//, "/")}
            alt=""
            width={1600}
            height={640}
            loading="lazy"
            sizes={imageSizes}
          />
        </div>
      ) : null}
      <div className="home-featured__body" aria-live="polite">
        <span id="featuredBulletinType" className="home-pill">
          {current ? "Current Event" : "Next Event"}
        </span>
        <h3 id="featuredBulletinTitle" className="home-title">{event.title}</h3>
        <p id="featuredBulletinDate" className="home-date">{eventMeta}</p>
        {children}
      </div>
    </>
  );
}
