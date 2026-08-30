import { render, screen } from "@testing-library/react";
import type { SongRead } from "../api";
import { builtInTags } from "../tags";
import { iconNames } from "../test/icons";
import { builtInTagRead, builtInTagReads, tagRead } from "../test/tags";
import SongListItem from "./SongListItem";

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: "SingStar",
    creator: "someone",
    ...overrides,
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

it("paints the two built-in marks in the colours the party chose", () => {
  const { container } = render(
    <SongListItem
      song={song()}
      sung
      favorite
      builtIns={builtInTags([
        builtInTagRead({ color: "gold" }),
        builtInTagRead({ id: "sung", color: "neutral" }),
      ])}
      onClick={() => {}}
    />,
  );

  expect(container.querySelector(".song-mark-sung")).toHaveClass(
    "tag-color-neutral",
  );
  expect(container.querySelector(".song-mark-favorite")).toHaveClass(
    "tag-color-gold",
  );
});

it("leaves a built-in mark off the row when it is not shown in the list", () => {
  render(
    <SongListItem
      song={song()}
      sung
      favorite
      builtIns={builtInTags([
        builtInTagRead({ show_in_list: false }),
        builtInTagRead({ id: "sung", color: "blue" }),
      ])}
      tags={[tagRead({ id: "t-broken", name: "broken", icon: "alert" })]}
      onClick={() => {}}
    />,
  );

  // The microphone and the tag stay; the heart is gone.
  expect(marks()).toEqual(["mic", "alert"]);
});

it("falls back to the pink heart and the blue microphone", () => {
  // No `builtIns`: the wishlist tile and every other caller that has not asked
  // the tags listing yet must not draw an unpainted mark.
  const { container } = render(
    <SongListItem song={song()} sung favorite onClick={() => {}} />,
  );

  expect(container.querySelector(".song-mark-sung")).toHaveClass(
    "tag-color-blue",
  );
  expect(container.querySelector(".song-mark-favorite")).toHaveClass(
    "tag-color-pink",
  );
});

// --- the two boolean facets ------------------------------------------------

/** The eight built-ins with `duet` and `video` put on the rows — off is how
 *  they arrive (§1.3), so every test that wants them says so. */
function withFacetMarks(color = "gold") {
  return builtInTags(
    builtInTagReads().map((row) =>
      row.id === "duet" || row.id === "video"
        ? { ...row, color, show_in_list: true }
        : row,
    ),
  );
}

it("leaves the duet and video marks off the row by default", () => {
  // The song is both, and the built-ins arrive with `show_in_list` off: half a
  // library is a duet, so nothing is marked until the party asks for it.
  render(
    <SongListItem
      song={song({ is_duet: true, has_video: true })}
      sung
      builtIns={builtInTags(builtInTagReads())}
      onClick={() => {}}
    />,
  );

  expect(marks()).toEqual(["mic"]);
});

it("draws the duet and video marks in §1.4's order once they are shown", () => {
  render(
    <SongListItem
      song={song({ is_duet: true, has_video: true })}
      sung
      favorite
      builtIns={withFacetMarks()}
      tags={[tagRead({ id: "t-broken", name: "broken", icon: "alert" })]}
      onClick={() => {}}
    />,
  );

  // Microphone, heart, the two facets, then the tags.
  expect(marks()).toEqual(["mic", "heart", "users", "video", "alert"]);
});

it("paints the facet marks in the colour the party chose", () => {
  const { container } = render(
    <SongListItem
      song={song({ is_duet: true, has_video: true })}
      builtIns={withFacetMarks("pink")}
      onClick={() => {}}
    />,
  );

  expect(container.querySelector(".song-mark-duet")).toHaveClass(
    "tag-color-pink",
  );
  expect(container.querySelector(".song-mark-video")).toHaveClass(
    "tag-color-pink",
  );
});

it("marks only what the file actually says about the song", () => {
  render(
    <SongListItem
      song={song({ is_duet: false, has_video: true })}
      builtIns={withFacetMarks()}
      onClick={() => {}}
    />,
  );

  expect(marks()).toEqual(["video"]);
});

it("never marks a valued facet", () => {
  // Genre, language, edition and decade have a value on this song and no row
  // mark anywhere: a near-universal attribute belongs in the modal (§1.3).
  const { container } = render(
    <SongListItem
      song={song()}
      builtIns={builtInTags(builtInTagReads())}
      onClick={() => {}}
    />,
  );

  expect(marks()).toEqual([]);
  expect(container.querySelectorAll(".song-mark")).toHaveLength(0);
});
