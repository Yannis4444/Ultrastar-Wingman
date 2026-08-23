import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WishRead } from "../api";
import {
  addWishMutation,
  listWishlistOptions,
  listWishlistQueryKey,
  removeWishMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail } from "../errors";
import { useWingmanEvent } from "./useWingmanEvents";

export interface Wishlist {
  wishes: WishRead[];
  isPending: boolean;
  /** Whether this browser (account or guest cookie) wished for the song. */
  mine: (songId: string) => boolean;
  wish: (songId: string) => void;
  unwish: (songId: string) => void;
  /** Last failed wish mutation, for a notice next to the button. */
  error: unknown;
}

/**
 * The global wishlist plus the two mutations, shared by the home tile, the
 * spinner and the song details.
 *
 * `wishlist.updated` only carries a song id and the new count — not the song
 * itself and not whether the caller is one of the wishers — so a broadcast
 * refetches the (small) list instead of being folded into the cache.
 */
export function useWishlist(): Wishlist {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: listWishlistQueryKey() });

  const wishlist = useQuery({
    ...listWishlistOptions(),
    enabled: auth.loaded && auth.can("wishlist.view"),
  });

  useWingmanEvent("wishlist.updated", refresh);

  const add = useMutation({
    ...addWishMutation(),
    // Already wished means the UI was stale, not that the click failed.
    onSettled: refresh,
  });
  const remove = useMutation({ ...removeWishMutation(), onSettled: refresh });

  const wishes = wishlist.data?.wishes ?? [];
  // A wish that was already there (or already gone) means the list was stale;
  // the refetch fixes the button, there is nothing to tell the user.
  const stale = ["already_wished", "not_wished"];
  const failure = [add.error, remove.error].find(
    (error) => error && !stale.includes(errorDetail(error) ?? ""),
  );

  return {
    wishes,
    isPending: wishlist.isPending,
    mine: (songId) =>
      wishes.some((wish) => wish.song.id === songId && wish.mine),
    wish: (songId) => add.mutate({ body: { song_id: songId } }),
    unwish: (songId) => remove.mutate({ path: { song_id: songId } }),
    error: failure ?? null,
  };
}
