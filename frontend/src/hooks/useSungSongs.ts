import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  listPlayerScoresOptions,
  listPlayerScoresQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "./useWingmanEvents";

export interface SungSongs {
  /**
   * False when nothing can be marked: a browser without an account, an account
   * with no player behind it, or a role that may not read statistics.
   */
  available: boolean;
  /** The songs this account ever got a score on, across every party. */
  ids: Set<string>;
  isPending: boolean;
}

/**
 * What the logged-in account has sung before — the microphone on the row and
 * the "Sung" filter on the songs page.
 *
 * Scores rather than sings: a score carries the player id, and that is the only
 * thing tying one run of a song to one account. A sing USDX never scored (no
 * microphone, stopped early) belongs to nobody in particular, so it cannot show
 * up here. Same query as the user's own statistics page, so the two share one
 * cached history instead of fetching it twice.
 *
 * A score whose song has since left the library comes back with `song: null` —
 * there is no row left to mark, so it is dropped.
 */
export function useSungSongs(): SungSongs {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const playerId = auth.user?.player_id ?? null;
  // The `user` check already covers the window before `/auth/me` answered, when
  // `can` says yes to everything.
  const available = playerId !== null && auth.can("stats.view");

  const scores = useQuery({
    ...listPlayerScoresOptions({ path: { player_id: playerId ?? "" } }),
    enabled: available,
  });

  // A score of the reader's own lands mid-party, and the row it belongs to is
  // on screen while it does. A moderator's correction is the same thing from
  // the other side: a score moved onto — or off — this reader changes which
  // songs carry their "sung" mark.
  const refresh = () => {
    if (!available) return;
    void queryClient.invalidateQueries({
      queryKey: listPlayerScoresQueryKey({
        path: { player_id: playerId ?? "" },
      }),
    });
  };

  useWingmanEvent("scores.recorded", refresh);
  useWingmanEvent("scores.changed", refresh);

  const rows = scores.data?.scores;
  return useMemo(
    () => ({
      available,
      ids: new Set(
        (rows ?? [])
          .map((score) => score.song?.id)
          .filter((id): id is string => id !== undefined && id !== null),
      ),
      isPending: available && scores.isPending,
    }),
    [rows, available, scores.isPending],
  );
}
