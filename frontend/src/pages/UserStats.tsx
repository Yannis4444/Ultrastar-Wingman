import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SongRead } from "../api";
import { listPlayerScoresOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import ScoreGroupList from "../components/ScoreGroupList";
import ScoresEmpty from "../components/ScoresEmpty";
import SongDetails from "../components/SongDetails";
import SpreadRows from "../components/SpreadRows";
import { errorMessage } from "../errors";
import { groupScores, sortGroups, type Sorting } from "../stats";
// The rules are the Scores page's; this view is the same list with one singer
// in it, so it shares the stylesheet instead of restating it.
import "./Scores.css";

/** The four score orders the Scores page opens with, wording included. That
 * page also offers *chronological*; here every row is a song rather than a
 * point in the evening, and the whole history is not an evening. */
const SORTINGS: { value: Sorting; label: string }[] = [
  { value: "alphabetically", label: "alphabetically" },
  { value: "average", label: "average score" },
  { value: "best", label: "best score" },
  { value: "worst", label: "worst score" },
];

/** The list itself, once it is known that there is a player to list. */
function History({ playerId }: { playerId: string }) {
  // The old app's default order, and the one a scoreboard is read for.
  const [sorting, setSorting] = useState<Sorting>("best");
  const [openSong, setOpenSong] = useState<SongRead | null>(null);

  const scores = useQuery(
    listPlayerScoresOptions({ path: { player_id: playerId } }),
  );

  if (scores.isPending) return <Loading />;

  if (scores.isError) {
    return (
      <p className="error-notice scores-session-error" role="alert">
        {errorMessage(scores.error, "Could not load your scores.")}
      </p>
    );
  }

  const rows = scores.data?.scores ?? [];
  // Always by song: it is the only grouping that says something about a single
  // singer — grouping one player by player would be one row.
  const groups = sortGroups(groupScores(rows, "song"), sorting);

  if (groups.length === 0) {
    return (
      <ScoresEmpty>
        Sing a song and your whole record builds up here.
      </ScoresEmpty>
    );
  }

  return (
    <>
      {/* One control, and the quiet kind: the reader came for the list. */}
      <div className="scores-controls">
        <label className="scores-control">
          <span className="scores-control-label">Sort</span>
          <select
            className="text-input text-input-quiet"
            value={sorting}
            onChange={(event) => setSorting(event.target.value as Sorting)}
          >
            {SORTINGS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* One song's spread says nothing a single row does not. */}
      {groups.length >= 2 && (
        <div className="scores-chart">
          <h2 className="scores-chart-title">Score spread</h2>
          {/* No initials: every score in here is the reader's own, so every
              mark would wear the same letter. Dated tooltips: two runs of one
              song can be months apart, and a bare clock time would lie. */}
          <SpreadRows
            groups={groups}
            grouping="song"
            label="Score spread per song"
            initials={false}
            dated
          />
        </div>
      )}

      {/* Every score in here is the reader's own, so the singer's name behind
          the panel's best and worst would be the same word twice. `ownRows`
          does the same for the expanded rows, which led with the reader's own
          avatar and name once per score: under one song those rows would be
          identical, so they lead with the date and time instead. */}
      <ScoreGroupList
        groups={groups}
        grouping="song"
        sorting={sorting}
        /* Empty on purpose: the map only feeds avatars, and `ownRows` is what
           took the reader's own avatar off every row. Nothing here needs the
           roster, so nothing here fetches it. */
        players={new Map()}
        onOpenSong={setOpenSong}
        namedPeaks={false}
        ownRows
      />

      {openSong !== null && (
        <SongDetails song={openSong} onClose={() => setOpenSong(null)} />
      )}
    </>
  );
}

/**
 * Everything the logged-in account ever sang, across every party — the whole
 * history the User page's stat bar totals into five numbers.
 *
 * One account, one player: the page shows `auth.user.player_id` and nothing
 * else, which is why it needs no id in its URL.
 */
export default function UserStats() {
  const auth = useAuth();
  const playerId = auth.user?.player_id ?? null;

  return (
    <div className="scores-page">
      <PageHeader title="Your scores" back="/user" />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight,
          and `player_id` is not known either. */}
      {auth.loaded &&
        (!auth.can("stats.view") ? (
          <p className="settings-notice">
            Statistics are not open to your role. Log in or ask the host for
            access.
          </p>
        ) : playerId === null ? (
          <p className="settings-notice">
            Your account is not linked to a player yet, so there is nothing to
            total up.
          </p>
        ) : (
          <History playerId={playerId} />
        ))}
    </div>
  );
}
