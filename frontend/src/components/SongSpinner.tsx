import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SongRead, WishRead } from "../api";
import { listSongsOptions } from "../api/@tanstack/react-query.gen";
import { useWishlist } from "../hooks/useWishlist";
import { DICE_FACES } from "../dice";
import { Icon } from "./icons";
import SongCover from "./SongCover";
import SongDetails from "./SongDetails";
import "./SongSpinner.css";

type Scope = "all" | "wishlist" | "weighted";

const SCOPES: [Scope, string][] = [
  ["all", "All songs"],
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

function pool(scope: Scope, songs: SongRead[], wishes: WishRead[]): SongRead[] {
  if (scope === "all") return songs;
  if (scope === "wishlist") return wishes.map((wish) => wish.song);
  // Weighted: a song wished for three times gets three tickets.
  return wishes.flatMap((wish) => Array<SongRead>(wish.count).fill(wish.song));
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the reel can land on, in one line under the scope pills. The empty
 * cases say what to do about it — an empty scope is an invitation, not a
 * shrug.
 */
function poolCaption(
  scope: Scope,
  songs: SongRead[],
  wishes: WishRead[],
): string {
  if (scope === "all") {
    return songs.length === 0
      ? "No songs in the library yet"
      : count(songs.length, "song", "songs");
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

/**
 * The casino reel: a stack of covers that scrolls up to the winner. The reel is
 * built once per spin inside the click handler and kept in state — building it
 * during render made the old app reshuffle every cover on any unrelated
 * re-render.
 *
 * The reel stands alone: scope pills and the pool size above it, the result
 * and the SPIN button below. A finished spin never opens the song modal by
 * itself — the cover and the result line are the way in, and the user takes
 * it.
 */
export default function SongSpinner() {
  const [scope, setScope] = useState<Scope>("all");
  const [reel, setReel] = useState<Reel | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<SongRead | null>(null);
  const [details, setDetails] = useState<SongRead | null>(null);
  const [face, setFace] = useState(FACE_AT_REST);
  const reelElement = useRef<HTMLDivElement>(null);

  const songs = useQuery(listSongsOptions()).data?.songs ?? [];
  const wishes = useWishlist().wishes;
  const candidates = pool(scope, songs, wishes);

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
  // reduced-motion path never sets `spinning`, so it never rolls.
  useEffect(() => {
    if (!spinning) return;
    let delay = ROLL_MS;
    let timer: ReturnType<typeof setTimeout>;
    const roll = () => {
      setFace(
        (current) =>
          (current + 1 + Math.floor(Math.random() * (DICE_FACES.length - 1))) %
          DICE_FACES.length,
      );
      delay *= ROLL_SLOWDOWN;
      timer = setTimeout(roll, delay);
    };
    timer = setTimeout(roll, delay);
    return () => clearTimeout(timer);
  }, [spinning]);

  const settled = spinning ? null : winner;

  return (
    <>
      <div className="spinner">
        <fieldset className="spinner-scopes">
          <legend className="visually-hidden">Pick from</legend>
          {SCOPES.map(([value, label]) => (
            <label key={value} className="spinner-scope">
              {/* Hidden, not removed: the pill is the visible affordance, the
                  radio keeps the keyboard and screen-reader semantics. */}
              <input
                className="visually-hidden"
                type="radio"
                name="spinner-scope"
                value={value}
                checked={scope === value}
                disabled={spinning || (value !== "all" && wishes.length === 0)}
                onChange={() => setScope(value)}
              />
              <span className="spinner-scope-text">{label}</span>
            </label>
          ))}
        </fieldset>
        <p className="spinner-pool">{poolCaption(scope, songs, wishes)}</p>

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
