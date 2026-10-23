import type { SongRead, TagRead } from "./api";
import { builtInTagRead, builtInTagReads, tagRead } from "./test/tags";
import {
  ANY_VALUE,
  builtInTags,
  criteriaOffAny,
  DEFAULT_BUILT_IN_TAGS,
  decadeLabel,
  defaultTagCriteria,
  effectiveCriteria,
  facetValues,
  FAVORITES_ONLY,
  isBuiltInTagId,
  markTags,
  NO_OVERRIDES,
  passesSongCriteria,
  passesTagCriteria,
  sameOverrides,
  songDecade,
  songEdition,
  songGenre,
  songHasVideo,
  songIsDuet,
  songLanguage,
  SUNG_ONLY,
  tagColorClass,
  tagGlyph,
  withoutDefaultHiding,
} from "./tags";

/** One song as a listing returns it — the facets read straight off this. */
function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: "SingStar",
    creator: "someone",
    ...overrides,
  };
}

/** The built-ins as the app ships them: every facet is a filter row. */
const BUILT_INS = builtInTags(builtInTagReads());

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

it("reads all eight built-ins out of the listing", () => {
  const built = builtInTags(builtInTagReads());

  expect(Object.keys(built)).toEqual([
    "favorites",
    "sung",
    "duet",
    "video",
    "genre",
    "language",
    "edition",
    "decade",
  ]);
  expect(built.favorites).toEqual({
    id: "favorites",
    kind: "mark",
    color: "pink",
    show_in_list: true,
    show_in_filter: false,
  });
  expect(built.duet.kind).toBe("boolean");
  expect(built.duet.show_in_list).toBe(false);
  expect(built.duet.show_in_filter).toBe(true);
  // A valued facet has no colour to set and is never on a row: the record fills
  // both with what describes the kind, so no surface reads a null.
  expect(built.genre.kind).toBe("valued");
  expect(built.genre.color).toBe("neutral");
  expect(built.genre.show_in_list).toBe(false);
});

it("falls back to the hard-coded built-ins for a listing it cannot read", () => {
  // No answer yet, and — a build older than the backend — a built-in whose
  // options came back null. Either way a heart drawn in nothing would inherit
  // whatever colour the row around it is painted in.
  expect(builtInTags(undefined)).toEqual(DEFAULT_BUILT_IN_TAGS);
  expect(
    builtInTags([builtInTagRead({ color: null, show_in_list: null })])
      .favorites,
  ).toEqual(DEFAULT_BUILT_IN_TAGS.favorites);
  // A ninth built-in has no glyph and no name here, so it is skipped rather
  // than drawn as something it is not.
  expect(
    builtInTags([
      {
        id: "mood",
        kind: "valued",
        color: null,
        show_in_list: null,
        show_in_filter: false,
      },
    ] as never),
  ).toEqual(DEFAULT_BUILT_IN_TAGS);
});

it("knows the eight reserved ids from a tag id", () => {
  expect(isBuiltInTagId("decade")).toBe(true);
  expect(isBuiltInTagId("favorites")).toBe(true);
  // A tag id is 32 hex characters, so no tag can collide with a word.
  expect(isBuiltInTagId("0123456789abcdef0123456789abcdef")).toBe(false);
  expect(isBuiltInTagId("new")).toBe(false);
});

it("reads each facet off the song, one question each", () => {
  expect(songIsDuet(song({ is_duet: true }))).toBe(true);
  expect(songHasVideo(song({ has_video: false }))).toBe(false);
  expect(songGenre(song({ genre: "Rock" }))).toBe("Rock");
  expect(songLanguage(song({ language: "German" }))).toBe("German");
  expect(songEdition(song({ edition: "SingStar" }))).toBe("SingStar");
  expect(songDecade(song({ year: 1976 }))).toBe("1970s");
});

it("treats a header that says nothing as no value at all", () => {
  // A `#GENRE:` with nothing behind it, and one somebody padded.
  expect(songGenre(song({ genre: null }))).toBeNull();
  expect(songGenre(song({ genre: "   " }))).toBeNull();
  expect(songEdition(song({ edition: " SingStar " }))).toBe("SingStar");
});

it("keeps the Any sentinel out of reach of every facet value", () => {
  // A file may spell its genre `any`; the sentinel must still mean "this row is
  // not filtering" and nothing else. No header can ever produce the empty
  // string, because a blank one is no value at all.
  expect(songGenre(song({ genre: "any" }))).toBe("any");
  expect(songGenre(song({ genre: "any" }))).not.toBe(ANY_VALUE);
  expect(facetValues("genre", [song({ genre: "any" })])).toEqual(["any"]);
  for (const value of ["", " ", "\t"])
    expect(songGenre(song({ genre: value }))).toBeNull();
  expect(decadeLabel(1980)).not.toBe(ANY_VALUE);
});

it("buckets a year into the decade §7 labels", () => {
  expect(decadeLabel(1985)).toBe("1980s");
  expect(decadeLabel(1990)).toBe("1990s");
  expect(decadeLabel(2009)).toBe("2000s");
  // No year is no decade: a gap in the metadata is not a bucket of its own,
  // and neither is a year nobody could have recorded a song in.
  expect(decadeLabel(null)).toBeNull();
  expect(decadeLabel(0)).toBeNull();
  expect(songDecade(song({ year: null }))).toBeNull();
});

it("offers the distinct values the library holds, sorted", () => {
  const songs = [
    song({ id: "a", genre: "Rock", year: 1999 }),
    song({ id: "b", genre: "pop", year: 1985 }),
    song({ id: "c", genre: "Rock", year: null }),
    song({ id: "d", genre: null, year: 2004 }),
  ];

  // Distinct and by name; a song with no genre contributes no option.
  expect(facetValues("genre", songs)).toEqual(["pop", "Rock"]);
  // Chronologically, never alphabetically — and no bucket for the missing year.
  expect(facetValues("decade", songs)).toEqual(["1980s", "1990s", "2000s"]);
  expect(facetValues("language", undefined)).toEqual([]);
});

it("opens a hide-by-default tag on No and every other one on Any", () => {
  const criteria = defaultTagCriteria([
    tagRead({ id: "archive", hide_by_default: true }),
    tagRead({ id: "party" }),
    tagRead({ id: "secret", hide_by_default: true, can_view: false }),
  ]);

  // Every viewable tag has a row, so the filter panel can count the ones that
  // are off Any; a tag the reader may not view is not one of them.
  expect([...criteria]).toEqual([
    ["archive", "no"],
    ["party", "any"],
  ]);
});

it("keeps a song out of the list only for the criteria that are set", () => {
  const archive = tagRead({ id: "archive", hide_by_default: true });
  const party = tagRead({ id: "party" });
  const bySong = new Map<string, TagRead[]>([
    ["s-archived", [archive]],
    ["s-party", [party]],
  ]);
  const criteria = defaultTagCriteria([archive, party]);

  expect(passesTagCriteria("s-archived", bySong, criteria)).toBe(false);
  expect(passesTagCriteria("s-party", bySong, criteria)).toBe(true);
  // Nothing tagged at all: no criterion has anything to say about it.
  expect(passesTagCriteria("s-plain", bySong, criteria)).toBe(true);

  // What the filter panel will write: Yes keeps only the songs carrying it.
  const wanted = new Map(criteria).set("party", "yes" as const);
  expect(passesTagCriteria("s-party", bySong, wanted)).toBe(true);
  expect(passesTagCriteria("s-plain", bySong, wanted)).toBe(false);
});

const ARCHIVE = tagRead({ id: "archive", hide_by_default: true });
const PARTY = tagRead({ id: "party", name: "party" });

it("starts every criterion at its default, the marks and facets included", () => {
  const criteria = effectiveCriteria([ARCHIVE, PARTY], BUILT_INS, NO_OVERRIDES);

  expect(criteria.favorite).toBe("any");
  expect(criteria.sung).toBe("any");
  expect([...criteria.booleans]).toEqual([
    ["duet", "any"],
    ["video", "any"],
  ]);
  expect([...criteria.values]).toEqual([
    ["genre", ANY_VALUE],
    ["language", ANY_VALUE],
    ["edition", ANY_VALUE],
    ["decade", ANY_VALUE],
  ]);
  expect([...criteria.tags]).toEqual([
    ["archive", "no"],
    ["party", "any"],
  ]);
});

it("lays the reader's choices over the defaults", () => {
  const criteria = effectiveCriteria([ARCHIVE, PARTY], BUILT_INS, {
    favorite: "yes",
    tags: new Map([
      ["archive", "any" as const],
      // A tag the reader may no longer view: the panel has no row for it, so
      // nothing on screen would explain a list it silently shortened.
      ["gone", "yes" as const],
    ]),
    facets: new Map([
      ["duet" as const, "yes"],
      ["decade" as const, "1980s"],
    ]),
  });

  expect(criteria.favorite).toBe("yes");
  expect(criteria.booleans.get("duet")).toBe("yes");
  expect(criteria.values.get("decade")).toBe("1980s");
  expect([...criteria.tags]).toEqual([
    ["archive", "any"],
    ["party", "any"],
  ]);
});

it("drops a facet the party took out of the filter, override and all", () => {
  // Show in filter off: §7 makes it no row — so it is no criterion either, and
  // a choice made before somebody turned it off cannot still be narrowing the
  // list with nothing on screen to say so.
  const hidden = builtInTags(
    builtInTagReads().map((row) =>
      row.id === "genre" ? { ...row, show_in_filter: false } : row,
    ),
  );
  const overrides = {
    tags: new Map(),
    facets: new Map([["genre" as const, "Pop"]]),
  };

  const criteria = effectiveCriteria([], hidden, overrides);

  expect(criteria.values.has("genre")).toBe(false);
  expect(criteriaOffAny(criteria)).toBe(0);
  expect(
    passesSongCriteria(song({ genre: "Rock" }), new Map(), criteria, {
      favorite: false,
      sung: false,
    }),
  ).toBe(true);
});

it("counts the criteria off Any — a hidden-by-default tag and a facet", () => {
  // §7: N is what is narrowing the list, not what the reader touched — the
  // archive tag is holding songs back whether or not anybody set it.
  const off = (overrides = NO_OVERRIDES) =>
    criteriaOffAny(effectiveCriteria([ARCHIVE, PARTY], BUILT_INS, overrides));

  expect(off()).toBe(1);
  expect(off(SUNG_ONLY)).toBe(2);
  expect(
    off({ tags: new Map([["archive", "any" as const]]), facets: new Map() }),
  ).toBe(0);
  // A facet counts like a tag, whichever kind it is.
  expect(
    off({
      tags: new Map(),
      facets: new Map([
        ["video" as const, "no"],
        ["genre" as const, "Pop"],
      ]),
    }),
  ).toBe(3);
});

it("tells the chips apart by what the reader chose, not by the result", () => {
  const nothing = { tags: new Map(), facets: new Map() };
  expect(sameOverrides(NO_OVERRIDES, nothing)).toBe(true);
  expect(sameOverrides(FAVORITES_ONLY, SUNG_ONLY)).toBe(false);
  expect(
    sameOverrides(NO_OVERRIDES, {
      tags: new Map([["party", "yes"]]),
      facets: new Map(),
    }),
  ).toBe(false);
  // A facet is a choice like any other: the Filter chip has to light for it.
  expect(
    sameOverrides(NO_OVERRIDES, {
      tags: new Map(),
      facets: new Map([["genre", "Pop"]]),
    }),
  ).toBe(false);
  expect(
    sameOverrides(
      { tags: new Map(), facets: new Map([["genre", "Pop"]]) },
      { tags: new Map(), facets: new Map([["genre", "Rock"]]) },
    ),
  ).toBe(false);
});

it("lifts only the hiding nobody asked for", () => {
  const overrides = {
    tags: new Map([["party", "no" as const]]),
    facets: new Map(),
  };
  const criteria = effectiveCriteria([ARCHIVE, PARTY], BUILT_INS, overrides);

  const relaxed = withoutDefaultHiding([ARCHIVE, PARTY], overrides, criteria);

  // The archive default goes back to Any; the No the reader typed stays.
  expect([...relaxed.tags]).toEqual([
    ["archive", "any"],
    ["party", "no"],
  ]);
});

it("asks the two built-in marks the same question as a tag", () => {
  const bySong = new Map<string, TagRead[]>([["s-archived", [ARCHIVE]]]);
  const criteria = effectiveCriteria(
    [ARCHIVE, PARTY],
    BUILT_INS,
    FAVORITES_ONLY,
  );
  const marks = { favorite: true, sung: false };

  expect(
    passesSongCriteria(song({ id: "s-plain" }), bySong, criteria, marks),
  ).toBe(true);
  // Favorited, but archived by the default nobody touched.
  expect(
    passesSongCriteria(song({ id: "s-archived" }), bySong, criteria, marks),
  ).toBe(false);
  expect(
    passesSongCriteria(song({ id: "s-plain" }), bySong, criteria, {
      favorite: false,
      sung: false,
    }),
  ).toBe(false);
  expect(
    passesSongCriteria(
      song({ id: "s-plain" }),
      bySong,
      effectiveCriteria([], BUILT_INS, {
        sung: "no",
        tags: new Map(),
        facets: new Map(),
      }),
      { favorite: false, sung: true },
    ),
  ).toBe(false);
});

it("asks a facet what the file says, and lets a song with no value through Any", () => {
  const criteria = (facets: [string, string][]) =>
    effectiveCriteria([], BUILT_INS, {
      tags: new Map(),
      facets: new Map(facets as [never, string][]),
    });
  const marks = { favorite: false, sung: false };
  const passes = (target: SongRead, facets: [string, string][]) =>
    passesSongCriteria(target, new Map(), criteria(facets), marks);

  const duet = song({ id: "a", is_duet: true, genre: "Rock", year: 1985 });
  const solo = song({ id: "b", is_duet: false, genre: null, year: null });

  expect(passes(duet, [["duet", "yes"]])).toBe(true);
  expect(passes(solo, [["duet", "yes"]])).toBe(false);
  expect(passes(solo, [["duet", "no"]])).toBe(true);
  expect(passes(duet, [["genre", "Rock"]])).toBe(true);
  expect(passes(duet, [["genre", "Pop"]])).toBe(false);
  expect(passes(duet, [["decade", "1980s"]])).toBe(true);
  // No genre and no year at all: the song matches Any alone, never a value.
  expect(passes(solo, [["genre", "Rock"]])).toBe(false);
  expect(passes(solo, [["decade", "1980s"]])).toBe(false);
  expect(passes(solo, [])).toBe(true);
  // Several facets narrow together, the way several tags do.
  expect(
    passes(duet, [
      ["duet", "yes"],
      ["decade", "1990s"],
    ]),
  ).toBe(false);
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
