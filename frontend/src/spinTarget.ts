/**
 * Where the Random song page's reel runs (ui-guidelines §7, Random song): on
 * this phone, or on the host screen for the whole room. The page's first row,
 * two pills, kept per device the way the song list's order is (`songSort.ts`).
 */

const TARGET_STORAGE_KEY = "wingman.spinTarget";

export const SPIN_TARGETS = [
  { value: "local", label: "This screen" },
  { value: "host", label: "Host screen" },
] as const;

export type SpinTarget = (typeof SPIN_TARGETS)[number]["value"];

export const DEFAULT_SPIN_TARGET: SpinTarget = "local";

export function isSpinTarget(value: unknown): value is SpinTarget {
  return SPIN_TARGETS.some((option) => option.value === value);
}

/**
 * Where this device spun last, or this screen for anything else. A kept *Host
 * screen* only chooses the pill: the room's selection is taken by the first
 * SPIN, never by opening the page.
 */
export function readSpinTarget(): SpinTarget {
  try {
    const stored = window.localStorage.getItem(TARGET_STORAGE_KEY);
    return isSpinTarget(stored) ? stored : DEFAULT_SPIN_TARGET;
  } catch {
    return DEFAULT_SPIN_TARGET;
  }
}

export function writeSpinTarget(target: SpinTarget): void {
  try {
    window.localStorage.setItem(TARGET_STORAGE_KEY, target);
  } catch {
    // Private mode or a full quota: the choice is a convenience, not a feature.
  }
}
