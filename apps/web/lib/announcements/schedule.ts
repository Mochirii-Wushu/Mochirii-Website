import { type GuildScheduleData, scheduleLine } from "../guild-schedule.ts";
import { type StreamingScheduleData, streamingScheduleLines } from "../events/streaming-schedule.ts";

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function announcementScheduleLines(schedule: GuildScheduleData, streaming?: StreamingScheduleData): string[] {
  const weekly = (schedule.weekly || [])
    .filter((item) => item.discord === true)
    .map((item) => {
      const start = item.startTime || "", end = item.endTime || "";
      const crossesMidnight = CLOCK.test(start) && CLOCK.test(end) && end <= start;
      return scheduleLine(item, schedule) + (crossesMidnight ? " (ends the following day)" : "");
    });
  const gathering = schedule.monthly?.gathering;
  if (gathering?.id === "monthly-gathering" && gathering.rule === "next-first-sunday" && gathering.startDayOffset === 1) {
    weekly.push(scheduleLine({ ...gathering, dayText: "Monday after the first Sunday" }, schedule));
  }
  return streaming ? [...weekly, ...streamingScheduleLines(streaming, schedule)] : weekly;
}
