import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import EditorActions from "./EditorActions";

it("submits the form it sits in", () => {
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <EditorActions />
    </form>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit).toHaveBeenCalled();
});

it("says why Save is off, so a disabled button is never a mystery", () => {
  render(
    <form>
      <EditorActions
        note="It needs a name before it can be saved."
        saveDisabled
      />
    </form>,
  );

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "It needs a name before it can be saved.",
  );
});

it("acknowledges a save in the same line, and the refusal wins over it", () => {
  const { rerender } = render(
    <form>
      <EditorActions saved />
    </form>,
  );

  const line = screen.getByRole("status");
  expect(line).toHaveTextContent("Saved");
  expect(line).toHaveClass("editor-actions-saved");

  // Saved a moment ago and broken since: what is wrong now is the useful line.
  rerender(
    <form>
      <EditorActions saved note="A condition above needs putting right." />
    </form>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "A condition above needs putting right.",
  );
  expect(screen.getByRole("status")).not.toHaveClass("editor-actions-saved");
});

it("says what landed in its own words when it was not a save", () => {
  render(
    <form>
      <EditorActions
        saved
        savedLabel="Reset — the shipped achievement is back."
      />
    </form>,
  );

  const line = screen.getByRole("status");
  expect(line).toHaveTextContent("Reset — the shipped achievement is back.");
  // The same accent slot: what happened is acknowledged, whichever write it was.
  expect(line).toHaveClass("editor-actions-saved");
});

it("keeps the live region in the document with nothing to say", () => {
  render(
    <form>
      <EditorActions />
    </form>,
  );

  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

it("puts the editor's other action beside Save on the one row", () => {
  render(
    <form>
      <EditorActions>
        <button type="button" className="button button-danger">
          Delete tag
        </button>
      </EditorActions>
    </form>,
  );

  const row = screen.getByRole("button", { name: "Save" }).parentElement!;
  expect(row).toHaveClass("editor-actions-row");
  expect(row.querySelector("button.button-danger")?.textContent).toBe(
    "Delete tag",
  );
});

it("is one sticky row inside the form, the geometry hangs on it", () => {
  const { container } = render(
    <form>
      <EditorActions note="Nothing has changed yet." />
    </form>,
  );

  // `.editor-actions` is what sticks at `--bottom-nav-height` — the term the
  // nav is that tall by and the page reserves at its foot — so the row rides on
  // the nav rather than a pixel or two above it. It has to be the last thing in
  // the form, or what follows scrolls behind it and ends up underneath.
  const row = container.querySelector(".editor-actions");
  expect(row).not.toBeNull();
  const form = container.querySelector("form")!;
  expect(form.lastElementChild).toBe(row);
  expect(row?.querySelector(".editor-actions-note")).not.toBeNull();
  expect(row?.querySelector(".editor-actions-row")).not.toBeNull();
});
