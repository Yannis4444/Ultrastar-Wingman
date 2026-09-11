import { useEffect, useState } from "react";

/**
 * The wall clock, once a second, for as long as something is actually counting.
 *
 * `active` is the whole point: a component that draws no time must not
 * re-render every second, and in a room full of phones that is not a small
 * thing. It was `CurrentlyPlaying`'s private `useElapsedSeconds`; the host's
 * sing clock and the player's music clock now share the one implementation.
 *
 * It also stops while the tab is hidden. A backgrounded phone in somebody's
 * pocket has nothing to draw, and the browser throttles the timer anyway — the
 * `visibilitychange` listener is what makes the first frame after it comes back
 * right rather than up to a second stale.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    let ticker: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      setNow(Date.now());
      ticker = setInterval(() => setNow(Date.now()), 1000);
    };
    const stop = () => {
      if (ticker !== undefined) clearInterval(ticker);
      ticker = undefined;
    };
    const follow = () => (document.hidden ? stop() : start());
    follow();
    document.addEventListener("visibilitychange", follow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", follow);
    };
  }, [active]);

  return now;
}
