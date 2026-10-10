import { type GuildScheduleData, type GuildWeeklyScheduleItem, scheduleLine, scheduleTimezoneLabel } from "../guild-schedule.ts";

export type StreamingScheduleData = {
  timezone: string;
  items: Pick<GuildWeeklyScheduleItem, "title" | "dayText" | "startTime" | "endTime">[];
};

// Website display only: streams never enter guild occurrence or Discord generation.
export function streamingScheduleLines(streaming: StreamingScheduleData, schedule: GuildScheduleData): string[] {
  if (streaming.timezone !== scheduleTimezoneLabel(schedule)) {
    throw new RangeError("Streaming schedule must use the authoritative schedule timezone.");
  }
  return streaming.items.map((item) => `Twitch — ${scheduleLine(item, schedule)}`);
}
