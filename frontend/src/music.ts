import type { CurrentSing, MusicRead } from "./api";
import { parseServerTime } from "./duration";

/**
 * What the background-music player is showing. The whole branching of the Home
 * stage is this one function, so it can be read and tested without rendering
 * anything.
 */
export type PlayerMode = "singing" | "music" | "idle";

/** What the music may play from. The backend's `MUSIC_SCOPES`, every song
 *  first — and no *Favorites*, which needs an account the room's soundtrack
 *  does not have. Deliberately its own list rather than `devices.RANDOM_SCOPES`:
 *  the two happen to agree today and are free to stop agreeing. */
export const MUSIC_SCOPES: { value: string; label: string }[] = [
  { value: "all", label: "All songs" },
  { value: "wishlist", label: "Wishlist" },
  { value: "weighted", label: "Wishlist (weighted)" },
  { value: "playlist", label: "A playlist" },
];

/** The statuses that mean a song is loaded, whether or not it is moving. */
const WITH_TRACK: MusicRead["status"][] = ["playing", "paused"];

/**
 * Which of the three the stage is in. A sing always wins: Ultrastar Deluxe has
 * the speakers, and whatever the music thinks it is doing is not what the room
 * is hearing.
 *
 * `canView` is the reader's `music.view`. Without it there is no music state to
 * read at all, so the stage is either a sing or idle — and its idle wording has
 * to be careful, because that reader cannot know whether music is playing.
 */
export function playerMode(
  sing: CurrentSing | null,
  music: MusicRead | undefined,
  canView: boolean,
): PlayerMode {
  if (sing !== null) return "singing";
  if (!canView || music === undefined) return "idle";
  return WITH_TRACK.includes(music.status) && music.track !== null
    ? "music"
    : "idle";
}

/**
 * Where the track is at `now`.
 *
 * The server sends where it was and when that was true, and it only keeps the
 * two moving while the music plays and a screen is listening — and not while
 * the reel's song has the speakers (`preview`) — so the same rule decides here
 * whether to add the seconds since. Clamped at both ends: a clock skew must not
 * show a negative time, and a track whose file turned out shorter than the
 * server thinks must not run past its own end.
 */
export function musicPosition(music: MusicRead, now: number): number {
  const track = music.track;
  if (track === null) return 0;
  const advancing =
    music.status === "playing" && music.sink_online && music.preview === null;
  const since = advancing
    ? (now - parseServerTime(track.position_at)) / 1000
    : 0;
  const position = Math.max(0, track.position_s + Math.max(0, since));
  return track.duration_s === null
    ? position
    : Math.min(position, track.duration_s);
}

/** How far through the track is, as a percentage, or null while nothing has
 *  measured the file — a bar with no end to it is not a bar. */
export function progressPercent(music: MusicRead, now: number): number | null {
  const duration = music.track?.duration_s ?? null;
  if (duration === null || duration <= 0) return null;
  return Math.min(100, (musicPosition(music, now) / duration) * 100);
}

/**
 * What the audio element's `volume` is set to: the master scaling the music's
 * own trim, both as percentages.
 *
 * A plain product, not a perceptual curve. Any gamma would make one of the two
 * printed numbers a lie, and both are set by ear against the room anyway. The
 * song's own loudness (`replayGainFactor`) is not in here: it is a third
 * multiplier, applied on its own and never printed, so the two numbers stay a
 * plain product.
 */
export function effectiveVolume(master: number, music: number): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, value / 100));
  return clamp(master) * clamp(music);
}

/**
 * How much a song is turned up or down to even out its loudness: its
 * ReplayGain, by the rule Ultrastar Deluxe plays it with (`UMusic.pas`,
 * `SetReplayGain`), so a song previews on the host screen as loud as it is then
 * sung. `10^(gain/20)`, lowered to `1/peak` where there is a peak, so a quiet
 * song is never turned up into clipping; `1` — the file as it is — where the
 * gain is not known.
 *
 * The printed master and trim stay a plain product (`effectiveVolume`): this is
 * a third multiplier on top of them, never printed, and the one Ultrastar
 * Deluxe applies too. It can be above 1, which an element's `volume` cannot,
 * so the sink applies it through a Web Audio gain node.
 */
export function replayGainFactor(
  gainDb: number | null | undefined,
  peak: number | null | undefined,
): number {
  if (typeof gainDb !== "number" || !Number.isFinite(gainDb)) return 1;
  const factor = 10 ** (gainDb / 20);
  if (typeof peak === "number" && Number.isFinite(peak) && peak > 0) {
    return Math.min(factor, 1 / peak);
  }
  return factor;
}

/** How far out of step the element may be before it is worth seeking.
 *  A report's own round trip is well under this, so a playing element is never
 *  nudged by the server merely answering it. */
export const SEEK_TOLERANCE_S = 1.5;

/** Whether an element at `current` should jump to `target`. */
export function seekIfDrifted(current: number, target: number): boolean {
  return Math.abs(current - target) > SEEK_TOLERANCE_S;
}
