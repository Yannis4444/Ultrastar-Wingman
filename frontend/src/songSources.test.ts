import { USDB_SONG_PAGE, usdbSongUrl } from "./songSources";

test("a USDB song links to its page on the public site", () => {
  expect(USDB_SONG_PAGE).toBe(
    "https://usdb.animux.de/index.php?link=detail&id=",
  );
  expect(usdbSongUrl("usdb:24435")).toBe(
    "https://usdb.animux.de/index.php?link=detail&id=24435",
  );
});

test("any other id has no USDB page", () => {
  for (const id of [
    "local:6f1c0a2e-4b7d-4c1e-9a3f-2d8e5b7c9a10",
    "usdb:",
    "usdb:gone",
    "usdb:12a",
    "usdb:12/34",
    "xusdb:12",
    "USDB:12",
  ]) {
    expect(usdbSongUrl(id)).toBeNull();
  }
});
