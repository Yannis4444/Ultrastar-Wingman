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
 * panel needs to know (ui-guidelines §7, *Share cards*): a look the card
 * cannot draw is a disabled pill over the sentence in `reason`, never a
 * button that does nothing. `resolve…Options` turns what the reader asked for
 * into what is drawn, falling back the way §3.1 says (Cover → Dark, Mosaic →
 * Dark).
 */

export interface Choice<T> {
  value: T;
  ok: boolean;
  /** The sentence the panel prints under a disabled pill; `null` when ok. */
  reason: string | null;
}

/** Whether a picture the card asks for arrived — the panel loads them first. */
export type Loaded = (url: string) => boolean;

const FORMATS: Choice<CardFormat>[] = [
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
  looks: Choice<ScoreLook>[];
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
    looks: [
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
  return { format: requested.format, look };
}

export interface PartyCardChoices {
  formats: Choice<CardFormat>[];
  looks: Choice<PartyLook>[];
  focus: Choice<PartyFocus>[];
  /**
   * *Under the podium* (*Ranking* · *Score strip*), or `null` where the card
   * has no such choice — then `underNote` says why.
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

function mosaicReason(
  content: PartyCardContent,
  focus: PartyFocus,
  loaded: Loaded,
): string | null {
  if (focus === "spread")
    return "The spread is drawn on the dark look, where its dots can be read.";
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
  return requested === "mosaic" && mosaicReason(content, focus, loaded) === null
    ? "mosaic"
    : "dark";
}

function underApplies(
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
  const underNote = underApplies(requested.format, look, focus);
  return {
    formats: FORMATS,
    looks: [
      choice("dark", null),
      choice("mosaic", mosaicReason(content, focus, loaded)),
    ],
    focus: [choice("podium", null), choice("spread", spreadReason(content))],
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
  if (underApplies(requested.format, look, focus) === null) {
    const ranking = rankingReason(content) === null;
    const strip = stripReason(content) === null;
    if (requested.under === "strip" && strip) under = "strip";
    else if (ranking) under = "ranking";
    else if (strip) under = "strip";
  }
  return { format: requested.format, look, focus, under };
}
