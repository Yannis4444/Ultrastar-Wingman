import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MouseEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import type { WishRead } from "../api";
import {
  exchangeHostTokenMutation,
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  getJoinInfoOptions,
  getJoinInfoQueryKey,
  launchUsdxMutation,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import HostAchievements, {
  type HostAchievementsPhase,
} from "../components/HostAchievements";
import HostResults from "../components/HostResults";
import HostSelection, {
  type HostSelectionPhase,
} from "../components/HostSelection";
import { Icon } from "../components/icons";
import { openModals } from "../components/modalStack";
import SessionLeaderboard from "../components/SessionLeaderboard";
import SongCover from "../components/SongCover";
import { errorMessage, usdxLaunchRefusal } from "../errors";
import { useSelectorStatus } from "../hooks/useSelectorStatus";
import { useSessionStanding } from "../hooks/useSessionStanding";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { type Music, useMusic } from "../hooks/useMusic";
import { useMusicSinkStatus } from "../hooks/useMusicSink";
import { useWishlist } from "../hooks/useWishlist";
import {
  type HostShortcut,
  hostShortcut,
  nudgedVolume,
  SHORTCUT_KEYS,
} from "../hostShortcuts";
import { manageEntries } from "../manage";
import { hasTransport } from "../music";
import type { LeaderboardOrder } from "../stats";
import "./Host.css";

/** The query parameter the server puts into the URL it logs and opens. */
const TOKEN_PARAM = "hostToken";

/** The setting that overrides the address the QR code encodes. */
const JOIN_URL_SETTING = "host.join_url";

/** One performance ranks nobody — the standing starts once there is a second. */
const MIN_SINGS = 2;

/** Rail wishes with a leaderboard above them, and without it. */
const WISHES_WITH_STANDING = 3;
const WISHES_ALONE = 5;

interface SettingChanged extends WingmanEvent {
  key: string;
}

/** Reads the token and takes it out of the URL, so it is never shared or re-sent. */
function takeToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(TOKEN_PARAM);
  if (token === null) return null;
  url.searchParams.delete(TOKEN_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  return token;
}

/**
 * A control the mouse clicked keeps its focus, and the next key pressed — Esc
 * out of full screen, say — turns that focus `:focus-visible`, which holds the
 * chrome up over the TV for good. So when the page goes idle, a control in the
 * chrome that only a click focused lets go of it; one Tab reached keeps it.
 */
function dropPointerFocus() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return;
  if (focused.closest(".host-controls, .host-reveal") === null) return;
  try {
    if (focused.matches(":focus-visible")) return;
  } catch {
    // A browser that cannot answer has no `:focus-visible` rule to hold the
    // chrome up with either.
    return;
  }
  focused.blur();
}

/**
 * A click on the chrome lets go of the focus it gave as soon as it has given
 * it, not three seconds later: a key pressed before the page goes idle would
 * turn that focus visible first, and the idle check would then keep it. A
 * label's click — the leaderboard's order pills are labels over hidden radios
 * — focuses its radio only after its own click has been dispatched, so the
 * check waits a task. Enter or Space on a control Tab reached clicks it too,
 * and that focus is visible, so it stays.
 */
function dropClickFocus(event: MouseEvent<HTMLElement>) {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(".host-controls, .host-reveal") === null) return;
  window.setTimeout(dropPointerFocus, 0);
}

/**
 * True after `delay` ms without input; drives cursor hiding, the overlay and
 * every `.host-reveal` cluster (the leaderboard's order pills). One timer for
 * the whole page — a second one would let the chrome fade out in pieces.
 */
function useIdle(delay = 3000): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    let timer = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIdle(true);
        dropPointerFocus();
      }, delay);
    };
    wake();
    for (const event of events) window.addEventListener(event, wake);
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [delay]);

  return idle;
}

function onFullscreenChange(listener: () => void): () => void {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

/** `?? null` because a browser without the API leaves the property undefined. */
function isFullscreen(): boolean {
  return (document.fullscreenElement ?? null) !== null;
}

/** Whether this browser can put the page on the whole screen at all
 *  (`fullscreenEnabled` is false in a frame that is not allowed, and an iPhone
 *  has no API at all). The button and the F key both ask. */
function canFullscreen(): boolean {
  return document.fullscreenEnabled === true;
}

/**
 * Onto the whole screen, or back off it — the button's press and the F key's.
 * Called inside the press: the browser grants full screen to a click or a key,
 * never to a page asking on its own. `onRefused` is told whether this press
 * was turned down.
 */
function toggleFullscreen(onRefused: (refused: boolean) => void) {
  onRefused(false);
  if (isFullscreen()) {
    // Only refused when the page is not in full screen after all, and then
    // `fullscreenchange` has already put the button right.
    document.exitFullscreen().catch(() => undefined);
  } else {
    document.documentElement.requestFullscreen().catch(() => onRefused(true));
  }
}

/**
 * The overlay's way onto the whole TV, and back off it. It reads the real
 * state from `fullscreenchange`, so Esc leaving full screen turns it back into
 * the way in. F11 is the browser's own full screen, which the page is never
 * told about: the button keeps offering the page's, and that still works.
 *
 * In full screen it stays, as the way out: it sits in the overlay, so the TV
 * sees it only while somebody moves the mouse, and a host with a wireless
 * mouse and no keyboard has no Esc to press. Drawn nowhere a browser cannot do
 * it (`canFullscreen`).
 *
 * `onRefused` is told whether the last press was turned down; the page says so
 * after the overlay's buttons rather than between them.
 */
function HostFullscreen({
  onRefused,
}: {
  onRefused: (refused: boolean) => void;
}) {
  const fullscreen = useSyncExternalStore(onFullscreenChange, isFullscreen);

  if (!canFullscreen()) return null;

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    // A click (`detail` counts the presses; Enter and Space leave it 0) lets
    // go of the focus at once: the very next key is likely Esc out of full
    // screen, and it would turn that focus visible and hold the overlay up.
    if (event.detail > 0) event.currentTarget.blur();
    toggleFullscreen(onRefused);
  };

  const label = fullscreen ? "Leave full screen" : "Full screen";
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={`${label} (F)`}
      aria-keyshortcuts={SHORTCUT_KEYS.fullscreen}
      onClick={toggle}
    >
      <Icon name={fullscreen ? "fullscreen-exit" : "fullscreen"} />
    </button>
  );
}

/** How long after the last move the master volume is written — `VolumeField`'s
 *  own 200 ms, so a drag across the track or an arrow key held down is one
 *  request, and a single press still lands before anybody looks away. */
const VOLUME_SETTLE_MS = 200;

interface MasterVolume {
  /** What the slider and its number show. */
  value: number | undefined;
  set: (value: number) => void;
  /** One arrow press: five up or down from wherever the slider stands. */
  nudge: (shortcut: HostShortcut) => void;
}

/**
 * The master volume the overlay shows, shared by its slider and the arrow
 * keys so the two never disagree. The draft is non-null only while somebody is
 * moving it and until that write is answered: a phone turning the room down
 * still reaches a slider nobody is touching, `music.changed` carrying every
 * volume — and so does a write on the Settings page, which the backend answers
 * with a `music.changed` of its own.
 */
function useMasterVolume(music: Music): MasterVolume {
  const stored = music.state?.volume.master;
  const [draft, setDraft] = useState<number | null>(null);
  const { setVolume } = music;

  useEffect(() => {
    if (draft === null) return;
    const timer = window.setTimeout(() => {
      if (draft === stored) {
        setDraft(null);
        return;
      }
      // Lets go only of the value it wrote: a key pressed while this one was on
      // the wire is the next write, not the stored value coming back.
      setVolume({ master: draft }, () =>
        setDraft((current) => (current === draft ? null : current)),
      );
    }, VOLUME_SETTLE_MS);
    return () => clearTimeout(timer);
    // `setVolume` is a new function on every render and `stored` moves with
    // every phone; the timer is about the draft alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return {
    value: draft ?? stored,
    set: setDraft,
    nudge: (shortcut) =>
      setDraft((current) => {
        const from = current ?? stored;
        return from === undefined ? null : nudgedVolume(from, shortcut);
      }),
  };
}

/**
 * The music group at the foot of the screen (§7): the background song in the
 * middle, its play or pause and skip ending the cell to its left, the master
 * volume starting the cell to its right — so the controls stand beside what
 * they control, not in the corner. The two cells are the overlay's
 * (`.host-reveal`, faded by the page's one idle timer); the line is content
 * while the song plays and never fades, and chrome while it is paused, named
 * beside the play that resumes it.
 *
 * Play or pause and skip only while the music is on and not held by a sing or
 * an open Ultrastar Deluxe (`transport`): beside the red Stop they would read
 * as the sing's. The volume for every reader who may control the music,
 * whatever it does, because it also sets how loud the song being picked comes
 * out with the music off — then it is the row alone, centred. In a takeover the
 * line is down (the reel names its own song, the badges are a singer's
 * seconds) and the two cells stand at the top right the rail has left.
 */
function HostMusic({
  music,
  volume,
  controls,
  transport,
  takeover,
}: {
  music: Music;
  volume: MasterVolume;
  /** The reader may control the music (`music.control`). */
  controls: boolean;
  /** Play or pause and skip are drawn. */
  transport: boolean;
  takeover: boolean;
}) {
  const state = music.state;
  if (state === undefined) return null;
  const paused = state.status === "paused";
  // Playing, the room is hearing it, so the line says so to anybody who may
  // read the music. Paused, it is the name beside the play, so only where that
  // play is drawn.
  const song =
    takeover || !(state.status === "playing" || (paused && transport))
      ? null
      : (state.track?.song ?? null);
  const showVolume = controls && volume.value !== undefined;
  if (song === null && !showVolume) return null;

  const toggle = paused ? "Play" : "Pause";
  // One thing alone in the row is centred on the screen rather than standing
  // in a side cell beside an empty middle.
  const single = !transport && (song === null || !showVolume);
  return (
    <div className={`host-music${single ? " host-music-single" : ""}`}>
      {transport && (
        <div className="host-music-cell host-music-transport host-reveal">
          <button
            type="button"
            className="icon-button"
            aria-label={toggle}
            title={`${toggle} (Space)`}
            aria-keyshortcuts={SHORTCUT_KEYS["play-pause"]}
            disabled={music.isBusy}
            onClick={() => (paused ? music.play() : music.pause())}
          >
            <Icon name={paused ? "play" : "pause"} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Skip"
            title="Skip (N)"
            aria-keyshortcuts={SHORTCUT_KEYS.skip}
            disabled={music.isBusy}
            onClick={() => music.skip()}
          >
            <Icon name="skip" />
          </button>
        </div>
      )}
      {song !== null && (
        <p
          className={`host-music-line${paused ? " host-music-line-paused host-reveal" : ""}`}
        >
          {song.title} · {song.artist}
        </p>
      )}
      {showVolume && (
        /* The speaker names the slider and is not a control of its own: there
           is no mute, only a volume. */
        <div className="host-music-cell host-volume host-reveal">
          <Icon name="volume" className="icon host-volume-glyph" />
          <label className="visually-hidden" htmlFor="host-volume">
            Master volume
          </label>
          <input
            className="range-input host-volume-input"
            id="host-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume.value}
            title="Master volume (↑ ↓)"
            aria-keyshortcuts={SHORTCUT_KEYS.volume}
            aria-valuetext={`${volume.value} percent`}
            onChange={(event) => volume.set(Number(event.target.value))}
          />
          {/* The slider says it in words already; this is for the eye. */}
          <span className="host-volume-value" aria-hidden="true">
            {volume.value}%
          </span>
        </div>
      )}
    </div>
  );
}

/** One entry of the legend: its keys, and the word for what they do. */
interface LegendEntry {
  keys: string[];
  word: string;
}

/**
 * The keyboard shortcuts in words, the corner's last line under the row of
 * buttons while the chrome is up (§7): only the keys whose control is drawn, so
 * the legend never offers what the page would ignore. Nothing at all when no
 * key is anybody's.
 */
function HostLegend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <p className="host-legend">
      {entries.map((entry) => (
        <span className="host-legend-entry" key={entry.word}>
          {entry.keys.map((name) => (
            <kbd key={name}>{name}</kbd>
          ))}
          {entry.word}
        </span>
      ))}
    </p>
  );
}

/**
 * The stage while USDX is idle and nothing has been scored: whose screen this
 * is, and what to do about it. It is the only state that says the name — a TV
 * playing a song does not need to be told which app it is, and the rail needs
 * the room.
 *
 * `scan` is false where there is no code to scan: the beat between two singers
 * of the achievements takeover shows the brand, and the rail with the QR in it
 * is not on the screen for those seconds.
 */
function HostBrand({ scan = true }: { scan?: boolean }) {
  return (
    <div className="host-brand">
      <img className="host-logo" src="/logo.png" alt="" />
      <span className="host-brand-name">Ultrastar Wingman</span>
      {scan && <p className="host-scan-hint">Scan the code to pick a song</p>}
    </div>
  );
}

/**
 * What the crowd wants to sing, in the rail beside the QR code: wishes feed the
 * spinner's odds, they are not a queue, so they belong next to the way in
 * rather than on the stage.
 */
function HostWishes({ wishes }: { wishes: WishRead[] }) {
  return (
    /* The heading names the region; an `aria-label` saying the same words
       would only be a second copy to keep in step with it. */
    <section className="host-wishes" aria-labelledby="host-wishes-heading">
      <h2 id="host-wishes-heading">Most wished</h2>
      <ol>
        {wishes.map((wish) => (
          <li key={wish.song.id}>
            <SongCover song={wish.song} className="host-wishes-cover" />
            <span className="host-wishes-song">
              <span className="host-wishes-title">{wish.song.title}</span>
              <span className="host-wishes-artist">{wish.song.artist}</span>
            </span>
            <span className="host-wishes-count">{wish.count}×</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The screen next to the TV where USDX runs. Two columns, each with one job:
 * the stage on the left is whatever the party is doing right now (a song, the
 * scores it just got, or the brand), and the rail on the right is how to take
 * part — the QR code first, then the standing and the wishes.
 *
 * Opened with `?hostToken=…` it trades that one-time token for a permanent
 * trusted admin session — the only way to become the host (no IP or header
 * check; the old app trusted `X-Forwarded-For`, which any client can set).
 */
export default function Host() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const idle = useIdle();
  const [error, setError] = useState<string | null>(null);
  const [askStop, setAskStop] = useState(false);
  const [fullscreenRefused, setFullscreenRefused] = useState(false);
  // A refusal answers one press, so it goes with the overlay once the mouse
  // rests, rather than coming back over the next song with every movement.
  if (idle && fullscreenRefused) setFullscreenRefused(false);
  // What a scoreboard is read for, and the Scores page's default too.
  const [order, setOrder] = useState<LeaderboardOrder>("best");
  // Whose turn the stage is between songs: the badges a finished song earned
  // play first, and the results follow them.
  const [earned, setEarned] = useState<HostAchievementsPhase>("idle");
  // The room picking the next song owns the stage too, between the badges above
  // it and the results below.
  const [picking, setPicking] = useState<HostSelectionPhase>("idle");

  const exchange = useMutation({
    ...exchangeHostTokenMutation(),
    // The session cookie is set now: everything cached was fetched as a guest.
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: () =>
      setError(
        "That host link does not work any more. It can only be used once. " +
          "Check the server log for the current one.",
      ),
  });

  const { mutate } = exchange;
  useEffect(() => {
    // The token is stripped before the request, so React's double-invoked
    // development effect finds nothing to send the second time.
    const token = takeToken();
    if (token !== null) mutate({ body: { token } });
  }, [mutate]);

  // Shares CurrentlyPlaying's cache entry; only the overlay Stop needs it here.
  const current = useQuery(getCurrentSingOptions());
  const sing = current.data?.sing ?? null;

  const join = useQuery(getJoinInfoOptions());
  const joinUrl = join.data?.url ?? window.location.origin;
  // A corrected address must reach the TV without somebody walking over to it.
  useWingmanEvent<SettingChanged>("setting.changed", ({ key }) => {
    if (key === JOIN_URL_SETTING) {
      void queryClient.invalidateQueries({ queryKey: getJoinInfoQueryKey() });
    }
  });

  // A player selector that has gone quiet is worth a word on the TV: the room
  // is putting cards down and nothing is happening. Only once one has actually
  // reported during this page's life, though — a party without a device would
  // otherwise be told all evening that something it never had is offline.
  const selector = useSelectorStatus();
  const [selectorSeen, setSelectorSeen] = useState(false);
  useEffect(() => {
    if (selector.online) setSelectorSeen(true);
  }, [selector.online]);
  // `isSuccess` because an unanswered request is not a device that went away:
  // the note would otherwise flash on every reload of a room that has one.
  const selectorGone = selectorSeen && selector.isSuccess && !selector.online;

  // Fetched once for the whole page: the rail ranks with it, the stage's score
  // bars take their avatars from it.
  const standing = useSessionStanding(order);
  const showStanding =
    auth.can("stats.view") &&
    standing.sings >= MIN_SINGS &&
    standing.entries.length > 0;

  const music = useMusic();
  const masterVolume = useMasterVolume(music);
  // A browser that may not touch the music — a guest who found this URL — gets
  // no transport and no keys for it; the host's browser is an administrator.
  const mayControl =
    auth.loaded && auth.can("music.control") && music.state !== undefined;
  // The keys follow the buttons: none for the transport while it is not drawn.
  const transport =
    mayControl && music.state !== undefined && hasTransport(music.state.status);
  const sink = useMusicSinkStatus();

  const wishlist = useWishlist();
  const wishes = [...wishlist.wishes]
    .sort((a, b) => b.count - a.count)
    .slice(0, showStanding ? WISHES_WITH_STANDING : WISHES_ALONE);

  // Only what this session may actually open, so a guest that found the host
  // URL sees the stage and nothing else.
  const manage = manageEntries(auth);

  const stop = useMutation({
    ...stopSingingMutation(),
    onSuccess: () =>
      queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  });

  // Ultrastar Deluxe on its own, for what only it can set — which microphone
  // is which, above all. Its window coming to the front is the answer, so a
  // success says nothing here; a refusal says why, and goes with the overlay
  // once the mouse rests, like the full-screen one.
  const launch = useMutation(launchUsdxMutation());
  const { isError: launchRefused, reset: resetLaunch } = launch;
  useEffect(() => {
    if (idle && launchRefused) resetLaunch();
  }, [idle, launchRefused, resetLaunch]);
  const launchRefusal = launch.isError
    ? (usdxLaunchRefusal(launch.error) ?? [
        errorMessage(launch.error, "Could not start Ultrastar Deluxe."),
      ])
    : [];

  // The legend under the row of buttons names the keys whose control is
  // drawn — the transport's while it stands, busy or not, so the line does not
  // flicker with every press the server is still answering.
  const legend: LegendEntry[] = [];
  if (transport) {
    legend.push({ keys: ["Space"], word: "Play or pause" });
    legend.push({ keys: ["N"], word: "Skip" });
  }
  if (mayControl) legend.push({ keys: ["↑", "↓"], word: "Volume" });
  if (canFullscreen()) legend.push({ keys: ["F"], word: "Full screen" });

  // The keyboard's way to the same controls (§7). It never moves the focus:
  // `useIdle` wakes on the same key, so the overlay shows what changed and
  // fades again as usual.
  const onShortcut = (event: KeyboardEvent) => {
    const available = new Set<HostShortcut>();
    if (transport && !music.isBusy) {
      available.add("play-pause");
      available.add("skip");
    }
    if (mayControl) {
      available.add("volume-up");
      available.add("volume-down");
    }
    if (canFullscreen()) available.add("fullscreen");

    const shortcut = hostShortcut(event, {
      modalOpen: openModals.length > 0,
      available,
    });
    if (shortcut === null) return;
    // Space would scroll a narrow host page, an arrow would too.
    event.preventDefault();
    if (shortcut === "play-pause") {
      if (music.state?.status === "paused") music.play();
      else music.pause();
    } else if (shortcut === "skip") music.skip();
    else if (shortcut === "fullscreen") toggleFullscreen(setFullscreenRefused);
    else masterVolume.nudge(shortcut);
  };
  // Bound once, reading the newest handler through a ref. Re-binding on every
  // render lost the key that woke a faded overlay: `useIdle`'s own listener
  // runs first, React renders in the microtask after it, and a listener
  // removed during a dispatch is never called — nor is the one added in its
  // place.
  const shortcutHandler = useRef(onShortcut);
  useEffect(() => {
    shortcutHandler.current = onShortcut;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcutHandler.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // New achievements take the whole screen (§7): while they are actually on it
  // the rail is not rendered at all — no QR card, no standing, no wishes — and
  // the stage runs the full width. `waiting`, the beat held for badges that may
  // never come, leaves the rail where it is; a rail that blinked out for every
  // song that earned nobody anything would be the beat made visible.
  const badges = earned === "playing";
  // The room picking the next song takes the screen the same way (the user's
  // decision, 2026-09-06): nobody needs the code while the slots are filling up,
  // and the cards along the foot want the width the rail was holding.
  const picked = picking === "selecting";
  // Badges win the stage from a selection — they are the seconds a singer gets —
  // so `HostSelection` is suppressed by `badges` alone and never by this. It
  // keeps reporting `"selecting"` underneath them, which is what leaves the rail
  // down across the hand-over and brings the cards straight back.
  const takeover = badges || picked;

  return (
    <div
      className={`host-page${takeover ? " host-takeover" : ""}${idle ? " host-idle" : ""}`}
      onClick={dropClickFocus}
    >
      {/* The screen's half of the chrome; the music's is at the foot. Hiding
          is opacity-only so the strings stay in the DOM and Tab still reaches
          the buttons. First in the page, as it is first on the screen: Tab
          starts in the corner and goes on to the music under the stage, which
          a narrow page also puts between the stage and the rail. */}
      <div className="host-controls">
        <div className="host-controls-row">
          {/* The host's own manage view, not the phone's user page: this
              screen has no tab bar to find its way back from. */}
          {manage.length > 0 && (
            <Link to="/host/manage" className="icon-button" aria-label="Manage">
              <Icon name="gear" />
            </Link>
          )}
          {/* For every browser on this page, host rights or not: putting the
              screen on the TV is not a management task. */}
          <HostFullscreen onRefused={setFullscreenRefused} />
          {/* One slot: Stop while a song plays, Open Ultrastar Deluxe
              otherwise — the launch is refused while a song plays anyway. Its
              caption stands under the button inside the slot, never beside it
              in the row, where it read as the whole row's. */}
          {sing !== null
            ? auth.can("karaoke.stop") && (
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  aria-label="Stop"
                  disabled={stop.isPending}
                  onClick={() => setAskStop(true)}
                >
                  <Icon name="stop" />
                </button>
              )
            : // The launch route's own right — asked once it is known, so a
              // guest's TV never flashes the button while `/auth/me` is on the
              // wire. The glyph alone would read as switching the TV off, so
              // the word goes with it — at the gear's weight, never a filled
              // button outweighing the icons beside it.
              auth.loaded &&
              auth.can("settings.manage") && (
                <div className="host-usdx">
                  <button
                    type="button"
                    className="icon-button icon-button-text"
                    title="Open Ultrastar Deluxe"
                    aria-describedby="host-usdx-caption"
                    disabled={launch.isPending}
                    onClick={() => launch.mutate({})}
                  >
                    <Icon name="power" />
                    Open Ultrastar Deluxe
                  </button>
                  <p className="host-caption" id="host-usdx-caption">
                    For settings like microphones
                  </p>
                </div>
              )}
        </div>
        {/* No line says this browser holds host rights: drawn only where it
            is true, it would say nothing (§7). */}
        <HostLegend entries={legend} />
        {/* Last, so a refusal coming and going moves nothing above it. */}
        {launchRefusal.map((sentence) => (
          <p className="error-notice host-error" role="alert" key={sentence}>
            {sentence}
          </p>
        ))}
        {error && (
          <p className="error-notice host-error" role="alert">
            {error}
          </p>
        )}
        {fullscreenRefused && (
          <p className="error-notice host-error" role="alert">
            The browser would not go full screen. Press F11 instead.
          </p>
        )}
      </div>

      <div className="host-stage">
        <CurrentlyPlaying />
        {/* Somebody is picking singers for the next song: the stage shows the
            song and its slots filling up, and takes the whole screen for it.
            It gives way to the badges a finished song earned, and it stands in
            front of the results — the room is looking at what happens next, not
            at what just happened. */}
        <HostSelection onPhase={setPicking} suppressed={badges} />
        {/* The badges a finished song earned take the stage before its scores
            do. `HostResults` stays mounted underneath them the whole time —
            it is what listens for the next scores and for the next song — and
            simply waits its turn; the brand stands in while the stage is
            holding for badges that may follow, and nothing at all while they
            are actually on it. The blank beat between two singers is the
            takeover's own, and it hands the stage the brand rather than
            leaving the TV empty for it — without the scan line, the rail
            holding the code being down for those seconds. */}
        <HostAchievements
          onPhase={setEarned}
          fallback={<HostBrand scan={false} />}
        />
        <HostResults
          players={standing.players}
          fallback={takeover ? null : <HostBrand />}
          suppressed={earned !== "idle" || picked}
        />
      </div>
      {/* What the room is hearing, quietly, along the foot of the whole
          screen — centred on the TV and not on the stage's column, under the
          brand and under the scores alike, so the room learns where to look —
          with its controls on either side of it. The line is content rather
          than a control, so it does not fade with them: the point is that it
          reads across the room while nobody is touching the mouse. */}
      <HostMusic
        music={music}
        volume={masterVolume}
        controls={mayControl}
        transport={transport}
        takeover={takeover}
      />

      {/* A browser plays no sound until somebody has pressed something on
          it, and a TV gets no presses. Over everything and in the middle of
          the screen, not in the rail: the rail is down while the room picks
          singers, and a fault the whole room has to see and fix cannot be a
          small button in a corner. Not in the overlay either — `.host-controls`
          is invisible the moment the mouse stops moving, which on a TV across
          the room is always. */}
      {sink.blocked && (
        <button
          type="button"
          className="button button-primary host-sound-on"
          onClick={sink.unlock}
        >
          <Icon name="volume" /> Turn on sound
        </button>
      )}

      {!takeover && (
        <div className="host-rail">
          {/* First in the rail because it is the one thing a guest is looking
              for — nothing below it may push it off the top. */}
          <div className="host-join">
            <QRCode
              value={joinUrl}
              size={512}
              viewBox="0 0 512 512"
              bgColor="#ffffff"
              fgColor="#021720"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
            <p className="host-join-label">Scan to join</p>
            {/* Only `http://` is dropped — it is what a phone assumes anyway.
                An `https://` join URL has to keep its scheme, or the guest who
                types the line instead of scanning it lands on the wrong
                protocol. */}
            <p className="host-join-url">{joinUrl.replace(/^http:\/\//, "")}</p>
          </div>
          {sink.failed && (
            <p className="error-notice host-rail-note" role="alert">
              The background music would not play.
            </p>
          )}
          {selectorGone && (
            <p className="host-rail-note">Player selector offline</p>
          )}
          {showStanding && (
            <SessionLeaderboard
              entries={standing.entries}
              order={order}
              onOrder={setOrder}
              players={standing.players}
            />
          )}
          {wishes.length > 0 && <HostWishes wishes={wishes} />}
        </div>
      )}

      {askStop && sing !== null && (
        <ConfirmModal
          title="Stop the song"
          message={`Stop "${sing.song.title}"? Scores for an unfinished song are not recorded.`}
          confirmLabel="Stop"
          danger
          onConfirm={() => {
            setAskStop(false);
            stop.mutate({});
          }}
          onCancel={() => setAskStop(false)}
        />
      )}
    </div>
  );
}
