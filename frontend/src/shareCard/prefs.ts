import type { CardFormat, PartyLook, ScoreLook } from "./layout";

/**
 * What the share panel remembers per device (share-cards.md §5): the last
 * format, look and toggles. A per-viewer convenience, so it lives in
 * `localStorage` behind try/catch and the panel works the same without it —
 * a private window, blocked storage, or a value an older build wrote.
 */
export interface SharePrefs {
  format: CardFormat;
  scoreLook: ScoreLook;
  partyLook: PartyLook;
  otherPictures: boolean;
  partyNameAndDate: boolean;
  onlyMe: boolean;
}

export const DEFAULT_PREFS: SharePrefs = {
  format: "square",
  scoreLook: "dark",
  partyLook: "dark",
  otherPictures: true,
  partyNameAndDate: true,
  onlyMe: false,
};

export const PREFS_KEY = "wingman.shareCard";

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** The remembered choices, each one checked on its own: a value this build
 * does not know falls back to its default and takes nothing else with it. */
export function readPrefs(): SharePrefs {
  let stored: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object")
      stored = parsed as Record<string, unknown>;
  } catch {
    // Storage that cannot be read is storage that holds nothing.
  }
  const d = DEFAULT_PREFS;
  return {
    format: pick(stored.format, ["square", "story"], d.format),
    scoreLook: pick(stored.scoreLook, ["dark", "cover"], d.scoreLook),
    partyLook: pick(stored.partyLook, ["dark", "mosaic"], d.partyLook),
    otherPictures: flag(stored.otherPictures, d.otherPictures),
    partyNameAndDate: flag(stored.partyNameAndDate, d.partyNameAndDate),
    onlyMe: flag(stored.onlyMe, d.onlyMe),
  };
}

export function writePrefs(prefs: SharePrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered, then; the panel still works.
  }
}
