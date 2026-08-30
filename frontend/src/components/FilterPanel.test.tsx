import { fireEvent, render, screen, within } from "@testing-library/react";
import { ANY_VALUE } from "../tags";
import { iconNames } from "../test/icons";
import FilterPanel, { type FilterRow } from "./FilterPanel";

/** The panel's two row shapes, as the Songs page builds them (§4, §7). */
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

const GENRE: FilterRow = {
  key: "facet:genre",
  kind: "select",
  name: "Genre",
  icon: "music",
  colorClass: "tag-color-neutral",
  value: ANY_VALUE,
  options: ["Pop", "Rock"],
};

function renderPanel(rows: FilterRow[], onSet = vi.fn()) {
  render(
    <FilterPanel
      rows={rows}
      onSet={onSet}
      onReset={() => {}}
      onClose={() => {}}
    />,
  );
  return onSet;
}

it("ends a mark, a tag and a boolean facet in the tri-state control", () => {
  renderPanel([MARK, FACET]);

  for (const [name, checked] of [
    ["Favorites", "Any"],
    ["Duet", "Yes"],
  ]) {
    const row = screen.getByRole("group", { name });
    expect(
      within(row)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["any", "yes", "no"]);
    expect(within(row).getByRole("radio", { name: checked })).toBeChecked();
  }
});

it("ends a valued facet in a select named by the criterion", () => {
  renderPanel([GENRE]);

  // §4: the select sits where the tri-state group would, and the criterion
  // names it the way that group's legend does.
  const select = screen.getByRole("combobox", { name: "Genre" });
  expect(select).toHaveClass("text-input-quiet");
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Any", "Pop", "Rock"]);
  expect(select).toHaveValue(ANY_VALUE);
  // Never a radio group as well: one control per row.
  expect(
    screen.queryByRole("group", { name: "Genre" }),
  ).not.toBeInTheDocument();
});

it("keeps a value spelled like the sentinel apart from Any", () => {
  // A song file may say `#GENRE:any`. If *Any* and that genre shared an option
  // value, picking the genre would read as "this row is not filtering" and the
  // select would snap its text back to *Any*.
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

  expect(
    within(screen.getByRole("combobox", { name: "Decade" }))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Any", "1980s", "1990s"]);
});

it("keeps showing a chosen value the library no longer holds", () => {
  // A rescan dropped the last song with it: without the extra option the
  // select would sit empty over a list filtered by something nothing names.
  renderPanel([{ ...GENRE, value: "Schlager" }]);

  const select = screen.getByRole("combobox", { name: "Genre" });
  expect(select).toHaveValue("Schlager");
  expect(within(select).getAllByRole("option")).toHaveLength(4);
});

it("reports what the reader picked, by the row's key", () => {
  const onSet = renderPanel([MARK, GENRE]);

  fireEvent.click(
    within(screen.getByRole("group", { name: "Favorites" })).getByRole(
      "radio",
      {
        name: "Yes",
      },
    ),
  );
  expect(onSet).toHaveBeenCalledWith("favorite", "yes");

  fireEvent.change(screen.getByRole("combobox", { name: "Genre" }), {
    target: { value: "Rock" },
  });
  expect(onSet).toHaveBeenCalledWith("facet:genre", "Rock");
});

it("paints each row's glyph in the colour it was given", () => {
  const { container } = render(
    <FilterPanel
      rows={[MARK, FACET, GENRE]}
      onSet={() => {}}
      onReset={() => {}}
      onClose={() => {}}
    />,
  );

  const glyphs = container.querySelectorAll(".filter-row-glyph");
  expect(glyphs[0]).toHaveClass("tag-color-pink");
  expect(glyphs[1]).toHaveClass("tag-color-gold");
  // A valued facet has no colour to configure, so its glyph is the neutral one.
  expect(glyphs[2]).toHaveClass("tag-color-neutral");
  expect(iconNames(container)).toEqual(
    expect.arrayContaining(["heart", "users", "music"]),
  );
});

it("names every row's control, so a reader hears which criterion it is", () => {
  renderPanel([MARK, FACET, GENRE]);

  expect(screen.getByRole("group", { name: "Favorites" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Duet" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Genre" })).toBeInTheDocument();
  // Every radio is reachable: the label wraps it, so the visible text is its
  // accessible name even though the input itself is visually hidden.
  expect(screen.getAllByRole("radio")).toHaveLength(6);
});
