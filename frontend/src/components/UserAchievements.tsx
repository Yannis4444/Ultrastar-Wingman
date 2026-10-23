import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type {
  AchievementRead,
  PlayerAchievementRead,
  PlayerRead,
} from "../api";
import {
  listPlayerAchievementsOptions,
  listPlayerAchievementsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { achievementDescription, achievementName } from "../achievements";
import { cardDate } from "../duration";
import { useAchievements } from "../hooks/useAchievements";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import AchievementBadge from "./AchievementBadge";
import AchievementModal from "./AchievementModal";
import AchievementProgress from "./AchievementProgress";
import { Icon } from "./icons";
import "./UserAchievements.css";

/** What a finished sing earned, for everybody it earned something. */
interface AchievementsEarned extends WingmanEvent {
  sing_id: string;
  players: { player: PlayerRead; achievements: AchievementRead[] }[];
}

/**
 * A row for an achievement the player holds none for. `GET /players/{id}/
 * achievements` answers with the rows a pass has written, and a player who has
 * never been scored has none at all — so the catalogue is what says how many
 * there are to reach, and this is the shape it is read in.
 *
 * The catalogue is masked over the reader and this list over its subject, which
 * on the reader's own page is the same person: a hidden one neither has earned
 * arrives blank from both.
 */
function unearned(
  achievement: AchievementRead,
  playerId: string,
): PlayerAchievementRead {
  return {
    achievement_id: achievement.id,
    player_id: playerId,
    earned_at: null,
    session_id: null,
    // No progress, and not a guess at one: nothing has been computed for a
    // player nothing was computed for.
    progress_current: null,
    progress_target: null,
    achievement,
  };
}

/** One achievement on the singer's record: the badge, the name and the
 *  sentence, and then either the day it was earned or how far along they are.
 *  The whole row is the button that opens it large — the badge is decorative,
 *  so what a screen reader announces is the row's own words (§5). */
function AchievementRow({
  row,
  onOpen,
}: {
  row: PlayerAchievementRead;
  onOpen: () => void;
}) {
  const earned = row.earned_at !== null;

  return (
    <li
      className={
        earned ? "user-achievement" : "user-achievement user-achievement-off"
      }
    >
      <button
        type="button"
        className="user-achievement-button"
        onClick={onOpen}
      >
        <AchievementBadge achievement={row.achievement} earned={earned} />
        <span className="user-achievement-text">
          <span className="user-achievement-name">
            {achievementName(row.achievement)}
          </span>
          <span className="user-achievement-description">
            {achievementDescription(row.achievement)}
          </span>
          {row.earned_at !== null ? (
            <span className="user-achievement-meta">
              Earned {cardDate(row.earned_at)}
            </span>
          ) : (
            <AchievementProgress
              current={row.progress_current}
              target={row.progress_target}
            />
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * What one singer has earned, on their own page: the badges they hold in a
 * wrapping strip with "7 of 35" beside them, and behind that strip the whole
 * list — earned first, then the ones still out there, both halves in the
 * catalogue's own order.
 *
 * Part of the singer's record (§7's *User*), between the scores above it and
 * the *Manage* errands below, and closed at rest so it never pushes those off
 * the screen.
 *
 * Nothing at all is drawn while the feature is switched off, while either
 * request is in flight or after one failed: a badge strip is a bonus on this
 * page, exactly as the stat bar above it is, and neither is worth a loading bar
 * or an alert of its own.
 *
 * Every badge and every row opens the same modal, the strip's included — a
 * badge is a picture, and a picture 30px across is a thing to tap rather than a
 * thing to look at.
 */
export default function UserAchievements({
  playerId,
}: {
  playerId: string | null;
}) {
  const queryClient = useQueryClient();
  // The achievement being shown large, by id rather than by row: a refetch
  // while the modal is open — the singer earned it a moment ago, the host
  // renamed it — then redraws what is open instead of holding a snapshot from
  // the moment it was tapped, and one that has gone closes it.
  const [shownId, setShownId] = useState<string | null>(null);
  // Behind no capability: reading achievements needs none, and the API masks
  // per caller. The catalogue rides on the one request every badge surface
  // makes, and is what says how many there are to reach.
  const catalogue = useAchievements();
  const record = useQuery({
    ...listPlayerAchievementsOptions({ path: { player_id: playerId ?? "" } }),
    // Behind the catalogue rather than beside it: `enabled` starts true so no
    // badge blinks out of existence for the length of one request, which would
    // make an instance with the feature switched off ask for a record it will
    // never draw. Nothing is drawn until both answers are in either way.
    enabled: playerId !== null && catalogue.isSuccess && catalogue.enabled,
  });

  const refresh = (): void => {
    if (playerId === null) return;
    void queryClient.invalidateQueries({
      queryKey: listPlayerAchievementsQueryKey({
        path: { player_id: playerId },
      }),
    });
  };

  // The singer who just earned something and picks their phone up: the badge is
  // on the strip before they have found the page. The event names every player
  // of the sing, so a duet partner's row refetches nothing here.
  useWingmanEvent<AchievementsEarned>("achievements.earned", (message) => {
    if (message.players.some(({ player }) => player.id === playerId)) refresh();
  });
  // The catalogue itself changed — a row appeared, went, or was renamed under
  // the badge this list draws. `useAchievements` refetches the catalogue; the
  // record is the other half of the same answer. The re-evaluation the write
  // started may land after this, and nothing is broadcast when it finishes:
  // what a pass moved shows up on the next visit.
  useWingmanEvent("achievements.changed", refresh);

  const rows = record.data?.achievements;
  const known = catalogue.achievements;
  const ordered = useMemo(() => {
    // Disabled achievements are dropped, the way the backend drops their rows:
    // one nobody is being evaluated against is not something to reach for.
    const offered = known.filter((achievement) => achievement.enabled);
    const held = new Map((rows ?? []).map((row) => [row.achievement_id, row]));
    const all = offered.map(
      (achievement) =>
        held.get(achievement.id) ?? unearned(achievement, playerId ?? ""),
    );
    // A row for something the catalogue has not got — a pass that has not run
    // since, an answer from before the last edit — is kept rather than dropped.
    const seen = new Set(offered.map((achievement) => achievement.id));
    for (const row of rows ?? [])
      if (!seen.has(row.achievement_id)) all.push(row);

    // The catalogue's own order — `sort_order`, the arrangement the host made
    // on /user/achievements — with the earned ones ahead of the rest. Not the
    // day they were earned: badges read in the host's own order, so the same
    // relative order reads on the TV, on the admin page and here. `all` is
    // already in that order and both filters keep it, so the partition below is
    // the only thing this does.
    return [
      ...all.filter((row) => row.earned_at !== null),
      ...all.filter((row) => row.earned_at === null),
    ];
  }, [known, rows, playerId]);

  if (playerId === null || !catalogue.enabled) return null;
  if (record.data === undefined || !catalogue.isSuccess) return null;
  // An instance whose achievements were all switched off has nothing to say.
  if (ordered.length === 0) return null;

  const earned = ordered.filter((row) => row.earned_at !== null);
  const shown = ordered.find((row) => row.achievement_id === shownId);

  return (
    <>
      <details className="user-achievements">
        {/* The line is the control: the heading opens the list, is a tab stop
            of its own and says "Achievements, 7 of 35" when it is read out.
            The badges under it are their own buttons — see below. */}
        <summary className="user-achievements-summary">
          <span className="user-achievements-heading">
            <span className="user-achievements-label">Achievements</span>
            <span className="user-achievements-count">
              {earned.length} of {ordered.length}
            </span>
            {/* Two glyphs, one drawn: a chevron that turns would be the rotation
                §5 rules out, and the state is the stylesheet's to read. */}
            <Icon
              name="chevron-right"
              className="user-achievements-chevron user-achievements-chevron-closed"
            />
            <Icon
              name="chevron-down"
              className="user-achievements-chevron user-achievements-chevron-open"
            />
          </span>
          {earned.length > 0 ? (
            <span className="user-achievements-strip">
              {earned.map((row) => (
                <button
                  key={row.achievement_id}
                  type="button"
                  className="user-achievements-badge-button"
                  // The badge is `aria-hidden`, so the button says what it is.
                  aria-label={achievementName(row.achievement)}
                  onClick={(event) => {
                    // The press is inside the `<summary>`, whose activation
                    // behaviour would fold the list out behind the modal.
                    // Cancelling the click's default action is what stops it —
                    // the toggle is the default action, not a listener, so
                    // holding the event back from the summary would not do.
                    event.preventDefault();
                    setShownId(row.achievement_id);
                  }}
                >
                  <AchievementBadge achievement={row.achievement} />
                </button>
              ))}
            </span>
          ) : (
            // An invitation, not a verdict: nothing has gone wrong, the evening
            // simply has not started yet.
            <span className="user-achievements-none">
              Nothing yet. The first one is a song away.
            </span>
          )}
        </summary>

        <ul className="user-achievements-list">
          {ordered.map((row) => (
            <AchievementRow
              key={row.achievement_id}
              row={row}
              onOpen={() => setShownId(row.achievement_id)}
            />
          ))}
        </ul>
      </details>
      {/* Outside the `<details>`, not inside it: every click in the modal
          bubbles, and a modal rendered under the summary would toggle the list
          each time somebody pressed its close button. */}
      {shown !== undefined && (
        <AchievementModal row={shown} onClose={() => setShownId(null)} />
      )}
    </>
  );
}
