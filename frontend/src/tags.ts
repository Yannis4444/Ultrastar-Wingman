import type { BuiltInTagRead, SongRead, TagRead } from "./api";
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
 * The eight built-ins `GET /tags` answers beside the tags: the two per-reader
 * **marks**, the two **boolean** facets the song file answers yes or no to, and
 * the four **valued** ones whose answer is a word.
 */
export type BuiltInTagId =
  | "favorites"
  | "sung"
  | "duet"
  | "video"
  | "genre"
  | "language"
  | "edition"
  | "decade";

/** What a built-in is, which decides what there is to configure about it. */
export type BuiltInTagKind = "mark" | "boolean" | "valued";

/** In the order §7's *Built-in* section lists them — the marks everybody knows
 *  first, then the two facts a file answers yes or no to, then the valued ones.
 *  Their order on a song row is a different one and belongs to `SongListItem`
 *  alone (§1.4: the microphone, the heart, the two facets, then the tags). */
export const BUILT_IN_TAG_IDS = [
  "favorites",
  "sung",
  "duet",
  "video",
  "genre",
  "language",
  "edition",
  "decade",
] as const;

/** Whether a path segment is one of the eight reserved ids. A tag id is 32 hex
 *  characters, so no tag can ever answer yes to this (§7). */
export function isBuiltInTagId(id: string): id is BuiltInTagId {
  return (BUILT_IN_TAG_IDS as readonly string[]).includes(id);
}

/** The two facts about a song the file answers yes or no to. */
export const BOOLEAN_FACET_IDS = ["duet", "video"] as const;
export type BooleanFacetId = (typeof BOOLEAN_FACET_IDS)[number];

/** The four whose answer is a word — and never a mark on a row (§1.3). */
export const VALUED_FACET_IDS = [
  "genre",
  "language",
  "edition",
  "decade",
] as const;
export type ValuedFacetId = (typeof VALUED_FACET_IDS)[number];

/** Either kind of facet — everything the song file already knows. */
export type FacetId = BooleanFacetId | ValuedFacetId;

/**
 * What is fixed about a built-in: what kind of thing it is, its glyph and what
 * the app calls it. Only the handful of options its kind has are the party's to
 * decide — a built-in has no name to rename, no icon to pick, nobody to grant it
 * to and nothing to delete.
 */
export const BUILT_IN_TAGS: Record<
  BuiltInTagId,
  { name: string; icon: IconName; kind: BuiltInTagKind }
> = {
  favorites: { name: "Favorites", icon: "heart", kind: "mark" },
  sung: { name: "Sung", icon: "mic", kind: "mark" },
  duet: { name: "Duet", icon: "users", kind: "boolean" },
  video: { name: "Video", icon: "video", kind: "boolean" },
  genre: { name: "Genre", icon: "music", kind: "valued" },
  language: { name: "Language", icon: "flag", kind: "valued" },
  edition: { name: "Edition", icon: "disc", kind: "valued" },
  decade: { name: "Decade", icon: "calendar", kind: "valued" },
};

/** One option a built-in may have — a field of `BuiltInTagUpdate`. */
export type BuiltInOption = "color" | "show_in_list" | "show_in_filter";

/**
 * Which options each kind has. Mirrors `KIND_OPTIONS` in the backend's
 * `tags/builtin.py`, which refuses a `PATCH` naming any other one with a 422 —
 * so the editor sends exactly what this says and nothing else.
 */
export const KIND_OPTIONS: Record<BuiltInTagKind, readonly BuiltInOption[]> = {
  mark: ["color", "show_in_list"],
  boolean: ["color", "show_in_list", "show_in_filter"],
  valued: ["show_in_filter"],
};

/**
 * One built-in as the surfaces that draw it need it: never null, whatever the
 * listing holds. The API's own row has a null for every option its kind has not
 * got, and a `tagColorClass(null)` would leave a heart in whatever colour the
 * row around it is painted in. An option the kind has not got keeps the value
 * that describes the kind — a valued facet is neutral (§7: no colour to set)
 * and is never on a row (§1.3).
 */
export interface BuiltInTag {
  id: BuiltInTagId;
  kind: BuiltInTagKind;
  color: string;
  show_in_list: boolean;
  show_in_filter: boolean;
}

/** All eight by id — one lookup for every surface that draws one. */
export type BuiltInTags = Record<BuiltInTagId, BuiltInTag>;

/**
 * What the built-ins look like before the listing has answered, and what a build
 * older than the backend falls back to. Mirrors `BUILT_INS` in the backend's
 * `tags/builtin.py`: the pink heart and the blue microphone the marks were
 * hard-coded as, both on the song rows; the two boolean facets neutral, off the
 * rows and in the filter; the valued ones in the filter alone.
 */
export const DEFAULT_BUILT_IN_TAGS: BuiltInTags = {
  favorites: {
    id: "favorites",
    kind: "mark",
    color: "pink",
    show_in_list: true,
    show_in_filter: false,
  },
  sung: {
    id: "sung",
    kind: "mark",
    color: "blue",
    show_in_list: true,
    show_in_filter: false,
  },
  duet: {
    id: "duet",
    kind: "boolean",
    color: "neutral",
    show_in_list: false,
    show_in_filter: true,
  },
  video: {
    id: "video",
    kind: "boolean",
    color: "neutral",
    show_in_list: false,
    show_in_filter: true,
  },
  genre: {
    id: "genre",
    kind: "valued",
    color: "neutral",
    show_in_list: false,
    show_in_filter: true,
  },
  language: {
    id: "language",
    kind: "valued",
    color: "neutral",
    show_in_list: false,
    show_in_filter: true,
  },
  edition: {
    id: "edition",
    kind: "valued",
    color: "neutral",
    show_in_list: false,
    show_in_filter: true,
  },
  decade: {
    id: "decade",
    kind: "valued",
    color: "neutral",
    show_in_list: false,
    show_in_filter: true,
  },
};

/**
 * The listing's `built_ins` as the record every surface reads. A null option —
 * one this built-in's kind has not got, or one a backend older than this build
 * did not send — falls back to the default, so every surface reads a value.
 * A row for an id this build has never heard of is skipped: there is no glyph
 * and no name for it here.
 */
export function builtInTags(
  rows: readonly BuiltInTagRead[] | undefined,
): BuiltInTags {
  const found = { ...DEFAULT_BUILT_IN_TAGS };
  for (const row of rows ?? []) {
    // A backend that grew a ninth built-in: there is no glyph and no name for
    // it here, so it is skipped rather than drawn as something it is not.
    if (!(row.id in DEFAULT_BUILT_IN_TAGS)) continue;
    const fallback = DEFAULT_BUILT_IN_TAGS[row.id];
    found[row.id] = {
      id: fallback.id,
      // The kind is the app's own word for what the built-in is — the whole UI
      // is written around the three — so the listing does not get to move it.
      kind: fallback.kind,
      color: row.color ?? fallback.color,
      show_in_list: row.show_in_list ?? fallback.show_in_list,
      show_in_filter: row.show_in_filter ?? fallback.show_in_filter,
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
 * *Any* on a valued facet's select — "this row is not filtering", the same
 * thing *Any* means on a tri-state.
 *
 * The empty string rather than the word, because the sentinel has to be a
 * string no facet value can ever be: a file that spells its genre `any` would
 * otherwise share the *Any* option's value, and picking it would read as "not
 * filtering". `headerValue` trims a header and answers `null` for one that is
 * empty, so no facet ever yields `""` — which makes this collision-proof by
 * construction rather than by hoping no library names a genre something.
 *
 * A tri-state row is unaffected: its three options are a closed enum, and its
 * *Any* stays the word (`TagCriterion`).
 */
export const ANY_VALUE = "";

/** What the song list is asked about one valued facet: `ANY_VALUE`, or exactly
 *  one of the values the library holds. One value per facet (facets.md). */
export type ValueCriterion = string;

/*
 * Reading one facet off a song. One function per facet, because each is a
 * different question of a different column — and `SongRead` is the only place
 * any of them is answered: there is no facet endpoint, the filtering is the
 * client's (backend `tags/builtin.py`).
 */

/** A song file with two singers: `P1`/`P2` body lines, or both duet headers. */
export function songIsDuet(song: SongRead): boolean {
  return song.is_duet;
}

/** A song folder with a video file the header points at. */
export function songHasVideo(song: SongRead): boolean {
  return song.has_video;
}

/** A header the file may leave out, may leave empty, or may pad. Blank is not a
 *  value: a `#GENRE:` with nothing behind it says nothing about the song. */
function headerValue(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  return value === "" ? null : value;
}

export function songGenre(song: SongRead): string | null {
  return headerValue(song.genre);
}

export function songLanguage(song: SongRead): string | null {
  return headerValue(song.language);
}

export function songEdition(song: SongRead): string | null {
  return headerValue(song.edition);
}

/**
 * The decade a year falls in, as §7 labels it: 1985 -> `1980s`. No year is no
 * decade — a gap in the metadata is not a bucket of its own, so such a song
 * matches *Any* alone. Neither is a year that is not a real one: the header is
 * whatever somebody typed, and `0s` would be a decade nothing is from.
 */
export function decadeLabel(year: number | null): string | null {
  if (year === null || !Number.isFinite(year) || year <= 0) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

export function songDecade(song: SongRead): string | null {
  return decadeLabel(song.year);
}

/** The yes/no question each boolean facet asks of a song. */
export const BOOLEAN_FACETS: Record<
  BooleanFacetId,
  (song: SongRead) => boolean
> = {
  duet: songIsDuet,
  video: songHasVideo,
};

/** The value each valued facet reads off a song, `null` for "not in the file". */
export const VALUED_FACETS: Record<
  ValuedFacetId,
  (song: SongRead) => string | null
> = {
  genre: songGenre,
  language: songLanguage,
  edition: songEdition,
  decade: songDecade,
};

/** Chronological, not alphabetical: `1980s` before `1990s`, and a two-digit
 *  year's `80s` still lands where the number says it does. */
function decadeStart(label: string): number {
  return Number.parseInt(label, 10);
}

/**
 * What one valued facet's select offers, besides *Any*: the distinct values of
 * the songs handed in — which are the songs the reader may see, and therefore
 * the only correct list, a value nothing visible carries being a value nothing
 * would match (§7). Sorted: chronologically for *Decade*, by name otherwise.
 */
export function facetValues(
  facet: ValuedFacetId,
  songs: readonly SongRead[] | undefined,
): string[] {
  const read = VALUED_FACETS[facet];
  const seen = new Set<string>();
  for (const song of songs ?? []) {
    const value = read(song);
    if (value !== null) seen.add(value);
  }
  const values = [...seen];
  return facet === "decade"
    ? values.sort((a, b) => decadeStart(a) - decadeStart(b))
    : values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

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
 * Everything the song list filters on: the two built-in marks, the facets the
 * party shows in the filter, and every tag the reader may view. One shape, so
 * the Filter panel draws one kind of row per kind of criterion and the page asks
 * one question per song.
 *
 * A facet whose *Show in filter* is off has no entry at all — it is not a
 * criterion, not a row, and nothing for the chip to count.
 */
export interface SongCriteria {
  favorite: TagCriterion;
  sung: TagCriterion;
  booleans: ReadonlyMap<BooleanFacetId, TagCriterion>;
  values: ReadonlyMap<ValuedFacetId, ValueCriterion>;
  tags: TagCriteria;
}

/**
 * What the reader chose, and only that. The defaults depend on the tags and on
 * what the party shows in the filter, which arrive after the page mounts and
 * move again when a permission or a built-in changes — state holding the whole
 * criteria object would freeze the lists it was built from. A criterion set back
 * to its own default drops out of here, so "opened the panel and changed nothing
 * back" is the same state as never having opened it.
 *
 * Both kinds of facet share one map: their default is *Any* either way, so an
 * entry here is always something the reader asked for.
 */
export interface CriteriaOverrides {
  favorite?: TagCriterion;
  sung?: TagCriterion;
  tags: ReadonlyMap<string, TagCriterion>;
  facets: ReadonlyMap<FacetId, string>;
}

const NO_TAG_OVERRIDES: ReadonlyMap<string, TagCriterion> = new Map();
const NO_FACET_OVERRIDES: ReadonlyMap<FacetId, string> = new Map();

/** The state behind the *All* chip: nothing chosen, everything at its default. */
export const NO_OVERRIDES: CriteriaOverrides = {
  tags: NO_TAG_OVERRIDES,
  facets: NO_FACET_OVERRIDES,
};

/** The state behind the *Favorites* chip. */
export const FAVORITES_ONLY: CriteriaOverrides = {
  favorite: "yes",
  tags: NO_TAG_OVERRIDES,
  facets: NO_FACET_OVERRIDES,
};

/** The state behind the *Sung* chip. */
export const SUNG_ONLY: CriteriaOverrides = {
  sung: "yes",
  tags: NO_TAG_OVERRIDES,
  facets: NO_FACET_OVERRIDES,
};

function sameMap<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** Whether two override sets ask for the same thing — which chip is pressed. */
export function sameOverrides(
  a: CriteriaOverrides,
  b: CriteriaOverrides,
): boolean {
  if (a.favorite !== b.favorite || a.sung !== b.sung) return false;
  return sameMap(a.tags, b.tags) && sameMap(a.facets, b.facets);
}

/** The default of one criterion: *Any*, or *No* for a `hide_by_default` tag. */
export function defaultCriterion(tag: TagRead | undefined): TagCriterion {
  return tag !== undefined && tag.hide_by_default ? "no" : "any";
}

/** Which of the two kinds a facet is — the overrides map holds both. */
export function isBooleanFacet(facet: FacetId): facet is BooleanFacetId {
  return (BOOLEAN_FACET_IDS as readonly string[]).includes(facet);
}

/** A stored override is a plain string; only these three mean anything to a
 *  tri-state row, and anything else is a state nothing on screen could show. */
function isTagCriterion(value: string): value is TagCriterion {
  return value === "any" || value === "yes" || value === "no";
}

/** Whether the party offers this facet as a filter row at all. */
export function facetShown(builtIns: BuiltInTags, facet: FacetId): boolean {
  return builtIns[facet].show_in_filter;
}

/**
 * The defaults with the reader's choices laid over them. An override for a tag
 * the reader may no longer view is dropped rather than applied: the panel has no
 * row for it, so nothing on screen would explain why the list is short. Same for
 * a facet somebody has since taken out of the filter — a row that is gone cannot
 * still be narrowing the list.
 */
export function effectiveCriteria(
  tags: readonly TagRead[],
  builtIns: BuiltInTags,
  overrides: CriteriaOverrides,
): SongCriteria {
  const byTag = defaultTagCriteria(tags);
  for (const [tagId, criterion] of overrides.tags)
    if (byTag.has(tagId)) byTag.set(tagId, criterion);

  const booleans = new Map<BooleanFacetId, TagCriterion>();
  for (const facet of BOOLEAN_FACET_IDS)
    if (facetShown(builtIns, facet)) booleans.set(facet, "any");
  const values = new Map<ValuedFacetId, ValueCriterion>();
  for (const facet of VALUED_FACET_IDS)
    if (facetShown(builtIns, facet)) values.set(facet, ANY_VALUE);

  for (const [facet, chosen] of overrides.facets) {
    if (isBooleanFacet(facet)) {
      if (booleans.has(facet) && isTagCriterion(chosen))
        booleans.set(facet, chosen);
    } else if (values.has(facet)) values.set(facet, chosen);
  }

  return {
    favorite: overrides.favorite ?? "any",
    sung: overrides.sung ?? "any",
    booleans,
    values,
    tags: byTag,
  };
}

/** How many criteria are off *Any* — the N of the Filter chip's label (§7). */
export function criteriaOffAny(criteria: SongCriteria): number {
  let off = 0;
  if (criteria.favorite !== "any") off += 1;
  if (criteria.sung !== "any") off += 1;
  for (const criterion of criteria.booleans.values())
    if (criterion !== "any") off += 1;
  for (const value of criteria.values.values())
    if (value !== ANY_VALUE) off += 1;
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

/** Whether one song answers what the facets ask of it. A song the file says
 *  nothing about — no genre, no year — matches *Any* alone (§7). */
export function passesFacetCriteria(
  song: SongRead,
  criteria: SongCriteria,
): boolean {
  for (const [facet, criterion] of criteria.booleans)
    if (!passesFlag(criterion, BOOLEAN_FACETS[facet](song))) return false;
  for (const [facet, chosen] of criteria.values)
    if (chosen !== ANY_VALUE && VALUED_FACETS[facet](song) !== chosen)
      return false;
  return true;
}

/** Whether one song survives every criterion — the marks and facets included. */
export function passesSongCriteria(
  song: SongRead,
  bySong: ReadonlyMap<string, TagRead[]>,
  criteria: SongCriteria,
  marks: { favorite: boolean; sung: boolean },
): boolean {
  return (
    passesFlag(criteria.favorite, marks.favorite) &&
    passesFlag(criteria.sung, marks.sung) &&
    passesFacetCriteria(song, criteria) &&
    passesTagCriteria(song.id, bySong, criteria.tags)
  );
}
