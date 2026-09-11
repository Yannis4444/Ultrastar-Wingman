import { useEffect, useRef } from "react";
import { registerMusicSink, reportMusicSink } from "../api";
import { useAuth } from "../auth";
import { useMusic } from "../hooks/useMusic";
import { musicSinkStore } from "../hooks/useMusicSink";
import { effectiveVolume, musicPosition, seekIfDrifted } from "../music";

/** How long the volume takes to come down when a song starts, and to come back
 *  up afterwards. Down more slowly than up: a hard cut under the first note is
 *  what this exists to avoid, while nobody notices the way it returns. */
const FADE_OUT_MS = 600;
const FADE_IN_MS = 300;

/** The lock one browser's tabs queue on, so only one of them ever plays. */
const TAB_LOCK = "wingman-music-sink";

/** Songs in a row that would not play before the sink gives up. The backend
 *  counts its own and stands the music down; this is the local twin, for the
 *  case where the reports themselves are what is failing. */
const MAX_ERRORS = 5;

/**
 * The one screen that actually makes the background music: a hidden `<audio>`
 * following the backend's state.
 *
 * **Mounted in `App.tsx`, not on the host page.** `/host/manage` is a sibling
 * route and the host walks from it into `/settings` and `/user/*`; a sink under
 * any page would unmount and stop the music mid-song. At the app root it
 * survives every navigation.
 *
 * **`auth.isHost` is the gate** — precisely "the host screen browser", the flag
 * the one-time `?hostToken=` exchange sets. It is an administrator session, so
 * it holds the `music.manage` the sink routes ask for, and a guest phone that
 * found the host URL makes no sound and is never asked to turn any on.
 */
export default function MusicSink() {
  const auth = useAuth();
  const active = auth.loaded && auth.isHost;
  return active ? <ActiveSink /> : null;
}

function ActiveSink() {
  const music = useMusic();
  const state = music.state;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sinkRef = useRef<string | null>(null);
  const trackRef = useRef<string | null>(null);
  const errorsRef = useRef(0);
  const fadeRef = useRef<number | null>(null);
  const targetVolumeRef = useRef(0);
  // StrictMode invokes effects twice in development; one claim is enough.
  const claimingRef = useRef(false);

  // --- the lease -------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let releaseLock: (() => void) | null = null;

    const claim = async () => {
      if (claimingRef.current || sinkRef.current !== null) return;
      claimingRef.current = true;
      try {
        const answer = await registerMusicSink({ throwOnError: true });
        if (cancelled) return;
        sinkRef.current = answer.data.sink_id;
      } catch {
        // Nothing to do but let the next attempt try: without a lease the
        // element simply stays quiet, which is what a failed claim means.
      } finally {
        claimingRef.current = false;
      }
    };

    // One tab of this browser at a time. The lock is held for the component's
    // life, so a second tab waits here and never registers; across machines the
    // backend's newest-claim-wins rule settles it instead.
    const locks = navigator.locks;
    if (locks === undefined) {
      // No Web Locks (an old browser, a non-secure context). One tab is the
      // normal case, and the backend's own rule still covers two.
      void claim();
    } else {
      void locks.request(TAB_LOCK, { mode: "exclusive" }, async () => {
        await claim();
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      });
    }

    return () => {
      cancelled = true;
      releaseLock?.();
      release(sinkRef.current);
      sinkRef.current = null;
    };
  }, []);

  // A closing tab gives the sound back at once, so the next screen does not
  // wait out the timeout in silence. `keepalive`, the `useSelectionLock`
  // precedent: the page is going away with the request.
  useEffect(() => {
    const leave = (event: PageTransitionEvent) => {
      // The back/forward cache keeps the page alive and will restore it.
      if (event.persisted) return;
      release(sinkRef.current);
      sinkRef.current = null;
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  // --- the element -----------------------------------------------------------

  const track = state?.track ?? null;
  const shouldPlay = state?.status === "playing";
  const volume =
    state === undefined
      ? 0
      : effectiveVolume(state.volume.master, state.volume.music);
  targetVolumeRef.current = volume;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null || state === undefined) return;

    if (track === null) {
      trackRef.current = null;
      audio.pause();
      audio.removeAttribute("src");
      return;
    }

    const target = musicPosition(state, Date.now());
    if (trackRef.current !== track.id) {
      trackRef.current = track.id;
      audio.src = `/api/v1/songs/${encodeURIComponent(track.song.id)}/audio`;
      // A host page that reloaded mid-song comes back where the room is.
      audio.currentTime = target;
    } else if (seekIfDrifted(audio.currentTime, target)) {
      // Only a real gap: a report's own round trip must never nudge a playing
      // element, which is what the tolerance in `seekIfDrifted` is for.
      audio.currentTime = target;
    }

    if (shouldPlay) {
      ramp(audio, fadeRef, targetVolumeRef.current, FADE_IN_MS);
      audio
        .play()
        .then(() => musicSinkStore.setBlocked(false))
        .catch(() => {
          // Every browser wants a gesture before the first sound of a page.
          musicSinkStore.setBlocked(true);
        });
    } else {
      // One path for a sing starting, a pause, and a lost sink: the state's own
      // `playing` going false is all three.
      fadeOut(audio, fadeRef);
    }
  }, [state, track, shouldPlay]);

  // The volume moves without touching the song.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null && shouldPlay && fadeRef.current === null) {
      audio.volume = volume;
    }
  }, [volume, shouldPlay]);

  // --- reporting -------------------------------------------------------------

  const report = useRef<
    (event: "progress" | "ended" | "error", detail?: string) => void
  >(() => {});
  report.current = (event, detail) => {
    const audio = audioRef.current;
    const sinkId = sinkRef.current;
    const trackId = trackRef.current;
    if (audio === null || sinkId === null || trackId === null) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : null;
    void reportMusicSink({
      body: {
        sink_id: sinkId,
        track_id: trackId,
        event,
        position_s: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration_s: duration,
        detail: detail ?? null,
      },
    }).catch(() => {});
  };

  useEffect(() => {
    const interval = setInterval(() => report.current("progress"), 5000);
    return () => clearInterval(interval);
  }, []);

  // --- the gesture -----------------------------------------------------------

  useEffect(() => {
    const unlock = () => {
      const audio = audioRef.current;
      if (audio === null) return;
      // Synchronously, inside the gesture: an `await` before this call spends
      // the user activation and the play is refused again.
      void audio
        .play()
        .then(() => musicSinkStore.setBlocked(false))
        .catch(() => {});
    };
    musicSinkStore.onUnlock(unlock);
    // A TV gets no clicks, but the karaoke machine does: any press anywhere on
    // the page counts, so the explicit button is the fallback and not the only
    // way out.
    const anyPress = () => unlock();
    document.addEventListener("pointerdown", anyPress);
    document.addEventListener("keydown", anyPress);
    return () => {
      musicSinkStore.onUnlock(null);
      document.removeEventListener("pointerdown", anyPress);
      document.removeEventListener("keydown", anyPress);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      hidden
      preload="auto"
      onLoadedMetadata={() => report.current("progress")}
      onEnded={() => {
        errorsRef.current = 0;
        musicSinkStore.setFailed(false);
        report.current("ended");
      }}
      onError={() => {
        errorsRef.current += 1;
        if (errorsRef.current >= MAX_ERRORS) musicSinkStore.setFailed(true);
        report.current("error", "the browser could not play the file");
      }}
    />
  );
}

/** Give the lease back. Nobody is waiting for the answer. */
function release(sinkId: string | null): void {
  if (sinkId === null) return;
  void fetch("/api/v1/music/sink/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sink_id: sinkId }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

/**
 * Walk the element's volume to `target`.
 *
 * **No reduced-motion branch, on purpose.** That setting is about things moving
 * on a screen; cutting a volume ramp makes the room's experience worse rather
 * than calmer, and a hard cut under the first note of a song is exactly what
 * this exists to prevent.
 */
function ramp(
  audio: HTMLAudioElement,
  fadeRef: { current: number | null },
  target: number,
  duration: number,
  onDone?: () => void,
): void {
  if (fadeRef.current !== null) cancelAnimationFrame(fadeRef.current);
  const from = audio.volume;
  const started = performance.now();
  const step = () => {
    const progress = Math.min(1, (performance.now() - started) / duration);
    audio.volume = from + (target - from) * progress;
    if (progress < 1) {
      fadeRef.current = requestAnimationFrame(step);
      return;
    }
    fadeRef.current = null;
    onDone?.();
  };
  fadeRef.current = requestAnimationFrame(step);
}

function fadeOut(
  audio: HTMLAudioElement,
  fadeRef: { current: number | null },
): void {
  if (audio.paused) return;
  ramp(audio, fadeRef, 0, FADE_OUT_MS, () => audio.pause());
}
