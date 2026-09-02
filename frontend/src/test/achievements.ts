import type {
  AchievementRead,
  AchievementSettings,
  Condition,
  PlayerAchievementRead,
} from "../api";

/**
 * One condition as a definition holds it: the plainest there is, "some score of
 * 9,000 or better, ever". A test that is about a metric or a selector overrides
 * the one field it is about.
 */
export function condition(overrides: Partial<Condition> = {}): Condition {
  return {
    scope: "global",
    metric: "any_score",
    comparator: ">=",
    value: 9000,
    ...overrides,
  };
}

/**
 * One achievement as `GET /achievements` returns it to somebody who may manage
 * them: whole, enabled, not hidden, with a description to read and a definition
 * of one condition. Every test that needs an achievement starts here and
 * overrides the field it is about, so a new field on `AchievementRead` is added
 * in one place.
 */
export function achievementRead(
  overrides: Partial<AchievementRead> = {},
): AchievementRead {
  return {
    id: "a-golden",
    name: "Golden Voice",
    description: "Score 9,000 or more in a song.",
    icon: "trophy",
    has_image: false,
    // No picture, so no version to bust a cache with — a test about an uploaded
    // one overrides both together, the way the API only ever sends them together.
    icon_version: null,
    color: "gold",
    hidden: false,
    enabled: true,
    built_in: false,
    sort_order: 0,
    definition: [condition()],
    ...overrides,
  };
}

/**
 * The same row as the API hands somebody who may *not* manage them and has not
 * earned it: `hidden` blanks the name, the sentence and the glyph, and the
 * definition is never in a masked row at all (achievements.md). The id stays —
 * which is why every surface tells a masked row by its empty name.
 */
export function maskedAchievementRead(
  overrides: Partial<AchievementRead> = {},
): AchievementRead {
  return achievementRead({
    id: "a-brave",
    name: "",
    description: "",
    icon: null,
    has_image: false,
    // Blanked with `has_image`: a version that moved would say a hidden
    // achievement has a picture, and having one is part of the surprise.
    icon_version: null,
    hidden: true,
    definition: null,
    ...overrides,
  });
}

/** The three knobs at the defaults `achievements/settings.py` declares. */
export function achievementSettings(
  overrides: Partial<AchievementSettings> = {},
): AchievementSettings {
  return {
    enabled: true,
    host_seconds_base: 4,
    host_seconds_per_badge: 2,
    ...overrides,
  };
}

/**
 * The seventeen Wingman ships, in `BUILT_INS` order — ids, names, glyphs and
 * colours exactly as `achievements/builtin.py` seeds them, so a test that counts
 * the *Included* rows counts what a fresh instance really has. Only *Brave Soul*
 * is hidden, and it is the last of them.
 */
const BUILT_INS: [string, string, string, string, boolean][] = [
  ["builtin-first-song", "First Time on the Mic", "smile", "neutral", false],
  ["builtin-score-6000", "Warmed Up", "thumbs-up", "neutral", false],
  ["builtin-score-8000", "In Tune", "bolt", "blue", false],
  ["builtin-score-9000", "Golden Voice", "trophy", "gold", false],
  ["builtin-score-9500", "Untouchable", "crown", "gold", false],
  ["builtin-evening-50k", "A Good Evening", "beer", "neutral", false],
  ["builtin-evening-100k", "Big Night", "flame", "blue", false],
  ["builtin-evening-250k", "Marathon", "rocket", "gold", false],
  ["builtin-songs-10", "Regular", "music", "neutral", false],
  ["builtin-songs-50", "Resident", "guitar", "blue", false],
  ["builtin-songs-100", "Living Legend", "graduation-cap", "gold", false],
  ["builtin-evening-songs-5", "Five in a Night", "hourglass", "neutral", false],
  ["builtin-evening-songs-10", "Iron Lungs", "dumbbell", "blue", false],
  ["builtin-evening-hat-trick", "Hat-trick", "drum", "gold", false],
  ["builtin-first-duet", "Better Together", "users", "neutral", false],
  ["builtin-artists-10", "Well Travelled", "plane", "blue", false],
  ["builtin-brave-soul", "Brave Soul", "ghost", "neutral", true],
];

export function builtInAchievementReads(): AchievementRead[] {
  return BUILT_INS.map(([id, name, icon, color, hidden], index) =>
    achievementRead({
      id,
      name,
      description: `${name}.`,
      icon,
      color,
      hidden,
      built_in: true,
      sort_order: index,
    }),
  );
}

/**
 * Where one player stands on one achievement, as `GET /players/{id}/achievements`
 * answers: earned, at the moment the fixture's session recorded it. A test about
 * progress overrides `earned_at` with `null` and gives the two numbers.
 */
export function playerAchievementRead(
  overrides: Partial<PlayerAchievementRead> = {},
): PlayerAchievementRead {
  const achievement = overrides.achievement ?? achievementRead();
  return {
    achievement_id: achievement.id,
    player_id: "p1",
    earned_at: "2026-09-01T20:15:00Z",
    session_id: "s1",
    progress_current: null,
    progress_target: null,
    ...overrides,
    achievement,
  };
}
