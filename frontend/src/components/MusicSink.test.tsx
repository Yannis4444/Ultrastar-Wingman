import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { MusicRead, MusicTrackRead, SongRead } from "../api";
import { musicSinkStore, useMusicSinkStatus } from "../hooks/useMusicSink";
import { resetLoudnessGraph, setEffectsLevel } from "../musicGraph";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import MusicSink, { SPIN_FADE_OUT_MS } from "./MusicSink";

const {
  getMe,
  getMusic,
  getMusicSettings,
  registerMusicSink,
  reportMusicSink,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMusic: vi.fn(),
  getMusicSettings: vi.fn(),
  registerMusicSink: vi.fn(),
  reportMusicSink: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getMusic,
  getMusicSettings,
  registerMusicSink,
  reportMusicSink,
}));

// The real graph, with the effects level watched: the sink is what sets it.
vi.mock("../musicGraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../musicGraph")>();
  return { ...actual, setEffectsLevel: vi.fn(actual.setEffectsLevel) };
});

const AT = "2026-09-12T20:00:00Z";

const SONG: SongRead = {
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

function track(overrides: Partial<MusicTrackRead> = {}): MusicTrackRead {
  return {
    id: "t-1",
    song: SONG,
    started_at: AT,
    position_s: 0,
    position_at: AT,
    duration_s: null,
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
    volume: { master: 100, music: 50, preview: 100, effects: 80 },
    sound_effects: true,
    scope: "all",
    ...overrides,
  };
}

/** jsdom implements no media pipeline: `play` throws "Not implemented" and
 *  `currentTime` is inert unless we give the element real backing. */
function stubMedia(play: () => Promise<void>): void {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn(play),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  let time = 0;
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => 214,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => false,
  });
}

function draw(): HTMLAudioElement | null {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MusicSink />
    </QueryClientProvider>,
  );
  return container.querySelector("audio");
}

/** The background song's element, once the auth answer has let the sink mount
 *  (the reel's song has an element of its own, `data-role="preview"`). */
async function audioElement(): Promise<HTMLAudioElement> {
  let audio: HTMLAudioElement | null = null;
  await waitFor(() => {
    audio = document.querySelector('audio:not([data-role="preview"])');
    expect(audio).not.toBe(null);
  });
  return audio as unknown as HTMLAudioElement;
}

/** The calls the release path made, which goes through `fetch` for `keepalive`. */
function releasedIds(): string[] {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls
    .filter((call) => String(call[0]).includes("sink/release"))
    .map((call) => JSON.parse(String(call[1].body)).sink_id as string);
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  musicSinkStore.reset();
  resetLoudnessGraph();
  vi.clearAllMocks();
  stubMedia(() => Promise.resolve());
  getMe.mockResolvedValue(
    meResponse(["music.view", "music.control", "music.manage"], {
      is_host: true,
    }),
  );
  getMusic.mockResolvedValue({ data: music() });
  getMusicSettings.mockResolvedValue({
    data: { enabled: true, scope: "all", playlist: "", resume_delay_s: 10 },
  });
  registerMusicSink.mockResolvedValue({
    data: { sink_id: "sink-1", heartbeat_interval_s: 5, music: music() },
  });
  reportMusicSink.mockResolvedValue({
    data: music(),
    response: { status: 200 },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("makes no sound on a browser that is not the host screen", async () => {
  getMe.mockResolvedValue(meResponse(["music.view"], { is_host: false }));
  const audio = draw();
  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(audio).toBe(null);
  expect(registerMusicSink).not.toHaveBeenCalled();
});

it("takes the lease and plays the song the room is on", async () => {
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  await waitFor(() => {
    const audio = document.querySelector('audio:not([data-role="preview"])');
    expect(audio?.getAttribute("src")).toBe("/api/v1/songs/usdb%3A1/audio");
  });
});

it("comes back where the room is after a reload", async () => {
  // Both answers carry the state as of the claim, the register's included.
  const midway = music({ track: track({ position_s: 40 }) });
  getMusic.mockResolvedValue({ data: midway });
  registerMusicSink.mockResolvedValue({
    data: { sink_id: "sink-1", heartbeat_interval_s: 5, music: midway },
  });
  draw();
  await waitFor(() => {
    const audio = document.querySelector<HTMLAudioElement>(
      'audio:not([data-role="preview"])',
    );
    expect(audio?.currentTime).toBeGreaterThanOrEqual(40);
  });
});

it("reports the end of a song so the music moves on", async () => {
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  const audio = document.querySelector('audio:not([data-role="preview"])');
  await waitFor(() => expect(audio?.getAttribute("src")).toContain("usdb%3A1"));

  act(() => {
    audio?.dispatchEvent(new Event("ended"));
  });

  await waitFor(() => expect(reportMusicSink).toHaveBeenCalled());
  const calls = reportMusicSink.mock.calls;
  const body = calls[calls.length - 1][0].body;
  expect(body.event).toBe("ended");
  expect(body.track_id).toBe("t-1");
  expect(body.sink_id).toBe("sink-1");
  // The file's own length, which the stored duration is not.
  expect(body.duration_s).toBe(214);
});

it("reports a file it could not play rather than stalling the room", async () => {
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  const audio = document.querySelector('audio:not([data-role="preview"])');
  await waitFor(() => expect(audio?.getAttribute("src")).toContain("usdb%3A1"));

  act(() => {
    audio?.dispatchEvent(new Event("error"));
  });

  await waitFor(() => expect(reportMusicSink).toHaveBeenCalled());
  const calls = reportMusicSink.mock.calls;
  expect(calls[calls.length - 1][0].body.event).toBe("error");
});

it("says so when the browser refuses to play without a click", async () => {
  stubMedia(() => Promise.reject(new Error("gesture required")));
  const seen: boolean[] = [];
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Watcher onBlocked={(blocked) => seen.push(blocked)} />
      <MusicSink />
    </QueryClientProvider>,
  );

  // The store is what the host page reads to draw "Turn on sound"; without it
  // the room gets silence and no explanation.
  await waitFor(() => expect(seen).toContain(true));
});

function Watcher({ onBlocked }: { onBlocked: (blocked: boolean) => void }) {
  const status = useMusicSinkStatus();
  onBlocked(status.blocked);
  return null;
}

/** Register answers numbered by call, so a test can tell the claims apart. */
function numberedClaims(): void {
  let claims = 0;
  registerMusicSink.mockImplementation(() => {
    claims += 1;
    return Promise.resolve({
      data: {
        sink_id: `sink-${claims}`,
        heartbeat_interval_s: 5,
        music: music({ sink_generation: claims }),
      },
    });
  });
}

it("claims exactly once under StrictMode's double mount", async () => {
  // Development React mounts, unmounts and mounts again. Before this the
  // first mount's claim was discarded and never released while the second
  // mount believed a claim was in flight — a lease nobody reported on while
  // the music audibly played, which read as "no screen is playing the music".
  numberedClaims();
  render(
    <StrictMode>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MusicSink />
      </QueryClientProvider>
    </StrictMode>,
  );
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  expect(registerMusicSink).toHaveBeenCalledTimes(1);
  expect(releasedIds()).toEqual([]);

  act(() => {
    audio.dispatchEvent(new Event("ended"));
  });
  await waitFor(() => expect(reportMusicSink).toHaveBeenCalled());
  const calls = reportMusicSink.mock.calls;
  expect(calls[calls.length - 1][0].body.sink_id).toBe("sink-1");
});

it("claims again when the backend has restarted", async () => {
  // A fresh server holds no leases and numbers them from one again, so the
  // generation check alone would keep the dead lease: the tab would play,
  // every report would be a 409, and the room would see the old symptoms.
  numberedClaims();
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));

  // The probe the tab sends on `server.ready` is what the fresh server 409s.
  reportMusicSink.mockResolvedValueOnce({
    error: "not_the_sink",
    response: { status: 409 },
  });
  act(() => {
    FakeSocket.deliver({ event: "server.ready", version: "test" });
  });

  await waitFor(() => expect(registerMusicSink).toHaveBeenCalledTimes(2));
  // The dead lease is not released — the server has already forgotten it.
  expect(releasedIds()).toEqual([]);
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  act(() => {
    audio.dispatchEvent(new Event("ended"));
  });
  await waitFor(() => {
    const calls = reportMusicSink.mock.calls;
    expect(calls[calls.length - 1][0].body.sink_id).toBe("sink-2");
  });
});

it("keeps its lease when server.ready arrives on a server that kept running", async () => {
  // At load the socket's first `server.ready` and the claim's own answer race
  // each other; a re-claim on every `server.ready` would restart the song a
  // moment into every page load. The probe is answered 200, so nothing moves.
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));

  act(() => {
    FakeSocket.deliver({ event: "server.ready", version: "test" });
  });

  await waitFor(() => expect(reportMusicSink).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(registerMusicSink).toHaveBeenCalledTimes(1);
  expect(audio.getAttribute("src")).toContain("usdb%3A1");
  expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
});

it("keeps the lease alive while a song is being sung", async () => {
  // No track while Ultrastar Deluxe sings. The heartbeat used to need one, so
  // the lease lapsed fifteen seconds into every sing and the music never came
  // back: the first report afterwards was a 409 and the tab went quiet.
  // Only the interval is faked: the volume ramp runs on requestAnimationFrame
  // against performance.now(), and a faked clock hands it values out of range.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    draw();
    const audio = await audioElement();
    await waitFor(() =>
      expect(audio.getAttribute("src")).toContain("usdb%3A1"),
    );
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ status: "blocked", blocked_by: "sing", track: null }),
      });
    });
    await waitFor(() => expect(audio.getAttribute("src")).toBe(null));
    reportMusicSink.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(reportMusicSink).toHaveBeenCalled();
    const body = reportMusicSink.mock.calls[0][0].body;
    expect(body.sink_id).toBe("sink-1");
    expect(body.event).toBe("progress");
  } finally {
    vi.useRealTimers();
  }
});

/** The two elements: the background song's, and the reel's. */
function elements(): { background: HTMLAudioElement; reel: HTMLAudioElement } {
  const all = [...document.querySelectorAll("audio")];
  const reel = all.find((el) => el.dataset.role === "preview");
  const background = all.find((el) => el.dataset.role !== "preview");
  if (reel === undefined || background === undefined) {
    throw new Error("the sink draws two elements");
  }
  return { background, reel };
}

it("plays the reel's song from where its singing starts when the reel lands", async () => {
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  const plays = (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>)
    .mock.calls.length;

  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({
        preview: {
          id: "s:1",
          song: { ...SONG, id: "usdb:9", title: "Waterloo" },
          start_s: 42,
          reveal_at: new Date(Date.now() + 60).toISOString(),
          gain_db: null,
          peak: null,
        },
      }),
    });
  });

  // Loaded and seeked at once, so the file buffers while the reel spins.
  const { reel } = elements();
  await waitFor(() =>
    expect(reel.getAttribute("src")).toBe("/api/v1/songs/usdb%3A9/audio"),
  );
  expect(reel.currentTime).toBe(42);
  // The background fades out under it — the long fade, the reel's: a second
  // in, it is still on its way down, and the pause lands only when it is out.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  await waitFor(
    () => expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled(),
    { timeout: SPIN_FADE_OUT_MS + 1500 },
  );
  // And the reel's song comes in when the reel lands, at its own volume —
  // the fixture's preview trim, not the music's.
  await waitFor(() =>
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays + 1),
  );
  await waitFor(() => expect(reel.volume).toBe(1), { timeout: 3000 });
});

it("plays the reel's song at the preview volume, not the music's", async () => {
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({
        volume: { master: 50, music: 100, preview: 50, effects: 80 },
        preview: {
          id: "s:1",
          song: { ...SONG, id: "usdb:9" },
          start_s: 0,
          reveal_at: new Date().toISOString(),
          gain_db: null,
          peak: null,
        },
      }),
    });
  });
  const { reel } = elements();
  // 50 % of 50 %: the master times the reel's own trim.
  await waitFor(() => expect(reel.volume).toBeCloseTo(0.25), {
    timeout: 3000,
  });
});

it("seeks again on a respin that lands on the same song", async () => {
  // A pool of one: the respin is a new spin on the same file, and it starts
  // where the song's singing starts, not where the fade-out left it.
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  const spin = (id: string, start_s: number) =>
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({
          preview: {
            id,
            song: { ...SONG, id: "usdb:9" },
            start_s,
            reveal_at: new Date(Date.now() + 60_000).toISOString(),
            gain_db: null,
            peak: null,
          },
        }),
      });
    });
  spin("s:1", 42);
  const { reel } = elements();
  // The stub's `paused` is always false, so every cue here waits out the fade.
  await waitFor(() => expect(reel.currentTime).toBe(42), {
    timeout: SPIN_FADE_OUT_MS + 1500,
  });
  reel.currentTime = 17; // where a played-out fade-out would have left it

  spin("s:2", 30);
  // After the long fade the reel causes.
  await waitFor(() => expect(reel.currentTime).toBe(30), {
    timeout: SPIN_FADE_OUT_MS + 1500,
  });
  expect(reel.getAttribute("src")).toBe("/api/v1/songs/usdb%3A9/audio");
}, 12_000); // two long fades, played out in real time

it("keeps the song being picked playing where it is through a state that carries it again", async () => {
  // A slot moved, a spin moving on to its singers: the backend keeps the same
  // preview, and any state that carries it — here a volume moving under it —
  // must neither seek it back to its start nor play it a second time. No
  // background track, so nothing else touches the (shared) stubbed clock.
  const quiet = music({ status: "off", track: null });
  getMusic.mockResolvedValue({ data: quiet });
  registerMusicSink.mockResolvedValue({
    data: { sink_id: "sink-1", heartbeat_interval_s: 5, music: quiet },
  });
  const picked = {
    id: "2026-10-22T20:00:00+00:00:song",
    song: { ...SONG, id: "usdb:9" },
    start_s: 42,
    reveal_at: new Date().toISOString(),
  };
  draw();
  await audioElement();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  const plays = (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>)
    .mock.calls.length;

  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: { ...quiet, preview: picked },
    });
  });
  const { reel } = elements();
  // A selection opened with a song: no reel to wait for, it comes in at once.
  await waitFor(() =>
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays + 1),
  );
  expect(reel.currentTime).toBe(42);
  reel.currentTime = 50; // where it has got to by the next state

  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: {
        ...quiet,
        preview: { ...picked },
        volume: { ...quiet.volume, music: 20 },
      },
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(reel.currentTime).toBe(50);
  expect(reel.getAttribute("src")).toBe("/api/v1/songs/usdb%3A9/audio");
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays + 1);
});

it("lets the last song fade out before a new selection's song comes in", async () => {
  // A selection opened with a song comes in at once — but over a song that is
  // still sounding, at once would be a jump cut. It waits for the long fade.
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  const preview = (id: string, songId: string) =>
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({
          preview: {
            id,
            song: { ...SONG, id: songId },
            start_s: 0,
            reveal_at: new Date().toISOString(),
            gain_db: null,
            peak: null,
          },
        }),
      });
    });
  const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
  preview("first:song", "usdb:9");
  const { reel } = elements();
  await waitFor(() => expect(reel.getAttribute("src")).toContain("usdb%3A9"));
  await waitFor(() => expect(reel.volume).toBe(1), { timeout: 3000 });
  const plays = play.mock.calls.length;

  preview("second:song", "usdb:7");
  // A second in, the first song is still going down and nothing new has begun.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(reel.getAttribute("src")).toContain("usdb%3A9");
  expect(play).toHaveBeenCalledTimes(plays);
  // Then the new one is cued and started, once.
  await waitFor(() => expect(reel.getAttribute("src")).toContain("usdb%3A7"), {
    timeout: SPIN_FADE_OUT_MS + 1500,
  });
  await waitFor(() => expect(play).toHaveBeenCalledTimes(plays + 1));
}, 12_000); // a fade-in and a long fade-out, played out in real time

it("lets the reel's song go when the selection does", async () => {
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));
  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({
        preview: {
          id: "s:1",
          song: { ...SONG, id: "usdb:9" },
          start_s: 0,
          reveal_at: new Date().toISOString(),
          gain_db: null,
          peak: null,
        },
      }),
    });
  });
  const { reel } = elements();
  await waitFor(() => expect(reel.getAttribute("src")).toContain("usdb%3A9"));

  act(() => {
    FakeSocket.deliver({ event: "music.changed", music: music() });
  });

  await waitFor(() => expect(reel.getAttribute("src")).toBe(null));
  // The background song is back where the server says it is.
  expect(audio.getAttribute("src")).toContain("usdb%3A1");
});

it("goes quiet on a report the backend answers with not_the_sink", async () => {
  reportMusicSink.mockResolvedValue({
    error: "not_the_sink",
    response: { status: 409 },
  });
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));

  act(() => {
    audio.dispatchEvent(new Event("ended"));
  });

  await waitFor(() => expect(audio.getAttribute("src")).toBe(null));
  // And no second claim: two screens that both re-claimed on a 409 would
  // trade the lease every five seconds.
  expect(registerMusicSink).toHaveBeenCalledTimes(1);
});

it("stays silent on a tab that does not hold the lease", async () => {
  // Home open beside the host page in the same browser: the second tab never
  // gets the lease, and must not play the same song a beat behind the first.
  registerMusicSink.mockRejectedValue(new Error("another tab has it"));
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  await waitFor(() => expect(getMusic).toHaveBeenCalled());
  expect(audio.getAttribute("src")).toBe(null);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});

it("sets the sound effects to master × effects on the screen that holds the lease", async () => {
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  // 100 % of 80 %, off the state the claim answered with.
  await waitFor(() =>
    expect(vi.mocked(setEffectsLevel)).toHaveBeenLastCalledWith(0.8),
  );

  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({
        volume: { master: 50, music: 100, preview: 100, effects: 40 },
      }),
    });
  });
  await waitFor(() =>
    expect(vi.mocked(setEffectsLevel)).toHaveBeenLastCalledWith(0.2),
  );

  // The switch thrown on the Settings page: silence, without a reload.
  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({ sound_effects: false }),
    });
  });
  await waitFor(() =>
    expect(vi.mocked(setEffectsLevel)).toHaveBeenLastCalledWith(0),
  );
});

it("keeps the sound effects silent on a tab without the lease", async () => {
  registerMusicSink.mockRejectedValue(new Error("another tab has it"));
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  await waitFor(() => expect(getMusic).toHaveBeenCalled());

  const levels = vi.mocked(setEffectsLevel).mock.calls.map(([level]) => level);
  expect(levels.every((level) => level === 0)).toBe(true);
});

it("falls silent when another screen takes the sound over", async () => {
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));

  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({ sink_generation: 2 }),
    });
  });

  await waitFor(() => expect(audio.getAttribute("src")).toBe(null));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  // The resource is unloaded, not merely unnamed.
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
});

it("does not restart the music on a click while a song is being sung", async () => {
  draw();
  const audio = await audioElement();
  await waitFor(() => expect(audio.getAttribute("src")).toContain("usdb%3A1"));

  act(() => {
    FakeSocket.deliver({
      event: "music.changed",
      music: music({ status: "blocked", blocked_by: "sing", track: null }),
    });
  });
  await waitFor(() => expect(audio.getAttribute("src")).toBe(null));
  const plays = (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>)
    .mock.calls.length;

  // The karaoke machine's own mouse and keyboard: any press used to be a
  // `play()`, whatever the state said.
  act(() => {
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));
  });
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays);
});

it("gives the sound back when the page goes away", async () => {
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());

  act(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    );
  });

  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const release = calls.find((call) =>
    String(call[0]).includes("sink/release"),
  );
  expect(release).toBeDefined();
  expect(release?.[1]).toMatchObject({ keepalive: true });
});

interface FakeGain {
  gain: {
    value: number;
    setTargetAtTime: ReturnType<typeof vi.fn>;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

/**
 * A Web Audio graph as small as the sink uses: one source per element — a
 * second for the same element throws, as a browser does, on any context — and
 * a gain node per source whose value a test reads back.
 */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: AudioContextState = "running";
  static routed = new WeakSet<HTMLMediaElement>();

  state: AudioContextState = FakeAudioContext.initialState;
  currentTime = 0;
  destination = { kind: "destination" };
  resume = vi.fn(() => Promise.resolve());
  gains = new Map<HTMLMediaElement, FakeGain>();
  createMediaElementSource = vi.fn((element: HTMLMediaElement) => {
    if (FakeAudioContext.routed.has(element)) {
      throw new DOMException("already routed", "InvalidStateError");
    }
    FakeAudioContext.routed.add(element);
    return {
      connect: (node: FakeGain) => {
        this.gains.set(element, node);
        return node;
      },
    };
  });
  // A gain whose glide lands at once, so a test reads the level it heads for.
  createGain = vi.fn((): FakeGain => ({
    gain: {
      value: 1,
      setTargetAtTime: vi.fn(function (this: { value: number }, value: number) {
        this.value = value;
      }),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
  }));
  private listeners: (() => void)[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  addEventListener(_type: string, listener: () => void) {
    this.listeners.push(listener);
  }

  /** The browser moving the graph on: a resume answered, a device lost. */
  become(state: AudioContextState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** The one context the page made, once a song has tried to play. */
async function graph(): Promise<FakeAudioContext> {
  await waitFor(() => expect(FakeAudioContext.instances).toHaveLength(1));
  return FakeAudioContext.instances[0];
}

/** The gain on `element`'s node, once it has one. */
async function gainOf(
  context: FakeAudioContext,
  element: HTMLAudioElement,
): Promise<FakeGain> {
  await waitFor(() => expect(context.gains.get(element)).toBeDefined());
  return context.gains.get(element) as FakeGain;
}

/** A room on one song, the register's answer and the page's read alike. */
function playing(state: MusicRead): void {
  getMusic.mockResolvedValue({ data: state });
  registerMusicSink.mockResolvedValue({
    data: { sink_id: "sink-1", heartbeat_interval_s: 5, music: state },
  });
}

/** A selection opened with a song, so its song comes in at once. */
function landedPreview(gain_db: number | null, peak: number | null) {
  return {
    id: "s:1",
    song: { ...SONG, id: "usdb:9" },
    start_s: 0,
    reveal_at: new Date().toISOString(),
    gain_db,
    peak,
  };
}

/** The press the host page's "Turn on sound" button makes. */
const press = { current: () => {} };

function Presser() {
  press.current = useMusicSinkStatus().unlock;
  return null;
}

/** The sink beside a reader of the store "Turn on sound" is drawn from. */
function drawWatched(seen: boolean[]): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Watcher onBlocked={(blocked) => seen.push(blocked)} />
      <Presser />
      <MusicSink />
    </QueryClientProvider>,
  );
}

describe("with Web Audio", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.initialState = "running";
    FakeAudioContext.routed = new WeakSet();
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  it("plays the background at its song's loudness, on a node and not the volume", async () => {
    playing(music({ track: track({ gain_db: -6, peak: 0.5 }) }));
    draw();
    const audio = await audioElement();
    const node = await gainOf(await graph(), audio);
    // The gain node is the loudness alone…
    expect(node.gain.value).toBeCloseTo(0.501, 3);
    // …and the element's volume the printed numbers alone: 100 % × 50 %.
    await waitFor(() => expect(audio.volume).toBeCloseTo(0.5));
  });

  it("moves the node when the same song's loudness changes mid-play", async () => {
    playing(music({ track: track({ gain_db: -6, peak: null }) }));
    draw();
    const audio = await audioElement();
    const node = await gainOf(await graph(), audio);
    expect(node.gain.value).toBeCloseTo(0.501, 3);

    // The library pass measured the song while it played.
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ track: track({ gain_db: -3, peak: null }) }),
      });
    });
    await waitFor(() => expect(node.gain.value).toBeCloseTo(0.708, 3));
    // Under a sounding song a glide, never a step that would click.
    expect(node.gain.setTargetAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.708, 3),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("keeps a song's level while it fades out under a sing", async () => {
    // The state carries no track once a sing starts, but the song is still
    // sounding for the fade: jumping it to full level there would be a swell.
    playing(music({ track: track({ gain_db: -6, peak: null }) }));
    draw();
    const audio = await audioElement();
    const node = await gainOf(await graph(), audio);
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ status: "blocked", blocked_by: "sing", track: null }),
      });
    });
    await waitFor(() => expect(audio.getAttribute("src")).toBe(null));
    expect(node.gain.value).toBeCloseTo(0.501, 3);
  });

  it("turns a quiet song being picked up, no further than its peak allows", async () => {
    draw();
    const audio = await audioElement();
    await waitFor(() =>
      expect(audio.getAttribute("src")).toContain("usdb%3A1"),
    );
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ preview: landedPreview(6, 0.9) }),
      });
    });
    const { reel } = elements();
    const node = await gainOf(await graph(), reel);
    // +6 dB would be about 2.0; a peak of 0.9 leaves room for 1/0.9 only.
    expect(node.gain.value).toBeCloseTo(1 / 0.9, 3);
    await waitFor(() => expect(reel.volume).toBe(1), { timeout: 3000 });
  });

  it("makes one source per element, under StrictMode and every state after", async () => {
    // A second `createMediaElementSource` for the same element throws in a
    // browser — the fake does too — so the routes have to outlive the double
    // mount and every re-render.
    numberedClaims();
    render(
      <StrictMode>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MusicSink />
        </QueryClientProvider>
      </StrictMode>,
    );
    const audio = await audioElement();
    const context = await graph();
    await gainOf(context, audio);
    // The same song's numbers moving, then two other songs, each its own file.
    for (const [id, songId, gain_db] of [
      ["t-1", "usdb:1", -2],
      ["t-2", "usdb:2", -4],
      ["t-3", "usdb:3", 3],
    ] as const) {
      act(() => {
        FakeSocket.deliver({
          event: "music.changed",
          music: music({
            track: track({
              id,
              song: { ...SONG, id: songId },
              gain_db,
              peak: null,
            }),
          }),
        });
      });
    }
    await waitFor(() =>
      expect(audio.getAttribute("src")).toContain("usdb%3A3"),
    );
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ preview: landedPreview(-1, null) }),
      });
    });
    const { reel } = elements();
    await gainOf(context, reel);
    act(() => {
      document.dispatchEvent(new Event("pointerdown"));
    });

    expect(FakeAudioContext.instances).toHaveLength(1);
    const routed = context.createMediaElementSource.mock.calls.map(
      ([element]) => element,
    );
    expect(routed).toHaveLength(2);
    expect(new Set(routed)).toEqual(new Set([audio, reel]));
    // One gain node per element, not one per song or per state, each into the
    // destination exactly once.
    expect(context.createGain).toHaveBeenCalledTimes(2);
    for (const result of context.createGain.mock.results) {
      const gain = result.value as FakeGain;
      expect(gain.connect).toHaveBeenCalledTimes(1);
      expect(gain.connect).toHaveBeenCalledWith(context.destination);
    }
    // Every call returned: none of them was a throwing second one.
    expect(
      context.createMediaElementSource.mock.results.every(
        (result) => result.type === "return",
      ),
    ).toBe(true);
  });

  it("asks for the press while the graph stays asleep, and wakes it on the press", async () => {
    // The play resolves, but a suspended graph swallows it: the same silence
    // as a refused play, so the host page must draw "Turn on sound".
    FakeAudioContext.initialState = "suspended";
    const seen: boolean[] = [];
    drawWatched(seen);
    const context = await graph();
    await waitFor(() => expect(seen[seen.length - 1]).toBe(true));
    // Resumed at the play already — which a browser may leave waiting.
    expect(context.resume).toHaveBeenCalled();
    const before = context.resume.mock.calls.length;

    act(() => {
      press.current();
    });
    // Inside the press, synchronously: a resume after an `await` is refused.
    expect(context.resume.mock.calls.length).toBeGreaterThan(before);

    act(() => {
      context.become("running");
    });
    await waitFor(() => expect(seen[seen.length - 1]).toBe(false));
  });

  it("keeps asking when the press cannot wake the graph", async () => {
    FakeAudioContext.initialState = "suspended";
    const seen: boolean[] = [];
    drawWatched(seen);
    const context = await graph();
    context.resume.mockImplementation(() =>
      Promise.reject(new DOMException("refused", "NotAllowedError")),
    );
    await waitFor(() => expect(seen[seen.length - 1]).toBe(true));
    const plays = (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>)
      .mock.calls.length;

    act(() => {
      press.current();
    });
    // The play itself resolves, and still nobody hears it.
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays + 1),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen[seen.length - 1]).toBe(true);
  });

  it("says the room hears it once the graph runs", async () => {
    const seen: boolean[] = [];
    drawWatched(seen);
    await graph();
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).not.toContain(true);
  });
});

describe("without Web Audio", () => {
  it("folds a loud song's loudness into the volume", async () => {
    expect(window.AudioContext).toBeUndefined();
    playing(music({ track: track({ gain_db: -6, peak: null }) }));
    draw();
    const audio = await audioElement();
    await waitFor(() =>
      expect(audio.getAttribute("src")).toContain("usdb%3A1"),
    );
    // 100 % × 50 % × 0.501.
    await waitFor(() => expect(audio.volume).toBeCloseTo(0.5 * 0.501, 3));
  });

  it("cannot turn a quiet song up past full, and plays it as it is", async () => {
    draw();
    const audio = await audioElement();
    await waitFor(() =>
      expect(audio.getAttribute("src")).toContain("usdb%3A1"),
    );
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ preview: landedPreview(6, 0.9) }),
      });
    });
    const { reel } = elements();
    await waitFor(() => expect(reel.getAttribute("src")).toContain("usdb%3A9"));
    // min(1/0.9, 1) × 100 % × 100 %: an element's volume stops at 1.
    await waitFor(() => expect(reel.volume).toBe(1), { timeout: 3000 });
  });

  it("turns a loud song being picked down", async () => {
    draw();
    const audio = await audioElement();
    await waitFor(() =>
      expect(audio.getAttribute("src")).toContain("usdb%3A1"),
    );
    act(() => {
      FakeSocket.deliver({
        event: "music.changed",
        music: music({ preview: landedPreview(-6, null) }),
      });
    });
    const { reel } = elements();
    await waitFor(() => expect(reel.volume).toBeCloseTo(0.501, 3), {
      timeout: 3000,
    });
  });
});
