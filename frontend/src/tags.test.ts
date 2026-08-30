import type { TagRead } from "./api";
import { builtInTagRead, builtInTagReads, tagRead } from "./test/tags";
import {
  builtInTags,
  criteriaOffAny,
  DEFAULT_BUILT_IN_TAGS,
  defaultTagCriteria,
  effectiveCriteria,
  FAVORITES_ONLY,
  markTags,
  NO_OVERRIDES,
  passesSongCriteria,
  passesTagCriteria,
  sameOverrides,
  SUNG_ONLY,
  tagColorClass,
  tagGlyph,
  withoutDefaultHiding,
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

it("reads the two marks out of a listing that carries all eight built-ins", () => {
  // The six facets ride along on the same listing; the surfaces that draw a
  // mark take their two and leave the rest to the filter panel and the admin.
  const marks = builtInTags(builtInTagReads());

  expect(Object.keys(marks)).toEqual(["favorites", "sung"]);
  expect(marks.favorites).toEqual({
    id: "favorites",
    color: "pink",
    show_in_list: true,
  });
  expect(marks.sung.color).toBe("blue");
});

it("falls back to the hard-coded marks for a listing it cannot read", () => {
  // No answer yet, and — a build older than the backend — a mark whose options
  // came back null. Either way a heart drawn in nothing would inherit whatever
  // colour the row around it is painted in.
  expect(builtInTags(undefined)).toEqual(DEFAULT_BUILT_IN_TAGS);
  expect(
    builtInTags([builtInTagRead({ color: null, show_in_list: null })])
      .favorites,
  ).toEqual(DEFAULT_BUILT_IN_TAGS.favorites);
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

const ARCHIVE = tagRead({ id: "archive", hide_by_default: true });
const DUET = tagRead({ id: "duet", name: "duet" });

it("starts every criterion at its default, the built-in marks included", () => {
  const criteria = effectiveCriteria([ARCHIVE, DUET], NO_OVERRIDES);

  expect(criteria.favorite).toBe("any");
  expect(criteria.sung).toBe("any");
  expect([...criteria.tags]).toEqual([
    ["archive", "no"],
    ["duet", "any"],
  ]);
});

it("lays the reader's choices over the defaults", () => {
  const criteria = effectiveCriteria([ARCHIVE, DUET], {
    favorite: "yes",
    tags: new Map([
      ["archive", "any" as const],
      // A tag the reader may no longer view: the panel has no row for it, so
      // nothing on screen would explain a list it silently shortened.
      ["gone", "yes" as const],
    ]),
  });

  expect(criteria.favorite).toBe("yes");
  expect(criteria.sung).toBe("any");
  expect([...criteria.tags]).toEqual([
    ["archive", "any"],
    ["duet", "any"],
  ]);
});

it("counts the criteria off Any, a hidden-by-default tag included", () => {
  // §7: N is what is narrowing the list, not what the reader touched — the
  // archive tag is holding songs back whether or not anybody set it.
  expect(criteriaOffAny(effectiveCriteria([ARCHIVE, DUET], NO_OVERRIDES))).toBe(
    1,
  );
  expect(criteriaOffAny(effectiveCriteria([ARCHIVE, DUET], SUNG_ONLY))).toBe(2);
  expect(
    criteriaOffAny(
      effectiveCriteria([ARCHIVE, DUET], {
        tags: new Map([["archive", "any" as const]]),
      }),
    ),
  ).toBe(0);
});

it("tells the chips apart by what the reader chose, not by the result", () => {
  expect(sameOverrides(NO_OVERRIDES, { tags: new Map() })).toBe(true);
  expect(sameOverrides(FAVORITES_ONLY, SUNG_ONLY)).toBe(false);
  expect(
    sameOverrides(NO_OVERRIDES, { tags: new Map([["duet", "yes"]]) }),
  ).toBe(false);
  expect(
    sameOverrides(
      { tags: new Map([["duet", "yes"]]) },
      { tags: new Map([["duet", "no"]]) },
    ),
  ).toBe(false);
});

it("lifts only the hiding nobody asked for", () => {
  const overrides = { tags: new Map([["duet", "no" as const]]) };
  const criteria = effectiveCriteria([ARCHIVE, DUET], overrides);

  const relaxed = withoutDefaultHiding([ARCHIVE, DUET], overrides, criteria);

  // The archive default goes back to Any; the No the reader typed stays.
  expect([...relaxed.tags]).toEqual([
    ["archive", "any"],
    ["duet", "no"],
  ]);
});

it("asks the two built-in marks the same question as a tag", () => {
  const bySong = new Map<string, TagRead[]>([["s-archived", [ARCHIVE]]]);
  const criteria = effectiveCriteria([ARCHIVE, DUET], FAVORITES_ONLY);
  const marks = { favorite: true, sung: false };

  expect(passesSongCriteria("s-plain", bySong, criteria, marks)).toBe(true);
  // Favorited, but archived by the default nobody touched.
  expect(passesSongCriteria("s-archived", bySong, criteria, marks)).toBe(false);
  expect(
    passesSongCriteria("s-plain", bySong, criteria, {
      favorite: false,
      sung: false,
    }),
  ).toBe(false);
  expect(
    passesSongCriteria(
      "s-plain",
      bySong,
      effectiveCriteria([], { sung: "no", tags: new Map() }),
      { favorite: false, sung: true },
    ),
  ).toBe(false);
});
