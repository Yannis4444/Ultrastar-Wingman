import { render, screen } from "@testing-library/react";
import type { SongRead } from "../api";
import { iconNames } from "../test/icons";
import { tagRead } from "../test/tags";
import SongListItem from "./SongListItem";

function song(): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: "SingStar",
    creator: "someone",
  };
}

/** The row's marks, in the order they follow the title. */
function marks(): string[] {
  return iconNames(screen.getByText("Dancing Queen").parentElement!);
}

it("puts the tag marks after the sung and favorite ones", () => {
  render(
    <SongListItem
      song={song()}
      sung
      favorite
      tags={[
        tagRead({ id: "t-broken", name: "broken", icon: "alert" }),
        tagRead({ id: "t-duet", name: "duet", icon: "users" }),
      ]}
      onClick={() => {}}
    />,
  );

  expect(marks()).toEqual(["mic", "heart", "alert", "users"]);
});

it("paints each tag in its own colour and names it on hover", () => {
  const { container } = render(
    <SongListItem
      song={song()}
      tags={[
        tagRead({
          id: "t-broken",
          name: "broken",
          icon: "alert",
          color: "gold",
        }),
        tagRead({ id: "t-duet", name: "duet", icon: "users", color: "blue" }),
      ]}
      onClick={() => {}}
    />,
  );

  const drawn = container.querySelectorAll(".song-mark-tag");
  expect(drawn[0]).toHaveClass("tag-color-gold");
  expect(drawn[0]).toHaveAttribute("title", "broken");
  expect(drawn[1]).toHaveClass("tag-color-blue");
});

it("falls back to the feature's own glyph and colour", () => {
  const { container } = render(
    <SongListItem
      song={song()}
      // No icon, and a colour this build does not know: neither may leave the
      // mark unpainted or draw an empty path.
      tags={[
        tagRead({ id: "t-x", name: "mystery", icon: null, color: "puce" }),
      ]}
      onClick={() => {}}
    />,
  );

  expect(marks()).toEqual(["tag"]);
  expect(container.querySelector(".song-mark-tag")).toHaveClass(
    "tag-color-neutral",
  );
});

it("draws no tag mark when the row was given none", () => {
  render(<SongListItem song={song()} sung onClick={() => {}} />);

  expect(marks()).toEqual(["mic"]);
});
