import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SongRead } from "../api";
import SongCover from "./SongCover";
import "./SongReel.css";

/** How many filler covers fly past: enough that the reel never looks short. */
const FILLERS_MIN = 40;
const FILLERS_SPAN = 21;
/** How long the covers glide. The die's roll and the tumble in the stylesheet
    are both cut to this clock. */
export const SPIN_MS = 5000;
/** The reel stands still for a moment before the winner is revealed. The host
    reel and the phone waiting on it both settle on this. */
export const REVEAL_MS = 5500;
const EASING = "cubic-bezier(0.75, 0, 0.1, 1)";

/** The reel entry that is not a song: the logo the empty window shows. */
const LOGO = "logo";
type ReelItem = SongRead | typeof LOGO;

interface Reel {
  /** Remounts the reel element, so no style from the last spin survives. */
  key: number;
  /** The spin this reel is, so a cut-short meant for it never lands a newer one. */
  spinId: number;
  /** Winner first, fillers, then what is on show at the bottom: the previous
      winner, or on the first spin the logo, so it spins away like a cover. */
  items: ReelItem[];
  winner: SongRead;
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

/**
 * The empty window's tile: black with the logo on it, what the reel shows
 * before anything has spun and what the first spin starts moving from — and
 * what the Random song page's window stands on while the reel runs on the host
 * screen, so nothing is given away before the TV's reel lands. Home's idle
 * player draws it too. Sized by the caller's class; in the reel it is one
 * `spinner-cover`.
 */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span
      className={
        className ? `spinner-cover-logo ${className}` : "spinner-cover-logo"
      }
      aria-hidden="true"
    />
  );
}

/** One spin: a new `id` starts the reel, and it lands on `winner`. */
export interface Spin {
  id: number;
  winner: SongRead;
}

interface SongReelProps {
  /**
   * The spin to show, `null` before the first one — the empty window with the
   * logo in it. The reel starts on every `id` it has not seen and lands on the
   * `winner` that came with it; the same id with another `winner` object is
   * the same spin (a broadcast redrawing the selection it belongs to) and
   * moves nothing.
   */
  spin: Spin | null;
  /**
   * What the covers flying past are drawn from. The reel picks among them at
   * random, duplicates and all — a song in here three times flies past about
   * three times as often, which is what the weighted scope is. With nothing to
   * pick from, the winner stands in for the fillers.
   */
  fillers: SongRead[];
  /**
   * The spin is already over. At the start of a spin: draw its winner at rest,
   * no animation and no `onSettled` — a host screen turned on after the reel
   * landed. Turning true *while the reel runs*: cut the spin short — the covers
   * stop, the winner stands in the window and `onSettled` fires at once — a
   * press in the room that skipped the animation.
   */
  settled?: boolean;
  /** The reel came to rest, `REVEAL_MS` after the spin started — or at once,
      for a reader who asked for reduced motion. */
  onSettled?: (winner: SongRead) => void;
  /**
   * What a tap on the settled cover does. With it the window is a button and
   * the way into the song; without it — the TV — it is a plain frame.
   */
  onOpen?: (song: SongRead) => void;
}

/**
 * The casino reel: a stack of covers that scrolls up to the winner, in a
 * window one cover high. Sized by `--spinner-cover`, which the caller sets on
 * a wrapper — the Random song page at the phone's size, the host screen at the
 * cover's — and nothing in here overrides.
 *
 * The reel is built once per spin inside an effect and kept in state —
 * building it during render made the old app reshuffle every cover on any
 * unrelated re-render. It remembers what it last landed on, so the next spin
 * starts from that cover the way the first one starts from the logo.
 */
export default function SongReel({
  spin,
  fillers,
  settled = false,
  onSettled,
  onOpen,
}: SongReelProps) {
  const [reel, setReel] = useState<Reel | null>(null);
  const [spinning, setSpinning] = useState(false);
  // What the window shows at rest — the bottom entry of the next reel.
  const [shown, setShown] = useState<SongRead | null>(null);
  const reelElement = useRef<HTMLDivElement>(null);

  // The spin effect keys on the id alone: the winner object, the filler list
  // and the callbacks change identity on every render of the caller, and a
  // re-render is not a spin. They are read through refs at the moment the id
  // arrives, and `onSettled` at the moment the reel lands.
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const fillersRef = useRef(fillers);
  fillersRef.current = fillers;
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // One key per reel element ever mounted, the spinning and the settled alike.
  const keyRef = useRef(0);

  const spinId = spin?.id ?? null;

  useEffect(() => {
    const current = spinRef.current;
    if (spinId === null || current === null) return;
    const target = current.winner;
    keyRef.current += 1;
    const key = keyRef.current;

    if (settledRef.current || prefersReducedMotion()) {
      // At rest on the winner, and the caller is told only when something
      // actually spun: a reel drawn settled has nothing to report.
      setReel({ key, spinId, items: [target], winner: target });
      setShown(target);
      setSpinning(false);
      if (!settledRef.current) onSettledRef.current?.(target);
      return;
    }
    const pool = fillersRef.current.length > 0 ? fillersRef.current : [target];
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    const count = FILLERS_MIN + Math.floor(Math.random() * FILLERS_SPAN);
    setReel({
      key,
      spinId,
      winner: target,
      items: [
        target,
        ...Array.from({ length: count }, pick),
        shownRef.current ?? LOGO,
      ],
    });
    setSpinning(true);
  }, [spinId]);

  // The reveal timer of the running spin, owned here so the cut-short path can
  // clear it itself rather than trust the order effects clean up in.
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The reel comes to rest on `winner`: the timer's landing and the cut-short
   * one alike. A fresh key: the settled reel is one cover with no transform,
   * and a remount is what guarantees no style from the spin survives on it.
   * Stable, so the layout effect below never re-arms itself over it.
   */
  const land = useCallback((landing: Reel) => {
    if (revealTimer.current !== null) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    const { spinId, winner } = landing;
    keyRef.current += 1;
    setReel({ key: keyRef.current, spinId, items: [winner], winner });
    setShown(winner);
    setSpinning(false);
    onSettledRef.current?.(winner);
  }, []);

  useLayoutEffect(() => {
    const element = reelElement.current;
    if (!spinning || reel === null || element === null) return;
    // The element was just mounted parked at the bottom of the reel. Reading a
    // layout property makes the browser adopt that position before the
    // transition is attached — without it the reel jumps straight to the end.
    void element.offsetHeight;
    element.style.transition = `transform ${SPIN_MS}ms ${EASING}`;
    element.style.transform = "translateY(0)";

    revealTimer.current = setTimeout(() => land(reel), REVEAL_MS);
    return () => {
      if (revealTimer.current !== null) clearTimeout(revealTimer.current);
      revealTimer.current = null;
    };
  }, [spinning, reel, land]);

  // The spin is declared over from outside while the covers still fly: a press
  // in the room skipped the animation, and the TV must not keep it running for
  // seconds after the phone has shown the song. The transition comes off and
  // the reel is put at its end before the landing remounts it, so the frame in
  // between never shows a cover mid-glide.
  useEffect(() => {
    if (!settled || !spinning || reel === null) return;
    // A newer spin arrived settled in the same render: the spin effect above
    // has drawn it at rest already, and this reel is the one it replaced.
    if (reel.spinId !== spinId) return;
    const element = reelElement.current;
    if (element !== null) {
      element.style.transition = "";
      element.style.transform = "translateY(0)";
    }
    land(reel);
  }, [settled, spinning, reel, spinId, land]);

  const resting = spinning ? null : shown;

  const inner = (
    <>
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
            <LogoTile key={index} className="spinner-cover" />
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
    </>
  );

  if (onOpen === undefined) {
    return <div className="spinner-window">{inner}</div>;
  }
  return (
    <button
      type="button"
      className="spinner-window"
      disabled={resting === null}
      aria-label={
        resting === null ? "Nothing spun yet" : `Details for ${resting.title}`
      }
      onClick={() => {
        if (resting !== null) onOpen(resting);
      }}
    >
      {inner}
    </button>
  );
}
