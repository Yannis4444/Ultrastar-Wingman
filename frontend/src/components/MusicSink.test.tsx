import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
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
  reportMusicSink.mockResolvedValue({ data: music() });
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
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("/api/v1/songs/usdb%3A1/audio");
  });
});

it("comes back where the room is after a reload", async () => {
  getMusic.mockResolvedValue({
    data: music({ track: track({ position_s: 40 }) }),
  });
  draw();
  await waitFor(() => {
    const audio = document.querySelector("audio");
    expect(audio?.currentTime).toBeGreaterThanOrEqual(40);
  });
});

it("reports the end of a song so the music moves on", async () => {
  draw();
  await waitFor(() => expect(registerMusicSink).toHaveBeenCalled());
  const audio = document.querySelector("audio");
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
  const audio = document.querySelector("audio");
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
