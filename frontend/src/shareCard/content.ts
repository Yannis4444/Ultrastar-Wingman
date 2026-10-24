import type { PlayerRead, ScoreWithContext, SessionRead } from "../api";
import { avatarUrl } from "../avatars";
import { MAX_SCORE } from "../chartTheme";
// A card leaves the room, so its date always carries the year.
import { cardDate, parseServerTime } from "../duration";
import {
  bestScoreOf,
  boxStats,
  evaluationLabel,
  groupScores,
  plural,
  scorePlayer,
  scorePlayerKey,
  scoreSummary,
  sessionLeaderboard,
} from "../stats";
import { graphemes } from "./fit";

/**
 * What a share card says (share-cards.md §2), worked out from the app's own
 * types and nothing else: no canvas, no layout, no fetch. The caller hands in
 * exactly the scores `/scores` showed this reader — a card never shows more
 * than that page, and it filters nothing on top of it either (§7.6).
 */

/** A picture on a card: where to load it from, and the letter drawn on
 * `--input-bg` when there is none or it did not load. */
export interface CardImage {
  /** `null` when there is no picture to ask for — a song that left the
   * library, a player without one, or another singer's picture with the
   * toggle off. */
  url: string | null;
  initial: string;
}

export interface CardPerson {
  name: string;
  avatar: CardImage;
}

/** The flag beside the singer: the song's record, or the singer's own best on
 * it. Only ever set when the caller could prove it (§7.4). */
export type ScoreFlag = "highscore" | "personal-best";

export interface ScoreCardContent {
  kind: "score";
  /** The song's title, or *Unknown song* once it has left the library. */
  title: string;
  /** `null` for a song that left the library: there is nobody to name. */
  artist: string | null;
  cover: CardImage;
  score: number;
  /** `evaluationLabel`'s word: *Superstar*, *Lead Singer*, … */
  rating: string;
  /** Where the score sits on the 0–10000 bar, 0…1. */
  fraction: number;
  singer: CardPerson;
  /** The score is the sharer's own: the only face on the card is theirs, so
   * *Other singers' pictures* has nothing to reach (share-cards §5). */
  mine: boolean;
  /** "1st of 3", or `null` where there is no place to give (§2.1). */
  place: string | null;
  /** The other singers of the same sing — a duet, or a few mics at once. */
  partners: string[];
  /** The line under the singer's name: the place and the partners. */
  detail: string | null;
  /** "Friday karaoke · 17 Oct 2026", or `null` with the toggle off. */
  eyebrow: string | null;
  flag: ScoreFlag | null;
}

export interface CardDot {
  id: number;
  score: number;
  /** The one gold mark: the best of the scores on the card. */
  best: boolean;
}

/** Box-plot numbers of one singer's row on the spread, from five scores on. */
export interface CardBox {
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
}

/** One singer in the party's ranking — the podium, the rows, the spread. */
export interface CardRank {
  key: string;
  /** Competition ranking on the best score: two equal bests share a place. */
  place: number;
  person: CardPerson;
  best: number;
  /** Holds the party's best score: their number is the gold one. */
  gold: boolean;
  isMe: boolean;
  /** Their scores ascending, for the spread row. */
  dots: CardDot[];
  /** `null` below five scores, where a quartile box is fiction. */
  box: CardBox | null;
}

export interface CardNumbers {
  sings: number;
  songs: number;
  best: number;
  /** Who holds `best`, or `null` on a card that is only the sharer's. */
  bestBy: string | null;
  average: number;
}

export interface PartyCardContent {
  kind: "party";
  /** The party's name, or its date when it has none — whatever the toggle
   * says: the file name and the picture's `alt` name the party even when the
   * card does not (§2.2). */
  party: string;
  /** The card's head: `party`, or `null` with *Party name and date* off —
   * never the singer count, which is not the thing to lead with (§1.10). */
  head: string | null;
  /** Under the head: "17 Oct 2026 · 5 singers", or "5 singers" alone under a
   * nameless party's date (never the date twice); `null` with the toggle
   * off, the count going with the head (§7.9). */
  sub: string | null;
  numbers: CardNumbers;
  /** Everybody, best first — or the sharer alone on the *You* slide. */
  ranking: CardRank[];
  /** How many sang at the party, whatever the card shows of them. */
  singerCount: number;
  /** Whether this is the *You* slide's content: the sharer alone (§2.2). */
  onlyMe: boolean;
  /** Whether it could be: the sharer sang at this party. */
  mayOnlyMe: boolean;
  /** "2nd of 5" on *You*, `null` otherwise. */
  myPlace: string | null;
  /** The scores on the strip: the party's, or the sharer's on *You*. */
  dots: CardDot[];
  median: number | null;
  /** The distinct covers of the party's songs, in the order they were sung,
   * for *Mosaic*. */
  covers: string[];
  /** What the ranking is by, at the foot — `null` with nobody to rank. */
  rankingNote: string | null;
}

export type CardContent = ScoreCardContent | PartyCardContent;

/** At most this many covers are asked for: the story's mosaic has eighteen
 * cells and a long party should not cost a hundred requests. */
export const MAX_COVERS = 18;

/** Below this many scores a singer's spread row is plain dots — `SpreadRows`'
 * own threshold. */
export const BOX_MIN_SCORES = 5;

export const RANKING_NOTE = "ranked by best score";

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/** The first letter of a name, the way `PlayerAvatar` and `CoverImage` draw
 * it — by grapheme, so a name starting with an emoji or a flag keeps it
 * whole. */
function initialOf(name: string): string {
  return (graphemes(name.trim())[0] ?? "?").toUpperCase();
}

export function coverUrl(songId: string): string {
  return `/api/v1/songs/${encodeURIComponent(songId)}/cover`;
}

/**
 * The person behind a score. The sharer's own picture is always theirs
 * (§1.3); everybody else's only while *Other singers' pictures* is on.
 */
function personOf(
  score: ScoreWithContext,
  players: Map<string, PlayerRead>,
  me: string | null,
  otherPictures: boolean,
): CardPerson {
  const player = scorePlayer(score, players);
  const mine = me !== null && score.player_id === me;
  const shown = player.has_avatar && (mine || otherPictures);
  return {
    name: score.player_name,
    avatar: {
      url: shown ? avatarUrl(player.id, player.avatar_version) : null,
      initial: initialOf(score.player_name),
    },
  };
}

/** "with Bob", "with Bob and Carol", "with Bob, Carol and 2 more". */
export function partnersLine(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `with ${names[0]}`;
  if (names.length === 2) return `with ${names[0]} and ${names[1]}`;
  return `with ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** The median of ascending values, linear-interpolated as `ScoreStrip` and
 * `groupScores` compute theirs. */
function medianOf(ascending: number[]): number | null {
  if (ascending.length === 0) return null;
  const position = (ascending.length - 1) / 2;
  const lower = ascending[Math.floor(position)];
  const upper = ascending[Math.ceil(position)];
  return Math.round(lower + (position % 1) * (upper - lower));
}

function dotsOf(scores: ScoreWithContext[]): CardDot[] {
  const best = bestScoreOf(scores);
  return [...scores]
    .sort((a, b) => a.score - b.score || a.id - b.id)
    .map((score) => ({
      id: score.id,
      score: score.score,
      best: score === best,
    }));
}

export interface ScoreCardInput {
  score: ScoreWithContext;
  /** The scores the page showed beside it — where the other singers of the
   * same sing come from. The score itself may be among them. */
  partyScores: ScoreWithContext[];
  /** The party the score was sung at, for the eyebrow; `null` when unknown. */
  session: SessionRead | null;
  players: Map<string, PlayerRead>;
  /** The sharer's own player id, `null` for a guest. */
  me: string | null;
  otherPictures: boolean;
  partyNameAndDate: boolean;
  /** Passed only where the caller could work them out (§7.4). */
  newHighscore?: boolean;
  personalBest?: boolean;
}

export function scoreCard(input: ScoreCardInput): ScoreCardContent {
  const { score, session } = input;
  const song = score.song;
  // A place needs a field: NULL before migration 0026 is "never recorded",
  // and a solo sing is not a win (§2.1).
  const place =
    score.placement !== null &&
    score.field_size !== null &&
    score.field_size > 1
      ? `${ordinal(score.placement)} of ${score.field_size}`
      : null;
  const partners = input.partyScores
    .filter((other) => other.sing_id === score.sing_id && other.id !== score.id)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .map((other) => other.player_name);
  const withLine = partnersLine(partners);
  const detail = [place, withLine].filter((part) => part !== null).join(" · ");
  const date = cardDate(score.recorded_at);
  const name = session?.name ?? "";
  return {
    kind: "score",
    title: song?.title ?? "Unknown song",
    artist: song?.artist ?? null,
    cover: {
      url: song === null ? null : coverUrl(song.id),
      initial: song === null ? "?" : initialOf(song.artist),
    },
    score: score.score,
    rating: evaluationLabel(score.score),
    fraction: Math.min(1, Math.max(0, score.score / MAX_SCORE)),
    singer: personOf(score, input.players, input.me, input.otherPictures),
    mine: input.me !== null && score.player_id === input.me,
    place,
    partners,
    detail: detail === "" ? null : detail,
    // A nameless party is its date: `sessionLabel`'s "Party 17/10/2026,
    // 21:00" would say the date twice.
    eyebrow: input.partyNameAndDate
      ? name === ""
        ? date
        : `${name} · ${date}`
      : null,
    flag: input.newHighscore
      ? "highscore"
      : input.personalBest
        ? "personal-best"
        : null,
  };
}

export interface PartyCardInput {
  /** The party's scores as `/scores` showed them. */
  scores: ScoreWithContext[];
  session: SessionRead;
  players: Map<string, PlayerRead>;
  me: string | null;
  otherPictures: boolean;
  partyNameAndDate: boolean;
  onlyMe: boolean;
}

export function partyCard(input: PartyCardInput): PartyCardContent {
  const { scores, session } = input;
  const partyBest = bestScoreOf(scores);
  const goldKey = partyBest === null ? null : scorePlayerKey(partyBest);
  const groups = new Map(
    groupScores(scores, "player").map((group) => [group.key, group]),
  );
  const board = sessionLeaderboard(scores, "best");
  const ranking: CardRank[] = board.map((entry) => {
    const group = groups.get(entry.key);
    const own = group?.scores ?? [];
    const box =
      group !== undefined && own.length >= BOX_MIN_SCORES
        ? boxStats(group)
        : null;
    return {
      key: entry.key,
      // Competition ranking: everybody with a higher best is ahead of you.
      place: 1 + board.filter((other) => other.best > entry.best).length,
      person: personOf(entry.top, input.players, input.me, input.otherPictures),
      best: entry.best,
      gold: entry.key === goldKey,
      isMe: input.me !== null && entry.top.player_id === input.me,
      dots: dotsOf(own).map((dot) => ({
        ...dot,
        best: partyBest !== null && dot.id === partyBest.id,
      })),
      box:
        box === null
          ? null
          : {
              q1: box.q1,
              median: box.median,
              q3: box.q3,
              whiskerLow: box.whiskerLow,
              whiskerHigh: box.whiskerHigh,
            },
    };
  });
  const mine = ranking.find((entry) => entry.isMe) ?? null;
  const onlyMe = input.onlyMe && mine !== null;
  const shown = onlyMe
    ? scores.filter((score) => scorePlayerKey(score) === mine.key)
    : scores;
  const summary = scoreSummary(shown);
  const dots = dotsOf(shown);
  const singers = plural(ranking.length, "singer");
  const name = session.name ?? "";
  const date = cardDate(session.started_at);
  const named = name !== "";

  const covers: string[] = [];
  const seen = new Set<string>();
  const sung = [...scores].sort(
    (a, b) =>
      parseServerTime(a.recorded_at) - parseServerTime(b.recorded_at) ||
      a.id - b.id,
  );
  for (const score of sung) {
    if (score.song === null || seen.has(score.song.id)) continue;
    seen.add(score.song.id);
    covers.push(coverUrl(score.song.id));
    if (covers.length === MAX_COVERS) break;
  }

  return {
    kind: "party",
    party: named ? name : date,
    head: input.partyNameAndDate ? (named ? name : date) : null,
    sub: input.partyNameAndDate
      ? named
        ? `${date} · ${singers}`
        : singers
      : null,
    numbers: {
      sings: summary?.sings ?? 0,
      songs: summary?.songs ?? 0,
      best: summary?.best ?? 0,
      bestBy: onlyMe ? null : (summary?.bestBy ?? null),
      average: summary?.average ?? 0,
    },
    ranking: onlyMe ? [mine] : ranking,
    singerCount: ranking.length,
    onlyMe,
    mayOnlyMe: mine !== null,
    // A party of one has no place to give, as a solo sing has none (§2.1):
    // never "1st of 1".
    myPlace:
      onlyMe && ranking.length > 1
        ? `${ordinal(mine.place)} of ${ranking.length}`
        : null,
    dots,
    median: medianOf(dots.map((dot) => dot.score)),
    covers,
    rankingNote: ranking.length > 1 ? RANKING_NOTE : null,
  };
}

/** How many of a party's singers a card ever draws a face for: the podium's
 * three and the three rows under it (§4.2). The spread draws none. */
export const FACES_SHOWN = 6;

/** Every picture a card can draw — what the panel loads before it renders.
 * The logo is not among them: it is the same on every card. A party of fifty
 * asks for the six faces it can draw, not fifty. */
export function cardImageUrls(content: CardContent): string[] {
  const urls =
    content.kind === "score"
      ? [content.cover.url, content.singer.avatar.url]
      : [
          ...content.ranking
            .slice(0, FACES_SHOWN)
            .map((entry) => entry.person.avatar.url),
          ...content.covers,
        ];
  return [...new Set(urls.filter((url): url is string => url !== null))];
}
