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
 * panel needs to know (ui-guidelines §7, *Share cards*). The panel's designs
 * are a carousel, one slide per design in a fixed order (a score's *Dark* ·
 * *Cover*, a party's *Dark* · *Mosaic* · *Spread*, the focus folded in), and a
 * design the card cannot draw is a dimmed slot holding the sentence in
 * `reason`; a choice of *Under the podium* it cannot take is a disabled pill
 * over its sentence. `resolve…Options` turns what the reader asked for into
 * what is drawn, falling back the way §3.1 says (Cover → Dark, Mosaic →
 * Dark). *Wingman logo* is drawable on every card and is carried through as
 * asked.
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

/** A party card's slides, in the carousel's order: the look and the focus
 * as one choice, because the spread is drawn on Dark alone. */
export type PartyDesign = "dark" | "mosaic" | "spread";
export const PARTY_DESIGNS: readonly PartyDesign[] = [
  "dark",
  "mosaic",
  "spread",
];

/** The look and the focus one party slide stands for. */
export function partyDesignOptions(design: PartyDesign): {
  look: PartyLook;
  focus: PartyFocus;
} {
  if (design === "mosaic") return { look: "mosaic", focus: "podium" };
  if (design === "spread") return { look: "dark", focus: "spread" };
  return { look: "dark", focus: "podium" };
}

/** Whether a picture the card asks for arrived — the panel loads them first. */
export type Loaded = (url: string) => boolean;

/** Both formats, on every card: there is no 4:5 (share-cards §7.5). */
export const FORMATS: Choice<CardFormat>[] = [
  { value: "square", ok: true, reason: null },
  { value: "story", ok: true, reason: null },
];

/** A Mosaic of fewer covers repeats them so often it reads as a mistake. */
export const MOSAIC_MIN_COVERS = 4;

function choice<T>(value: T, reason: string | null): Choice<T> {
  return { value, ok: reason === null, reason };
}

export interface ScoreCardChoices {
  formats: Choice<CardFormat>[];
  /** One per slide, in `SCORE_DESIGNS`' order. */
  designs: Choice<ScoreDesign>[];
}

function coverReason(content: ScoreCardContent, loaded: Loaded): string | null {
  if (content.cover.url === null)
    return "This song has left the library, so there is no cover to draw.";
  if (!loaded(content.cover.url))
    return "This song has no cover, so the card stays dark.";
  return null;
}

export function scoreCardChoices(
  content: ScoreCardContent,
  loaded: Loaded,
): ScoreCardChoices {
  return {
    formats: FORMATS,
    designs: [
      choice("dark", null),
      choice("cover", coverReason(content, loaded)),
    ],
  };
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

export interface PartyCardChoices {
  formats: Choice<CardFormat>[];
  /** One per slide, in `PARTY_DESIGNS`' order; whether each can be drawn
   * does not hang on the options asked for. */
  designs: Choice<PartyDesign>[];
  /**
   * *Under the podium* (*Ranking* · *Score strip*) on the card the options
   * ask for, or `null` where it has no such choice — then `underNote` says
   * why.
   */
  under: Choice<Exclude<UnderPodium, "none">>[] | null;
  underNote: string | null;
  /** *Only me and my place*: possible only for somebody who sang there. */
  onlyMe: Choice<boolean>;
}

function spreadReason(content: PartyCardContent): string | null {
  if (content.onlyMe)
    return "Only me and my place shows one singer, and the spread compares several.";
  if (content.ranking.length < 2)
    return "One singer has nobody to compare with.";
  if (content.dots.length < CHART_MIN_SCORES)
    return "The spread needs at least four scores.";
  return null;
}

/** Why the Mosaic slide cannot be drawn. It is always a podium card: the
 * spread is a slide of its own, drawn on Dark (`resolveLook`). */
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

function rankingReason(content: PartyCardContent): string | null {
  if (content.onlyMe) return "Only me and my place leaves nobody else to rank.";
  if (content.ranking.length <= 3)
    return "With three singers or fewer the podium is the whole ranking.";
  return null;
}

function stripReason(content: PartyCardContent): string | null {
  return content.dots.length < CHART_MIN_SCORES
    ? "The score strip needs at least four scores."
    : null;
}

function resolveFocus(
  content: PartyCardContent,
  requested: PartyFocus,
): PartyFocus {
  return requested === "spread" && spreadReason(content) === null
    ? "spread"
    : "podium";
}

function resolveLook(
  content: PartyCardContent,
  requested: PartyLook,
  focus: PartyFocus,
  loaded: Loaded,
): PartyLook {
  // The spread is drawn on Dark, where its dots can be read.
  return requested === "mosaic" &&
    focus === "podium" &&
    mosaicReason(content, loaded) === null
    ? "mosaic"
    : "dark";
}

/** Why a party slide has no *Under the podium* choice, or `null` where it has
 * one: a square Dark podium. Asked of the design itself, so a dimmed slot
 * says what its design would do — `partyCardChoices` asks it of what is
 * drawn. */
export function underPodiumNote(
  format: CardFormat,
  look: PartyLook,
  focus: PartyFocus,
): string | null {
  if (focus === "spread") return "The spread takes the place of the podium.";
  if (format === "story")
    return "A story has room for the ranking and the strip both.";
  if (look === "mosaic")
    return "Mosaic keeps the podium alone over the covers.";
  return null;
}

export function partyCardChoices(
  content: PartyCardContent,
  requested: PartyCardOptions,
  loaded: Loaded,
): PartyCardChoices {
  const focus = resolveFocus(content, requested.focus);
  const look = resolveLook(content, requested.look, focus, loaded);
  const underNote = underPodiumNote(requested.format, look, focus);
  return {
    formats: FORMATS,
    designs: [
      choice("dark", null),
      choice("mosaic", mosaicReason(content, loaded)),
      choice("spread", spreadReason(content)),
    ],
    under:
      underNote === null
        ? [
            choice("ranking", rankingReason(content)),
            choice("strip", stripReason(content)),
          ]
        : null,
    underNote,
    onlyMe: choice(
      true,
      content.mayOnlyMe ? null : "You did not sing at this party.",
    ),
  };
}

export function resolvePartyOptions(
  content: PartyCardContent,
  requested: PartyCardOptions,
  loaded: Loaded,
): PartyCardOptions {
  const focus = resolveFocus(content, requested.focus);
  const look = resolveLook(content, requested.look, focus, loaded);
  let under: UnderPodium = "none";
  if (underPodiumNote(requested.format, look, focus) === null) {
    const ranking = rankingReason(content) === null;
    const strip = stripReason(content) === null;
    if (requested.under === "strip" && strip) under = "strip";
    else if (ranking) under = "ranking";
    else if (strip) under = "strip";
  }
  return { format: requested.format, look, focus, under, logo: requested.logo };
}
