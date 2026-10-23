import type {
  PlayerRead,
  ScoreWithContext,
  SessionRead,
  SongRead,
} from "../api";
import type { Measure } from "../shareCard/fit";

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
