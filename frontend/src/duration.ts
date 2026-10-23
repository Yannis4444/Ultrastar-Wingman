/** `null` durations exist: not every song has a readable audio file. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/**
 * How long a whole playlist runs, in words — "48 min", "1 h 20 min". Minutes,
 * not `m:ss`: nobody plans an evening to the second, and the clock format would
 * read as one song's length beside the song count.
 */
export function formatTotalDuration(seconds: number): string {
  // Anything that plays at all is at least a minute of the evening.
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  const hours = (minutes - rest) / 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The backend timestamps in UTC, but SQLite can round-trip the offset away and
 * a naive string would be read as local time.
 */
export function parseServerTime(timestamp: string): number {
  return Date.parse(
    /(Z|[+-]\d\d:?\d\d)$/.test(timestamp) ? timestamp : `${timestamp}Z`,
  );
}

/** Clock time of a timestamp — what a score row inside one session shows. */
export function shortTime(timestamp: string): string {
  return new Date(parseServerTime(timestamp)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Day and month of a timestamp, with the year once the score is old enough for
 * it to matter. An all-time list spans parties, so "21:40" would say nothing.
 */
export function shortDate(timestamp: string): string {
  const date = new Date(parseServerTime(timestamp));
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

/** "17 Oct 2026": day, month and year, always — for a date that is read on its
 * own, away from the list around it: a share card leaving the room, the day
 * an achievement was earned. Unlike `shortDate`, which drops the year inside
 * the current one. */
export function cardDate(timestamp: string): string {
  return new Date(parseServerTime(timestamp)).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Whether a timestamp falls on the day the reader is having — local days, so
 * "today" means what the calendar on the wall says, not what UTC says.
 */
export function isToday(timestamp: string): boolean {
  const day = new Date(parseServerTime(timestamp));
  return day.toDateString() === new Date().toDateString();
}

/** Coarse "how long ago" for wish times — a party never needs seconds. */
export function timeAgo(timestamp: string): string {
  const minutes = Math.floor((Date.now() - parseServerTime(timestamp)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
