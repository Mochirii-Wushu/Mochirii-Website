import "server-only";
import guildScheduleData from "@/public/data/guild-schedule.json";
import type { GuildScheduleData } from "@/lib/guild-schedule";

function eventCoverUrl(cover: string) {
  return `${cover}?v=${encodeURIComponent(guildScheduleData.discordCoverVersion)}`;
}

// Client displays need timing and public presentation, not the Discord management fields.
export const publicGuildSchedule: GuildScheduleData = {
  timezone: guildScheduleData.timezone,
  monthly: Object.fromEntries(Object.entries(guildScheduleData.monthly)
    .filter(([, item]) => item.id !== "monthly-raffle")
    .map(([key, item]) => [key, {
      id: item.id,
      title: item.title,
      rule: item.rule,
      startDayOffset: "startDayOffset" in item ? item.startDayOffset : 0,
      startTime: item.startTime,
      endTime: item.endTime,
      location: item.location,
      description: item.description,
      discordCoverImage: eventCoverUrl(item.discordCoverImage),
    }])),
  weekly: guildScheduleData.weekly.filter((item) => item.discord === true).map((item) => ({
    id: item.id,
    title: item.title,
    days: item.days,
    dayText: item.dayText,
    startTime: item.startTime,
    endTime: item.endTime,
    location: item.location,
    summary: "summary" in item ? item.summary : undefined,
    href: "href" in item ? item.href : undefined,
    discordCoverImage: eventCoverUrl(item.discordCoverImage),
    discord: true,
  })),
};
