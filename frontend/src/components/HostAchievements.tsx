import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  achievementDescription,
  achievementName,
  holdersLine,
} from "../achievements";
import type { AchievementRead, AchievementSettings, PlayerRead } from "../api";
import { useAchievements } from "../hooks/useAchievements";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import AchievementBadge from "./AchievementBadge";
import PlayerAvatar from "./PlayerAvatar";
import "./HostAchievements.css";

/** One singer of the finished sing and what they just earned. */
interface EarnedByPlayer {
  player: PlayerRead;
  achievements: AchievementRead[];
}

/**
 * `achievements.earned`: one event per **sing**, carrying every player who
 * earned something, in order. The whole sequence is choreographed out of this
 * one payload — a stream of per-player events could land the second singer's
 * badges in the middle of the first singer's row (achievements.md, *The events*).
 */
interface AchievementsEarned extends WingmanEvent {
  sing_id: string;
  players: EarnedByPlayer[];
}

/** What the stage is doing, so the page knows whose turn the stage is. */
export type HostAchievementsPhase = "idle" | "waiting" | "playing";

interface Props {
  /**
   * Called whenever the sequence changes hands. `waiting` is the beat between
   * the scores and the badges that may follow them, `playing` is the sequence
   * itself; on `idle` the stage belongs to the results again.
   */
  onPhase?: (phase: HostAchievementsPhase) => void;
  /**
   * What stands on the stage during the blank beat between two singers — the
   * brand, the same thing the stage shows when nothing is playing. The sequence
   * still owns the screen for that beat (the phase stays `playing`, so the page
   * keeps the rail down), and a TV with nothing at all on it for most of a
   * second reads as a fault rather than as a pause.
   */
  fallback?: ReactNode;
}

/** At most four badges land in one row; a fifth starts a fresh one. */
const ROW_SIZE = 4;

/**
 * How long the stage holds after `scores.recorded` for the badges that follow
 * it. The backend evaluates and broadcasts `achievements.earned` immediately
 * after the scores, so this is a fraction of a second in practice — but the
 * scoreboard flashing up and being pushed aside again is exactly what would
 * cheapen the reveal, so the stage waits rather than races. A party where
 * nobody earned anything pays for it with this much of a beat before the
 * results, which reads as a pause rather than as a delay.
 */
const ARM_MS = 1200;

/** The blank beat between one singer's last row and the next singer. */
const PLAYER_GAP_MS = 700;

/** A row that would otherwise be gone before it was drawn (both knobs at 0). */
const MIN_ROW_MS = 500;

/**
 * The first badge of a new singer waits for the name to have risen; a follow-on
 * row of the same singer keeps the name and starts almost at once.
 */
const LEAD_IN_MS = 380;
const ROW_IN_MS = 140;

/** Between two badges of the same row, so they land in sequence, not together. */
const BADGE_STAGGER_MS = 200;

/**
 * One step of the sequence: a singer and up to four badges, or — with a `null`
 * player — the blank beat that separates two singers. A step carries its own
 * duration, worked out from the settings the event arrived under: retiming the
 * host screen mid-sequence must not stretch the row that is on it.
 */
interface Step {
  player: PlayerRead | null;
  achievements: AchievementRead[];
  /** Whether this step introduces the singer, or carries on from their last row. */
  lead: boolean;
  dwellMs: number;
}

/** One `achievements.earned` payload, as the steps it plays out as. */
interface Run {
  /** Bumped per event, so a superseding payload really remounts the row. */
  id: number;
  steps: Step[];
}

/**
 * How long a row of badges stays: `host_seconds_base + host_seconds_per_badge ×
 * badges` (achievements.md, *Settings*). Both knobs are a host's to set, so a
 * pair that works out to nothing at all still gets long enough to be seen.
 */
function rowMs(count: number, settings: AchievementSettings): number {
  const seconds =
    settings.host_seconds_base + settings.host_seconds_per_badge * count;
  if (!Number.isFinite(seconds)) return MIN_ROW_MS;
  return Math.max(MIN_ROW_MS, Math.round(seconds * 1000));
}

/**
 * The payload as the sequence it plays: one singer after another, each of them
 * four badges at a time, with a beat in between. A singer who earned nothing is
 * not a step — the event should not carry one, and an empty row would be a
 * name over a gap.
 */
function buildSteps(
  players: EarnedByPlayer[],
  settings: AchievementSettings,
): Step[] {
  const steps: Step[] = [];
  for (const entry of players) {
    const earned = entry.achievements;
    if (earned.length === 0) continue;
    if (steps.length > 0) {
      steps.push({
        player: null,
        achievements: [],
        lead: false,
        dwellMs: PLAYER_GAP_MS,
      });
    }
    for (let start = 0; start < earned.length; start += ROW_SIZE) {
      const row = earned.slice(start, start + ROW_SIZE);
      steps.push({
        player: entry.player,
        achievements: row,
        lead: start === 0,
        dwellMs: rowMs(row.length, settings),
      });
    }
  }
  return steps;
}

/**
 * Where a badge is thrown from: slightly off-centre, alternating sides so a row
 * does not arrive as one block. Deterministic in the index — the same row looks
 * the same every time it is drawn, and nothing here is random.
 */
function throwFrom(index: number): { x: string; y: string } {
  const side = index % 2 === 0 ? -1 : 1;
  return {
    x: `${side * (10 + (index % 3) * 4)}%`,
    y: `${-16 - (index % 2) * 6}%`,
  };
}

/**
 * What a finished song just earned, on the TV: one singer after another, their
 * picture and name rising into the top of the stage and their new badges thrown
 * onto it one by one, four to a row.
 *
 * The whole sequence comes from one `achievements.earned` payload, so nothing
 * about it can race: the order is the event's order and the timing is the two
 * settings on `GET /achievements`. It owns the stage while it runs — the page
 * holds the results back — and hands it straight back when the last row is
 * done. A song starting cuts it short rather than playing over the next singer.
 */
export default function HostAchievements({ onPhase, fallback }: Props) {
  const { settings, enabled } = useAchievements();
  const [run, setRun] = useState<Run | null>(null);
  const [index, setIndex] = useState(0);
  /** Non-null while the stage is holding the beat after `scores.recorded`. */
  const [arm, setArm] = useState<number | null>(null);
  const runs = useRef(0);

  const stop = () => {
    setRun(null);
    setIndex(0);
    setArm(null);
  };

  // The scores are on the bus a moment before the badges they earned. Holding
  // the stage for that moment is what keeps the scoreboard from flashing up
  // between the two.
  useWingmanEvent("scores.recorded", () => {
    if (!enabled) return;
    setArm((token) => (token ?? 0) + 1);
  });

  useWingmanEvent<AchievementsEarned>("achievements.earned", (message) => {
    if (!enabled) return;
    const steps = buildSteps(message.players, settings);
    setArm(null);
    // Started even when the beat above has already expired: a slow evaluation
    // costs the reveal a flash of the scoreboard, never the reveal itself.
    if (steps.length === 0) return;
    runs.current += 1;
    setRun({ id: runs.current, steps });
    setIndex(0);
  });

  // The next song owns the screen the moment it starts; badges over a running
  // song would be the sequence outliving what it was about.
  useWingmanEvent("karaoke.started", stop);

  // Switched off mid-party: nothing is drawn, including whatever is on screen.
  useEffect(() => {
    if (!enabled) {
      setRun(null);
      setIndex(0);
      setArm(null);
    }
  }, [enabled]);

  useEffect(() => {
    if (arm === null) return;
    const timer = window.setTimeout(() => setArm(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [arm]);

  useEffect(() => {
    if (run === null) return;
    if (index >= run.steps.length) {
      // The last row has had its time: the stage goes back to the results.
      setRun(null);
      setIndex(0);
      return;
    }
    const timer = window.setTimeout(
      () => setIndex((step) => step + 1),
      run.steps[index].dwellMs,
    );
    return () => clearTimeout(timer);
  }, [run, index]);

  const playing = run !== null && index < run.steps.length;
  const phase: HostAchievementsPhase = playing
    ? "playing"
    : arm !== null
      ? "waiting"
      : "idle";
  // Before the paint, not after it: the page takes the rail down for `playing`
  // (§7), so a phase told one frame late would put this row on the screen once
  // at the narrow width — and hand the stage back to a full-width results
  // block for one frame when the next song cuts the sequence short.
  useLayoutEffect(() => {
    onPhase?.(phase);
  }, [onPhase, phase]);

  if (run === null || !playing) return null;
  const step = run.steps[index];
  // The beat between two singers: no badges and no name, but the sequence still
  // holds the screen — so the stage shows what it shows when nothing is
  // playing rather than going blank for most of a second.
  if (step.player === null) return <>{fallback}</>;

  const intro = step.lead ? LEAD_IN_MS : ROW_IN_MS;

  return (
    <section className="host-achievements" aria-label="New achievements">
      {/* Keyed by the singer, not by the step: the second row of six badges
          keeps the name that is already standing rather than raising it
          again — one arrival per singer is what the sequence is made of. */}
      <div
        className="host-achievement-player"
        key={`${run.id}-${step.player.id}`}
      >
        <PlayerAvatar
          player={step.player}
          className="host-achievement-avatar"
        />
        <p className="host-achievement-player-name">{step.player.name}</p>
      </div>

      {/* Keyed by the step so every row is a fresh mount and every badge is
          thrown again; the count sizes them, so one badge alone is not drawn
          at the size four of them share. */}
      <ul
        className="host-achievement-row"
        data-count={step.achievements.length}
        key={`${run.id}-${index}`}
      >
        {step.achievements.map((achievement, position) => {
          const from = throwFrom(position);
          // Off the payload, not the catalogue: an earn broadcasts no
          // `achievements.changed`, so the cached catalogue still has the
          // count from before this song, while the event's is counted after
          // the pass, the singer included.
          const holders = holdersLine(achievement, { singer: true });
          return (
            <li
              className="host-achievement"
              key={achievement.id}
              style={
                {
                  "--enter-delay": `${intro + position * BADGE_STAGGER_MS}ms`,
                  "--throw-x": from.x,
                  "--throw-y": from.y,
                } as CSSProperties
              }
            >
              <AchievementBadge
                achievement={achievement}
                className="host-achievement-badge"
              />
              <div className="host-achievement-text">
                <p className="host-achievement-name">
                  {achievementName(achievement)}
                </p>
                {achievementDescription(achievement) !== "" && (
                  <p className="host-achievement-description">
                    {achievementDescription(achievement)}
                  </p>
                )}
                {holders !== null && (
                  <p className="host-achievement-holders">{holders}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
