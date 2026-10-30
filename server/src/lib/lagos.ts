// Every schedule in this project runs on Lagos time, which is UTC+1 all year with no
// daylight saving, so a fixed offset is exact.
const OFFSET_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const FRIDAY = 5;

// The calendar date in Lagos at this instant, as YYYY-MM-DD for a `date` column.
export function lagosDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

// The most recent Friday 00:00 Lagos at or before `now`, as a UTC instant.
// A billing week runs from one of these to the next.
export function weekBoundaryAtOrBefore(now: Date): Date {
  const lagos = new Date(now.getTime() + OFFSET_MS);
  const daysSinceFriday = (lagos.getUTCDay() - FRIDAY + 7) % 7;
  const midnightLagos = Date.UTC(
    lagos.getUTCFullYear(),
    lagos.getUTCMonth(),
    lagos.getUTCDate(),
  );
  return new Date(midnightLagos - daysSinceFriday * DAY_MS - OFFSET_MS);
}

export function previousWeekBoundary(boundary: Date): Date {
  return new Date(boundary.getTime() - 7 * DAY_MS);
}
