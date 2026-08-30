import type { BuiltInTagRead, TagRead } from "./api";
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
 * The two per-reader marks. `GET /tags` answers eight built-ins — the marks and
 * the six facets the song files already carry — and every surface here draws
 * the two it knows; the rest are the Filter panel's and the admin's, and are
 * taught to this module in their own batch.
 */
export type BuiltInTagId = "favorites" | "sung";

/** In the order §7's *Built-in* section lists them — the heart everybody knows
 *  first. Their order on a song row is the other way round and belongs to
 *  `SongListItem` alone (§1.4: the microphone, then the heart, then the tags). */
export const BUILT_IN_TAG_IDS = ["favorites", "sung"] as const;

/**
 * What is fixed about a built-in: its glyph and what the app calls it. Only the
 * colour and `show_in_list` are the party's to decide — a mark is a fact about
 * one reader (my favorites, the songs I have sung), so it has no name to rename,
 * no icon to pick, nobody to grant it to and nothing to delete.
 */
export const BUILT_IN_TAGS: Record<
  BuiltInTagId,
  { name: string; icon: IconName }
> = {
  favorites: { name: "Favorites", icon: "heart" },
  sung: { name: "Sung", icon: "mic" },
};

/**
 * One mark as the surfaces that draw it need it: never null, whatever the
 * listing holds. The API's own row has a null for every option its kind has not
 * got, and a `tagColorClass(null)` would leave a heart in whatever colour the
 * row around it is painted in.
 */
export interface BuiltInMark {
  id: BuiltInTagId;
  color: string;
  show_in_list: boolean;
}

/** Both marks by id — one lookup for every surface that draws one. */
export type BuiltInTags = Record<BuiltInTagId, BuiltInMark>;

/**
 * What the marks look like before the listing has answered, and what a build
 * older than the backend falls back to: the pink heart and the blue microphone
 * they were hard-coded as, both on the song rows. A row drawn from nothing would
 * flash the wrong colour on every list that does not wait for the tags.
 */
export const DEFAULT_BUILT_IN_TAGS: BuiltInTags = {
  favorites: { id: "favorites", color: "pink", show_in_list: true },
  sung: { id: "sung", color: "blue", show_in_list: true },
};

/**
 * The listing's `built_ins` as the pair every surface reads. The six facets in
 * the same list are skipped here rather than dropped from the response: they
 * belong to the Filter panel and the Tags admin, which read the rows themselves.
 * A null option falls back to the default, so a backend that grew a kind this
 * build has never heard of still leaves the two marks drawable.
 */
export function builtInTags(
  rows: readonly BuiltInTagRead[] | undefined,
): BuiltInTags {
  const found = { ...DEFAULT_BUILT_IN_TAGS };
  for (const row of rows ?? []) {
    if (row.id !== "favorites" && row.id !== "sung") continue;
    found[row.id] = {
      id: row.id,
      color: row.color ?? DEFAULT_BUILT_IN_TAGS[row.id].color,
      show_in_list:
        row.show_in_list ?? DEFAULT_BUILT_IN_TAGS[row.id].show_in_list,
    };
  }
  return found;
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

/**
 * Everything the song list filters on: the two built-in marks and every tag the
 * reader may view. One shape, so the Filter panel draws one kind of row and the
 * page asks one question per song.
 */
export interface SongCriteria {
  favorite: TagCriterion;
  sung: TagCriterion;
  tags: TagCriteria;
}

/**
 * What the reader chose, and only that. The defaults depend on the tags, which
 * arrive after the page mounts and move again when a permission changes — state
 * holding the whole criteria object would freeze the tag list it was built from.
 * A criterion set back to its own default drops out of here, so "opened the
 * panel and changed nothing back" is the same state as never having opened it.
 */
export interface CriteriaOverrides {
  favorite?: TagCriterion;
  sung?: TagCriterion;
  tags: ReadonlyMap<string, TagCriterion>;
}

const NO_TAG_OVERRIDES: ReadonlyMap<string, TagCriterion> = new Map();

/** The state behind the *All* chip: nothing chosen, everything at its default. */
export const NO_OVERRIDES: CriteriaOverrides = { tags: NO_TAG_OVERRIDES };

/** The state behind the *Favorites* chip. */
export const FAVORITES_ONLY: CriteriaOverrides = {
  favorite: "yes",
  tags: NO_TAG_OVERRIDES,
};

/** The state behind the *Sung* chip. */
export const SUNG_ONLY: CriteriaOverrides = {
  sung: "yes",
  tags: NO_TAG_OVERRIDES,
};

/** Whether two override sets ask for the same thing — which chip is pressed. */
export function sameOverrides(
  a: CriteriaOverrides,
  b: CriteriaOverrides,
): boolean {
  if (a.favorite !== b.favorite || a.sung !== b.sung) return false;
  if (a.tags.size !== b.tags.size) return false;
  for (const [tagId, criterion] of a.tags)
    if (b.tags.get(tagId) !== criterion) return false;
  return true;
}

/** The default of one criterion: *Any*, or *No* for a `hide_by_default` tag. */
export function defaultCriterion(tag: TagRead | undefined): TagCriterion {
  return tag !== undefined && tag.hide_by_default ? "no" : "any";
}

/**
 * The defaults with the reader's choices laid over them. An override for a tag
 * the reader may no longer view is dropped rather than applied: the panel has no
 * row for it, so nothing on screen would explain why the list is short.
 */
export function effectiveCriteria(
  tags: readonly TagRead[],
  overrides: CriteriaOverrides,
): SongCriteria {
  const byTag = defaultTagCriteria(tags);
  for (const [tagId, criterion] of overrides.tags)
    if (byTag.has(tagId)) byTag.set(tagId, criterion);
  return {
    favorite: overrides.favorite ?? "any",
    sung: overrides.sung ?? "any",
    tags: byTag,
  };
}

/** How many criteria are off *Any* — the N of the Filter chip's label (§7). */
export function criteriaOffAny(criteria: SongCriteria): number {
  let off = 0;
  if (criteria.favorite !== "any") off += 1;
  if (criteria.sung !== "any") off += 1;
  for (const criterion of criteria.tags.values())
    if (criterion !== "any") off += 1;
  return off;
}

/**
 * The same criteria with every untouched `hide_by_default` tag put back on
 * *Any*. What the list would hold if nothing were hidden for the reader — the
 * page compares the two to tell "you have no favorites" from "your favorites
 * are all archived".
 */
export function withoutDefaultHiding(
  tags: readonly TagRead[],
  overrides: CriteriaOverrides,
  criteria: SongCriteria,
): SongCriteria {
  const relaxed = new Map(criteria.tags);
  for (const tag of tags)
    if (
      tag.hide_by_default &&
      relaxed.has(tag.id) &&
      !overrides.tags.has(tag.id)
    )
      relaxed.set(tag.id, "any");
  return { ...criteria, tags: relaxed };
}

function passesFlag(criterion: TagCriterion, has: boolean): boolean {
  return criterion === "any" || has === (criterion === "yes");
}

/** Whether one song survives every criterion, the two built-in marks included. */
export function passesSongCriteria(
  songId: string,
  bySong: ReadonlyMap<string, TagRead[]>,
  criteria: SongCriteria,
  marks: { favorite: boolean; sung: boolean },
): boolean {
  return (
    passesFlag(criteria.favorite, marks.favorite) &&
    passesFlag(criteria.sung, marks.sung) &&
    passesTagCriteria(songId, bySong, criteria.tags)
  );
}
