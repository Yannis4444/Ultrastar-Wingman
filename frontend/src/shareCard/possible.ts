import { CHART_MIN_SCORES } from "../stats";
import type { PartyCardContent, ScoreCardContent } from "./content";
import type {
  CardFormat,
  PartyCardOptions,
  PartyFocus,
  PartyLook,
  ScoreCardOptions,
  ScoreLook,
  UnderPodium,
} from "./layout";

/**
 * What a card can be drawn as, and why not where it cannot — what the share
 * panel needs to know (share-cards.md §5, ui-guidelines §7 *Share cards*).
 * The designs are a carousel, one slide per design in a fixed order (a
 * score's *Dark* · *Cover*, a party's *Podium* · *Strip* · *Mosaic* ·
 * *Spread* · *You*), and a design the card cannot draw is a dimmed slot
 * holding the sentence in `reason`. Every choice that used to change what a
 * slide could draw is a slide of its own (§7.11), so nothing here hangs on
 * the slide in view. The three toggles are the same on every slide; a slide
 * that cannot honour one dims it, and `…SlideToggles` says why.
 * `resolve…Options` turns a slide into what is drawn, falling back the way
 * §3.1 says (Cover → Dark).
 */

export interface Choice<T> {
  value: T;
  ok: boolean;
  /** The sentence the panel prints for a choice it cannot take; `null` when
   * ok. */
  reason: string | null;
}

/** A score card's slides, in the carousel's order. */
export type ScoreDesign = ScoreLook;
export const SCORE_DESIGNS: readonly ScoreDesign[] = ["dark", "cover"];

/** A party card's slides, in the carousel's order. *Podium* and *Strip* are
 * the Dark podium with ranks 4–6 or the score strip under it, *You* is the
 * sharer alone — *Under the podium* and *Only me and my place*, which used to
 * be options, as slides (§7.11). */
export type PartyDesign = "podium" | "strip" | "mosaic" | "spread" | "you";
export const PARTY_DESIGNS: readonly PartyDesign[] = [
  "podium",
  "strip",
  "mosaic",
  "spread",
  "you",
];

/** What one party slide stands for: its look, its focus, what it asks to
 * stand under the podium, and whether it is the sharer alone. */
export interface PartyDesignOptions {
  look: PartyLook;
  focus: PartyFocus;
  under: UnderPodium;
  onlyMe: boolean;
}

export function partyDesignOptions(design: PartyDesign): PartyDesignOptions {
  switch (design) {
    case "strip":
      return { look: "dark", focus: "podium", under: "strip", onlyMe: false };
    case "mosaic":
      return { look: "mosaic", focus: "podium", under: "none", onlyMe: false };
    case "spread":
      return { look: "dark", focus: "spread", under: "none", onlyMe: false };
    case "you":
      // Their own strip under the hero (§4.2), where there is one to draw.
      return { look: "dark", focus: "podium", under: "strip", onlyMe: true };
    default:
      return { look: "dark", focus: "podium", under: "ranking", onlyMe: false };
  }
}

/** Whether a picture the card asks for arrived — the panel loads them first. */
export type Loaded = (url: string) => boolean;

/** Both formats, on every card: there is no 4:5 (share-cards §7.5). */
export const FORMATS: readonly CardFormat[] = ["square", "story"];

/** A Mosaic of fewer covers repeats them so often it reads as a mistake. */
export const MOSAIC_MIN_COVERS = 4;

function choice<T>(value: T, reason: string | null): Choice<T> {
  return { value, ok: reason === null, reason };
}

// ------------------------------------------------------------------ toggles

/** The options row, in its fixed order on every slide of every card. */
export type ShareToggle = "pictures" | "date" | "logo";
export const SHARE_TOGGLES: readonly ShareToggle[] = [
  "pictures",
  "date",
  "logo",
];

/** Why a slide cannot honour a toggle, per toggle; `null` where it can. */
export type ToggleReasons = Record<ShareToggle, string | null>;

/** What the line under the row reads before any toggle has been touched. */
export const TOGGLES_REST =
  "Press a symbol to take it off the card or put it back.";

const TOGGLE_SENTENCES: Record<ShareToggle, { on: string; off: string }> = {
  pictures: {
    on: "Other singers' pictures are on the card.",
    off: "Other singers are drawn as their initials.",
  },
  date: {
    on: "The party's name and date are on the card.",
    off: "The party's name and date are left off.",
  },
  logo: {
    on: "The Wingman logo is on the card.",
    off: "The Wingman logo is left off.",
  },
};

/** The toggle's sentence for the state it is in, or the slide's reason. */
export function toggleSentence(
  toggle: ShareToggle,
  on: boolean,
  reason: string | null,
): string {
  if (reason !== null) return reason;
  return TOGGLE_SENTENCES[toggle][on ? "on" : "off"];
}

const NOBODY_ELSE = "Nobody else is on this card.";

/** A score card's toggles: pictures only reach a singer who is not the
 * sharer — their own picture is always theirs (§1.3). */
export function scoreSlideToggles(content: ScoreCardContent): ToggleReasons {
  return {
    pictures: content.mine ? NOBODY_ELSE : null,
    date: null,
    logo: null,
  };
}

/** A party slide's toggles, asked of the content the slide draws (the
 * sharer's alone on *You*). The spread draws names and no faces. */
export function partySlideToggles(
  design: PartyDesign,
  content: PartyCardContent,
): ToggleReasons {
  let pictures: string | null = null;
  if (design === "spread") pictures = "The spread draws names, not pictures.";
  else if (content.ranking.every((entry) => entry.isMe)) pictures = NOBODY_ELSE;
  return { pictures, date: null, logo: null };
}

// --------------------------------------------------------------- one score

function coverReason(content: ScoreCardContent, loaded: Loaded): string | null {
  if (content.cover.url === null)
    return "This song has left the library, so there is no cover to draw.";
  if (!loaded(content.cover.url))
    return "This song has no cover, so the card stays dark.";
  return null;
}

/** One per slide, in `SCORE_DESIGNS`' order. */
export function scoreCardDesigns(
  content: ScoreCardContent,
  loaded: Loaded,
): Choice<ScoreDesign>[] {
  return [choice("dark", null), choice("cover", coverReason(content, loaded))];
}

export function resolveScoreOptions(
  content: ScoreCardContent,
  requested: ScoreCardOptions,
  loaded: Loaded,
): ScoreCardOptions {
  const look =
    requested.look === "cover" && coverReason(content, loaded) === null
      ? "cover"
      : "dark";
  return { format: requested.format, look, logo: requested.logo };
}

// ---------------------------------------------------------------- a party

function spreadReason(content: PartyCardContent): string | null {
  if (content.ranking.length < 2)
    return "One singer has nobody to compare with.";
  if (content.dots.length < CHART_MIN_SCORES)
    return "The spread needs at least four scores.";
  return null;
}

/** Why the Mosaic slide cannot be drawn. */
function mosaicReason(
  content: PartyCardContent,
  loaded: Loaded,
): string | null {
  const covers = content.covers.filter(loaded).length;
  if (covers < MOSAIC_MIN_COVERS) {
    const have =
      covers === 0
        ? "this party has none"
        : `this party has ${covers === 1 ? "one" : covers}`;
    return `Mosaic needs four different covers, and ${have}.`;
  }
  return null;
}

function stripReason(content: PartyCardContent): string | null {
  return content.dots.length < CHART_MIN_SCORES
    ? "The score strip needs at least four scores."
    : null;
}

/** Ranks 4–6 need a fourth singer; with fewer the podium stands alone. */
function rowsDrawable(content: PartyCardContent): boolean {
  return content.ranking.length > 3;
}

/**
 * One per slide, in `PARTY_DESIGNS`' order. `content` is the whole party,
 * `mine` the sharer alone (`partyCard` with `onlyMe`), which is what *You*
 * draws.
 */
export function partyCardDesigns(
  content: PartyCardContent,
  mine: PartyCardContent,
  loaded: Loaded,
): Choice<PartyDesign>[] {
  return [
    choice("podium", null),
    choice("strip", stripReason(content)),
    choice("mosaic", mosaicReason(content, loaded)),
    choice("spread", spreadReason(content)),
    choice("you", mine.onlyMe ? null : "You did not sing at this party."),
  ];
}

/**
 * What one slide draws. Nothing falls back to another slide's drawing: a
 * *Podium* with three singers or fewer is the podium alone (§4.2), and a
 * *You* below four scores of the sharer's has no strip under the hero.
 */
export function resolvePartyOptions(
  content: PartyCardContent,
  design: PartyDesign,
  format: CardFormat,
  logo: boolean,
  loaded: Loaded,
): PartyCardOptions {
  const { look, focus, under } = partyDesignOptions(design);
  return settlePartyOptions(
    content,
    { format, look, focus, under, logo },
    loaded,
  );
}

/**
 * Options asked for, made drawable against the pictures there are: the
 * renderer asks it again of what actually decoded, so a Mosaic whose covers
 * would not decode is drawn Dark rather than as a scrim over nothing. What
 * cannot stand under the podium is left out, never swapped for the other.
 */
export function settlePartyOptions(
  content: PartyCardContent,
  asked: PartyCardOptions,
  loaded: Loaded,
): PartyCardOptions {
  const { format, logo } = asked;
  const focus: PartyFocus =
    asked.focus === "spread" && spreadReason(content) === null
      ? "spread"
      : "podium";
  const look: PartyLook =
    asked.look === "mosaic" && mosaicReason(content, loaded) === null
      ? "mosaic"
      : "dark";
  let under: UnderPodium = "none";
  if (focus === "podium" && look === "dark") {
    if (asked.under === "ranking" && rowsDrawable(content)) under = "ranking";
    if (asked.under === "strip" && stripReason(content) === null)
      under = "strip";
  }
  return { format, look, focus, under, logo };
}
