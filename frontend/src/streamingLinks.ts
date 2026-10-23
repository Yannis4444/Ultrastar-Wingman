/**
 * Where a song can be listened to outside Wingman: one search per streaming
 * service, for the song's artist and title. A search rather than a lookup, so
 * no service needs an API key, and a song named a little differently there
 * still turns up near the top.
 */

import type { IconName } from "./components/icons";

/** One streaming service the song modal offers. */
export interface StreamingService {
  id: string;
  /** What the service calls itself, written beside its mark. */
  name: string;
  /** The service's mark, drawn monochrome before the name (ui-guidelines §3). */
  icon: IconName;
  /** The service's search page for one query. */
  searchUrl: (query: string) => string;
}

/** A service's search page for one song. */
export interface StreamingLink {
  id: string;
  name: string;
  icon: IconName;
  href: string;
}

/**
 * A query as one path segment. Deezer answers 404 for a `%2F` in its search
 * path (tried 2026-10-23), so a slash becomes a space there before anything is
 * encoded. Spotify, the other path form, gets the same rule: a slash says
 * nothing to a search ("AC DC" finds AC/DC), and one rule for both is one rule
 * less to remember.
 */
function pathSegment(query: string): string {
  return encodeURIComponent(query.replace(/\//g, " ").replace(/\s+/g, " "));
}

/** The services, in the order the user listed them. */
export const STREAMING_SERVICES: readonly StreamingService[] = [
  {
    id: "spotify",
    name: "Spotify",
    icon: "brand-spotify",
    searchUrl: (query) =>
      `https://open.spotify.com/search/${pathSegment(query)}`,
  },
  {
    id: "apple-music",
    name: "Apple Music",
    icon: "brand-applemusic",
    searchUrl: (query) =>
      `https://music.apple.com/search?term=${encodeURIComponent(query)}`,
  },
  {
    id: "youtube-music",
    name: "YouTube Music",
    icon: "brand-youtubemusic",
    searchUrl: (query) =>
      `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: "tidal",
    name: "Tidal",
    icon: "brand-tidal",
    searchUrl: (query) =>
      `https://tidal.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: "deezer",
    name: "Deezer",
    icon: "brand-deezer",
    searchUrl: (query) => `https://www.deezer.com/search/${pathSegment(query)}`,
  },
];

/**
 * The words in parentheses that say how a karaoke file was made rather than
 * what the song is called. Only a group that is exactly one of these goes:
 * "(I Can't Get No) Satisfaction" is the title, and "(Remix)" names a
 * different recording the reader may well be looking for.
 */
const PARENTHESISED_TAGS = new Set(["duet", "karaoke", "live"]);

/**
 * A title or an artist as a streaming service would spell it: every group in
 * square brackets dropped ("[DUET]", "[Live]" — no song is called that on a
 * service), a parenthesised group dropped only when it is one of the tags
 * above, the spaces collapsed and the ends trimmed.
 */
export function cleanForSearch(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^()]*)\)/g, (group, inner: string) =>
      PARENTHESISED_TAGS.has(inner.trim().toLowerCase()) ? " " : group,
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** What every service is asked for: the artist, then the title, cleaned. */
export function searchQuery(song: { artist: string; title: string }): string {
  return [cleanForSearch(song.artist), cleanForSearch(song.title)]
    .filter((part) => part !== "")
    .join(" ");
}

/** One search link per service, in the services' order. */
export function streamingLinks(song: {
  artist: string;
  title: string;
}): StreamingLink[] {
  const query = searchQuery(song);
  return STREAMING_SERVICES.map(({ id, name, icon, searchUrl }) => ({
    id,
    name,
    icon,
    href: searchUrl(query),
  }));
}
