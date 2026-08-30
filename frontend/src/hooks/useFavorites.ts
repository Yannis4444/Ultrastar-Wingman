import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FavoritesRead } from "../api";
import {
  addFavoriteMutation,
  listFavoritesOptions,
  listFavoritesQueryKey,
  removeFavoriteMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";

export interface Favorites {
  /** False for an anonymous browser: favorites need an account to belong to. */
  available: boolean;
  ids: Set<string>;
  toggle: (songId: string) => void;
}

export interface FavoritesOptions {
  /**
   * Whether the listing is fetched at all. For a surface that only sometimes
   * needs it — the reel over a fixed playlist never does. Only for a caller
   * that draws no heart: without the listing `ids` is empty, so `toggle` would
   * favorite a song that already is one. `available` still answers on its own,
   * so a caller may ask whether there is an account without fetching anything.
   */
  enabled?: boolean;
}

/**
 * The caller's favorites with an optimistic toggle: the heart flips on click and
 * flips back if the request fails.
 */
export function useFavorites({
  enabled = true,
}: FavoritesOptions = {}): Favorites {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const available = auth.user !== null;
  const key = listFavoritesQueryKey();

  const favorites = useQuery({
    ...listFavoritesOptions(),
    enabled: available && enabled,
  });
  // One set per answer, not one per render: the Songs list memoizes what it
  // shows on this very set, and a fresh one every time made that memo — over
  // thousands of songs — recompute on every keystroke. The optimistic toggle
  // below writes a new `data` object, so the set still moves with the heart.
  const data = favorites.data;
  const ids = useMemo(() => new Set(data?.song_ids ?? []), [data]);

  const flip = (songId: string, wanted: boolean): FavoritesRead | undefined => {
    const previous = queryClient.getQueryData<FavoritesRead>(key);
    const kept = (previous?.song_ids ?? []).filter((id) => id !== songId);
    queryClient.setQueryData<FavoritesRead>(key, {
      song_ids: wanted ? [...kept, songId] : kept,
    });
    return previous;
  };
  const rollback = (previous: FavoritesRead | undefined) =>
    queryClient.setQueryData(key, previous);

  const add = useMutation({
    ...addFavoriteMutation(),
    onMutate: (options) => flip(options.path.song_id, true),
    onError: (_error, _options, previous) => rollback(previous),
  });
  const remove = useMutation({
    ...removeFavoriteMutation(),
    onMutate: (options) => flip(options.path.song_id, false),
    onError: (_error, _options, previous) => rollback(previous),
  });

  return {
    available,
    ids,
    toggle: (songId) =>
      (ids.has(songId) ? remove : add).mutate({ path: { song_id: songId } }),
  };
}
