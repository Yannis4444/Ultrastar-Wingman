import type { CurrentSing, MusicRead, MusicTrackRead, SongRead } from "./api";
import {
  effectiveVolume,
  musicPosition,
  playerMode,
  progressPercent,
  replayGainFactor,
  seekIfDrifted,
} from "./music";

const AT = "2026-09-12T20:00:00Z";
const NOW = Date.parse(AT);

function song(): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Bohemian Rhapsody",
    artist: "Queen",
    duration_seconds: 354,
    has_video: false,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  };
}

function track(overrides: Partial<MusicTrackRead> = {}): MusicTrackRead {
  return {
    id: "t-1",
    song: song(),
    started_at: AT,
    position_s: 0,
    position_at: AT,
    duration_s: 200,
    gain_db: null,
    peak: null,
    ...overrides,
  };
}

function music(overrides: Partial<MusicRead> = {}): MusicRead {
  return {
    status: "playing",
    track: track(),
    preview: null,
    blocked_by: null,
    resume_at: null,
    retry_at: null,
    sink_online: true,
    sink_generation: 1,
    volume: { master: 100, music: 60, preview: 100, effects: 80 },
    scope: "all",
    ...overrides,
  };
}

function sing(): CurrentSing {
  return { sing_id: "s-1", song: song(), started_at: AT, slots: [] };
}

describe("playerMode", () => {
  it("gives a running sing the stage, whatever the music thinks", () => {
    expect(playerMode(sing(), music(), true)).toBe("singing");
  });

  it("shows the background song while one is loaded", () => {
    expect(playerMode(null, music(), true)).toBe("music");
    expect(playerMode(null, music({ status: "paused" }), true)).toBe("music");
  });

  it("is idle for every state that has nothing to show", () => {
    for (const status of ["off", "blocked", "waiting", "empty"] as const) {
      expect(playerMode(null, music({ status, track: null }), true)).toBe(
        "idle",
      );
    }
  });

  it("is idle for a reader who may not see the music at all", () => {
    expect(playerMode(null, music(), false)).toBe("idle");
    expect(playerMode(null, undefined, true)).toBe("idle");
  });
});

describe("musicPosition", () => {
  it("adds the seconds since the server last said", () => {
    expect(musicPosition(music(), NOW + 12_000)).toBeCloseTo(12);
  });

  it("stands still while nobody is listening", () => {
    const frozen = music({
      sink_online: false,
      track: track({ position_s: 8 }),
    });
    expect(musicPosition(frozen, NOW + 60_000)).toBeCloseTo(8);
  });

  it("stands still while the music is paused", () => {
    const paused = music({ status: "paused", track: track({ position_s: 8 }) });
    expect(musicPosition(paused, NOW + 60_000)).toBeCloseTo(8);
  });

  it("never runs past the end of the file", () => {
    expect(musicPosition(music(), NOW + 9_999_000)).toBe(200);
  });

  it("never goes negative when the two clocks disagree", () => {
    expect(musicPosition(music(), NOW - 5_000)).toBe(0);
  });

  it("is nothing at all with no track", () => {
    expect(musicPosition(music({ track: null }), NOW)).toBe(0);
  });
});

describe("musicPosition while the reel's song plays", () => {
  it("stands still: the background froze for the preview", () => {
    const base = music();
    if (base.track === null) throw new Error("the fixture has a track");
    const state = music({
      preview: {
        id: "s:1",
        song: base.track.song,
        start_s: 12,
        reveal_at: AT,
        gain_db: null,
        peak: null,
      },
    });
    expect(musicPosition(state, NOW + 30_000)).toBe(base.track.position_s);
  });
});

describe("progressPercent", () => {
  it("is the share of the file that has played", () => {
    expect(progressPercent(music(), NOW + 100_000)).toBeCloseTo(50);
  });

  it("draws nothing until something has measured the file", () => {
    expect(
      progressPercent(music({ track: track({ duration_s: null }) }), NOW),
    ).toBe(null);
  });
});

describe("effectiveVolume", () => {
  it("scales the music's trim by the master", () => {
    expect(effectiveVolume(100, 60)).toBeCloseTo(0.6);
    expect(effectiveVolume(50, 50)).toBeCloseTo(0.25);
  });

  it("is silent at either end", () => {
    expect(effectiveVolume(0, 100)).toBe(0);
    expect(effectiveVolume(100, 0)).toBe(0);
  });

  it("clamps a value the settings could not have produced", () => {
    expect(effectiveVolume(400, 400)).toBe(1);
    expect(effectiveVolume(-10, 50)).toBe(0);
  });
});

describe("seekIfDrifted", () => {
  it("leaves a playing element alone over a round trip's worth of drift", () => {
    expect(seekIfDrifted(10, 10.4)).toBe(false);
  });

  it("jumps when the element is somewhere else entirely", () => {
    expect(seekIfDrifted(0, 95)).toBe(true);
    expect(seekIfDrifted(95, 0)).toBe(true);
  });
});

describe("replayGainFactor", () => {
  it("plays a song whose loudness is not known as it is", () => {
    expect(replayGainFactor(null, null)).toBe(1);
    expect(replayGainFactor(null, 0.5)).toBe(1);
    expect(replayGainFactor(undefined, undefined)).toBe(1);
  });

  it("turns a loud song down by its gain", () => {
    expect(replayGainFactor(-6, null)).toBeCloseTo(0.501, 3);
    expect(replayGainFactor(0, 0.9)).toBe(1);
  });

  it("turns a quiet song up no further than its peak allows", () => {
    // +6 dB would be about 2.0; a peak of 0.9 leaves room for 1/0.9 only.
    expect(replayGainFactor(6, 0.9)).toBeCloseTo(1 / 0.9);
    // A peak with room to spare does not hold the gain back.
    expect(replayGainFactor(6, 0.25)).toBeCloseTo(1.995, 3);
  });

  it("lowers even a negative gain under a peak above full scale", () => {
    // Ultrastar Deluxe caps the gain at -20·log10(peak) whatever its sign.
    expect(replayGainFactor(-1, 1.25)).toBeCloseTo(0.8);
  });

  it("leaves the gain uncapped without a peak", () => {
    expect(replayGainFactor(6, null)).toBeCloseTo(1.995, 3);
    expect(replayGainFactor(6, 0)).toBeCloseTo(1.995, 3);
    expect(replayGainFactor(6, -0.5)).toBeCloseTo(1.995, 3);
  });

  it("never turns a number it cannot read into a volume", () => {
    expect(replayGainFactor(Number.NaN, 0.9)).toBe(1);
    expect(replayGainFactor(Number.POSITIVE_INFINITY, null)).toBe(1);
    expect(replayGainFactor(-6, Number.NaN)).toBeCloseTo(0.501, 3);
    // A cached state from a build that sent the tag's own text.
    expect(replayGainFactor("-6.00 dB" as unknown as number, 0.5)).toBe(1);
    expect(replayGainFactor("-6" as unknown as number, null)).toBe(1);
  });
});
