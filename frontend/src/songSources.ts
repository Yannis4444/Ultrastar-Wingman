import type { IconName } from "./components/icons";

/** One place songs can be fetched from. */
export interface SongSource {
  id: string;
  /** What the source calls itself. */
  name: string;
  /** The view that searches it. */
  route: string;
  icon: IconName;
  /** Without it the source is not offered; the backend would refuse anyway. */
  capability: string;
  /** One or two sentences: what picking this does. */
  description: string;
}

/**
 * The sources the "Add songs" picker offers. One entry today — the picker is a
 * list because the seam behind it (`sources/base.py`) is built for more, and a
 * second source should only have to appear here.
 */
export const SONG_SOURCES: SongSource[] = [
  {
    id: "usdb",
    name: "USDB",
    route: "/usdb",
    icon: "globe",
    capability: "usdb.search",
    description:
      "Search usdb.animux.de, the community song database, and download songs straight into the library.",
  },
];

/**
 * A USDB song's own page, the address the song modal's fine print links to
 * with the song's number appended. A constant rather than the backend's
 * `usdb.base_url`: that setting is where Wingman downloads from, which a host
 * may point somewhere else, while a link for a person to open wants the
 * public site.
 */
export const USDB_SONG_PAGE =
  "https://usdb.animux.de/index.php?link=detail&id=";

/**
 * The USDB page of a song whose id is `usdb:<number>`, or `null` for any other
 * id — a local song, or one whose number is not a number.
 */
export function usdbSongUrl(songId: string): string | null {
  const match = /^usdb:(\d+)$/.exec(songId);
  return match === null ? null : `${USDB_SONG_PAGE}${match[1]}`;
}
