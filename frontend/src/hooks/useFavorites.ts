import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * The caller's favorites with an optimistic toggle: the heart flips on click and
 * flips back if the request fails.
 */
export function useFavorites(): Favorites {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const available = auth.user !== null;
  const key = listFavoritesQueryKey();

  const favorites = useQuery({ ...listFavoritesOptions(), enabled: available });
  const ids = new Set(favorites.data?.song_ids ?? []);

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
