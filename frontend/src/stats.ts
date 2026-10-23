import type {
  PlayerRead,
  ScoreWithContext,
  SessionRead,
  SongRead,
} from "./api";
import { MAX_SCORE } from "./chartTheme";
import { parseServerTime, shortDate, shortTime } from "./duration";

/** What the score lists can be grouped by on the stats page. `none` leaves
 * every single score standing on its own, as the old app's "don't group". */
export type Grouping = "none" | "player" | "song";

/**
 * The old app's four score orders, recreated verbatim, plus one it never had:
 * `chronological` reads the evening back in the order it happened. It says
 * nothing about a *singer* — a player is not an event — so the Scores page
 * keeps it out of the sort list while the grouping is by player.
 */
export type Sorting =
  "alphabetically" | "average" | "best" | "worst" | "chronological";

export interface ScoreGroup {
  /** Stable across renders, so it works as a React key and an expansion id. */
  key: string;
  label: string;
  /** The song the row stands for, for its cover and its details modal. Null
   * when grouping by player, and when the song has left the library. */
  song: SongRead | null;
  /** The group's scores, best first. */
  scores: ScoreWithContext[];
  best: number;
  worst: number;
  median: number;
  /** Boxplot five-number summary, ascending: worst, q1, median, q3, best. */
  quartiles: number[];
  average: number;
  /**
   * When the group first happened, as epoch milliseconds — the earliest
   * `recorded_at` behind it. What `chronological` orders by: a song's place in
   * the evening is the run that put it there, not the last time it came round.
   */
  firstAt: number;
}

/**
 * What a set of scores adds up to: the five numbers `ScoreSummary` prints
 * wherever scores are totalled — the user page, an open score group, a song's
 * best scores.
 */
export interface ScoreSummaryStats {
  /** Performances that were scored, not scores: one duet run counts once. */
  sings: number;
  /** Distinct songs behind those performances; the ones that have left the
   * library are lumped into one, exactly as `summarize` counts them. */
  songs: number;
  best: number;
  /** Who holds `best` — the name the summary prints beside it. */
  bestBy: string;
  /** The mean over the scores, not over the sings, as a whole number. */
  average: number;
  worst: number;
  /** Who holds `worst`. */
  worstBy: string;
}

/** How many scores a summary needs before a chart is drawn under it (§7): a
 * couple of dots have no spread and a handful of bars across twenty buckets is
 * noise. The list under a summary is drawn either way. */
export const CHART_MIN_SCORES = 4;

export interface SessionSummary {
  /** Performances that produced a score — distinct `sing_id`s among them. */
  sings: number;
  songs: number;
  singers: number;
  top: ScoreWithContext | null;
}

/** What a song's whole history adds up to: the three numbers the host stage's
 * marker strip is drawn from (`scoreMarkers`). The words under the cover are
 * `ScoreSummary`'s, straight off the scores — nothing here is printed. */
export interface SongHistory {
  best: number;
  worst: number;
  average: number;
}

/** How the session leaderboard ranks its singers. */
export type LeaderboardOrder = "best" | "average" | "sings";

/** One singer's standing in the running session. */
export interface LeaderboardEntry {
  /** Stable across renders, so it works as a React key. */
  key: string;
  name: string;
  best: number;
  average: number;
  /** Performances of theirs that were scored in this session. */
  sings: number;
  /** The number the chosen order ranks by, and therefore the one shown. */
  value: number;
  /** Their best score of the session — where the row's avatar comes from. */
  top: ScoreWithContext;
}

/** The USDX rating words the old app printed under each singer's name, with
 * its thresholds verbatim: the score has to be at or below the bound. */
const EVALUATIONS: [number, string][] = [
  [2009, "Tone Deaf"],
  [4009, "Amateur"],
  [5009, "Wannabe"],
  [6009, "Hopeful"],
  [7509, "Rising Star"],
  [8509, "Lead Singer"],
  [9009, "Superstar"],
  [MAX_SCORE, "Ultrastar"],
];

/**
 * The rating word for one score. USDX cannot award more than `MAX_SCORE`, so
 * anything above it is a parsing accident rather than a better performance —
 * it gets the top word instead of the old app's "How did we get here?".
 */
export function evaluationLabel(score: number): string {
  for (const [bound, label] of EVALUATIONS) if (score <= bound) return label;
  return EVALUATIONS[EVALUATIONS.length - 1][1];
}

/**
 * What one song's complete score history adds up to, or `null` when it has
 * none. Computed over *every* score the song ever got, across all sessions —
 * that is what makes the numbers worth putting on the TV.
 */
export function songHistory(scores: ScoreWithContext[]): SongHistory | null {
  if (scores.length === 0) return null;
  let best = scores[0].score;
  let worst = scores[0].score;
  let total = 0;
  for (const score of scores) {
    if (score.score > best) best = score.score;
    if (score.score < worst) worst = score.score;
    total += score.score;
  }
  return { best, worst, average: Math.round(total / scores.length) };
}

/** Where a score sits on the 0…`MAX_SCORE` scale the host's bars are drawn on,
 * as a percentage of the bar. Anything off the scale sits on its end. */
export function scoreOffset(score: number): number {
  return Math.min(100, Math.max(0, (score / MAX_SCORE) * 100));
}

/** One of the three all-time marks above the host's score bars. */
export interface ScoreMarker {
  /** Which number it stands for, and therefore which glyph it wears. */
  kind: "worst" | "average" | "best";
  /** Where it sits on the bars' scale, as a percentage. */
  offset: number;
}

/**
 * The marks above the host's score bars, with the ones that would collide
 * dropped (ui-guidelines §7, *Host*). `minGap` is that collision distance as a
 * percentage of the strip — the caller measures it, because 2.5em of the
 * marker's own font size is a share of the strip only once both are in pixels.
 *
 * The average yields first: it is the number the two ends already imply. When
 * worst and best themselves fall inside the gap the three collapse into one
 * mark wearing `average`, which is where a song sung once ends up. Nothing is
 * lost by any of it — the strip is decoration for numbers the summary above it
 * prints in full.
 */
export function scoreMarkers(
  stats: SongHistory,
  minGap: number,
): ScoreMarker[] {
  const worst = scoreOffset(stats.worst);
  const average = scoreOffset(stats.average);
  const best = scoreOffset(stats.best);
  // Exactly the gap is far enough: it is a minimum, not a clearance.
  if (best - worst < minGap) return [{ kind: "average", offset: average }];
  const marks: ScoreMarker[] = [{ kind: "worst", offset: worst }];
  if (average - worst >= minGap && best - average >= minGap) {
    marks.push({ kind: "average", offset: average });
  }
  marks.push({ kind: "best", offset: best });
  return marks;
}

/**
 * Whether the sing that just finished set the song's all-time record. The old
 * app's rule, ported: it is a record when *every* occurrence of the song's best
 * score came out of this one sing.
 *
 * `history` is the song's complete history, which already contains `scores`.
 * An empty history means nothing is known yet — not a record.
 */
export function isNewHighscore(
  history: ScoreWithContext[],
  scores: ScoreWithContext[],
): boolean {
  if (history.length === 0 || scores.length === 0) return false;
  const best = Math.max(...history.map((score) => score.score));
  const counts = (rows: ScoreWithContext[]): number =>
    rows.filter((score) => score.score === best).length;
  return counts(history) === counts(scores);
}

/**
 * The running session's singers, strongest first in the reader's order. Ties
 * fall back to the best score and then the name, so the rows keep a stable
 * place while the party goes on.
 */
export function sessionLeaderboard(
  scores: ScoreWithContext[],
  order: LeaderboardOrder,
): LeaderboardEntry[] {
  // `groupScores` already bundles the scores per singer, keeping two guests of
  // the same name apart, and its groups are sorted best score first.
  const entries = groupScores(scores, "player").map((group) => {
    const sings = new Set(group.scores.map((score) => score.sing_id)).size;
    return {
      key: group.key,
      name: group.label,
      best: group.best,
      average: group.average,
      sings,
      value:
        order === "average"
          ? group.average
          : order === "sings"
            ? sings
            : group.best,
      top: group.scores[0],
    };
  });
  return entries.sort(
    (a, b) =>
      b.value - a.value ||
      b.best - a.best ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** "singer" / "singers": the word a count of `count` takes, for a surface that
 * prints the number apart from its word (a share card's numbers). */
export function countWord(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/** "1 singer" / "5 singers" — the picker's counts, none of which is ever a bare
 * number the reader has to guess the unit of. */
export function plural(count: number, word: string): string {
  return `${count} ${countWord(count, word)}`;
}

/**
 * A party's second line in the session picker: when it was and how much
 * happened at it. A party is more than its name, and this is what tells two
 * evenings apart before either is opened.
 */
export function sessionMeta(session: SessionRead): string {
  return [
    shortDate(session.started_at),
    plural(session.singer_count, "singer"),
    plural(session.score_count, "score"),
  ].join(" · ");
}

/**
 * The picker's head row under its name: what "everything at once" adds up to.
 *
 * The two figures come from the listing's own `session_count` and
 * `score_count` rather than from the rows it carries, because the head row
 * stands for `GET /stats/scores` — every party this reader may open, the ones
 * kept out of the picker included, since opening it opens them.
 */
export function allSessionsMeta(sessions: number, scores: number): string {
  // "party" is the one count here whose plural is not the word plus an "s".
  const parties = `${sessions} ${sessions === 1 ? "party" : "parties"}`;
  return `${parties} · ${plural(scores, "score")}`;
}

/**
 * Whether this party is kept out of the party picker's list (`stats.hide`).
 *
 * The stored flag alone is not enough: it is dormant on the party being sung —
 * the evening in progress is what the Scores page is for, and the backend never
 * drops that one from the listing either — so a party that was tucked away and
 * is then sung into again reads as an ordinary row until the room goes home.
 */
export function isTucked(session: SessionRead): boolean {
  return session.hidden && !session.current;
}

/** A session's own name, or when it started — the label the picker shows.
 * The time keeps two nameless parties on the same day apart. */
export function sessionLabel(session: SessionRead): string {
  if (session.name !== null && session.name !== "") return session.name;
  const started = new Date(parseServerTime(session.started_at));
  const time = started.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Party ${started.toLocaleDateString()}, ${time}`;
}

/** The song a score was sung on — `song` is null once it has left the library. */
export function songLabel(score: ScoreWithContext): string {
  return score.song === null
    ? "Unknown song"
    : `${score.song.artist} – ${score.song.title}`;
}

/**
 * The lines a chart mark answers hover or tap with: who, on what, and what it
 * scored when. A chart over one evening clocks the score; one that spans
 * parties (`dated`) dates it too, or two runs months apart would read alike.
 */
export function scoreTipLines(
  score: ScoreWithContext,
  dated: boolean,
): string[] {
  const when = dated
    ? `${shortDate(score.recorded_at)}, ${shortTime(score.recorded_at)}`
    : shortTime(score.recorded_at);
  return [score.player_name, songLabel(score), `${score.score} · ${when}`];
}

/** USDX stores the difficulty it was sung on as 0/1/2; anything else is unknown. */
export function difficultyLabel(difficulty: number | null): string {
  return ["Easy", "Medium", "Hard"][difficulty ?? -1] ?? "—";
}

/**
 * The player record behind a score, for its avatar. A guest, a singer whose
 * player was deleted and a caller who may not list players all end up on the
 * same stand-in, which `PlayerAvatar` draws as the name's initial.
 */
export function scorePlayer(
  score: ScoreWithContext,
  players: Map<string, PlayerRead>,
): PlayerRead {
  const known =
    score.player_id === null ? undefined : players.get(score.player_id);
  return (
    known ?? {
      id: score.player_id ?? `name:${score.player_name}`,
      name: score.player_name,
      registered: false,
      hidden: false,
      has_avatar: false,
    }
  );
}

/** Linear-interpolated percentile of an ascending array, as echarts' own boxplot does it. */
function percentile(ascending: number[], fraction: number): number {
  const position = (ascending.length - 1) * fraction;
  const lower = Math.floor(position);
  const next = ascending[lower + 1];
  if (next === undefined) return ascending[lower];
  return ascending[lower] + (position - lower) * (next - ascending[lower]);
}

function groupKey(score: ScoreWithContext, grouping: Grouping): string {
  // Ungrouped: every score is its own group, so its own id is the key.
  if (grouping === "none") return `score:${score.id}`;
  if (grouping === "song") return score.song?.id ?? "song:unknown";
  // Two guests can share a display name; the player id keeps them apart when
  // there is one. Registered and walk-in singers never collide.
  return score.player_id ?? `name:${score.player_name}`;
}

/** The singer behind a score, as `groupScores(…, "player")` tells them apart —
 * what the timeline uses to give one singer's dots one colour. */
export function scorePlayerKey(score: ScoreWithContext): string {
  return groupKey(score, "player");
}

/** Tukey box statistics of one group, for the spread chart's box rows. */
export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  /** Whisker ends: the most extreme *scores* still inside the 1.5 × IQR
   * fences — a whisker always ends on a real score, never on the fence. */
  whiskerLow: number;
  whiskerHigh: number;
  /** The scores beyond either fence, drawn as dots past the whiskers. */
  outliers: ScoreWithContext[];
}

/**
 * The standard box-and-whisker numbers of a group: quartiles as `groupScores`
 * already computes them, whiskers to the farthest score within 1.5 × IQR of
 * the box, and whatever lies beyond a fence — on either side — as outliers.
 */
export function boxStats(group: ScoreGroup): BoxStats {
  const [, q1, median, q3] = group.quartiles;
  const reach = 1.5 * (q3 - q1);
  const lowFence = q1 - reach;
  const highFence = q3 + reach;
  const inside = group.scores
    .map((score) => score.score)
    .filter((value) => value >= lowFence && value <= highFence);
  return {
    q1,
    median,
    q3,
    whiskerLow: Math.min(...inside),
    whiskerHigh: Math.max(...inside),
    outliers: group.scores.filter(
      (score) => score.score < lowFence || score.score > highFence,
    ),
  };
}

/**
 * Scores bundled by player or song (or not at all), strongest group first (by
 * median, then by best score so a tie is still deterministic). `sortGroups`
 * puts the list into the order the reader picked; this order is only the
 * stable base it starts from.
 */
export function groupScores(
  scores: ScoreWithContext[],
  grouping: Grouping,
): ScoreGroup[] {
  const groups = new Map<string, ScoreWithContext[]>();
  for (const score of scores) {
    const key = groupKey(score, grouping);
    const existing = groups.get(key);
    if (existing) existing.push(score);
    else groups.set(key, [score]);
  }

  return [...groups]
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => b.score - a.score);
      const ascending = sorted.map((score) => score.score).reverse();
      const total = ascending.reduce((sum, score) => sum + score, 0);
      return {
        key,
        // Grouped by player the row is a person; otherwise it is a song, and
        // an ungrouped row is a song too — its singer moves to the caption.
        label:
          grouping === "player" ? sorted[0].player_name : songLabel(sorted[0]),
        song: grouping === "player" ? null : sorted[0].song,
        scores: sorted,
        best: ascending[ascending.length - 1],
        worst: ascending[0],
        median: Math.round(percentile(ascending, 0.5)),
        quartiles: [
          ascending[0],
          percentile(ascending, 0.25),
          percentile(ascending, 0.5),
          percentile(ascending, 0.75),
          ascending[ascending.length - 1],
        ],
        average: Math.round(total / ascending.length),
        firstAt: Math.min(
          ...members.map((score) => parseServerTime(score.recorded_at)),
        ),
      };
    })
    .sort((a, b) => b.median - a.median || b.best - a.best);
}

/** The number a row is ranked by, and therefore the number it shows — the two
 * can never disagree. Alphabetical and chronological order have no value of
 * their own (a date is not a score), so they fall back to the best score, the
 * same thing "best score" ranks by. */
export function groupValue(group: ScoreGroup, sorting: Sorting): number {
  if (sorting === "average") return group.average;
  if (sorting === "worst") return group.worst;
  return group.best;
}

/**
 * The list in the reader's order. Every comparison ends on the label so two
 * groups with identical scores keep a stable place across re-renders.
 *
 * "worst score" sorts *ascending*, exactly as the old app did: the point of
 * that order is to put the evening's biggest flop first. "chronological" is
 * ascending too, and for the same reason: the word means oldest first — the
 * evening read forwards from its first song.
 */
export function sortGroups(
  groups: ScoreGroup[],
  sorting: Sorting,
): ScoreGroup[] {
  const byLabel = (a: ScoreGroup, b: ScoreGroup): number =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  const copy = [...groups];
  switch (sorting) {
    case "alphabetically":
      return copy.sort(byLabel);
    case "average":
      return copy.sort(
        (a, b) => b.average - a.average || b.best - a.best || byLabel(a, b),
      );
    case "worst":
      return copy.sort(
        (a, b) => a.worst - b.worst || a.average - b.average || byLabel(a, b),
      );
    case "best":
      return copy.sort(
        (a, b) => b.best - a.best || b.average - a.average || byLabel(a, b),
      );
    case "chronological":
      return copy.sort((a, b) => a.firstAt - b.firstAt || byLabel(a, b));
  }
}

/**
 * The numbers above the chart, all four derived from the scores themselves so
 * every one of them can be checked against the rows below.
 *
 * `sings` counts distinct performances that were scored — not the session's
 * `sing_count`, which counts every song *started*, restarts and songs stopped
 * before USDX scored them included, and therefore matches nothing on screen.
 */
export function summarize(scores: ScoreWithContext[]): SessionSummary {
  const sings = new Set<string>();
  const songs = new Set<string>();
  const singers = new Set<string>();
  let top: ScoreWithContext | null = null;
  for (const score of scores) {
    sings.add(score.sing_id);
    songs.add(groupKey(score, "song"));
    singers.add(groupKey(score, "player"));
    if (top === null || score.score > top.score) top = score;
  }
  return { sings: sings.size, songs: songs.size, singers: singers.size, top };
}

/**
 * Whether `a` happened before `b`. The row id settles a tie the clock cannot:
 * a duet's two scores are one import and share a `recorded_at` to the second,
 * so without it a peak's holder would come down to the order the list
 * happened to arrive in.
 */
function earlier(a: ScoreWithContext, b: ScoreWithContext): boolean {
  const at = parseServerTime(a.recorded_at);
  const bt = parseServerTime(b.recorded_at);
  return at === bt ? a.id < b.id : at < bt;
}

/**
 * The best of a set of scores under `scoreSummary`'s rule — a shared peak is
 * held by whoever got there first — so a chart's gold mark and the summary's
 * Best always name the same score. `null` for no scores at all.
 */
export function bestScoreOf(
  scores: ScoreWithContext[],
): ScoreWithContext | null {
  let best: ScoreWithContext | null = null;
  for (const score of scores) {
    if (
      best === null ||
      score.score > best.score ||
      (score.score === best.score && earlier(score, best))
    )
      best = score;
  }
  return best;
}

/**
 * What a set of scores adds up to, or `null` when there are none — a surface
 * with nothing to total should say so rather than print five zeroes.
 *
 * Deliberately the same shape as `summarize`: every number is derived from the
 * scores themselves, so each one can be checked against the rows below it.
 *
 * A peak that several people share is held by whoever got there first: the
 * earliest run wins, and two scores of one and the same run fall back to the
 * row id, so the name never depends on the order the scores arrive in.
 */
export function scoreSummary(
  scores: ScoreWithContext[],
): ScoreSummaryStats | null {
  if (scores.length === 0) return null;
  const sings = new Set<string>();
  const songs = new Set<string>();
  let best = scores[0];
  let worst = scores[0];
  let total = 0;
  for (const score of scores) {
    sings.add(score.sing_id);
    songs.add(groupKey(score, "song"));
    if (
      score.score > best.score ||
      (score.score === best.score && earlier(score, best))
    )
      best = score;
    if (
      score.score < worst.score ||
      (score.score === worst.score && earlier(score, worst))
    )
      worst = score;
    total += score.score;
  }
  return {
    sings: sings.size,
    songs: songs.size,
    best: best.score,
    bestBy: best.player_name,
    average: Math.round(total / scores.length),
    worst: worst.score,
    worstBy: worst.player_name,
  };
}

/** Score buckets of a histogram, e.g. 500 wide for 20 buckets out of 10000. */
export const HISTOGRAM_BUCKETS = 20;
const BUCKET_WIDTH = MAX_SCORE / HISTOGRAM_BUCKETS;

/** How many of `scores` fall into each equally wide score bucket. */
export function histogram(scores: ScoreWithContext[]): number[] {
  const buckets = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  for (const { score } of scores) {
    // A perfect 10000 belongs in the last bucket, not in a 21st one.
    buckets[
      Math.min(Math.floor(score / BUCKET_WIDTH), HISTOGRAM_BUCKETS - 1)
    ]++;
  }
  return buckets;
}
