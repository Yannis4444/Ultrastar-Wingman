import { useEffect, useState } from "react";
import type { IconName } from "../components/icons";
import { SPIN_MS } from "../components/SongReel";
import { DICE_FACES } from "../dice";

/** The face the die shows before the first spin: the five. */
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

/**
 * The face of a die that rolls while `spinning` — the one on the SPIN button
 * under the reel. Every roll lands on a face other than the current one, so
 * the change is always visible. The rolls stop at `ROLL_STOP_MS`, short of the
 * reel — a die that is still flickering as the drum halts reads as a counter,
 * not as a die — and the face then stays where it landed until the next spin.
 */
export function useDieRoll(spinning: boolean): IconName {
  const [face, setFace] = useState(FACE_AT_REST);

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

  return DICE_FACES[face];
}
