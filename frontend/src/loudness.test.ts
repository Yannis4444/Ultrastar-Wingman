import type { LoudnessCounts, LoudnessPassStatus } from "./api";
import {
  LOUDNESS_PASS_NOTE,
  loudnessCountsSentence,
  loudnessPassLine,
} from "./loudness";

function counts(overrides: Partial<LoudnessCounts> = {}): LoudnessCounts {
  return {
    tagged: 0,
    already_tagged: 0,
    unsupported: 0,
    silent: 0,
    missing: 0,
    in_use: 0,
    failed: 0,
    ...overrides,
  };
}

function pass(overrides: Partial<LoudnessPassStatus> = {}): LoudnessPassStatus {
  return {
    state: "idle",
    waiting: false,
    total: 0,
    done: 0,
    counts: counts(),
    ended: null,
    error: null,
    song: null,
    ...overrides,
  };
}

test("the counts are short sentences, every outcome without a tag in one", () => {
  expect(
    loudnessCountsSentence(
      counts({
        tagged: 300,
        already_tagged: 20,
        unsupported: 5,
        silent: 2,
        missing: 3,
        in_use: 1,
        failed: 4,
      }),
    ),
  ).toBe("Tagged 300 songs. 20 had a tag already. 15 could not be tagged.");
  expect(loudnessCountsSentence(counts({ tagged: 1 }))).toBe("Tagged 1 song.");
  expect(loudnessCountsSentence(counts({ already_tagged: 4 }))).toBe(
    "4 had a tag already.",
  );
  expect(loudnessCountsSentence(counts())).toBe("");
});

test("before any pass the line says what the button does", () => {
  expect(loudnessPassLine(pass())).toBe(LOUDNESS_PASS_NOTE);
  // Under about 90 characters, so it fits a phone in two lines.
  expect(LOUDNESS_PASS_NOTE.length).toBeLessThanOrEqual(90);
});

test("a running pass counts the song in hand and names it", () => {
  const running = pass({
    state: "running",
    total: 340,
    done: 11,
    song: { id: "usdb:1", title: "Waterloo", artist: "ABBA" },
  });

  expect(loudnessPassLine(running)).toBe("12 of 340: Waterloo by ABBA");
  expect(loudnessPassLine({ ...running, song: null })).toBe("12 of 340.");
  expect(loudnessPassLine({ ...running, waiting: true })).toBe(
    "12 of 340. Paused until Ultrastar Deluxe closes.",
  );
  // The retries at the end never count past the total.
  expect(loudnessPassLine({ ...running, done: 340 })).toBe(
    "340 of 340: Waterloo by ABBA",
  );
  expect(loudnessPassLine(pass({ state: "running" }))).toBe(
    "Looking for songs without a tag…",
  );
  expect(loudnessPassLine({ ...running, state: "stopping" })).toBe(
    "Stopping after this song.",
  );
});

test("an ended pass says how it ended until the next press", () => {
  expect(
    loudnessPassLine(
      pass({
        ended: "finished",
        total: 3,
        done: 3,
        counts: counts({ tagged: 2, failed: 1 }),
      }),
    ),
  ).toBe("Tagged 2 songs. 1 could not be tagged.");
  expect(loudnessPassLine(pass({ ended: "finished" }))).toBe(
    "Every song has its loudness already.",
  );
  expect(
    loudnessPassLine(
      pass({
        ended: "stopped",
        total: 340,
        done: 12,
        counts: counts({ tagged: 12 }),
      }),
    ),
  ).toBe("Stopped after 12 of 340. Tagged 12 songs.");
  expect(loudnessPassLine(pass({ ended: "stopped", total: 340 }))).toBe(
    "Stopped after 0 of 340.",
  );
  // A pass that never started says so in the error notice, not here.
  expect(loudnessPassLine(pass({ ended: "failed", error: "No ffmpeg." }))).toBe(
    LOUDNESS_PASS_NOTE,
  );
});
