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
    // Manual: what people put on songs. An automatic tag carries a rule instead, and
    // then `can_assign` is false for everybody.
    rule: null,
    song_count: 0,
    permissions: null,
    ...overrides,
  };
}

/**
 * One built-in mark as `GET /tags` returns it beside the tags — the pink heart
 * and the blue microphone the app arrives with, unless a test says otherwise.
 */
export function builtInTagRead(
  overrides: Partial<BuiltInTagRead> = {},
): BuiltInTagRead {
  return { id: "favorites", color: "pink", show_in_list: true, ...overrides };
}

/** Both marks at their defaults, for the listings a test does not configure. */
export function builtInTagReads(): BuiltInTagRead[] {
  return [builtInTagRead(), builtInTagRead({ id: "sung", color: "blue" })];
}
