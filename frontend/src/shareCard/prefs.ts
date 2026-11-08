import type { CardFormat, ScoreLook } from "./layout";
import {
  PLAYER_DESIGNS,
  type PartyDesign,
  type PlayerDesign,
} from "./possible";

/**
 * What the share panel remembers per device (share-cards.md §5): the last
 * format, design and toggles. A per-viewer convenience, so it lives in
 * `localStorage` behind try/catch and the panel works the same without it —
 * a private window, blocked storage, or a value an older build wrote.
 */

/** The party designs worth opening on again. *Spread* and *You* are not
 * kept (§5): the panel opens on one of these, the last one in view. */
export type RememberedPartyDesign = Extract<
  PartyDesign,
  "podium" | "strip" | "mosaic"
>;
export const REMEMBERED_PARTY_DESIGNS: readonly RememberedPartyDesign[] = [
  "podium",
  "strip",
  "mosaic",
];

export interface SharePrefs {
  format: CardFormat;
  scoreLook: ScoreLook;
  partyDesign: RememberedPartyDesign;
  /** All three of a player card's designs are kept (share-cards §5). */
  playerDesign: PlayerDesign;
  otherPictures: boolean;
  partyNameAndDate: boolean;
}

export const DEFAULT_PREFS: SharePrefs = {
  format: "square",
  scoreLook: "dark",
  partyDesign: "podium",
  playerDesign: "histogram",
  otherPictures: true,
  partyNameAndDate: true,
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
 * does not know falls back to its default and takes nothing else with it. An
 * older build's `partyLook` of `mosaic` is still a Mosaic; its `onlyMe` is
 * read as nothing, *You* being a slide that is not remembered, and its `logo`
 * too, the logo being on every card. */
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
  const olderParty = stored.partyLook === "mosaic" ? "mosaic" : d.partyDesign;
  return {
    format: pick(stored.format, ["square", "story"], d.format),
    scoreLook: pick(stored.scoreLook, ["dark", "cover"], d.scoreLook),
    partyDesign: pick(stored.partyDesign, REMEMBERED_PARTY_DESIGNS, olderParty),
    playerDesign: pick(stored.playerDesign, PLAYER_DESIGNS, d.playerDesign),
    otherPictures: flag(stored.otherPictures, d.otherPictures),
    partyNameAndDate: flag(stored.partyNameAndDate, d.partyNameAndDate),
  };
}

export function writePrefs(prefs: SharePrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered, then; the panel still works.
  }
}
