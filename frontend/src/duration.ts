/** `null` durations exist: not every song has a readable audio file. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
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

/** Coarse "how long ago" for wish times — a party never needs seconds. */
export function timeAgo(timestamp: string): string {
  const minutes = Math.floor((Date.now() - parseServerTime(timestamp)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
