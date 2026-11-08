import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ScoreWithContext, SongRead } from "../api";
import {
  listPlayerScoresOptions,
  listPlayersOptions,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import ScoreGroupList from "../components/ScoreGroupList";
import ScoresEmpty from "../components/ScoresEmpty";
import ScoreStrip from "../components/ScoreStrip";
import ShareCardPanel, { type ShareTarget } from "../components/ShareCardPanel";
import SingView from "../components/SingView";
import SongDetails from "../components/SongDetails";
import { errorMessage } from "../errors";
import { playerStatsShareable } from "../shareCard/possible";
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
  // The run whose sing is open: who else sang it, and Share.
  const [openScore, setOpenScore] = useState<ScoreWithContext | null>(null);

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

      {/* The Scores page's headline picture, over one singer's whole record,
          in the same flat chart area under the same quiet title: every score,
          not the groups — a song sung three times is a shape, which is why
          the strip counts scores rather than songs. A single score is its own
          headline and no picture at all. Dated tooltips: two runs of one song
          can be months apart, and a bare clock time would lie. */}
      {rows.length >= 2 && (
        <div className="scores-chart">
          <h2 className="scores-chart-title">All scores</h2>
          {/* Unnamed gold: the whole page is this one singer's record, and
              their name on their own best says nothing (§1.5). */}
          <ScoreStrip
            scores={rows}
            label="Every score you ever got"
            dated
            named={false}
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
           roster; the share card asks for it when it opens. */
        players={new Map()}
        onOpenSong={setOpenSong}
        onOpenScore={setOpenScore}
        namedPeaks={false}
        ownRows
      />

      {openSong !== null && (
        <SongDetails song={openSong} onClose={() => setOpenSong(null)} />
      )}

      {/* The sing view reads its own roster: a duet partner's face is not
          the reader's, so the empty map above would not do there. */}
      {openScore !== null && (
        <SingView score={openScore} onClose={() => setOpenScore(null)} />
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
  const reading = auth.loaded && auth.can("stats.view") && playerId !== null;
  // The same query `History` reads, so it is one request: the header's share
  // button waits for the record and is not drawn while it is empty.
  const scores = useQuery({
    ...listPlayerScoresOptions({ path: { player_id: playerId ?? "" } }),
    enabled: reading,
  });
  const rows = scores.data?.scores ?? [];
  // The card needs one design it can draw: four scores, or two songs.
  const shareable = playerStatsShareable(rows);
  const [sharing, setSharing] = useState(false);
  // The card draws the reader's own picture, which is in the roster: asked
  // for once the card is, and the panel waits for the answer, so it is never
  // drawn first with the initial. A reader who may not list players — or
  // whose roster read failed — gets their initial, as everywhere else.
  const askRoster = sharing && auth.can("players.view");
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: askRoster,
  });
  // Kept as they are across renders, as `/scores` keeps its own: the panel
  // works its card out again whenever either changes.
  const roster = playerList.data?.players;
  const players = useMemo(
    () => new Map((roster ?? []).map((player) => [player.id, player])),
    [roster],
  );
  const record = scores.data?.scores;
  const target = useMemo<ShareTarget>(
    () => ({ kind: "player", scores: record ?? [], session: null }),
    [record],
  );
  const rosterSettled = !askRoster || !playerList.isPending;

  return (
    <div className="scores-page">
      <PageHeader title="Your scores" back="/user">
        {/* A page-level control (ui-guidelines §6): the whole record as a
            card (share-cards §9), once the record makes one with a design
            to draw. */}
        {reading && scores.isSuccess && shareable && (
          <button
            type="button"
            className="icon-button icon-button-bordered"
            aria-label="Share my stats"
            title="Share my stats"
            onClick={() => setSharing(true)}
          >
            <Icon name="share" />
          </button>
        )}
      </PageHeader>
      {sharing && shareable && rosterSettled && (
        <ShareCardPanel
          target={target}
          players={players}
          onClose={() => setSharing(false)}
        />
      )}
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight,
          and `player_id` is not known either. */}
      {auth.loaded &&
        (!auth.can("stats.view") ? (
          <p className="settings-notice">
            Statistics are not open to you. Log in or ask the host for access.
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
