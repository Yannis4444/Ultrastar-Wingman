import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { MusicRead, MusicTrackRead, SongRead } from "../api";
import { musicSinkStore, useMusicSinkStatus } from "../hooks/useMusicSink";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import MusicSink from "./MusicSink";

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

const AT = "2026-09-12T20:00:00Z";

const SONG: SongRead = {
  id: "usdb:1",
  source: "usdb",
  title: "Bohemian Rhapsody",
  artist: "Queen",
  duration_seconds: 354,
  has_video: false,
  is_duet: false,
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
    volume: { master: 100, music: 50, effects: 80 },
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
  // The background fades out under it: no new play on it, a pause on the way.
  await waitFor(() =>
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled(),
  );
  // And the reel's song comes in when the reel lands.
  await waitFor(() =>
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays + 1),
  );
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
          },
        }),
      });
    });
  spin("s:1", 42);
  const { reel } = elements();
  await waitFor(() => expect(reel.currentTime).toBe(42));
  reel.currentTime = 17; // where a played-out fade-out would have left it

  spin("s:2", 30);
  await waitFor(() => expect(reel.currentTime).toBe(30));
  expect(reel.getAttribute("src")).toBe("/api/v1/songs/usdb%3A9/audio");
});

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
