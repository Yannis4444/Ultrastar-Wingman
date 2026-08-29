import type { TagRead } from "./api";
import { ICON_PATHS, PICKER_ICON_NAMES } from "./components/icons";
import { tagRead } from "./test/tags";
import {
  defaultTagCriteria,
  markTags,
  passesTagCriteria,
  tagColorClass,
  tagGlyph,
} from "./tags";

it("draws a tag with the glyph it names", () => {
  expect(tagGlyph("archive")).toBe("archive");
});

it("falls back to the feature's own glyph", () => {
  // No icon at all, and an icon this build does not ship — the backend only
  // checks the shape of the name, so both really happen.
  expect(tagGlyph(null)).toBe("tag");
  expect(tagGlyph("sparkles")).toBe("tag");
});

it("paints a tag in one of the four colours, never in nothing", () => {
  expect(tagColorClass("gold")).toBe("tag-color-gold");
  expect(tagColorClass("neutral")).toBe("tag-color-neutral");
  // A colour the backend grew after this build reads as the plain one rather
  // than leaving the glyph in whatever colour it inherited.
  expect(tagColorClass("chartreuse")).toBe("tag-color-neutral");
});

it("keeps the control glyphs and the song row's marks out of the picker", () => {
  for (const excluded of [
    "search",
    "plus",
    "check",
    "close",
    "chevron-right",
    "arrow-up",
    "pencil",
    "trash",
    "copy",
    // Not drawn yet (the comment composer owns it): named here so it stays out
    // of the picker the moment it is added.
    "send",
    "drag-handle",
    "dice",
    "dice-3",
    "heart",
    "mic",
  ])
    expect(PICKER_ICON_NAMES).not.toContain(excluded);
});

it("offers every other glyph, the seeded tags' two included", () => {
  expect(PICKER_ICON_NAMES).toContain("archive");
  expect(PICKER_ICON_NAMES).toContain("alert");
  expect(PICKER_ICON_NAMES).toContain("tag");
  // Nothing invented: the picker is a view of `ICON_PATHS`.
  for (const name of PICKER_ICON_NAMES) expect(ICON_PATHS[name]).toBeDefined();
});

it("puts on a row only the tags the reader may see and asked for", () => {
  const shown = tagRead({ id: "a", show_in_list: true });
  const quiet = tagRead({ id: "b", show_in_list: false });
  // Only a `tags.manage` holder is ever handed one of these, and the admin
  // list is the one place it belongs.
  const unseen = tagRead({ id: "c", show_in_list: true, can_view: false });

  expect(markTags([shown, quiet, unseen])).toEqual([shown]);
  expect(markTags(undefined)).toEqual([]);
});

it("opens a hide-by-default tag on No and every other one on Any", () => {
  const criteria = defaultTagCriteria([
    tagRead({ id: "archive", hide_by_default: true }),
    tagRead({ id: "duet" }),
    tagRead({ id: "secret", hide_by_default: true, can_view: false }),
  ]);

  // Every viewable tag has a row, so the filter panel can count the ones that
  // are off Any; a tag the reader may not view is not one of them.
  expect([...criteria]).toEqual([
    ["archive", "no"],
    ["duet", "any"],
  ]);
});

it("keeps a song out of the list only for the criteria that are set", () => {
  const archive = tagRead({ id: "archive", hide_by_default: true });
  const duet = tagRead({ id: "duet" });
  const bySong = new Map<string, TagRead[]>([
    ["s-archived", [archive]],
    ["s-duet", [duet]],
  ]);
  const criteria = defaultTagCriteria([archive, duet]);

  expect(passesTagCriteria("s-archived", bySong, criteria)).toBe(false);
  expect(passesTagCriteria("s-duet", bySong, criteria)).toBe(true);
  // Nothing tagged at all: no criterion has anything to say about it.
  expect(passesTagCriteria("s-plain", bySong, criteria)).toBe(true);

  // What the filter panel will write: Yes keeps only the songs carrying it.
  const wanted = new Map(criteria).set("duet", "yes" as const);
  expect(passesTagCriteria("s-duet", bySong, wanted)).toBe(true);
  expect(passesTagCriteria("s-plain", bySong, wanted)).toBe(false);
});
