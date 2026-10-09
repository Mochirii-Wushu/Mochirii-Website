"use client";

import type { ReactNode } from "react";
import { type GuildScheduleData, currentOrUpcomingEvent } from "@/lib/guild-schedule";
import { useGuildSchedule } from "@/lib/events/use-guild-schedule";
import { formatPublicDate } from "@/lib/public-date";

export function HomeNextEvent({
  referenceTime,
  scheduleData,
  children,
}: {
  referenceTime: string;
  scheduleData: GuildScheduleData;
  children: ReactNode;
}) {
  const schedule = useGuildSchedule(scheduleData, referenceTime);
  const event = currentOrUpcomingEvent(schedule.items, new Date(schedule.referenceTime));
  if (!event) return <p className="muted">No event is scheduled.</p>;
  const eventMeta = [formatPublicDate(new Date(`${event.date}T00:00:00Z`)), event.timeText, event.timezone].filter(Boolean).join(" • ");

  return (
    <>
      <div className="home-featured__meta">
        <span id="featuredBulletinType" className="home-pill">Next Event</span>
        <span id="featuredBulletinDate" className="home-date">
          {eventMeta}
        </span>
      </div>
      <div className="home-featured__plate">
        <h3 id="featuredBulletinTitle" className="home-title">{event.title}</h3>
        {children}
      </div>
    </>
  );
}
