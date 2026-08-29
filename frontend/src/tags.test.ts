import { ICON_PATHS, PICKER_ICON_NAMES } from "./components/icons";
import { tagColorClass, tagGlyph } from "./tags";

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
