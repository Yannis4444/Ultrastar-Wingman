/** `null` durations exist: not every song has a readable audio file. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
