import type { PlayerRead } from "../api";
import {
  scorePlayer,
  type LeaderboardEntry,
  type LeaderboardOrder,
} from "../stats";
import PlayerAvatar from "./PlayerAvatar";
import "./SessionLeaderboard.css";

/** The three ways to read a party, in the wording of the Scores page. */
const ORDERS: { value: LeaderboardOrder; label: string }[] = [
  { value: "best", label: "best score" },
  { value: "average", label: "average" },
  { value: "sings", label: "sings" },
];

/** What the rail has room for beside the QR code and the wishes. */
const MAX_ROWS = 5;

/** Above this many rows the TV needs the tighter treatment to fit them. */
const DENSE_FROM = 4;

interface SessionLeaderboardProps {
  /** Already in the reader's order, strongest first. */
  entries: LeaderboardEntry[];
  order: LeaderboardOrder;
  onOrder: (order: LeaderboardOrder) => void;
  players: Map<string, PlayerRead>;
}

/**
 * Who is winning the party so far, aggregated over every score of the running
 * session — the standing that the single song's bars cannot show. It sits in
 * the host rail under the QR code, so it stays up while a song is playing.
 *
 * The order control carries `host-reveal`: it is mouse-only chrome and hides
 * with the rest of it when the host screen goes idle. The ranking does not.
 */
export default function SessionLeaderboard({
  entries,
  order,
  onOrder,
  players,
}: SessionLeaderboardProps) {
  const rows = entries.slice(0, MAX_ROWS);

  return (
    <section className="host-leaderboard" aria-label="Party leaderboard">
      <div className="host-leaderboard-head">
        <h2>Tonight</h2>
        <fieldset className="host-leaderboard-order host-reveal">
          <legend className="visually-hidden">Leaderboard order</legend>
          {ORDERS.map((option) => (
            <label key={option.value} className="host-order-option">
              <input
                className="visually-hidden"
                type="radio"
                name="host-leaderboard-order"
                value={option.value}
                checked={order === option.value}
                onChange={() => onOrder(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <ol
        className={
          rows.length > DENSE_FROM
            ? "host-leaderboard-list host-leaderboard-dense"
            : "host-leaderboard-list"
        }
      >
        {rows.map((entry, index) => (
          <li key={entry.key}>
            <span
              className={
                index < 3
                  ? "host-leaderboard-rank host-leaderboard-podium"
                  : "host-leaderboard-rank"
              }
            >
              {index + 1}
            </span>
            <PlayerAvatar
              player={scorePlayer(entry.top, players)}
              className="host-leaderboard-avatar"
            />
            <span className="host-leaderboard-name">{entry.name}</span>
            {/* A count is not a score: the multiplier says which one it is
                without a second label per row. */}
            <span className="host-leaderboard-value">
              {order === "sings" ? `${entry.value}×` : entry.value}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
