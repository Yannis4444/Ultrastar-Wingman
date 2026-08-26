import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PlayerRead } from "../api";
import {
  listPlayersOptions,
  listSessionScoresOptions,
  listSessionScoresQueryKey,
  listSessionsOptions,
  listSessionsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { parseServerTime } from "../duration";
import {
  sessionLeaderboard,
  type LeaderboardEntry,
  type LeaderboardOrder,
} from "../stats";
import { useWingmanEvent } from "./useWingmanEvents";

export interface SessionStanding {
  /** The running party's singers, strongest first in the asked-for order. */
  entries: LeaderboardEntry[];
  /** Performances of the session that USDX scored — not the same as singers. */
  sings: number;
  /** Registered players by id, for the avatars the rows and bars draw. */
  players: Map<string, PlayerRead>;
}

/**
 * Where the running party stands: who has sung, how well, and the players the
 * avatars come from.
 *
 * It exists so the host screen fetches this once. The leaderboard lives in the
 * rail and the score bars on the stage, and both need the same three lists —
 * two components each asking for them would double the invalidation work every
 * time USDX scores a song.
 */
export function useSessionStanding(order: LeaderboardOrder): SessionStanding {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const canView = auth.loaded && auth.can("stats.view");

  const sessions = useQuery({ ...listSessionsOptions(), enabled: canView });
  // The party the backend would attach the next song to — `attach_to_session`
  // picks the session with the latest activity, so the standing does too.
  const session =
    [...(sessions.data?.sessions ?? [])].sort(
      (a, b) =>
        parseServerTime(b.last_activity_at) -
        parseServerTime(a.last_activity_at),
    )[0] ?? null;

  const sessionScores = useQuery({
    ...listSessionScoresOptions({ path: { session_id: session?.id ?? "" } }),
    enabled: canView && session !== null,
  });

  // Only for the avatars: a singer without a player record — a guest, or a
  // deleted player — still gets the initial `PlayerAvatar` draws for them.
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && auth.can("players.view"),
  });

  useWingmanEvent("scores.recorded", () => {
    // A finished song changes both which session is the newest and what it
    // holds; a stale standing next to fresh score bars is worse than none.
    void queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
    if (session !== null) {
      void queryClient.invalidateQueries({
        queryKey: listSessionScoresQueryKey({
          path: { session_id: session.id },
        }),
      });
    }
  });

  const scores = sessionScores.data?.scores;
  const roster = playerList.data?.players;
  return useMemo(() => {
    const played = scores ?? [];
    return {
      entries: sessionLeaderboard(played, order),
      sings: new Set(played.map((score) => score.sing_id)).size,
      players: new Map((roster ?? []).map((player) => [player.id, player])),
    };
  }, [scores, roster, order]);
}
