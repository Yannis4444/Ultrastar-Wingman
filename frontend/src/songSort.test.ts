import type { SongRead } from "./api";
import {
  DEFAULT_SONG_SORT,
  isSongSort,
  newShuffleSeed,
  readSongSort,
  shuffleKey,
  SONG_SORTS,
  sortSongs,
  writeSongSort,
} from "./songSort";

function song(
  id: string,
  artist: string,
  title: string,
  overrides: Partial<SongRead> = {},
): SongRead {
  return {
    id,
    source: "local",
    title,
    artist,
    duration_seconds: null,
    has_video: false,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
    ...overrides,
  };
}

const LIBRARY: SongRead[] = [
  song("s:toto", "Toto", "Africa", {
    year: 1982,
    created_at: "2026-03-01T20:00:00Z",
  }),
  song("s:queen", "ABBA", "Dancing Queen", {
    year: 1976,
    created_at: "2026-10-20T19:00:00Z",
  }),
  song("s:mamma", "abba", "Mamma Mia", {
    year: 1975,
    created_at: "2026-01-05T18:00:00Z",
  }),
  song("s:nomad", "Zappa", "Bobby Brown", { year: null }),
  song("s:funk", "Mark Ronson", "Uptown Funk", {
    year: 2014,
    created_at: "2026-10-20T19:00:00Z",
  }),
];

const ids = (songs: SongRead[]) => songs.map((one) => one.id);

beforeEach(() => window.localStorage.clear());

test("the options are the guideline's six, in the USDB page's words", () => {
  expect(SONG_SORTS.map((option) => option.label)).toEqual([
    "Artist A to Z",
    "Title A to Z",
    "Year, newest first",
    "Year, oldest first",
    "Recently added",
    "Random",
  ]);
  expect(DEFAULT_SONG_SORT).toBe("artist");
});

test("artist A to Z ignores case and falls to the title", () => {
  expect(ids(sortSongs(LIBRARY, "artist"))).toEqual([
    "s:queen",
    "s:mamma",
    "s:funk",
    "s:toto",
    "s:nomad",
  ]);
});

test("the comparison ignores accents and reads numbers as numbers", () => {
  const songs = [
    song("a", "Édith Piaf", "Song 10"),
    song("b", "edith piaf", "Song 2"),
    song("c", "Eagles", "Hotel California"),
  ];

  expect(ids(sortSongs(songs, "artist"))).toEqual(["c", "b", "a"]);
});

test("title A to Z, ties falling to the artist", () => {
  const songs = [
    ...LIBRARY,
    song("s:africa-cover", "Weezer", "africa"),
    song("s:africa-other", "Karl Jenkins", "Africa"),
  ];

  expect(ids(sortSongs(songs, "title"))).toEqual([
    "s:africa-other",
    "s:toto",
    "s:africa-cover",
    "s:nomad",
    "s:queen",
    "s:mamma",
    "s:funk",
  ]);
});

test("a song without a year comes last whichever way the years run", () => {
  expect(ids(sortSongs(LIBRARY, "year-desc"))).toEqual([
    "s:funk",
    "s:toto",
    "s:queen",
    "s:mamma",
    "s:nomad",
  ]);
  expect(ids(sortSongs(LIBRARY, "year-asc"))).toEqual([
    "s:mamma",
    "s:queen",
    "s:toto",
    "s:funk",
    "s:nomad",
  ]);
});

test("songs of one year fall to artist, then title", () => {
  const songs = [
    song("b", "Toto", "Rosanna", { year: 1982 }),
    song("a", "Toto", "Africa", { year: 1982 }),
    song("c", "Michael Jackson", "Thriller", { year: 1982 }),
  ];

  expect(ids(sortSongs(songs, "year-desc"))).toEqual(["c", "a", "b"]);
});

test("recently added puts the newest find first, ties by artist", () => {
  expect(ids(sortSongs(LIBRARY, "added"))).toEqual([
    "s:queen",
    "s:funk",
    "s:toto",
    "s:mamma",
    "s:nomad",
  ]);
});

test("recently added reads the backend's microseconds as time, not as text", () => {
  const songs = [
    // As text, "…59.9Z" sorts after "…00Z" of the next second.
    song("earlier", "A", "A second before", {
      created_at: "2026-10-20T18:59:59.900001Z",
    }),
    song("later", "B", "On the second", {
      created_at: "2026-10-20T19:00:00Z",
    }),
    song("broken", "C", "Unreadable", { created_at: "yesterday" }),
  ];

  expect(ids(sortSongs(songs, "added"))).toEqual([
    "later",
    "earlier",
    "broken",
  ]);
});

test("songs one scan found in the same second tie and fall to the artist", () => {
  // What a scan writes: one row after the other, microseconds apart, in
  // folder order. Read to the microsecond this would be Toto, ABBA, Queen.
  const songs = [
    song("s:queen", "Queen", "Bohemian Rhapsody", {
      created_at: "2026-10-20T19:00:00.000100Z",
    }),
    song("s:abba", "ABBA", "Waterloo", {
      created_at: "2026-10-20T19:00:00.000200Z",
    }),
    song("s:toto", "Toto", "Africa", {
      created_at: "2026-10-20T19:00:00.004000Z",
    }),
    song("s:old", "Zappa", "Bobby Brown", {
      created_at: "2026-10-20T18:59:59.999999Z",
    }),
  ];

  expect(ids(sortSongs(songs, "added"))).toEqual([
    "s:abba",
    "s:queen",
    "s:toto",
    "s:old",
  ]);
});
test("one seed is one order, whatever order the songs arrive in", () => {
  const once = ids(sortSongs(LIBRARY, "random", 42));

  expect(ids(sortSongs([...LIBRARY].reverse(), "random", 42))).toEqual(once);
  expect([...once].sort()).toEqual([...ids(LIBRARY)].sort());
});

test("a filtered list keeps the shuffle's relative order", () => {
  const whole = ids(sortSongs(LIBRARY, "random", 7));
  const narrowed = LIBRARY.filter((one) => one.id !== "s:toto");

  expect(ids(sortSongs(narrowed, "random", 7))).toEqual(
    whole.filter((id) => id !== "s:toto"),
  );
});

test("another seed is another order", () => {
  const songs = Array.from({ length: 12 }, (_, index) =>
    song(`s:${index}`, "Artist", `Title ${index}`),
  );
  const orders = new Set(
    [1, 2, 3, 4].map((seed) => ids(sortSongs(songs, "random", seed)).join()),
  );

  expect(orders.size).toBe(4);
  expect(shuffleKey(1, "s:1")).not.toBe(shuffleKey(2, "s:1"));
});

test("a seed is a 32-bit number out of the random source", () => {
  expect(newShuffleSeed(() => 0)).toBe(0);
  expect(newShuffleSeed(() => 0.5)).toBe(0x80000000);
  expect(newShuffleSeed(() => 0.999999999)).toBeLessThan(0x100000000);
});

test("sorting never touches the list it was handed", () => {
  const before = ids(LIBRARY);
  sortSongs(LIBRARY, "title");

  expect(ids(LIBRARY)).toEqual(before);
});

test("the choice is kept per device, and garbage reads as the default", () => {
  expect(readSongSort()).toBe("artist");

  writeSongSort("year-asc");
  expect(readSongSort()).toBe("year-asc");

  window.localStorage.setItem("wingman.songSort", "loudest");
  expect(readSongSort()).toBe("artist");
  expect(isSongSort("loudest")).toBe(false);
  expect(isSongSort("random")).toBe(true);
});

test("a storage that throws is a default, not a crash", () => {
  const getItem = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  const setItem = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });

  expect(readSongSort()).toBe("artist");
  expect(() => writeSongSort("title")).not.toThrow();

  getItem.mockRestore();
  setItem.mockRestore();
});
