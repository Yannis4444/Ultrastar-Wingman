import type { TagRead } from "./api";
import { ICON_PATHS, type IconName } from "./components/icons";

/** The colours a tag may be drawn in, in the order the editor offers them.
 *  Mirrors `TAG_COLORS` in the backend's `tags/model.py`. */
export const TAG_COLORS = ["neutral", "blue", "pink", "gold"] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/**
 * The glyph of a tag. The backend only checks the *shape* of an icon name — it
 * ships no icon list — so a tag can name a glyph this frontend does not have,
 * and a tag may have no icon at all. Both fall back to `tag` itself (§3), never
 * to an empty `<path>`.
 */
export function tagGlyph(icon: string | null): IconName {
  return icon !== null && icon in ICON_PATHS ? (icon as IconName) : "tag";
}

/**
 * The class that paints a tag in its colour. An unknown colour — a value the
 * backend grew after this build — reads as the plain one rather than as no
 * class at all, which would leave the glyph in whatever colour it inherited.
 */
export function tagColorClass(color: string): string {
  const known = (TAG_COLORS as readonly string[]).includes(color);
  return `tag-color-${known ? color : "neutral"}`;
}

/**
 * The tags of one song that belong on its row: visible to this reader and asked
 * for by their tag (§1.4). A tag the reader may not view only ever reaches the
 * client for a `tags.manage` holder, and managing a tag is not knowing it.
 */
export function markTags(tags: readonly TagRead[] | undefined): TagRead[] {
  return (tags ?? []).filter((tag) => tag.can_view && tag.show_in_list);
}

/**
 * What the song list is asked about one tag: *Any* ignores it, *Yes* keeps only
 * the songs carrying it, *No* drops them. The three of §4's tri-state, so the
 * filter panel sets exactly this.
 */
export type TagCriterion = "any" | "yes" | "no";

/** Tag id -> what the list is asked about it. */
export type TagCriteria = ReadonlyMap<string, TagCriterion>;

/**
 * Where the criteria start: every tag the reader may view is on *Any*, except a
 * `hide_by_default` one, which opens on *No* — that flag is exactly "leave these
 * out until somebody asks". Every viewable tag gets an entry even when it is on
 * *Any*, so the panel has one row per tag and counting the ones off *Any* is a
 * count of this map.
 */
export function defaultTagCriteria(
  tags: readonly TagRead[],
): Map<string, TagCriterion> {
  return new Map(
    tags
      .filter((tag) => tag.can_view)
      .map((tag) => [tag.id, tag.hide_by_default ? "no" : "any"]),
  );
}

/** Whether one song survives the criteria. A tag with no entry is on *Any*. */
export function passesTagCriteria(
  songId: string,
  bySong: ReadonlyMap<string, TagRead[]>,
  criteria: TagCriteria,
): boolean {
  const carried = bySong.get(songId);
  for (const [tagId, criterion] of criteria) {
    if (criterion === "any") continue;
    const has = (carried ?? []).some((tag) => tag.id === tagId);
    if (has !== (criterion === "yes")) return false;
  }
  return true;
}
