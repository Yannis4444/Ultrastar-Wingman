import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SongRead, WishRead } from "../api";
import { listSongsOptions } from "../api/@tanstack/react-query.gen";
import { useFavorites } from "../hooks/useFavorites";
import { useTags } from "../hooks/useTags";
import { useWishlist } from "../hooks/useWishlist";
import { defaultTagCriteria, passesTagCriteria } from "../tags";
import { DICE_FACES } from "../dice";
import { Icon } from "./icons";
import SongCover from "./SongCover";
import SongDetails from "./SongDetails";
import "./SongSpinner.css";

type Scope = "all" | "favorites" | "wishlist" | "weighted";

const SCOPES: [Scope, string][] = [
  ["all", "All songs"],
  ["favorites", "Favorites"],
  ["wishlist", "Wishlist"],
  ["weighted", "Wishlist (weighted)"],
];

/** How many filler covers fly past: enough that the reel never looks short. */
const FILLERS_MIN = 40;
const FILLERS_SPAN = 21;
const SPIN_MS = 5000;
/** The reel stands still for a moment before the winner is revealed. */
const REVEAL_MS = 5500;
const EASING = "cubic-bezier(0.75, 0, 0.1, 1)";

/** The face the die on the SPIN button shows before the first spin: the five. */
const FACE_AT_REST = 4;
/** The die rolls fast at first and slows with the reel: 90ms growing by 6% a
    roll comes to about 25 rolls over the reel's five seconds. */
const ROLL_MS = 90;
const ROLL_SLOWDOWN = 1.06;
/** The number settles before the drum does: the last roll lands about eight
    tenths of a second before the reel stops, so the die comes to rest and the
    covers glide the last stretch under a face that no longer changes. Nothing
    is clamped mid-roll — a roll that would land after this is simply never
    scheduled, so the slowdown keeps its shape to the end. */
const ROLL_STOP_MS = SPIN_MS - 800;

/** The reel entry that is not a song: the logo the empty window shows. */
const LOGO = "logo";
type ReelItem = SongRead | typeof LOGO;

interface Reel {
  /** Remounts the reel element, so no style from the last spin survives. */
  key: number;
  /** Winner first, fillers, then what is on show at the bottom: the previous
      winner, or on the first spin the logo, so it spins away like a cover. */
  items: ReelItem[];
  winner: SongRead;
}

function pool(
  scope: Scope,
  songs: SongRead[],
  favorites: SongRead[],
  wishes: WishRead[],
): SongRead[] {
  if (scope === "all") return songs;
  if (scope === "favorites") return favorites;
  if (scope === "wishlist") return wishes.map((wish) => wish.song);
  // Weighted: a song wished for three times gets three tickets.
  return wishes.flatMap((wish) => Array<SongRead>(wish.count).fill(wish.song));
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the reel can land on, in one line under the *Pick from* select. The
 * empty cases say what to do about it — an empty scope is an invitation, not a
 * shrug.
 */
function poolCaption(
  scope: Scope,
  songs: SongRead[],
  favorites: SongRead[],
  wishes: WishRead[],
): string {
  if (scope === "all") {
    return songs.length === 0
      ? "No songs in the library yet"
      : count(songs.length, "song", "songs");
  }
  if (scope === "favorites") {
    return favorites.length === 0
      ? "Nothing favorited yet"
      : count(favorites.length, "favorite", "favorites");
  }
  if (wishes.length === 0) return "Nothing on the wishlist yet";
  const wished = count(wishes.length, "wished song", "wished songs");
  if (scope === "wishlist") return wished;
  const tickets = wishes.reduce((sum, wish) => sum + wish.count, 0);
  return `${wished} · ${count(tickets, "wish", "wishes")}`;
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

interface SongSpinnerProps {
  /**
   * A fixed pool to spin — the songs of one playlist. The *Pick from* select
   * then has nothing to choose between and goes away, and neither the library
   * nor the favorites are fetched: the caller already holds the songs.
   */
  songs?: SongRead[];
}

/**
 * The casino reel: a stack of covers that scrolls up to the winner. The reel is
 * built once per spin inside the click handler and kept in state — building it
 * during render made the old app reshuffle every cover on any unrelated
 * re-render.
 *
 * The reel stands alone: the *Pick from* select and the pool size above it,
 * the result and the SPIN button below. A finished spin never opens the song
 * modal by itself — the cover and the result line are the way in, and the user
 * takes it.
 */
export default function SongSpinner({ songs: fixed }: SongSpinnerProps) {
  const [scope, setScope] = useState<Scope>("all");
  const [reel, setReel] = useState<Reel | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<SongRead | null>(null);
  const [details, setDetails] = useState<SongRead | null>(null);
  const [face, setFace] = useState(FACE_AT_REST);
  const reelElement = useRef<HTMLDivElement>(null);

  const library = useQuery({
    ...listSongsOptions(),
    enabled: fixed === undefined,
  }).data?.songs;
  const wishes = useWishlist().wishes;
  const favoriteIds = useFavorites({ enabled: fixed === undefined }).ids;
  const tags = useTags();
  // The reel is the song list in another shape, so it hides the same songs
  // (§7). Only the library scope: a wish and a playlist are somebody's own
  // choice, and hiding what they deliberately asked for would be a bug.
  const criteria = useMemo(() => defaultTagCriteria(tags.tags), [tags.tags]);
  const songs = useMemo(
    () =>
      // Nothing to land on until the tags are in: the criteria are empty while
      // they load, so every hidden song would be a candidate — and the reel
      // picks the instant SPIN is pressed. An empty pool disables SPIN exactly
      // as an unloaded library does, which is the state this already is in.
      tags.isPending
        ? []
        : (library ?? []).filter((song) =>
            passesTagCriteria(song.id, tags.bySong, criteria),
          ),
    [library, criteria, tags.bySong, tags.isPending],
  );
  // The favorites come off the *unfiltered* library, like the wishes: somebody
  // hearted these songs on purpose, and a tag folding them away would be a bug
  // (§7). So this pool also never waits for the tag listings.
  const favorites = useMemo(
    () => (library ?? []).filter((song) => favoriteIds.has(song.id)),
    [library, favoriteIds],
  );
  const candidates = fixed ?? pool(scope, songs, favorites, wishes);
  /** An option with nothing behind it cannot be picked; *All songs* always can
      — an empty library is the library's state, not a closed door. */
  const empty = (value: Scope): boolean =>
    value === "all"
      ? false
      : (value === "favorites" ? favorites : wishes).length === 0;

  const reveal = useCallback((song: SongRead, key: number) => {
    setReel({ key, items: [song], winner: song });
    setWinner(song);
    setSpinning(false);
  }, []);

  const spin = () => {
    if (spinning || candidates.length === 0) return;
    const pick = () =>
      candidates[Math.floor(Math.random() * candidates.length)];
    const target = pick();
    const key = (reel?.key ?? 0) + 1;

    if (prefersReducedMotion()) {
      reveal(target, key);
      return;
    }
    const fillers = FILLERS_MIN + Math.floor(Math.random() * FILLERS_SPAN);
    setReel({
      key,
      winner: target,
      items: [target, ...Array.from({ length: fillers }, pick), winner ?? LOGO],
    });
    setSpinning(true);
  };

  useLayoutEffect(() => {
    const element = reelElement.current;
    if (!spinning || reel === null || element === null) return;
    // The element was just mounted parked at the bottom of the reel. Reading a
    // layout property makes the browser adopt that position before the
    // transition is attached — without it the reel jumps straight to the end.
    void element.offsetHeight;
    element.style.transition = `transform ${SPIN_MS}ms ${EASING}`;
    element.style.transform = "translateY(0)";

    const timer = setTimeout(
      () => reveal(reel.winner, reel.key + 1),
      REVEAL_MS,
    );
    return () => clearTimeout(timer);
  }, [spinning, reel, reveal]);

  // The die on the button rolls while the reel runs. Every roll lands on a
  // face other than the current one, so the change is always visible; the
  // reduced-motion path never sets `spinning`, so it never rolls. The rolls
  // stop at `ROLL_STOP_MS`, short of the reel — a die that is still flickering
  // as the drum halts reads as a counter, not as a die.
  useEffect(() => {
    if (!spinning) return;
    let delay = ROLL_MS;
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout>;
    const roll = () => {
      setFace(
        (current) =>
          (current + 1 + Math.floor(Math.random() * (DICE_FACES.length - 1))) %
          DICE_FACES.length,
      );
      elapsed += delay;
      delay *= ROLL_SLOWDOWN;
      if (elapsed + delay > ROLL_STOP_MS) return;
      timer = setTimeout(roll, delay);
    };
    timer = setTimeout(roll, delay);
    return () => clearTimeout(timer);
  }, [spinning]);

  const settled = spinning ? null : winner;

  return (
    <>
      <div className="spinner">
        {/* One quiet select, not a bank of pills: four choices made once an
            evening must not compete with the reel and the SPIN below (§7).
            The `<label>` wraps the select, which is what names it. */}
        {fixed === undefined && (
          <label className="spinner-pick">
            <span className="spinner-pick-label">Pick from</span>
            <select
              className="text-input text-input-quiet spinner-pick-select"
              value={scope}
              disabled={spinning}
              onChange={(event) => setScope(event.target.value as Scope)}
            >
              {SCOPES.map(([value, label]) => (
                <option key={value} value={value} disabled={empty(value)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* The count stays in a fixed pool: it is what the reel can land on,
            not a setting. */}
        <p className="spinner-pool">
          {fixed
            ? count(fixed.length, "song", "songs")
            : poolCaption(scope, songs, favorites, wishes)}
        </p>

        <button
          type="button"
          className="spinner-window"
          disabled={settled === null}
          aria-label={
            settled === null
              ? "Nothing spun yet"
              : `Details for ${settled.title}`
          }
          onClick={() => setDetails(settled)}
        >
          <div
            key={reel?.key}
            ref={reelElement}
            className="spinner-reel"
            style={
              reel
                ? {
                    transform: `translateY(calc(var(--spinner-cover) * -${reel.items.length - 1}))`,
                  }
                : undefined
            }
          >
            {(reel?.items ?? []).map((item, index) =>
              // Duplicates are the point of the weighted scope, so the index is
              // the only usable key here. Eager: a lazy cover inside the
              // overflow-hidden frame would only start loading as it flies by.
              item === LOGO ? (
                <span
                  key={index}
                  className="spinner-cover spinner-cover-logo"
                  aria-hidden="true"
                />
              ) : (
                <SongCover
                  key={index}
                  song={item}
                  className="spinner-cover"
                  loading="eager"
                />
              ),
            )}
          </div>
          <span className="spinner-line" />
        </button>

        {/* The slot is held open before the first spin so SPIN never jumps —
            but it stays empty: the page title already says "Random song". */}
        <div className="spinner-result">
          {winner && (
            <button
              // Keyed on the reel so the rise-in plays for every reveal, not
              // only the first.
              key={reel?.key}
              type="button"
              className="spinner-winner"
              disabled={settled === null}
              onClick={() => setDetails(settled)}
            >
              <span className="spinner-winner-title">{winner.title}</span>
              <span className="spinner-winner-artist">{winner.artist}</span>
            </button>
          )}
        </div>

        <button
          type="button"
          className={
            spinning ? "spinner-spin spinner-spin-running" : "spinner-spin"
          }
          disabled={spinning || candidates.length === 0}
          onClick={spin}
        >
          <Icon name={DICE_FACES[face]} className="spinner-spin-dice" />
          {/* Uppercased in CSS: the caps are the look, "Spin" is the name. */}
          Spin
        </button>
      </div>

      {details && (
        <SongDetails song={details} onClose={() => setDetails(null)} />
      )}
    </>
  );
}
