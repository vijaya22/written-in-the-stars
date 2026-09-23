// Wall-clock times in a named time zone ("22:00 in Sydney"), independent of the
// computer's own zone. Used by the page and the server.

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
export function tzOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/** "2026-09-23T22:00" read as wall-clock time in `timeZone` -> Date. */
export function wallTimeToDate(value: string, timeZone: string): Date {
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffset(guess, timeZone);
  utc = guess - tzOffset(utc, timeZone); // settle across DST changes
  return new Date(utc);
}

/** Date -> "2026-09-23T22:00" wall-clock time in `timeZone`. */
export function dateToWallTime(date: Date, timeZone: string): string {
  return new Date(date.getTime() + tzOffset(date.getTime(), timeZone)).toISOString().slice(0, 16);
}
