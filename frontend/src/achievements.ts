/**
 * What every surface that draws a badge needs to know about one: where its
 * picture comes from, what it may be called, how far along somebody is — and
 * the words the editor puts on a condition.
 *
 * Plain functions and plain tables, no React: the admin page, the user page and
 * the host screen all read the same ones, and `achievements.md` is the ground
 * truth behind every sentence here.
 */

import type { AchievementRead, Condition, SelectorClause } from "./api";
import { ICON_PATHS, type IconName } from "./components/icons";
import { tagColorClass } from "./tags";

/**
 * The icon endpoint of one achievement, with the same cache-busting shape
 * `avatarUrl` has.
 *
 * Unlike a player, an achievement carries **no version**: `AchievementRead` has
 * `has_image` and nothing else, and the endpoint sets no cache headers. So the
 * URL is stable and a replaced picture appears once the browser's copy goes
 * stale — the "not knowing" case of `avatars.asPlayer`. A caller that has just
 * uploaded one and knows the picture moved passes a `version` of its own to get
 * the new bytes at once.
 */
export function achievementIconUrl(
  achievementId: string,
  version?: number | null,
): string {
  const url = `/api/v1/achievements/${encodeURIComponent(achievementId)}/icon`;
  return version === undefined || version === null
    ? url
    : `${url}?v=${version}`;
}

/**
 * The glyph of an achievement. Like a tag's, the backend checks only the *shape*
 * of an icon name — it ships no icon list — so an achievement can name a glyph
 * this frontend has not got, and may have no icon at all. Both fall back to the
 * feature's own glyph (§3), never to an empty `<path>`.
 */
export function achievementGlyph(icon: string | null): IconName {
  return icon !== null && icon in ICON_PATHS ? (icon as IconName) : "trophy";
}

/**
 * The class that paints an achievement in its colour. The same four a tag has
 * and the same classes — one colour vocabulary for the whole app, because a
 * badge is drawn beside the tags and the backend imports `TAG_COLORS` for
 * exactly this reason (`achievements/model.py`).
 */
export function achievementColorClass(color: string): string {
  return tagColorClass(color);
}

/** What a masked row is called, since its own name is what is being kept back. */
export const MASKED_NAME = "Hidden achievement";

/** And the one line under it. Never what it is for — that is the surprise. */
export const MASKED_DESCRIPTION = "Earn it to find out what this is.";

/**
 * Whether the API kept this one back: a `hidden` achievement the caller has not
 * earned arrives with its name, description and icon blanked (achievements.md).
 * The empty name is the signal — a real one is never empty, the backend refuses
 * it — so no surface has to work out for itself whether it may draw a row.
 */
export function isMasked(achievement: AchievementRead): boolean {
  return achievement.name === "";
}

/** What to write where the name goes, masked or not. */
export function achievementName(achievement: AchievementRead): string {
  return isMasked(achievement) ? MASKED_NAME : achievement.name;
}

/** And under it: the sentence, or the one line that stands in for it. */
export function achievementDescription(achievement: AchievementRead): string {
  return isMasked(achievement) ? MASKED_DESCRIPTION : achievement.description;
}

/**
 * How far along somebody is, as a fraction between 0 and 1 — the width of a bar.
 * `null` when there is nothing to draw: a masked row, an achievement whose
 * conditions are none of them monotone, or a backend older than this build. A
 * target of zero is no bar either — everybody would be at 1 before they started.
 */
export function progressFraction(
  current: number | null,
  target: number | null,
): number | null {
  if (current === null || target === null || target <= 0) return null;
  return Math.min(Math.max(current / target, 0), 1);
}

/**
 * The same progress in words: `"7 / 10"`. Plain numbers, no grouping — every
 * other number in the app is drawn plain, and a score of `9,000` beside one of
 * `9000` would read as two different conventions.
 */
export function progressLabel(
  current: number | null,
  target: number | null,
): string | null {
  if (current === null || target === null || target <= 0) return null;
  return `${Math.min(current, target)} / ${target}`;
}

/* --------------------------------------------------------- the editor's words
   One vocabulary for the two editor bundles, declared here so the admin page,
   the condition editor and the song selector all call the same thing by the
   same name. Every table is keyed off the generated types, so a metric or an
   operator the backend grows breaks the build rather than going unnoticed. */

/** What a condition looks at: everything ever, or one party (achievements.md). */
export const CONDITION_SCOPES = ["global", "session"] as const;

export const SCOPE_LABELS: Record<NonNullable<Condition["scope"]>, string> = {
  global: "Ever",
  session: "In one party",
};

/** What each scope means, for the line under the select. */
export const SCOPE_DESCRIPTIONS: Record<
  NonNullable<Condition["scope"]>,
  string
> = {
  global: "Every score the singer has ever got.",
  session: "It has to happen inside one party.",
};

/** The metrics, in the order the editor offers them: the score ones first, then
 *  the counting ones, and the mean last — it is the one that needs a thought. */
export const METRICS = [
  "any_score",
  "sum_of_scores",
  "number_of_sings",
  "number_of_scores",
  "different_songs",
  "different_artists",
  "average_score",
] as const;

export const METRIC_LABELS: Record<Condition["metric"], string> = {
  any_score: "Any score",
  sum_of_scores: "Sum of scores",
  number_of_sings: "Number of sings",
  number_of_scores: "Number of scores",
  different_songs: "Different songs",
  different_artists: "Different artists",
  average_score: "Average score",
};

/** One line each on what is actually counted — the traps are all in here. */
export const METRIC_DESCRIPTIONS: Record<Condition["metric"], string> = {
  any_score: "Some one score. Which end is meant is what the comparator says.",
  sum_of_scores: "Every score added up.",
  number_of_sings: "How many songs were sung. A duet scored twice is one.",
  number_of_scores: "How many scores there are.",
  different_songs: "How many different songs.",
  different_artists: "How many different artists.",
  average_score: "The mean, rounded down. Nobody with no scores has one.",
};

/** The five comparators, from the loosest upward. */
export const COMPARATORS = [">=", ">", "=", "<=", "<"] as const;

export const COMPARATOR_LABELS: Record<Condition["comparator"], string> = {
  ">=": "at least",
  ">": "more than",
  "=": "exactly",
  "<=": "at most",
  "<": "less than",
};

/**
 * The number a condition works towards, or `null` when it has none. Mirrors
 * `_target` in the backend's `evaluate.py`: only `>` and `>=` are progressible —
 * there is no progressing toward *fewer* — and `>` has to be *exceeded*, so the
 * first number that satisfies it is one past `value`. A target of zero or less
 * is no target: everybody satisfies it before they start.
 */
export function conditionTarget(condition: Condition): number | null {
  if (condition.comparator !== ">" && condition.comparator !== ">=")
    return null;
  const target =
    condition.comparator === ">" ? condition.value + 1 : condition.value;
  return target > 0 ? target : null;
}

/**
 * Whether a condition can show a bar at all, so the editor can say so while one
 * is being written rather than after the backend has stored a `NULL`.
 */
export function conditionHasProgress(condition: Condition): boolean {
  return conditionTarget(condition) !== null;
}

/** The two ways a selector's clauses are put together. */
export const COMBINE_LABELS: Record<"all" | "any", string> = {
  all: "All of them",
  any: "Any of them",
};

/** The song fields a selector clause may ask about — `SongRead`'s own (§the
 *  song selector), in the order the song details list names them. */
export const SELECTOR_FIELDS = [
  "title",
  "artist",
  "genre",
  "language",
  "edition",
  "year",
  "is_duet",
  "has_video",
] as const;

export const SELECTOR_FIELD_LABELS: Record<SelectorClause["field"], string> = {
  title: "Title",
  artist: "Artist",
  genre: "Genre",
  language: "Language",
  edition: "Edition",
  year: "Year",
  is_duet: "Duet",
  has_video: "Video",
};

export const SELECTOR_OP_LABELS: Record<SelectorClause["op"], string> = {
  contains: "contains",
  equals: "is",
  starts_with: "starts with",
  "=": "is",
  ">=": "at least",
  "<=": "at most",
};

/** What kind of box a clause's value needs. */
export type SelectorFieldKind = "text" | "number" | "boolean";

export const SELECTOR_FIELD_KINDS: Record<
  SelectorClause["field"],
  SelectorFieldKind
> = {
  title: "text",
  artist: "text",
  genre: "text",
  language: "text",
  edition: "text",
  year: "number",
  is_duet: "boolean",
  has_video: "boolean",
};

const TEXT_OPS = ["contains", "equals", "starts_with"] as const;
const YEAR_OPS = ["=", ">=", "<="] as const;
const BOOLEAN_OPS = ["equals"] as const;

/**
 * Which operators each field takes. Mirrors what the backend's condition models
 * accept, so an editor offering exactly these never builds a 422.
 */
export const SELECTOR_FIELD_OPS: Record<
  SelectorClause["field"],
  readonly SelectorClause["op"][]
> = {
  title: TEXT_OPS,
  artist: TEXT_OPS,
  genre: TEXT_OPS,
  language: TEXT_OPS,
  edition: TEXT_OPS,
  year: YEAR_OPS,
  is_duet: BOOLEAN_OPS,
  has_video: BOOLEAN_OPS,
};

/**
 * The operator to keep when the field changes: the one already chosen if the
 * new field takes it, the first it does take otherwise — so switching *Genre*
 * to *Year* lands on `=` rather than on a `contains` nothing would accept.
 */
export function selectorOpFor(
  field: SelectorClause["field"],
  op: SelectorClause["op"],
): SelectorClause["op"] {
  const allowed = SELECTOR_FIELD_OPS[field];
  return allowed.includes(op) ? op : allowed[0];
}
