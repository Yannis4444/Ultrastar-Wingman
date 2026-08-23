import { useQuery } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SongRead, WishRead } from "../api";
import { listSongsOptions } from "../api/@tanstack/react-query.gen";
import { useWishlist } from "../hooks/useWishlist";
import SongCover from "./SongCover";
import SongDetails from "./SongDetails";
import "./Spinner.css";

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

interface Reel {
  /** Remounts the reel element, so no style from the last spin survives. */
  key: number;
  /** Winner first, fillers, then the song currently on show at the bottom. */
  items: SongRead[];
  winner: SongRead;
}

function pool(scope: Scope, songs: SongRead[], wishes: WishRead[]): SongRead[] {
  if (scope === "all") return songs;
  if (scope === "wishlist") return wishes.map((wish) => wish.song);
  // Weighted: a song wished for three times gets three tickets.
  return wishes.flatMap((wish) => Array<SongRead>(wish.count).fill(wish.song));
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
 */
export default function Spinner() {
  const [scope, setScope] = useState<Scope>("all");
  const [reel, setReel] = useState<Reel | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<SongRead | null>(null);
  const [details, setDetails] = useState<SongRead | null>(null);
  const reelElement = useRef<HTMLDivElement>(null);

  const songs = useQuery(listSongsOptions()).data?.songs ?? [];
  const wishes = useWishlist().wishes;
  const candidates = pool(scope, songs, wishes);

  const reveal = useCallback((song: SongRead, key: number) => {
    setReel({ key, items: [song], winner: song });
    setWinner(song);
    setSpinning(false);
    setDetails(song);
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
      items: [
        target,
        ...Array.from({ length: fillers }, pick),
        winner ?? pick(),
      ],
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

  return (
    <>
      <section
        className={spinning ? "spinner spinner-spinning" : "spinner"}
        aria-label="Random song"
      >
        <button
          type="button"
          className="spinner-winner"
          disabled={winner === null || spinning}
          onClick={() => setDetails(winner)}
        >
          <span className="spinner-winner-title">
            {winner?.title ?? "Random song"}
          </span>
          <span className="spinner-winner-artist">
            {winner?.artist ?? "Spin the reel"}
          </span>
        </button>

        <div className="spinner-window">
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
            {(reel?.items ?? []).map((song, index) => (
              // Duplicates are the point of the weighted scope, so the index is
              // the only usable key here.
              <SongCover key={index} song={song} className="spinner-cover" />
            ))}
          </div>
          <span className="spinner-line" />
        </div>

        <div className="spinner-controls">
          {SCOPES.map(([value, label]) => (
            <label key={value} className="spinner-scope">
              <input
                type="radio"
                name="spinner-scope"
                value={value}
                checked={scope === value}
                disabled={spinning || (value !== "all" && wishes.length === 0)}
                onChange={() => setScope(value)}
              />
              {label}
            </label>
          ))}
          <button
            type="button"
            className="spinner-spin"
            // The label changes while the reel runs; the name must not.
            aria-label="Spin"
            disabled={spinning || candidates.length === 0}
            onClick={spin}
          >
            {spinning ? "…" : "SPIN"}
          </button>
        </div>
      </section>

      {details && (
        <SongDetails song={details} onClose={() => setDetails(null)} />
      )}
    </>
  );
}
