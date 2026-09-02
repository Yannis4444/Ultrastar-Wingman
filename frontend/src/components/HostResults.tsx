import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { PlayerRead } from "../api";
import {
  getCurrentSingOptions,
  listLatestScoresOptions,
  listLatestScoresQueryKey,
  listSongScoresOptions,
  listSongScoresQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import LastSong from "./LastSong";
import "./HostResults.css";

// A duet has two singers, USDX allows more; a handful covers the last song and
// leaves headroom without pulling the whole history onto the TV.
const LIMIT = 12;

interface HostResultsProps {
  /** For the avatars, from the page's `useSessionStanding()`. */
  players: Map<string, PlayerRead>;
  /** What the host stage shows instead while there is nothing to score. */
  fallback?: ReactNode;
  /**
   * True while something else owns the stage — the achievements a finished song
   * just earned, which play before the results and hand the stage back when
   * they are done. The block waits rather than draws, and the `fallback` is
   * what stands in its place; everything it listens for carries on, so the run
   * it is holding back is the right one by the time it is let go.
   */
  suppressed?: boolean;
}

/**
 * The host stage between songs: the song that just finished, what it has scored
 * over its whole life, and a bar per singer of this run.
 *
 * Seeded from `/stats/latest` so a reload right after a song still shows it,
 * refreshed when USDX reports new scores, and out of the way once the next song
 * starts. The party's standing is not here — it lives in the rail, where it
 * stays up while a song is playing.
 */
export default function HostResults({
  players,
  fallback = null,
  suppressed = false,
}: HostResultsProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

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

  useWingmanEvent("scores.recorded", () => {
    setDismissed(false);
    void queryClient.invalidateQueries({
      queryKey: listLatestScoresQueryKey({ query: { limit: LIMIT } }),
    });
    if (song !== null) {
      void queryClient.invalidateQueries({
        queryKey: listSongScoresQueryKey({ path: { song_id: song.id } }),
      });
    }
  });
  useWingmanEvent("karaoke.started", () => setDismissed(true));

  // A live sing owns the stage — never results (or the fallback) next to it.
  if (current.isPending || current.data?.sing) return null;

  // `dismissed`: a song was started, so whatever `/stats/latest` still holds
  // belongs to the run before it. It stays out until USDX scores again.
  // `suppressed`: the scores are the right ones, but the stage is not this
  // block's for the moment — the badges the song earned are on it.
  const showLastSong =
    canView && !dismissed && !suppressed && scores.length > 0;

  // The wrapper is unconditional: the song history lands a moment after the
  // scores, and a tree that changed shape for it would remount the bars —
  // restarting their 2s reveal in front of the room.
  return (
    <div className="host-results">
      {showLastSong ? (
        <LastSong
          song={song}
          scores={scores}
          history={history.data?.scores ?? []}
          players={players}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
