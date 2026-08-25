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
