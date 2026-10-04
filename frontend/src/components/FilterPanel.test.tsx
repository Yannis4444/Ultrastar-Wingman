import { fireEvent, render, screen, within } from "@testing-library/react";
import { ANY_VALUE } from "../tags";
import { iconNames } from "../test/icons";
import FilterPanel, { type FilterRow } from "./FilterPanel";

/** The panel's two chip shapes, as the Songs page builds them (§4, §7). */
const MARK: FilterRow = {
  key: "favorite",
  kind: "tri-state",
  name: "Favorites",
  icon: "heart",
  colorClass: "tag-color-pink",
  value: "any",
};

const FACET: FilterRow = {
  key: "facet:duet",
  kind: "tri-state",
  name: "Duet",
  icon: "users",
  colorClass: "tag-color-gold",
  value: "yes",
};

/** A hidden-by-default tag, which the page hands over on *No*. */
const ARCHIVE: FilterRow = {
  key: "tag:t-archive",
  kind: "tri-state",
  name: "archive",
  icon: "tag",
  colorClass: "tag-color-blue",
  value: "no",
};

const GENRE: FilterRow = {
  key: "facet:genre",
  kind: "select",
  name: "Genre",
  icon: "music",
  colorClass: "tag-color-neutral",
  value: ANY_VALUE,
  options: ["Pop", "Rock"],
};

function renderPanel(
  rows: FilterRow[],
  {
    onSet = vi.fn(),
    onReset = vi.fn(),
    onClose = vi.fn(),
  }: {
    onSet?: (key: string, value: string) => void;
    onReset?: () => void;
    onClose?: () => void;
  } = {},
) {
  const view = render(
    <FilterPanel
      rows={rows}
      onSet={onSet}
      onReset={onReset}
      onClose={onClose}
    />,
  );
  return { ...view, onSet, onReset, onClose };
}

/** The text of a select's options, in order. */
function optionTexts(select: HTMLElement) {
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);
}

it("heads the panel with the one hint line", () => {
  renderPanel([MARK]);

  const hint = screen.getByText(
    "Tap once for only these songs, twice to leave them out.",
  );
  expect(hint).toHaveClass("section-note");
});

it("names every cycling chip by its criterion and its state", () => {
  renderPanel([MARK, FACET, ARCHIVE]);

  // The state is a word in the name, never `aria-pressed`: its true and false
  // cannot say *No*.
  for (const name of ["Favorites Any", "Duet Yes", "archive No"]) {
    const chip = screen.getByRole("button", { name });
    expect(chip).not.toHaveAttribute("aria-pressed");
  }
});

it("cycles Any, Yes, No and back to Any from wherever a chip stands", () => {
  const { onSet } = renderPanel([MARK, FACET, ARCHIVE]);

  fireEvent.click(screen.getByRole("button", { name: "Favorites Any" }));
  expect(onSet).toHaveBeenLastCalledWith("favorite", "yes");

  fireEvent.click(screen.getByRole("button", { name: "Duet Yes" }));
  expect(onSet).toHaveBeenLastCalledWith("facet:duet", "no");

  // A hidden-by-default tag opens on *No*, so its first tap brings its songs
  // back rather than asking for them alone.
  fireEvent.click(screen.getByRole("button", { name: "archive No" }));
  expect(onSet).toHaveBeenLastCalledWith("tag:t-archive", "any");
  expect(onSet).toHaveBeenCalledTimes(3);
});

it("follows the value it is handed, one tap at a time", () => {
  // Controlled: the chip shows what the page says, and the page answers each
  // tap with the next value — three taps go all the way round.
  const onSet = vi.fn();
  const { rerender } = renderPanel([MARK], { onSet });
  for (const [now, next] of [
    ["any", "yes"],
    ["yes", "no"],
    ["no", "any"],
  ] as const) {
    const label = { any: "Any", yes: "Yes", no: "No" }[now];
    rerender(
      <FilterPanel
        rows={[{ ...MARK, value: now }]}
        onSet={onSet}
        onReset={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `Favorites ${label}` }));
    expect(onSet).toHaveBeenLastCalledWith("favorite", next);
  }
});

it("is a native button, so Enter and Space cycle it with no handler of ours", () => {
  // jsdom does not turn a key into a click; the browser does, for a
  // `<button>`. What is ours to get right is that the chip is one, and that it
  // never submits anything.
  renderPanel([MARK]);

  const chip = screen.getByRole("button", { name: "Favorites Any" });
  expect(chip.tagName).toBe("BUTTON");
  expect(chip).toHaveAttribute("type", "button");
  expect(chip).not.toHaveAttribute("tabindex");
});

it("draws Any at rest, Yes pressed and No struck out under eye-off", () => {
  renderPanel([MARK, FACET, ARCHIVE]);

  const any = screen.getByRole("button", { name: "Favorites Any" });
  expect(any).toHaveClass("chip");
  expect(any).not.toHaveClass("chip-on");
  expect(iconNames(any)).toEqual(["heart"]);

  const yes = screen.getByRole("button", { name: "Duet Yes" });
  expect(yes).toHaveClass("chip", "chip-on");
  expect(iconNames(yes)).toEqual(["users"]);

  const no = screen.getByRole("button", { name: "archive No" });
  expect(no).toHaveClass("chip", "filter-chip-no");
  expect(no).not.toHaveClass("chip-on");
  // The criterion's glyph gives way to `eye-off`, out of the tag's colour.
  expect(iconNames(no)).toEqual(["eye-off"]);
  expect(no.querySelector("svg")).not.toHaveClass("tag-color-blue");
});

it("paints each chip's glyph in the colour it was given", () => {
  const { container } = renderPanel([MARK, FACET, GENRE]);

  const glyphs = container.querySelectorAll(".filter-chip-glyph");
  expect(glyphs[0]).toHaveClass("tag-color-pink");
  expect(glyphs[1]).toHaveClass("tag-color-gold");
  // A valued facet has no colour to configure, so its glyph is the neutral one.
  expect(glyphs[2]).toHaveClass("tag-color-neutral");
});

it("puts the built-ins in one cloud and the tags in a second", () => {
  renderPanel([MARK, FACET, GENRE, ARCHIVE]);

  const builtIn = screen.getByRole("group", { name: "Built-in" });
  const tags = screen.getByRole("group", { name: "Tags" });
  expect(
    within(builtIn)
      .getAllByRole("button")
      .map((chip) => chip.textContent),
  ).toEqual(["Favorites Any", "Duet Yes"]);
  expect(
    within(builtIn).getByRole("combobox", { name: "Genre" }),
  ).toBeInTheDocument();
  expect(
    within(tags)
      .getAllByRole("button")
      .map((chip) => chip.textContent),
  ).toEqual(["archive No"]);
  // No visible heading: the glyphs say which cloud is which.
  expect(screen.queryByRole("heading", { name: "Tags" })).toBeNull();
});

it("draws no empty cloud", () => {
  renderPanel([MARK]);

  expect(screen.getByRole("group", { name: "Built-in" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Tags" })).not.toBeInTheDocument();
});

it("lays a select named by the facet over a valued facet's chip", () => {
  renderPanel([GENRE]);

  const select = screen.getByRole("combobox", { name: "Genre" });
  // The chip is the box the reader sees; the select is the control inside it.
  const chip = select.closest(".chip");
  expect(chip).not.toBeNull();
  expect(chip).not.toHaveClass("chip-on");
  expect(chip?.textContent).toContain("Genre");
  expect(iconNames(chip as HTMLElement)).toEqual(["music", "chevron-down"]);
  // Its first entry is the facet's own name, and that is *Any*.
  expect(optionTexts(select)).toEqual(["Genre", "Pop", "Rock"]);
  expect(select).toHaveValue(ANY_VALUE);
});

it("presses a valued facet's chip and shows the value once one is chosen", () => {
  renderPanel([{ ...GENRE, value: "Rock" }]);

  const select = screen.getByRole("combobox", { name: "Genre" });
  const chip = select.closest(".chip");
  expect(chip).toHaveClass("chip-on");
  expect(chip?.querySelector(".chip-name")?.textContent).toBe("Rock");
  expect(select).toHaveValue("Rock");
});

it("keeps a value spelled like the sentinel apart from Any", () => {
  // A song file may say `#GENRE:any`. If *Any* and that genre shared an option
  // value, picking the genre would read as "this chip is not filtering" and the
  // select would snap back to the facet's name.
  renderPanel([{ ...GENRE, options: ["any", "Pop"] }]);

  const select = screen.getByRole("combobox", { name: "Genre" });
  const values = within(select)
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value);
  expect(values).toEqual([ANY_VALUE, "any", "Pop"]);
  expect(new Set(values).size).toBe(values.length);
});

it("offers exactly the options it was handed, in that order", () => {
  renderPanel([{ ...GENRE, name: "Decade", options: ["1980s", "1990s"] }]);

  expect(optionTexts(screen.getByRole("combobox", { name: "Decade" }))).toEqual(
    ["Decade", "1980s", "1990s"],
  );
});

it("keeps showing a chosen value the library no longer holds", () => {
  // A rescan dropped the last song with it: without the extra option the
  // select would fall back to the facet's name over a list filtered by
  // something nothing names.
  renderPanel([{ ...GENRE, value: "Schlager" }]);

  const select = screen.getByRole("combobox", { name: "Genre" });
  expect(select).toHaveValue("Schlager");
  expect(optionTexts(select)).toEqual(["Genre", "Schlager", "Pop", "Rock"]);
  expect(select.closest(".chip")).toHaveClass("chip-on");
});

it("reports a picked value by the chip's key", () => {
  const { onSet } = renderPanel([GENRE]);

  fireEvent.change(screen.getByRole("combobox", { name: "Genre" }), {
    target: { value: "Rock" },
  });
  expect(onSet).toHaveBeenCalledWith("facet:genre", "Rock");
});

it("hands Reset and Done to the page", () => {
  const { onReset, onClose } = renderPanel([MARK]);

  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
