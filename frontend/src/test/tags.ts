import type { BuiltInTagRead, TagRead } from "../api";

/**
 * One tag as `GET /tags` returns it: visible to the reader, theirs to set, and
 * without the permission rows only a `tags.manage` holder is given. Every test
 * that needs a tag starts here and overrides the one field it is about, so a
 * new field on `TagRead` is added in one place.
 */
export function tagRead(overrides: Partial<TagRead> = {}): TagRead {
  return {
    id: "t-archive",
    name: "archive",
    icon: "archive",
    color: "neutral",
    show_in_list: false,
    hide_by_default: false,
    can_view: true,
    can_assign: true,
    song_count: 0,
    permissions: null,
    ...overrides,
  };
}

/**
 * One built-in mark as `GET /tags` returns it beside the tags — the pink heart
 * the app arrives with, unless a test says otherwise. A mark has no
 * `show_in_filter`: the Filter panel always has its row.
 */
export function builtInTagRead(
  overrides: Partial<BuiltInTagRead> = {},
): BuiltInTagRead {
  return {
    id: "favorites",
    kind: "mark",
    color: "pink",
    show_in_list: true,
    show_in_filter: null,
    ...overrides,
  };
}

/**
 * All eight built-ins at their defaults, in §7's *Built-in* order: the two
 * per-reader marks, the two boolean facets the song file answers yes or no to,
 * and the four valued ones. Every listing a test does not configure carries the
 * whole set, so a surface that draws only the marks proves it skips the rest.
 */
export function builtInTagReads(): BuiltInTagRead[] {
  return [
    builtInTagRead(),
    builtInTagRead({ id: "sung", color: "blue" }),
    ...(["duet", "video"] as const).map((id) =>
      builtInTagRead({
        id,
        kind: "boolean",
        color: "neutral",
        show_in_list: false,
        show_in_filter: true,
      }),
    ),
    ...(["genre", "language", "edition", "decade"] as const).map((id) =>
      builtInTagRead({
        id,
        kind: "valued",
        color: null,
        show_in_list: null,
        show_in_filter: true,
      }),
    ),
  ];
}
