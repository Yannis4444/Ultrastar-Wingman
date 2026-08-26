import type { IconName } from "./components/icons";

/** The six faces of the die, one to six pips; `dice` itself is the five. */
export const DICE_FACES: readonly IconName[] = [
  "dice-1",
  "dice-2",
  "dice-3",
  "dice-4",
  "dice",
  "dice-6",
];

/** A face at random — the die on Home shows a different one on every load. */
export function randomDiceFace(): IconName {
  return DICE_FACES[Math.floor(Math.random() * DICE_FACES.length)];
}
