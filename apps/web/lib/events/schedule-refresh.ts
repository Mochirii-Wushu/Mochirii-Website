type EventBoundary = {
  startIso?: string;
  endIso?: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function nextScheduleRefreshDelay(
  referenceTimeMs: number,
  items: readonly EventBoundary[],
  offsetMinutes = 480,
) {
  const offsetMs = offsetMinutes * 60 * 1000;
  let next = Math.floor((referenceTimeMs + offsetMs) / MS_PER_DAY + 1) * MS_PER_DAY - offsetMs;

  for (const item of items) {
    for (const iso of [item.startIso, item.endIso]) {
      const boundary = Date.parse(iso || "");
      if (boundary > referenceTimeMs && boundary < next) next = boundary;
    }
  }

  return next - referenceTimeMs;
}
