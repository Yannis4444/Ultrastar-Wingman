import type { SongRead } from "./api";

/**
 * The song list's order (ui-guidelines §7, Songs): the options of the one
 * quiet select in the count row, in the USDB page's words, and the comparator
 * behind each. Sorting happens here, over the list the page already holds and
 * has already filtered, because the backend hands the whole library over in
 * one answer.
 */

const SORT_STORAGE_KEY = "wingman.songSort";

export const SONG_SORTS = [
  { value: "artist", label: "Artist A to Z" },
  { value: "title", label: "Title A to Z" },
  { value: "year-desc", label: "Year, newest first" },
  { value: "year-asc", label: "Year, oldest first" },
  { value: "added", label: "Recently added" },
  { value: "random", label: "Random" },
] as const;

export type SongSort = (typeof SONG_SORTS)[number]["value"];

export const DEFAULT_SONG_SORT: SongSort = "artist";

export function isSongSort(value: unknown): value is SongSort {
  return SONG_SORTS.some((option) => option.value === value);
}

/**
 * Case- and accent-insensitive, like the backend's `lower()` and a little
 * kinder: "abba" sits with "ABBA" and "Édith" with "Edith". `numeric` so
 * "Song 2" comes before "Song 10". One fixed locale rather than the device's:
 * a Swedish phone would put "Ärzte" after "Zappa" while the TV beside it put
 * it with the A's, and the room should read one order.
 */
const COLLATOR = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

/** The rule every option falls back on: artist, then title, then the id so the
 *  order never depends on the order the songs arrived in. */
function byArtistThenTitle(a: SongRead, b: SongRead): number {
  return (
    COLLATOR.compare(a.artist, b.artist) ||
    COLLATOR.compare(a.title, b.title) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** A song without a year goes last whichever way the years run: a gap in the
 *  metadata is neither old nor new. */
function byYear(a: SongRead, b: SongRead, direction: 1 | -1): number {
  if (a.year === null || b.year === null) {
    if (a.year === b.year) return 0;
    return a.year === null ? 1 : -1;
  }
  return (a.year - b.year) * direction;
}

/**
 * When the library found the song, to the whole second. One scan inserts
 * every song it finds within a few milliseconds, one row after the other in
 * folder order; read to the millisecond, a library found in one go would come
 * out as folder order in broken runs. To the second, songs found together tie
 * and fall to artist, then title, while downloads, seconds apart, keep their
 * order. The fraction is dropped before parsing, which also spares engines
 * the six digits Pydantic writes. Unreadable reads as the oldest, so such a
 * song sinks rather than jumps.
 */
function addedAt(song: SongRead): number {
  const parsed = Date.parse(song.created_at.replace(/\.\d+/, ""));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Where a song lands in the shuffle `seed` stands for: FNV-1a over the seed and
 * the id. A key per song rather than a shuffled array, so the order holds while
 * the list is refetched, filtered or searched — a song that comes back lands
 * where it was, and a new one slots in without moving the rest.
 */
export function shuffleKey(seed: number, id: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // One more mix, so ids that differ only in their last character do not
  // land next to each other.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d) >>> 0;
  hash ^= hash >>> 12;
  return hash >>> 0;
}

/** A fresh shuffle: what choosing *Random*, *Shuffle again* and coming back to
 *  a kept *Random* each start. */
export function newShuffleSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x100000000) >>> 0;
}

/**
 * `songs` in `order`, as a new array. `seed` is only read by *Random*; ties
 * fall to artist, then title in every order.
 */
export function sortSongs(
  songs: readonly SongRead[],
  order: SongSort,
  seed = 0,
): SongRead[] {
  const compare = (a: SongRead, b: SongRead): number => {
    switch (order) {
      case "artist":
        return byArtistThenTitle(a, b);
      case "title":
        return COLLATOR.compare(a.title, b.title) || byArtistThenTitle(a, b);
      case "year-desc":
        return byYear(a, b, -1) || byArtistThenTitle(a, b);
      case "year-asc":
        return byYear(a, b, 1) || byArtistThenTitle(a, b);
      case "added": {
        // Newest first. Parsed rather than compared as text: the backend
        // writes microseconds only when there are any, and "…00.5Z" sorts
        // before "…00Z" as a string.
        const difference = addedAt(b) - addedAt(a);
        return difference || byArtistThenTitle(a, b);
      }
      case "random":
        return (
          shuffleKey(seed, a.id) - shuffleKey(seed, b.id) ||
          byArtistThenTitle(a, b)
        );
    }
  };
  return [...songs].sort(compare);
}

/** The order this device chose last, or the default for anything else. */
export function readSongSort(): SongSort {
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    // A stored value no option carries would draw the select blank.
    return isSongSort(stored) ? stored : DEFAULT_SONG_SORT;
  } catch {
    return DEFAULT_SONG_SORT;
  }
}

export function writeSongSort(order: SongSort): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, order);
  } catch {
    // Private mode or a full quota: the order is a convenience, not a feature.
  }
}
