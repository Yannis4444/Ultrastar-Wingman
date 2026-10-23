import { render } from "@testing-library/react";
import { iconNames } from "../test/icons";
import { ICON_PATHS, Icon, PICKER_ICON_NAMES, type IconName } from "./icons";

/**
 * The allowlist ui-guidelines §3 pins, in the order the picker draws it: the
 * eight general glyphs that already say something about a song, then the
 * thirty-four drawn for tags, then `tv`. Spelled out again here rather than
 * derived from the export, so that adding a glyph to the picker — or giving
 * one a job that should take it out — is a deliberate edit and not a side
 * effect of touching `ICON_PATHS`.
 */
const PICKABLE = [
  "users",
  "alert",
  "archive",
  "calendar",
  "disc",
  "user",
  "video",
  "music",
  "flame",
  "moon",
  "snowflake",
  "gift",
  "cake",
  "child",
  "guitar",
  "crown",
  "film",
  "gamepad",
  "flag",
  "skull",
  "sun",
  "umbrella",
  "beer",
  "car",
  "plane",
  "bolt",
  "bell",
  "ghost",
  "ring",
  "graduation-cap",
  "headphones",
  "drum",
  "piano",
  "rocket",
  "anchor",
  "tree",
  "paw",
  "smile",
  "thumbs-up",
  "hourglass",
  "balloon",
  "dumbbell",
  "tv",
];

/** Glyphs that mean something else wherever they appear: the feature icons, the
 *  controls, the two marks a song row already owns, and the dice. */
const NOT_PICKABLE: IconName[] = [
  "card",
  "clock",
  "layers",
  "globe",
  "star",
  "trophy",
  "tag",
  "heart",
  "mic",
  "close",
  "check",
  "plus",
  "send",
  "trash",
  "pencil",
  "copy",
  "drag-handle",
  "filter",
  "dice",
  "dice-1",
  "shuffle",
  "chevron-down",
  "arrow-up",
];

test("the picker offers exactly the glyphs that say something about a song", () => {
  expect(PICKER_ICON_NAMES).toEqual(PICKABLE);
  // The count too: a name dropped from both lists in one edit would pass the
  // comparison above and quietly shrink the picker.
  expect(PICKER_ICON_NAMES).toHaveLength(43);
});

test("every pickable glyph is one drawn path", () => {
  for (const name of PICKER_ICON_NAMES) {
    expect({ name, drawn: ICON_PATHS[name] !== undefined }).toEqual({
      name,
      drawn: true,
    });
    expect(ICON_PATHS[name]).toMatch(/^M/);
  }
});

test("the glyphs with a job of their own stay out of the picker", () => {
  for (const name of NOT_PICKABLE) {
    expect(ICON_PATHS[name]).toBeDefined();
    expect(PICKER_ICON_NAMES).not.toContain(name);
  }
});

test("every subpath is closed, so the nonzero fill has something to fill", () => {
  for (const [name, d] of Object.entries(ICON_PATHS)) {
    // An open subpath is filled as if it were closed, but its outline is the
    // straight line back to where it started — which is not what any of the
    // cut-outs here were drawn against. `Z` before every `M` and at the end —
    // and before every `m` too: a relative move continues the path just as an
    // absolute one does, so `smile`'s second eye is a subpath of its own and
    // an unclosed one would leak exactly the same way.
    expect({ name, closed: d.trimEnd().endsWith("Z") }).toEqual({
      name,
      closed: true,
    });
    expect({ name, open: /[^Zz]\s*[Mm]/.test(d.slice(1)) }).toEqual({
      name,
      open: false,
    });
  }
});

test("no two glyphs share their path, which is how a test tells them apart", () => {
  const paths = Object.values(ICON_PATHS);
  expect(new Set(paths).size).toBe(paths.length);
});

test("a glyph is one solid path in the 24x24 box", () => {
  const { container } = render(<Icon name="flame" />);

  expect(container.querySelector("svg")).toHaveAttribute(
    "viewBox",
    "0 0 24 24",
  );
  expect(container.querySelectorAll("path")).toHaveLength(1);
  expect(container.querySelector("g")).toBeNull();
  expect(iconNames(container)).toEqual(["flame"]);
});

test("every glyph is path data and nothing else", () => {
  for (const [name, d] of Object.entries(ICON_PATHS)) {
    // Solid shapes with counter-wound cut-outs, so the default nonzero fill is
    // the whole story: one `d` string of path commands and numbers each, never
    // markup that could carry a `fill-rule`, a `stroke` or a `<g>` with it.
    expect({ name, d }).toEqual({
      name,
      d: expect.stringMatching(/^M[-\d\s.,AaCcHhLlMmQqSsTtVvZz]*$/),
    });
  }
});

test("Shuffle again has a glyph of its own, never the reel's dice", () => {
  // Two arrows and their two heads: four closed subpaths in one `d`.
  expect(ICON_PATHS.shuffle.match(/M/g)).toHaveLength(4);
  expect(ICON_PATHS.shuffle).not.toBe(ICON_PATHS.dice);
  expect(ICON_PATHS.shuffle).not.toBe(ICON_PATHS.refresh);

  const { container } = render(<Icon name="shuffle" />);
  expect(container.querySelectorAll("path")).toHaveLength(1);
  expect(iconNames(container)).toEqual(["shuffle"]);
});
