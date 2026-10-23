import {
  cleanForSearch,
  searchQuery,
  STREAMING_SERVICES,
  streamingLinks,
} from "./streamingLinks";

/** The hrefs of one song's links, keyed by service. */
function hrefs(artist: string, title: string): Record<string, string> {
  return Object.fromEntries(
    streamingLinks({ artist, title }).map((link) => [link.id, link.href]),
  );
}

test("the five services stand in the order the user listed them", () => {
  expect(STREAMING_SERVICES.map((service) => service.name)).toEqual([
    "Spotify",
    "Apple Music",
    "YouTube Music",
    "Tidal",
    "Deezer",
  ]);
  expect(
    streamingLinks({ artist: "Queen", title: "Bohemian Rhapsody" }).map(
      (link) => link.name,
    ),
  ).toEqual(["Spotify", "Apple Music", "YouTube Music", "Tidal", "Deezer"]);
});

test("each service is asked on its own search page, artist before title", () => {
  expect(hrefs("Queen", "Bohemian Rhapsody")).toEqual({
    spotify: "https://open.spotify.com/search/Queen%20Bohemian%20Rhapsody",
    "apple-music":
      "https://music.apple.com/search?term=Queen%20Bohemian%20Rhapsody",
    "youtube-music":
      "https://music.youtube.com/search?q=Queen%20Bohemian%20Rhapsody",
    tidal: "https://tidal.com/search?q=Queen%20Bohemian%20Rhapsody",
    deezer: "https://www.deezer.com/search/Queen%20Bohemian%20Rhapsody",
  });
});

test("a bracketed group goes, whatever it says", () => {
  expect(cleanForSearch("I Got You Babe [DUET]")).toBe("I Got You Babe");
  expect(cleanForSearch("Hotel California [Live]")).toBe("Hotel California");
  expect(cleanForSearch("[SC] Song [VIDEO] Title")).toBe("Song Title");
});

test("a parenthesised tag goes in any case, with spaces inside", () => {
  expect(cleanForSearch("Islands in the Stream (Duet)")).toBe(
    "Islands in the Stream",
  );
  expect(cleanForSearch("Islands in the Stream (DUET)")).toBe(
    "Islands in the Stream",
  );
  expect(cleanForSearch("Hotel California ( live )")).toBe("Hotel California");
  expect(cleanForSearch("Wonderwall (Karaoke)")).toBe("Wonderwall");
});

test("a parenthesised part of the title stays", () => {
  expect(cleanForSearch("(I Can't Get No) Satisfaction")).toBe(
    "(I Can't Get No) Satisfaction",
  );
  // A remix is a recording of its own, which is what the reader looks for.
  expect(cleanForSearch("Blue (Da Ba Dee) (Remix)")).toBe(
    "Blue (Da Ba Dee) (Remix)",
  );
  // Only a group that is the tag alone: a duet *with* somebody names them.
  expect(cleanForSearch("Shallow (Duet with Bradley Cooper)")).toBe(
    "Shallow (Duet with Bradley Cooper)",
  );
});

test("the spaces left behind collapse and the ends are trimmed", () => {
  expect(cleanForSearch("  Under   Pressure  [DUET]  (Live) ")).toBe(
    "Under Pressure",
  );
});

test("the artist is cleaned the same way, and an emptied part leaves no gap", () => {
  expect(searchQuery({ artist: "Sonny & Cher [DUET]", title: "[DUET]" })).toBe(
    "Sonny & Cher",
  );
  expect(
    searchQuery({ artist: "Sonny & Cher", title: "I Got You Babe [DUET]" }),
  ).toBe("Sonny & Cher I Got You Babe");
});

test("an ampersand is encoded, never read as the next parameter", () => {
  const links = hrefs("Sonny & Cher", "I Got You Babe [DUET]");

  expect(links["apple-music"]).toBe(
    "https://music.apple.com/search?term=Sonny%20%26%20Cher%20I%20Got%20You%20Babe",
  );
  expect(links.spotify).toBe(
    "https://open.spotify.com/search/Sonny%20%26%20Cher%20I%20Got%20You%20Babe",
  );
  expect(new URL(links.tidal).searchParams.get("q")).toBe(
    "Sonny & Cher I Got You Babe",
  );
  expect(new URL(links["youtube-music"]).searchParams.get("q")).toBe(
    "Sonny & Cher I Got You Babe",
  );
});

test("umlauts and other letters are UTF-8 percent-encoded", () => {
  const links = hrefs("Die Ärzte", "Schrei nach Liebe");

  expect(links["youtube-music"]).toBe(
    "https://music.youtube.com/search?q=Die%20%C3%84rzte%20Schrei%20nach%20Liebe",
  );
  expect(links.deezer).toBe(
    "https://www.deezer.com/search/Die%20%C3%84rzte%20Schrei%20nach%20Liebe",
  );
  expect(new URL(links["apple-music"]).searchParams.get("term")).toBe(
    "Die Ärzte Schrei nach Liebe",
  );
});

test("a slash stays in a parameter but never splits a search path", () => {
  const links = hrefs("AC/DC", "Highway to Hell");

  // A parameter carries it encoded, so the service searches for "AC/DC".
  expect(new URL(links.tidal).searchParams.get("q")).toBe(
    "AC/DC Highway to Hell",
  );
  expect(links["apple-music"]).toContain("AC%2FDC");
  // In a path it becomes a space: Deezer answers 404 for a `%2F` there.
  expect(links.deezer).toBe(
    "https://www.deezer.com/search/AC%20DC%20Highway%20to%20Hell",
  );
  expect(links.spotify).toBe(
    "https://open.spotify.com/search/AC%20DC%20Highway%20to%20Hell",
  );
  // A slash on its own between spaces leaves one space, not two.
  expect(hrefs("Artist", "Side A / Side B").deezer).toBe(
    "https://www.deezer.com/search/Artist%20Side%20A%20Side%20B",
  );
});

test("nothing in a query can break out of its place in the address", () => {
  const links = hrefs("Who?", "50% #1 Hit");

  for (const href of Object.values(links)) {
    const url = new URL(href);
    expect(url.hash).toBe("");
  }
  expect(new URL(links.tidal).searchParams.get("q")).toBe("Who? 50% #1 Hit");
  expect(decodeURIComponent(new URL(links.spotify).pathname)).toBe(
    "/search/Who? 50% #1 Hit",
  );
  // A plus is a plus, never a space a form decoder would read into it.
  expect(new URL(hrefs("Elton John", "Rock + Roll").tidal).search).toBe(
    "?q=Elton%20John%20Rock%20%2B%20Roll",
  );
});

test("a bracketed tag goes wherever it stands and however it is cased", () => {
  expect(cleanForSearch("[duet] I Got You Babe")).toBe("I Got You Babe");
  expect(cleanForSearch("I Got [Duet] You Babe")).toBe("I Got You Babe");
  expect(cleanForSearch("I Got You Babe [duet]")).toBe("I Got You Babe");
});

test("a missing artist or a title that is only a tag still makes a search", () => {
  expect(searchQuery({ artist: "", title: "Bohemian Rhapsody [DUET]" })).toBe(
    "Bohemian Rhapsody",
  );
  expect(searchQuery({ artist: "Queen", title: "[DUET]" })).toBe("Queen");
  // Nothing left at all is the service's empty search page, still its own.
  expect(hrefs("", "[DUET]")).toEqual({
    spotify: "https://open.spotify.com/search/",
    "apple-music": "https://music.apple.com/search?term=",
    "youtube-music": "https://music.youtube.com/search?q=",
    tidal: "https://tidal.com/search?q=",
    deezer: "https://www.deezer.com/search/",
  });
});

test("whatever a song is called, every link is an https link to its service", () => {
  const hosts = [
    "open.spotify.com",
    "music.apple.com",
    "music.youtube.com",
    "tidal.com",
    "www.deezer.com",
  ];
  for (const [artist, title] of [
    ["javascript:alert(1)", "x"],
    ["", "javascript:alert(1)//"],
    ["//evil.example", "@evil.example"],
    ["<img src=x onerror=alert(1)>", "\"'><script>"],
    ["..", ".."],
  ]) {
    const links = streamingLinks({ artist, title });
    expect(links.map((link) => new URL(link.href).protocol)).toEqual(
      Array(5).fill("https:"),
    );
    expect(links.map((link) => new URL(link.href).host)).toEqual(hosts);
  }
});
