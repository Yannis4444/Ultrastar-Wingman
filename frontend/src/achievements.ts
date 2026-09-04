/**
 * What every surface that draws a badge needs to know about one: where its
 * picture comes from, what it may be called, how far along somebody is — and
 * the words the editor puts on a condition.
 *
 * Plain functions and plain tables, no React: the admin page, the user page and
 * the host screen all read the same ones, and `achievements.md` is the ground
 * truth behind every sentence here.
 */

import type {
  AchievementImportResult,
  AchievementRead,
  Condition,
  SelectorClause,
} from "./api";
import { ICON_PATHS, type IconName } from "./components/icons";
import { tagColorClass } from "./tags";

/**
 * The icon endpoint of one achievement, with the same cache-busting shape
 * `avatarUrl` has.
 *
 * The version is `AchievementRead.icon_version` — the stored file's mtime in
 * milliseconds, exactly what `PlayerRead.avatar_version` is for an avatar
 * (achievements.md, *Icons*). Replacing a picture changes neither the URL nor
 * `has_image`, so without it a browser goes on drawing the copy it already has.
 * `null` or left out — no picture, a file that has gone, or a masked row — is
 * the bare URL: the "not knowing" case of `avatars.asPlayer`.
 */
export type AchievementIconSize = "small" | "full";

export function achievementIconUrl(
  achievementId: string,
  version?: number | null,
  size: AchievementIconSize = "small",
): string {
  // `small` is the 256px variant of a shipped picture, for the 40px rows and
  // the TV — the originals are over a megabyte each and the user page draws the
  // whole catalogue. An upload has no variant and answers either size with
  // itself.
  // `full` is for the one view that shows a single badge large: the achievement
  // modal, which asks for it only while it is open (ui-guidelines §5).
  const url = `/api/v1/achievements/${encodeURIComponent(achievementId)}/icon?size=${size}`;
  return version === undefined || version === null
    ? url
    : `${url}&v=${version}`;
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

/**
 * How the two management pages ask for the catalogue — and the only place in
 * the app that asks this way.
 *
 * `GET /achievements` is masked for **everybody**: a `hidden` achievement the
 * caller's own player has not earned comes back blank, an administrator and the
 * host screen included, because the same listing feeds the user page and the TV
 * and holding `achievements.manage` is not the same as using it
 * (achievements.md, *Hidden achievements*). `?manage=true` is the other answer —
 * every row whole, plus its `definition` — and takes the capability, else 403.
 *
 * It is a query of its own, so the masked catalogue and the managing one are two
 * cache entries rather than one overwriting the other. `invalidateQueries` on
 * the bare `listAchievementsQueryKey()` still reaches both — it matches keys
 * partially — but a `setQueryData` has to name this one.
 */
export const MANAGE_CATALOGUE = { query: { manage: true } } as const;

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

/* ------------------------------------------------------------ the archive
   What an import did, in a sentence. The backend answers with two lists of ids
   precisely so the page can say something true instead of "done"
   (achievements.md, *Import*), and turning those ids into names is the same job
   on whichever surface ever runs an import. */

/** Past this many, a list of names stops being something anybody reads. */
const NAMED_AT_MOST = 3;

/** "Golden Voice", "Golden Voice and Duettist", "A, B and C". */
function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One half of the sentence, or `null` when nothing happened on that side. */
function importPhrase(
  ids: readonly string[],
  verb: string,
  nameOf: (id: string) => string,
): string | null {
  if (ids.length === 0) return null;
  if (ids.length <= NAMED_AT_MOST)
    return `${verb} ${listWords(ids.map(nameOf))}`;
  return `${verb} ${ids.length} achievements`;
}

/**
 * What an imported archive did: *"Added Golden Voice and updated 14
 * achievements."*
 *
 * `nameOf` looks an id up in the catalogue as the page has it — an id it does
 * not know yet stands for itself, which is what a just-created achievement is
 * until the refetch lands, and is still a truthful thing to name.
 */
export function importSummary(
  result: AchievementImportResult,
  nameOf: (id: string) => string,
): string {
  const parts = [
    importPhrase(result.created, "added", nameOf),
    importPhrase(result.updated, "updated", nameOf),
  ].filter((part): part is string => part !== null);
  // The backend refuses an archive holding no achievement at all, so this is
  // only ever a backend that grew a third outcome — still not "done".
  if (parts.length === 0) return "The archive held nothing to import.";
  const sentence = parts.join(" and ");
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

/* --------------------------------------------------------- the editor's words
   One vocabulary for the two editor bundles, declared here so the admin page,
   the condition editor and the song selector all call the same thing by the
   same name. Every table is keyed off the generated types, so a metric or an
   operator the backend grows breaks the build rather than going unnoticed. */

/** What a condition looks at: everything ever, or one party (achievements.md). */
export const CONDITION_SCOPES = ["global", "session"] as const;

export const SCOPE_LABELS: Record<NonNullable<Condition["scope"]>, string> = {
  global: "All time",
  session: "One party",
};

/**
 * The one line under the scope pills. Static, not one sentence per scope: what
 * the reader needs is the *difference*, and a note that changed as they pressed
 * the pills would only ever show them half of it.
 */
export const SCOPE_NOTE =
  "One party has to happen inside a single evening: the difference between " +
  '"sing 10 songs" and "sing 10 songs tonight".';

/** The metrics, in the order the editor offers them: the score ones first, then
 *  the counting ones, and the mean last — it is the one that needs a thought. */
export const METRICS = [
  "any_score",
  "sum_of_scores",
  "number_of_sings",
  "number_of_scores",
  "different_songs",
  "different_artists",
  "different_genres",
  "different_decades",
  "most_sings_of_one_song",
  "number_of_wins",
  "average_score",
] as const;

export const METRIC_LABELS: Record<Condition["metric"], string> = {
  any_score: "Any score",
  sum_of_scores: "Sum of scores",
  number_of_sings: "Number of sings",
  number_of_scores: "Number of scores",
  different_songs: "Different songs",
  different_artists: "Different artists",
  different_genres: "Different genres",
  different_decades: "Different decades",
  most_sings_of_one_song: "Sings of one song",
  number_of_wins: "Number of wins",
  average_score: "Average score",
};

/** One line each on what is actually counted — the traps are all in here. */
export const METRIC_DESCRIPTIONS: Record<Condition["metric"], string> = {
  any_score:
    'One single score. With "more than" or "at least" that is the singer\'s ' +
    'best. With "less than" or "at most" it is their worst.',
  sum_of_scores: "Every score added up.",
  number_of_sings: "How many songs were sung. A duet scored twice is one.",
  number_of_scores: "How many scores there are.",
  different_songs: "How many different songs.",
  different_artists: "How many different artists.",
  different_genres:
    "How many different genres. A song whose file names no genre counts " +
    "for nothing.",
  different_decades:
    "How many different decades the songs are from. A song whose file names " +
    "no year counts for nothing.",
  most_sings_of_one_song:
    "How often the same song was sung. The song sung most often is the one " +
    "counted, and other songs in between do not matter.",
  number_of_wins:
    "How many times the singer had the best score of a song. A song nobody " +
    "else sang is not a win. A tie for the top counts for both singers.",
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
  regex: "matches regex",
  "=": "is",
  ">=": "at least",
  "<=": "at most",
};

/**
 * How long a pattern may be — `schema.MAX_PATTERN_LENGTH`, mirrored so Save can
 * say so instead of coming back a 422. It is one of the two things about a
 * pattern this side may judge; the other is that it is not empty.
 */
export const MAX_PATTERN_LENGTH = 200;

/**
 * The line under a clause list holding a pattern. Nobody can guess any of the
 * three things it says — that case is ignored, that a pattern matches anywhere
 * in the field, and that Python's flavour is the one that counts — so all three
 * are said.
 *
 * The last sentence is not a hedge but the honest division of labour: this
 * editor is TypeScript and the engine is Python, and the two dialects disagree
 * (`(?P<name>…)` is Python's and throws in a browser; `(?<name>…)` is the
 * browser's and Python refuses it). So the backend is the authority, and the
 * only refusals `conditionProblem` mirrors are the two that hold in both. It
 * names the third refusal — a pattern whose shape could take practically
 * forever, `schema.MAX_PATTERN_COMBINATIONS` — as a rule to write by rather
 * than mirroring it: deciding it needs a regex parser, and a second one here
 * would be wrong in exactly the cases it exists to catch.
 */
export const REGEX_NOTE =
  "A pattern matches anywhere in the field and ignores case. Use ^ and $ to " +
  "pin it to the whole field. Use (?-i:Love) for a part that has to keep its " +
  "capitals. When you save, Wingman refuses a pattern it cannot read. It also " +
  "refuses one whose repetitions would take too long to try. Use at most two " +
  "of * and +, and never wrap one around another.";

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

// `regex` last: it is the specialist, and the first three are what a host reaches
// for. Switching a field keeps whichever is already chosen (`selectorOpFor`), so
// the order only decides what a fresh text clause starts on.
const TEXT_OPS = ["contains", "equals", "starts_with", "regex"] as const;
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

/**
 * The three ways a condition may narrow which songs count. Not a field of the
 * condition — it is `songs` and `match`, which the models keep mutually
 * exclusive — so the editor reads the mode off the data rather than keeping a
 * fourth piece of state that could disagree with it.
 */
export const SONG_MODES = ["all", "ids", "match"] as const;

export type SongMode = (typeof SONG_MODES)[number];

export const SONG_MODE_LABELS: Record<SongMode, string> = {
  all: "All songs",
  ids: "Chosen songs",
  match: "Songs matching",
};

export function songMode(condition: Condition): SongMode {
  if (condition.songs) return "ids";
  if (condition.match) return "match";
  return "all";
}

/**
 * What is wrong with a clause's pattern, or `null` — and only ever something
 * that is wrong in *both* dialects.
 *
 * Whether a pattern compiles is Python's answer, not this browser's: `new
 * RegExp` accepts patterns Python refuses and refuses patterns Python accepts,
 * so gating Save on it would block a rule the backend would have taken. Empty
 * and too long are the two refusals `schema.check_pattern` makes that no
 * dialect can disagree about (achievements.md, *The song selector*).
 */
function patternProblem(pattern: string): string | null {
  if (pattern === "")
    return "A song rule's regular expression cannot be empty. Every song would match it.";
  if (pattern.length > MAX_PATTERN_LENGTH)
    return `A song rule's regular expression cannot be longer than ${MAX_PATTERN_LENGTH} characters.`;
  return null;
}

/**
 * What is wrong with a condition, in a sentence, or `null` when nothing is —
 * the same refusals the backend's models make, so the editor can say so beside
 * the box rather than letting Save come back a 422.
 *
 * Not a full validator: an empty song list and a value of zero are legal, if
 * unsatisfiable, and the summary sentence is what says so.
 */
export function conditionProblem(condition: Condition): string | null {
  const filter = condition.score_filter;
  if (
    filter &&
    filter.min !== null &&
    filter.min !== undefined &&
    filter.max !== null &&
    filter.max !== undefined &&
    filter.min > filter.max
  )
    return '"At least" cannot be above "at most". No score would be left to count.';
  // Unreachable from this editor, which switches between the two. It is here
  // for a definition that arrived from an import or a hand-edited archive.
  if (condition.songs && condition.match)
    return "A condition picks songs by a list or by a match, never both.";
  for (const clause of condition.match?.clauses ?? []) {
    if (clause.op !== "regex") continue;
    const problem = patternProblem(String(clause.value));
    if (problem) return problem;
  }
  return null;
}

/* ------------------------------------------------------- the sentence
   A condition in words. The editor draws it under every block, because a host
   who assembled four selects has no other way of knowing whether what they
   built means what they intended. Pure and here rather than in the component:
   the same sentence belongs on any surface that ever shows a definition. */

/** "at least 3 scores", "exactly 1 sing" — the comparator, the number and the
 *  noun it counts, singular when there is one of it. */
function counted(
  condition: Condition,
  singular: string,
  plural: string,
): string {
  const noun = condition.value === 1 ? singular : plural;
  // Plain numbers, no grouping — the app's convention (see `progressLabel`).
  return `${COMPARATOR_LABELS[condition.comparator]} ${condition.value} ${noun}`;
}

/** "9000 or more", "between 9000 and 9500" — a score filter's range, or `null`
 *  when both ends are open and every score counts. */
function rangeWords(condition: Condition): string | null {
  const min = condition.score_filter?.min ?? null;
  const max = condition.score_filter?.max ?? null;
  if (min !== null && max !== null) return `between ${min} and ${max}`;
  if (min !== null) return `${min} or more`;
  if (max !== null) return `${max} or less`;
  return null;
}

/**
 * The metrics whose sentence is "<comparator> <number> <noun>", and the noun
 * each of them counts. Written out rather than derived from the label: *Sings
 * of one song* is a select's entry and "3 sings of one and the same song" is a
 * sentence, and the two do not want the same words.
 *
 * Keyed by every metric except the four that read their own way in `measured`,
 * so a metric the backend adds is a type error here rather than a sentence
 * quietly claiming an average score.
 */
const COUNTED_NOUNS: Record<
  Exclude<
    Condition["metric"],
    "any_score" | "number_of_scores" | "sum_of_scores" | "average_score"
  >,
  readonly [string, string]
> = {
  number_of_sings: ["sing", "sings"],
  different_songs: ["different song", "different songs"],
  different_artists: ["different artist", "different artists"],
  different_genres: ["different genre", "different genres"],
  different_decades: ["different decade", "different decades"],
  // "of one and the same song", because the number is not how many songs were
  // sung that often — it is how often the most-sung one was, and the songs in
  // between do not matter.
  most_sings_of_one_song: [
    "sing of one and the same song",
    "sings of one and the same song",
  ],
  // "wins" and not "won songs": what is counted is the times the singer came
  // first, and winning the same song twice is two of them rather than one song.
  number_of_wins: ["win", "wins"],
};

/** What is measured, filter included. */
function measured(condition: Condition): string {
  const range = rangeWords(condition);
  if (condition.metric === "any_score") {
    // `any_score` spends its own comparator on the number, so a filter can
    // never fold into the noun the way a count's does.
    const value = condition.value;
    const phrase =
      condition.comparator === ">="
        ? `some score of ${value} or more`
        : condition.comparator === ">"
          ? `some score above ${value}`
          : condition.comparator === "="
            ? `some score of exactly ${value}`
            : condition.comparator === "<="
              ? `some score of ${value} or less`
              : `some score below ${value}`;
    return range === null
      ? phrase
      : `${phrase}, counting only scores of ${range}`;
  }

  if (condition.metric === "number_of_scores") {
    // The one metric whose noun *is* the filtered thing, so the range reads as
    // part of it: "at least 3 scores of 9000 or more".
    const phrase = counted(condition, "score", "scores");
    return range === null ? phrase : `${phrase} of ${range}`;
  }

  const phrase =
    condition.metric === "sum_of_scores"
      ? `scores adding up to ${COMPARATOR_LABELS[condition.comparator]} ${condition.value}`
      : condition.metric === "average_score"
        ? `an average score of ${COMPARATOR_LABELS[condition.comparator]} ${condition.value}`
        : counted(condition, ...COUNTED_NOUNS[condition.metric]);
  return range === null
    ? phrase
    : `${phrase}, counting only scores of ${range}`;
}

/** One clause of a selector, in words. */
function clauseWords(clause: SelectorClause): string {
  if (clause.field === "is_duet")
    return clause.value === true ? "it is a duet" : "it is not a duet";
  if (clause.field === "has_video")
    return clause.value === true ? "it has a video" : "it has no video";
  if (clause.field === "year")
    return clause.op === ">="
      ? `the year is ${clause.value} or later`
      : clause.op === "<="
        ? `the year is ${clause.value} or earlier`
        : `the year is ${clause.value}`;
  const field = SELECTOR_FIELD_LABELS[clause.field].toLowerCase();
  const verb =
    clause.op === "contains"
      ? "contains"
      : clause.op === "starts_with"
        ? "starts with"
        : clause.op === "regex"
          ? // Spelled out rather than "matches regex": the sentence is what a host
            // reads to check they built what they meant, and the select's own
            // shorthand is no help there.
            "matches the regular expression"
          : "is";
  // Quoted: a value of "Hard Rock" is two words, and an empty one is a hole the
  // reader has to be able to see.
  return `the ${field} ${verb} "${String(clause.value)}"`;
}

/** Which songs count, or `""` when the condition narrows them not at all. */
function songWords(condition: Condition): string {
  if (condition.songs) {
    const count = condition.songs.ids.length;
    // An empty list matches no score at all (`evaluate._on_a_chosen_song`), so
    // it is a state the sentence has to name rather than skip.
    if (count === 0) return ", on no song (none is chosen yet)";
    return count === 1
      ? ", on one chosen song"
      : `, on one of ${count} chosen songs`;
  }
  const clauses = condition.match?.clauses ?? [];
  // No clauses is no restriction, whichever way they would have been combined —
  // the backend says so too, so the sentence says nothing about songs.
  if (clauses.length === 0) return "";
  const joiner = condition.match?.combine === "any" ? " or " : " and ";
  return `, on songs where ${clauses.map(clauseWords).join(joiner)}`;
}

/**
 * The whole condition as one sentence: *"In one party, at least 3 scores of
 * 9000 or more, on songs where the genre is "Rock"."*
 *
 * It says what the definition says and never what it ought to say — a filter
 * whose ends are the wrong way round is spelled out as written, because the
 * point of the sentence is to make exactly that visible (`conditionProblem` is
 * what names it as a mistake).
 */
export function conditionSentence(condition: Condition): string {
  const scope =
    (condition.scope ?? "global") === "session"
      ? "In one party, "
      : "Over all time, ";
  return `${scope}${measured(condition)}${songWords(condition)}.`;
}
