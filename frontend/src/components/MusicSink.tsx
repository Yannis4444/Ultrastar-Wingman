import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { registerMusicSink, reportMusicSink } from "../api";
import { parseServerTime } from "../duration";
import { getMusicQueryKey } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useMusic } from "../hooks/useMusic";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { musicSinkStore } from "../hooks/useMusicSink";
import { effectiveVolume, musicPosition, seekIfDrifted } from "../music";

/** How long the volume takes to come down when a song starts, and to come back
 *  up afterwards. Down more slowly than up: a hard cut under the first note is
 *  what this exists to avoid, while nobody notices the way it returns. */
const FADE_OUT_MS = 600;
const FADE_IN_MS = 300;
/** A fade the reel causes — the background going under a spin, the last
 *  song going under a respin — has the whole spin to play out in, and the
 *  user asked for it to take its time (2026-09-12). Well inside the 5.5 s
 *  reel, so the new file is cued long before it lands. */
export const SPIN_FADE_OUT_MS = 2500;
/** The reel's song rises in over this, from the moment the reel lands: long
 *  enough that the landing is a swell and not a jump cut, short enough that
 *  the two-second lead-in before the first word (`songs/txt.py`) still ends
 *  before it. */
const PREVIEW_FADE_IN_MS = 1500;

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
 *
 * **Only the tab holding the lease makes a sound.** The element follows the
 * state *and* the lease: a second host tab (Home open beside the host page),
 * or one whose claim another screen has since overtaken, stays silent. The
 * alternative — playing on `status === "playing"` alone — is two tabs playing
 * the same song a beat apart, and a `sink_online` that says nothing about the
 * sound actually coming out.
 *
 * **Two elements.** The background song has one, and the reel's song — the
 * `preview` the state carries while the room's selection was spun — has its
 * own: it is loaded and seeked the moment the reel starts, so the file buffers
 * while the reel spins, and it rises in at `reveal_at` on the server's clock.
 * The background element fades out under it and comes back where it froze
 * when the preview goes. One element swapping its `src` would have lost the
 * background's position, reported the preview's time under the background
 * track's id, and started loading only when the reel stopped.
 */
export default function MusicSink() {
  const auth = useAuth();
  const active = auth.loaded && auth.isHost;
  return active ? <ActiveSink /> : null;
}

/** The lease this tab holds: the id every report carries, and the generation
 *  the backend numbered it — which is how the tab learns it has been overtaken. */
interface Lease {
  id: string;
  generation: number;
}

function ActiveSink() {
  const music = useMusic();
  const queryClient = useQueryClient();
  const state = music.state;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const previewFadeRef = useRef<number | null>(null);
  // `id@reveal_at` of the preview the element is set up for: a respin is a new
  // id, a press landing the reel early is a new `reveal_at`, and both re-arm.
  const previewKeyRef = useRef<string | null>(null);
  // The key the element was last loaded and seeked for.
  const previewCuedRef = useRef<string | null>(null);
  // Whether the reel's song should be sounding right now — landed, and still
  // wanted — for the gesture unlock to know which element to play.
  const previewLiveRef = useRef(false);
  // The lease twice: as state, so the element effect runs when it arrives and
  // goes, and as a ref, so the `pagehide` handler and the reports read it
  // synchronously.
  const [lease, setLease] = useState<Lease | null>(null);
  // Bumped to claim again: the lease effect keys on it.
  const [claimNonce, setClaimNonce] = useState(0);
  const sinkRef = useRef<string | null>(null);
  const trackRef = useRef<string | null>(null);
  const errorsRef = useRef(0);
  const fadeRef = useRef<number | null>(null);
  const targetVolumeRef = useRef(0);
  // The reel's song has a volume of its own (`sound.preview_volume`).
  const previewVolumeRef = useRef(0);
  const shouldPlayRef = useRef(false);

  // --- the lease -------------------------------------------------------------

  useEffect(() => {
    // Everything this effect owns lives in its closure, and nothing in a ref
    // that outlives the cleanup: StrictMode runs mount, cleanup, mount in
    // development, and a component-level "claiming" flag left the second
    // mount believing the first one's claim — which the first one's cleanup
    // had just thrown away. A lease claimed and never reported on is the
    // backend's `sink_online: false` under audible music.
    let cancelled = false;
    let releaseLock: (() => void) | null = null;
    let deferred: ReturnType<typeof setTimeout> | null = null;

    const claim = async () => {
      let answer;
      try {
        answer = await registerMusicSink({ throwOnError: true });
      } catch {
        // Nothing to do but let the next mount try: without a lease the
        // element simply stays quiet, which is what a failed claim means.
        return;
      }
      if (cancelled) {
        // Claimed for a mount that is already gone — a real unmount racing
        // the request. Give it back rather than leaving the backend with a
        // lease nobody reports on.
        release(answer.data.sink_id);
        return;
      }
      sinkRef.current = answer.data.sink_id;
      setLease({
        id: answer.data.sink_id,
        generation: answer.data.music.sink_generation,
      });
      // The answer already carries the state as of our claim, so the element
      // need not wait for the broadcast to learn its own generation.
      queryClient.setQueryData(getMusicQueryKey(), answer.data.music);
    };

    // One tab of this browser at a time. The lock is held for the component's
    // life, so a second tab waits here and never registers; across machines the
    // backend's newest-claim-wins rule settles it instead.
    const locks = navigator.locks;
    if (locks === undefined) {
      // No Web Locks (an old browser, a non-secure context). One tab is the
      // normal case, and the backend's own rule still covers two. Deferred a
      // tick: StrictMode's cleanup runs synchronously before it fires, so the
      // development double mount sends one claim, not two whose answers the
      // server may number in either order.
      deferred = setTimeout(() => {
        deferred = null;
        void claim();
      }, 0);
    } else {
      void locks.request(TAB_LOCK, { mode: "exclusive" }, async () => {
        // The callback may run after the cleanup — StrictMode again. Parking
        // here would hold the lock for a mount that no longer exists, and the
        // live mount would queue behind it forever.
        if (cancelled) return;
        await claim();
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      });
    }

    return () => {
      cancelled = true;
      if (deferred !== null) clearTimeout(deferred);
      releaseLock?.();
      release(sinkRef.current);
      sinkRef.current = null;
      setLease(null);
    };
  }, [queryClient, claimNonce]);

  // The lease is dead but this tab still thinks it holds it. Forget it without
  // a release — the backend has already — and, when asked, claim again.
  const dropLease = (claimAgain: boolean) => {
    if (sinkRef.current === null) return;
    sinkRef.current = null;
    setLease(null);
    if (claimAgain) setClaimNonce((nonce) => nonce + 1);
  };

  // The backend may have restarted: the socket's first message on every
  // connection is `server.ready`, and a fresh server holds no leases at all —
  // it would pick a song, number it from one again (never *above* ours, so the
  // check above would not catch it) and 409 every report. A tab holding a
  // lease *probes* rather than re-claiming outright: one report, and only a 409
  // on it means the lease is dead and a new one is wanted. A server that kept
  // running answers 200 and nothing happens — which matters at load, where the
  // first `server.ready` and the claim's own answer race each other.
  useWingmanEvent("server.ready", () => probe.current());

  // Another screen took the sound over: the backend numbers every claim, and a
  // state carrying a newer number than ours means we are not the sink any more.
  // Silence, and no more reports — the next one would only be a 409. Strictly
  // newer: the page's own first `GET /music` may land *after* the claim and
  // carry the number from before it, and that is stale, not an overtake.
  useEffect(() => {
    if (
      lease !== null &&
      state !== undefined &&
      state.sink_generation > lease.generation
    ) {
      sinkRef.current = null;
      setLease(null);
    }
  }, [lease, state]);

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

  const holding = lease !== null;
  const track = holding ? (state?.track ?? null) : null;
  const preview = holding ? (state?.preview ?? null) : null;
  // The reel's song has the speakers while a preview is set: the background
  // fades out under it and its position is frozen on the server meanwhile.
  const shouldPlay = holding && state?.status === "playing" && preview === null;
  const volume =
    state === undefined
      ? 0
      : effectiveVolume(state.volume.master, state.volume.music);
  const previewVolume =
    state === undefined
      ? 0
      : effectiveVolume(state.volume.master, state.volume.preview);
  targetVolumeRef.current = volume;
  previewVolumeRef.current = previewVolume;
  shouldPlayRef.current = shouldPlay;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null || state === undefined) return;

    if (track === null) {
      trackRef.current = null;
      const unload = () => {
        // The ramp takes 600ms, and a track may be back by then — a respin, a
        // skip that landed. Only a still-silent element is unloaded.
        if (trackRef.current !== null) return;
        audio.pause();
        if (audio.hasAttribute("src")) {
          // Removing the attribute alone leaves the loaded resource in the
          // element, and the next `play()` — a click on the page while a song
          // is being sung — would resume it. `load()` is what actually
          // unloads it.
          audio.removeAttribute("src");
          audio.load();
        }
      };
      // The same fade a pause gets, never a cut: a song being sung clears the
      // track while Ultrastar Deluxe is still loading its own, so the ramp
      // runs out before the first note, and a skip is a fade into the next.
      if (audio.paused) unload();
      else ramp(audio, fadeRef, 0, FADE_OUT_MS, unload);
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
        .catch((error: unknown) => {
          // A `pause()` that came in before playback started rejects the
          // promise too; that is the music stopping on purpose, not a browser
          // asking for a gesture.
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          // Every browser wants a gesture before the first sound of a page.
          musicSinkStore.setBlocked(true);
        });
    } else {
      // One path for a sing starting, a pause, and a lost sink: the state's own
      // `playing` going false is all three. Under a spin the fade is the
      // long one — the reel is the room's cue that the music is going.
      fadeOut(
        audio,
        fadeRef,
        preview !== null ? SPIN_FADE_OUT_MS : FADE_OUT_MS,
      );
    }
  }, [state, track, shouldPlay, preview]);

  // The volume moves without touching the song — on whichever element sounds.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null && shouldPlay && fadeRef.current === null) {
      audio.volume = volume;
    }
    const reel = previewRef.current;
    if (
      reel !== null &&
      previewLiveRef.current &&
      previewFadeRef.current === null
    ) {
      reel.volume = previewVolume;
    }
  }, [volume, previewVolume, shouldPlay]);

  // --- the reel's song -------------------------------------------------------

  const previewId = preview?.id ?? null;
  const previewRevealAt = preview?.reveal_at ?? null;
  const previewSongId = preview?.song.id ?? null;
  const previewStart = preview?.start_s ?? 0;

  useEffect(() => {
    const reel = previewRef.current;
    if (reel === null) return;

    if (
      previewId === null ||
      previewRevealAt === null ||
      previewSongId === null
    ) {
      // Picked and started, given up, expired, or this tab lost the lease: the
      // song fades out and the element is emptied — only if nothing new has
      // arrived in the meantime.
      previewKeyRef.current = null;
      previewLiveRef.current = false;
      const unload = () => {
        if (previewKeyRef.current !== null) return;
        reel.pause();
        if (reel.hasAttribute("src")) {
          reel.removeAttribute("src");
          reel.load();
        }
      };
      if (reel.paused) unload();
      else ramp(reel, previewFadeRef, 0, FADE_OUT_MS, unload);
      return;
    }

    const key = `${previewId}@${previewRevealAt}`;
    const url = `/api/v1/songs/${encodeURIComponent(previewSongId)}/audio`;
    const load = () => {
      // Idempotent: a moved landing keeps the loaded file where it stands.
      if (reel.getAttribute("src") !== url) reel.src = url;
    };
    const cue = () => {
      // A new spin: the file, and the seek to its start — unconditionally, because a
      // respin out of a pool of one lands on the same file, which a played-out
      // fade-out has left somewhere else.
      load();
      reel.currentTime = previewStart;
      previewCuedRef.current = key;
    };
    if (previewKeyRef.current !== key) {
      previewKeyRef.current = key;
      previewLiveRef.current = false;
      if (reel.paused) {
        // The reel has just started: load and seek now, so the file is buffered
        // by the time it lands.
        cue();
      } else {
        // A respin while the last song was playing: fade it out, then cue the
        // new one — long before the new reel lands.
        ramp(reel, previewFadeRef, 0, SPIN_FADE_OUT_MS, () => {
          if (previewKeyRef.current !== key) return;
          reel.pause();
          cue();
        });
      }
    }

    // The landing, on the server's clock; already past for a host that loads
    // mid-selection, and then the song comes in at once.
    const delay = Math.max(0, parseServerTime(previewRevealAt) - Date.now());
    const timer = setTimeout(() => {
      if (previewKeyRef.current !== key) return;
      // Cued already, unless the fade-out of the last song is still running.
      if (previewCuedRef.current !== key) cue();
      previewLiveRef.current = true;
      reel.volume = 0;
      ramp(reel, previewFadeRef, previewVolumeRef.current, PREVIEW_FADE_IN_MS);
      reel
        .play()
        .then(() => musicSinkStore.setBlocked(false))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          musicSinkStore.setBlocked(true);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [previewId, previewRevealAt, previewSongId, previewStart]);

  // --- reporting -------------------------------------------------------------

  const probe = useRef<() => void>(() => {});
  probe.current = () => {
    const sinkId = sinkRef.current;
    if (sinkId === null) return;
    void reportMusicSink({
      body: {
        sink_id: sinkId,
        // Any track id does: a report naming a track that is not current is
        // answered with the state and ignored, while an unknown sink is a 409.
        track_id: trackRef.current ?? "probe",
        event: "progress",
        position_s: 0,
        duration_s: null,
        detail: null,
      },
    })
      .then((result) => {
        if (result.response?.status === 409 && sinkRef.current === sinkId) {
          dropLease(true);
        }
      })
      .catch(() => {});
  };

  const report = useRef<
    (event: "progress" | "ended" | "error", detail?: string) => void
  >(() => {});
  report.current = (event, detail) => {
    const audio = audioRef.current;
    const sinkId = sinkRef.current;
    if (audio === null || sinkId === null) return;
    // With no track — a song is being sung, the room is waiting, the pool is
    // empty — the heartbeat still goes out, naming no track: the backend
    // answers its state and touches the lease, which is all that report is
    // for. A heartbeat that stopped with the track let the lease lapse during
    // every sing, and the music never came back afterwards.
    const trackId = trackRef.current;
    if (trackId === null && event !== "progress") return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : null;
    void reportMusicSink({
      body: {
        sink_id: sinkId,
        track_id: trackId ?? "none",
        event,
        position_s: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration_s: duration,
        detail: detail ?? null,
      },
    })
      .then((result) => {
        // `not_the_sink`: another screen holds the sound now. Silence, and no
        // re-claim — two machines that both did would trade the lease every
        // five seconds. The newest registration wins, and it was not ours.
        if (result.response?.status === 409) dropLease(false);
      })
      .catch(() => {});
  };

  useEffect(() => {
    const interval = setInterval(() => report.current("progress"), 5000);
    return () => clearInterval(interval);
  }, []);

  // --- the gesture -----------------------------------------------------------

  useEffect(() => {
    const unlock = () => {
      // Whichever element is supposed to be sounding right now: the reel's
      // song once it has landed, or the background music. A press while a song
      // is being sung, while the music is paused, or on a tab that does not
      // hold the lease must not start anything.
      const element = previewLiveRef.current
        ? previewRef.current
        : shouldPlayRef.current
          ? audioRef.current
          : null;
      if (element === null) return;
      // Synchronously, inside the gesture: an `await` before this call spends
      // the user activation and the play is refused again.
      void element
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
    <>
      {/* The reel's song. Reports nothing: the lease is about the background
          track, and this element's time is not that track's. */}
      <audio ref={previewRef} hidden preload="auto" data-role="preview" />
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
    </>
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
  duration: number,
): void {
  if (audio.paused) return;
  ramp(audio, fadeRef, 0, duration, () => audio.pause());
}
