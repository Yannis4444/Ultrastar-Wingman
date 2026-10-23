import {
  cardDate,
  formatDuration,
  formatTotalDuration,
  shortDate,
} from "./duration";

test("a date read on its own always carries its year", () => {
  const now = new Date().toISOString();
  expect(cardDate(now)).toContain(String(new Date().getFullYear()));
  // Unlike the list's own date, which drops it inside the current year.
  expect(shortDate(now)).not.toContain(String(new Date().getFullYear()));
});

test("a song's length is a clock", () => {
  expect(formatDuration(295)).toBe("4:55");
  expect(formatDuration(60)).toBe("1:00");
  // Not every song has a readable audio file.
  expect(formatDuration(null)).toBe("--:--");
});

test("a playlist's length is minutes and hours", () => {
  expect(formatTotalDuration(2880)).toBe("48 min");
  expect(formatTotalDuration(3600)).toBe("1 h");
  expect(formatTotalDuration(4800)).toBe("1 h 20 min");
});

test("a playlist shorter than a minute still says a minute", () => {
  // "0 min" beside "1 song" reads as a bug, and the row is about scale, not
  // accuracy — a single short song is a minute of the evening.
  expect(formatTotalDuration(20)).toBe("1 min");
});
