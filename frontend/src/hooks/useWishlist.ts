import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WishRead } from "../api";
import {
  addWishMutation,
  clearWishesMutation,
  listWishlistOptions,
  listWishlistQueryKey,
  removeWishMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail } from "../errors";
import { useWingmanEvent, type WingmanEvent } from "./useWingmanEvents";

interface SettingChanged extends WingmanEvent {
  key: string;
}

/** The switch that says what a wish weighs (`karaoke.weighting.FAIR_WISHES`). */
const FAIR_WISHES_SETTING = "karaoke.fair_wishes";

export interface Wishlist {
  wishes: WishRead[];
  isPending: boolean;
  /** Whether this browser (account or guest cookie) wished for the song. */
  mine: (songId: string) => boolean;
  wish: (songId: string) => void;
  unwish: (songId: string) => void;
  /** Take the song off the list for everybody — needs `wishlist.manage`. */
  clear: (songId: string) => void;
  /** Last failed wish mutation, for a notice next to the button. */
  error: unknown;
}

/**
 * The global wishlist plus the two mutations, shared by the home tile, the
 * spinner and the song details.
 *
 * `wishlist.updated` only carries a song id and the new count — not the song
 * itself and not whether the caller is one of the wishers — so a broadcast
 * refetches the (small) list instead of being folded into the cache. The
 * whole list, because one person's new wish moves the `weight` of every other
 * song they wished for.
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
  // A wish's `weight` moves without a wish row moving: the switch behind it,
  // and a scan that loses or finds the file of a song somebody wished for —
  // which changes how many wishes they hold in the library.
  useWingmanEvent<SettingChanged>("setting.changed", ({ key }) => {
    if (key === FAIR_WISHES_SETTING) refresh();
  });
  useWingmanEvent("songs.scan_finished", refresh);

  const add = useMutation({
    ...addWishMutation(),
    // Already wished means the UI was stale, not that the click failed.
    onSettled: refresh,
  });
  const remove = useMutation({ ...removeWishMutation(), onSettled: refresh });
  const clear = useMutation({ ...clearWishesMutation(), onSettled: refresh });

  const wishes = wishlist.data?.wishes ?? [];
  // A wish that was already there (or already gone) means the list was stale;
  // the refetch fixes the button, there is nothing to tell the user.
  const stale = ["already_wished", "not_wished"];
  const failure = [add.error, remove.error, clear.error].find(
    (error) => error && !stale.includes(errorDetail(error) ?? ""),
  );

  return {
    wishes,
    isPending: wishlist.isPending,
    mine: (songId) =>
      wishes.some((wish) => wish.song.id === songId && wish.mine),
    wish: (songId) => add.mutate({ body: { song_id: songId } }),
    unwish: (songId) => remove.mutate({ path: { song_id: songId } }),
    clear: (songId) => clear.mutate({ path: { song_id: songId } }),
    error: failure ?? null,
  };
}
