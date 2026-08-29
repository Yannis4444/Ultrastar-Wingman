import type { TagRead } from "../api";

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
    permissions: null,
    ...overrides,
  };
}
