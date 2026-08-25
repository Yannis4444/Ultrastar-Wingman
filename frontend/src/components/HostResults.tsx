import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  getCurrentSingOptions,
  listLatestScoresOptions,
  listLatestScoresQueryKey,
  listPlayersOptions,
  listSessionScoresOptions,
  listSessionScoresQueryKey,
  listSessionsOptions,
  listSessionsQueryKey,
  listSongScoresOptions,
  listSongScoresQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { parseServerTime } from "../duration";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { sessionLeaderboard, type LeaderboardOrder } from "../stats";
import LastSong from "./LastSong";
import SessionLeaderboard from "./SessionLeaderboard";
import "./HostResults.css";

// A duet has two singers, USDX allows more; a handful covers the last song and
// leaves headroom without pulling the whole history onto the TV.
const LIMIT = 12;

// One performance ranks nobody: the bars right above already say the same
// thing. The leaderboard joins in once the party has a second sing to compare.
const MIN_SINGS = 2;

interface HostResultsProps {
  /** What the host stage shows instead while there is nothing to score. */
  fallback?: ReactNode;
}

/**
 * What the TV shows between songs: the song that just finished with its
 * all-time numbers and this run's score bars, next to the standing of the
 * running session.
 *
 * Seeded from `/stats/latest` so a reload right after a song still shows it,
 * refreshed when USDX reports new scores, and out of the way once the next song
 * starts.
 */
export default function HostResults({ fallback = null }: HostResultsProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  // What a scoreboard is read for, and the Scores page's default too.
  const [order, setOrder] = useState<LeaderboardOrder>("best");

  const canView = auth.can("stats.view");
  const latest = useQuery({
    ...listLatestScoresOptions({ query: { limit: LIMIT } }),
    enabled: auth.loaded && canView,
  });
  // Shares CurrentlyPlaying's cache entry: a page reloaded mid-song must not
  // show the previous song's scores next to the running one.
  const current = useQuery(getCurrentSingOptions());

  // The list is newest first and one sing's scores share a `sing_id`, so the
  // first row's sing is the one that just finished.
  const all = latest.data?.scores ?? [];
  const singId = all[0]?.sing_id;
  const scores = all
    .filter((score) => score.sing_id === singId)
    .sort((a, b) => b.score - a.score);
  // Null both when there is no sing and when its song has left the library.
  const song = scores[0]?.song ?? null;

  const history = useQuery({
    ...listSongScoresOptions({ path: { song_id: song?.id ?? "" } }),
    enabled: auth.loaded && canView && song !== null,
  });

  const sessions = useQuery({
    ...listSessionsOptions(),
    enabled: auth.loaded && canView,
  });
  // The party the backend would attach the next song to — `attach_to_session`
  // picks the session with the latest activity, so the leaderboard does too.
  const session =
    [...(sessions.data?.sessions ?? [])].sort(
      (a, b) =>
        parseServerTime(b.last_activity_at) -
        parseServerTime(a.last_activity_at),
    )[0] ?? null;
  const sessionScores = useQuery({
    ...listSessionScoresOptions({ path: { session_id: session?.id ?? "" } }),
    enabled: auth.loaded && canView && session !== null,
  });

  // Only for the avatars: a singer without a player record — a guest, or a
  // deleted player — still gets the initial `PlayerAvatar` draws for them.
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && auth.can("players.view"),
  });
  const players = new Map(
    (playerList.data?.players ?? []).map((player) => [player.id, player]),
  );

  useWingmanEvent("scores.recorded", () => {
    setDismissed(false);
    void queryClient.invalidateQueries({
      queryKey: listLatestScoresQueryKey({ query: { limit: LIMIT } }),
    });
    // The finished song changes the session's standing as well as its own
    // history; a stale leaderboard next to fresh bars is worse than none.
    void queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
    if (session !== null) {
      void queryClient.invalidateQueries({
        queryKey: listSessionScoresQueryKey({
          path: { session_id: session.id },
        }),
      });
    }
    if (song !== null) {
      void queryClient.invalidateQueries({
        queryKey: listSongScoresQueryKey({ path: { song_id: song.id } }),
      });
    }
  });
  useWingmanEvent("karaoke.started", () => setDismissed(true));

  // A live sing owns the stage — never results (or the fallback) next to it.
  if (current.isPending || current.data?.sing) return null;

  const played = sessionScores.data?.scores ?? [];
  const sings = new Set(played.map((score) => score.sing_id)).size;
  const entries = sessionLeaderboard(played, order);
  const showLeaderboard = canView && sings >= MIN_SINGS && entries.length > 0;

  // `dismissed`: a song was started, so whatever `/stats/latest` still holds
  // belongs to the run before it. It stays out until USDX scores again.
  const showLastSong = canView && !dismissed && scores.length > 0;
  const main = showLastSong ? (
    <LastSong
      song={song}
      scores={scores}
      history={history.data?.scores ?? []}
      players={players}
    />
  ) : (
    fallback
  );

  // The wrapper is unconditional: the leaderboard's own request lands a moment
  // after the scores, and a tree that changed shape for it would remount the
  // bars — restarting their 2s reveal in front of the room.
  return (
    <div
      className={
        showLeaderboard ? "host-results host-results-split" : "host-results"
      }
    >
      <div className="host-results-main">{main}</div>
      {showLeaderboard && (
        <SessionLeaderboard
          entries={entries}
          order={order}
          onOrder={setOrder}
          players={players}
        />
      )}
    </div>
  );
}
