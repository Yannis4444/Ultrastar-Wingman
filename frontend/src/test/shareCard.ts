import type {
  AchievementRead,
  PlayerRead,
  ScoreWithContext,
  SessionRead,
  SongRead,
} from "../api";
import {
  achievementCard,
  type AchievementCardContent,
  type AchievementCardInput,
} from "../shareCard/content";
import type { Measure } from "../shareCard/fit";
import { achievementRead, playerAchievementRead } from "./achievements";

/** The share card tests' data: songs, scores, a party and its players. */

export function song(id: string, artist: string, title: string): SongRead {
  return {
    id,
    artist,
    title,
    duration_seconds: null,
    has_video: false,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
    source: "usdb",
  };
}

export function player(id: string, name: string, hasAvatar = true): PlayerRead {
  return {
    id,
    name,
    registered: true,
    hidden: false,
    has_avatar: hasAvatar,
    avatar_version: 3,
  };
}

let nextId = 1;

/** A score by `playerId` (whose name is the id capitalised unless given). */
export function cardScore(
  playerId: string,
  value: number,
  songRead: SongRead | null,
  overrides: Partial<ScoreWithContext> = {},
): ScoreWithContext {
  const id = nextId++;
  return {
    id,
    sing_id: `sing-${id}`,
    player_id: playerId,
    player_name: playerId.charAt(0).toUpperCase() + playerId.slice(1),
    score: value,
    difficulty: 1,
    placement: null,
    field_size: null,
    recorded_at: new Date(Date.UTC(2026, 9, 17, 19, 0, id)).toISOString(),
    song: songRead,
    sing_started_at: new Date(Date.UTC(2026, 9, 17, 19, 0, id)).toISOString(),
    ...overrides,
  };
}

export function partySession(
  overrides: Partial<SessionRead> = {},
): SessionRead {
  return {
    id: "party-1",
    name: "Friday karaoke",
    started_at: "2026-10-17T19:00:00Z",
    last_activity_at: "2026-10-17T23:00:00Z",
    sing_count: 10,
    score_count: 10,
    singer_count: 3,
    hidden: false,
    current: false,
    ...overrides,
  };
}

/** A measurer that needs no canvas: every character is a fixed share of the
 * font size wide, bold a little wider — close enough to a real sans-serif for
 * the fitting rules to bite where they would. */
export const fakeMeasure: Measure = (text, font) =>
  Array.from(text).length * font.size * (font.weight === "bold" ? 0.6 : 0.55);

export const SONGS = [
  song("usdb:1", "Queen", "Bohemian Rhapsody"),
  song("usdb:2", "ABBA", "Dancing Queen"),
  song("usdb:3", "Toto", "Africa"),
  song("usdb:4", "Bonnie Tyler", "Total Eclipse of the Heart"),
  song("usdb:5", "Oasis", "Wonderwall"),
  song("usdb:6", "Gloria Gaynor", "I Will Survive"),
];

export const NAMES = [
  "chiara",
  "alice",
  "ben",
  "dana",
  "emil",
  "fatima",
  "georg",
  "hanna",
  "ivo",
  "jule",
];

/** The `index`th singer: the ten names, then "singer11", "singer12", … for
 * the big parties. */
export function singerId(index: number): string {
  return NAMES[index] ?? `singer${index + 1}`;
}

export function cardPlayers(count = NAMES.length): Map<string, PlayerRead> {
  return new Map(
    Array.from({ length: count }, (_, index) => {
      const id = singerId(index);
      return [id, player(id, id.charAt(0).toUpperCase() + id.slice(1))];
    }),
  );
}

/** `singers` singers with `each` scores apiece, the first the strongest —
 * spread closer together past ten singers so fifty still score above 0. */
export function cardParty(singers: number, each: number): ScoreWithContext[] {
  const step = singers > 10 ? 9000 / singers : 400;
  const scores: ScoreWithContext[] = [];
  for (let round = 0; round < each; round++) {
    for (let index = 0; index < singers; index++) {
      scores.push(
        cardScore(
          singerId(index),
          Math.round(9500 - index * step - round * 137),
          SONGS[(round * singers + index) % SONGS.length],
        ),
      );
    }
  }
  return scores;
}

/** One singer's scores, `values` in the order they were sung, the songs taken
 * in turn from `songs` — a player card's record. */
export function singerScores(
  playerId: string,
  values: number[],
  songs: (SongRead | null)[] = SONGS,
): ScoreWithContext[] {
  return values.map((value, index) =>
    cardScore(playerId, value, songs[index % songs.length]),
  );
}

/** An achievement card's input: Chiara's own record row, earned on 12 Aug
 * 2026, of an achievement three players hold — `achievement` overriding the
 * fixture's *Golden Voice*, `player` her player row (`null` for a page that
 * could not read it). */
export function achievementInput(
  achievement: Partial<AchievementRead> = {},
  player: PlayerRead | null = cardPlayers().get("chiara") ?? null,
): AchievementCardInput {
  return {
    row: playerAchievementRead({
      player_id: "chiara",
      earned_at: "2026-08-12T20:15:00Z",
      achievement: achievementRead({ holder_count: 3, ...achievement }),
    }),
    player,
    name: "Chiara",
  };
}

/** The same as a card's content. */
export function achievementContent(
  achievement: Partial<AchievementRead> = {},
  player?: PlayerRead | null,
): AchievementCardContent {
  return achievementCard(achievementInput(achievement, player));
}

/** A built-in with a picture Wingman ships, at a version to bust a cache. */
export const PICTURED = {
  id: "first-time-on-the-mic",
  name: "First Time on the Mic",
  description: "Sing your first song.",
  has_image: true,
  image_shipped: true,
  icon_version: 7,
  built_in: true,
  color: "blue",
} satisfies Partial<AchievementRead>;

/** An achievement whose name and description run long, and no picture. */
export const LONG_ACHIEVEMENT = {
  name: "The Unbelievably Long-Winded Marathon of Every Single Eighties Ballad",
  description:
    "Sing twenty different ballads from the eighties in one party, every one " +
    "of them above seven thousand, without a single song in between that is " +
    "not a ballad, and do it before midnight strikes on a weekday.",
} satisfies Partial<AchievementRead>;
