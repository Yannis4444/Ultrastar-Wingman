import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { TagRead } from "../api";
import {
  listSongsQueryKey,
  listTagAssignmentsOptions,
  listTagAssignmentsQueryKey,
  listTagsOptions,
  listTagsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "./useWingmanEvents";

export interface Tags {
  /**
   * The tags this reader may view — the only ones a reader-facing surface draws:
   * the marks on a song row, the song modal's Tags row, the filter panel.
   */
  tags: TagRead[];
  /**
   * Everything the listing returned. Identical to `tags` for everybody but a
   * `tags.manage` holder, who is also shown the tags they gave themselves no
   * right to see — the admin list is the one surface that wants those.
   */
  allTags: TagRead[];
  /** Song id -> the tags on it, in the listing's order (by name). */
  bySong: Map<string, TagRead[]>;
  /** The viewable tags that belong on every song row carrying them (§1.4). */
  showInList: TagRead[];
  /** The viewable tags whose songs the list leaves out until asked. */
  hideByDefault: TagRead[];
  isPending: boolean;
}

const NO_TAGS: TagRead[] = [];

/**
 * The party's tags and which songs carry them — two requests shared by every
 * surface that draws a tag, so the song list, the song modal and the reel all
 * read one cache.
 *
 * A permission change can hide or reveal *songs*, not only tags, which is why
 * `tags.changed` invalidates the song library as well.
 */
export function useTags(): Tags {
  const auth = useAuth();
  const queryClient = useQueryClient();
  // `can` says yes to everything until /auth/me answers, so the listings wait
  // for it rather than firing a request the role may not be allowed to make.
  const available = auth.loaded && auth.can("songs.view");

  const tags = useQuery({ ...listTagsOptions(), enabled: available });
  const assignments = useQuery({
    ...listTagAssignmentsOptions(),
    enabled: available,
  });

  useWingmanEvent("tags.changed", () => {
    void queryClient.invalidateQueries({ queryKey: listTagsQueryKey() });
    void queryClient.invalidateQueries({
      queryKey: listTagAssignmentsQueryKey(),
    });
    // A tag whose `view_songs` moved takes its songs with it, in or out.
    void queryClient.invalidateQueries({ queryKey: listSongsQueryKey() });
  });
  useWingmanEvent("song_tags.changed", () => {
    void queryClient.invalidateQueries({
      queryKey: listTagAssignmentsQueryKey(),
    });
  });

  const allTags = tags.data?.tags ?? NO_TAGS;
  const rows = assignments.data?.assignments;

  return useMemo(() => {
    const byId = new Map(allTags.map((tag) => [tag.id, tag]));
    const bySong = new Map<string, TagRead[]>();
    for (const row of rows ?? []) {
      const tag = byId.get(row.tag_id);
      // A tag the listing does not hold cannot be drawn; the two requests are
      // one snapshot apart while an event is being caught up with.
      if (tag === undefined) continue;
      for (const songId of row.song_ids) {
        const carried = bySong.get(songId);
        if (carried === undefined) bySong.set(songId, [tag]);
        else carried.push(tag);
      }
    }
    const viewable = allTags.filter((tag) => tag.can_view);
    return {
      tags: viewable,
      allTags,
      bySong,
      showInList: viewable.filter((tag) => tag.show_in_list),
      hideByDefault: viewable.filter((tag) => tag.hide_by_default),
      // Pending until it is known that there is nothing to wait for: a list
      // drawn before the tags are in shows what a tag is about to hide.
      isPending:
        !auth.loaded ||
        (available && (tags.isPending || assignments.isPending)),
    };
  }, [
    allTags,
    rows,
    auth.loaded,
    available,
    tags.isPending,
    assignments.isPending,
  ]);
}
