import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SingRead, SongRead } from "../api";
import {
  listCurrentSessionSingsOptions,
  listCurrentSessionSingsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "./useWingmanEvents";

export interface RecentlyPlayed {
  /** The songs of the running party, the one played last at the front. */
  songs: SongRead[];
  /** Song id -> when it last started, for the clock time on the row. */
  startedAt: Map<string, string>;
  isPending: boolean;
}

/**
 * What the running party has played — the Songs page's "Recently played" tab.
 *
 * The backend decides what "this session" is (the same six-hour idle rule a
 * starting sing follows), lists sings rather than scores, and deduplicates by
 * song, so nothing here has to reconstruct a history from scoreboard rows: a
 * song USDX never got round to scoring was still played.
 *
 * A sing whose song has since left the library comes back with `song: null` —
 * there is no row to draw for it, so it is dropped here.
 */
export function useRecentlyPlayed(): RecentlyPlayed {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const enabled = auth.loaded && auth.can("stats.view");

  const sings = useQuery({ ...listCurrentSessionSingsOptions(), enabled });

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: listCurrentSessionSingsQueryKey(),
    });
  // The sing row is committed before `karaoke.started` is broadcast, so a
  // refetch on the event always sees the song that just went on screen. The end
  // of a song leaves the list unchanged, but it is when the sing that USDX
  // scored nothing for is finally over — refetching there keeps a stale row from
  // outliving the party.
  useWingmanEvent("karaoke.started", refresh);
  useWingmanEvent("karaoke.ended", refresh);

  const rows = sings.data?.sings;
  return useMemo(() => {
    const played = (rows ?? []).filter(
      (sing): sing is SingRead & { song: SongRead } => sing.song !== null,
    );
    return {
      songs: played.map((sing) => sing.song),
      startedAt: new Map(
        played.map((sing) => [sing.song_id, sing.started_at] as const),
      ),
      isPending: enabled && sings.isPending,
    };
  }, [rows, enabled, sings.isPending]);
}
