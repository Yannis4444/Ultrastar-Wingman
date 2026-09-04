import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import ConfirmModal from "./ConfirmModal";
import Modal from "./Modal";

/** Renders a modal whose body has one button, scoped to its own container. */
function renderModal(props: { bare?: boolean; hideTitle?: boolean } = {}) {
  const onClose = vi.fn();
  const { container, rerender } = render(
    <Modal title="Bohemian Rhapsody" onClose={onClose} {...props}>
      <button type="button">Sing</button>
    </Modal>,
  );
  const backdrop = container.querySelector(".modal-backdrop");
  if (backdrop === null) throw new Error("no backdrop rendered");
  return {
    onClose,
    backdrop,
    panel: within(container).getByRole("dialog"),
    body: within(container),
    /** Re-renders with fresh props, as a parent re-render would. A sub-view
     *  passes its own `body`: the swap really does unmount what was focused. */
    rerender: (next: { title?: string; body?: ReactNode } = {}) =>
      rerender(
        <Modal
          title={next.title ?? "Bohemian Rhapsody"}
          // A new identity every time, like the inline arrows at every real
          // call site.
          onClose={() => onClose()}
          {...props}
        >
          {next.body ?? <button type="button">Sing</button>}
        </Modal>,
      ),
  };
}

/**
 * A dialog whose body opens a confirmation over itself — the shape every page
 * with a delete inside a modal has. Confirming takes the row away, so what
 * opened the confirmation is gone by the time it closes.
 */
function Nested({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState(["Bohemian Rhapsody"]);
  const [confirming, setConfirming] = useState(false);
  return (
    <Modal title="Comments" onClose={onClose}>
      {rows.map((row) => (
        <button key={row} type="button" onClick={() => setConfirming(true)}>
          Delete {row}
        </button>
      ))}
      {confirming && (
        <ConfirmModal
          title="Delete comment"
          message="It is gone for everybody."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setRows([]);
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  );
}

/** Renders `Nested` and opens the confirmation from a focused row control. */
function openConfirmation() {
  const onClose = vi.fn();
  render(<Nested onClose={onClose} />);
  const trash = screen.getByRole("button", {
    name: "Delete Bohemian Rhapsody",
  });
  // A real click focuses what it presses; jsdom's does not.
  trash.focus();
  fireEvent.click(trash);
  return { onClose, trash };
}

/** A full press: browsers never dispatch `click` without a `mousedown`. */
function press(target: Element) {
  fireEvent.mouseDown(target);
  fireEvent.click(target);
}

test("clicking the backdrop closes the modal", () => {
  const { onClose, backdrop } = renderModal();

  press(backdrop);
  expect(onClose).toHaveBeenCalled();
});

test("clicking content inside the panel does not close the modal", () => {
  const { onClose, body } = renderModal();

  press(body.getByRole("button", { name: "Sing" }));
  expect(onClose).not.toHaveBeenCalled();
});

test("the empty stretches of a bare panel close it like backdrop", () => {
  const { onClose, panel } = renderModal({ bare: true, hideTitle: true });

  // A bare modal shows no surface, so the panel's own area reads as backdrop.
  // The click has to land on the panel element itself, not on its content.
  press(panel);
  expect(onClose).toHaveBeenCalled();
});

test("a bare panel still ignores clicks on its content", () => {
  const { onClose, body } = renderModal({ bare: true, hideTitle: true });

  press(body.getByRole("button", { name: "Sing" }));
  expect(onClose).not.toHaveBeenCalled();
});

test("a panel modal keeps its own surface unclickable", () => {
  const { onClose, panel } = renderModal();

  press(panel);
  expect(onClose).not.toHaveBeenCalled();
});

test("a drag out of the content onto the backdrop does not close the modal", () => {
  const { onClose, backdrop, body } = renderModal();

  // Selecting text (or scrubbing) inside and releasing outside dispatches the
  // click on the common ancestor — the backdrop.
  fireEvent.mouseDown(body.getByRole("button", { name: "Sing" }));
  fireEvent.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();
});

test("a drag out of the content onto a bare panel does not close the modal", () => {
  const { onClose, panel, body } = renderModal({ bare: true, hideTitle: true });

  fireEvent.mouseDown(body.getByRole("button", { name: "Sing" }));
  fireEvent.click(panel);
  expect(onClose).not.toHaveBeenCalled();
});

test("Escape closes a panel modal", () => {
  const { onClose } = renderModal();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("Escape closes a bare modal", () => {
  const { onClose } = renderModal({ bare: true, hideTitle: true });

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("Escape still closes after the callback identity changed", () => {
  const { onClose, rerender } = renderModal();

  rerender();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("a re-render leaves the focus where the user put it", () => {
  const { body, rerender } = renderModal({ bare: true, hideTitle: true });
  const sing = body.getByRole("button", { name: "Sing" });
  sing.focus();

  rerender();
  expect(document.activeElement).toBe(sing);
});

test("a field the body autofocuses keeps the focus the dialog would take", () => {
  // The New playlist panel opens with the cursor in the name field; the focus
  // trap must not pull it back to the panel on the way in.
  const { container } = render(
    <Modal title="New playlist" onClose={vi.fn()}>
      <input aria-label="Name" autoFocus />
    </Modal>,
  );

  expect(document.activeElement).toBe(
    within(container).getByRole("textbox", { name: "Name" }),
  );
});

test("Escape over a confirmation closes only the confirmation", () => {
  const { onClose } = openConfirmation();
  expect(screen.getByText("It is gone for everybody.")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });

  // Both dialogs listen on `document`; only the top one may answer.
  expect(
    screen.queryByText("It is gone for everybody."),
  ).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();

  // And the dialog underneath is the top one again.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("a closed confirmation hands the focus back to what opened it", () => {
  const { trash } = openConfirmation();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(document.activeElement).toBe(trash);
});

test("the dialog underneath takes the focus when the opener is gone", () => {
  const { trash } = openConfirmation();
  const panel = screen.getByRole("dialog", { name: "Comments" });

  // Confirming removes the row, so the control that opened the confirmation
  // unmounts with it — focus must not fall through to the page behind.
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(trash).not.toBeInTheDocument();
  expect(document.activeElement).toBe(panel);
});

test("swapping to a sub-view moves focus back into the dialog", () => {
  const { body, panel, rerender } = renderModal({
    bare: true,
    hideTitle: true,
  });
  body.getByRole("button", { name: "Sing" }).focus();

  // The sub-views render their own title and their own body; whatever was
  // focused is gone with it.
  rerender({ title: "Add to playlist", body: <p>Pick a playlist</p> });
  expect(document.activeElement).toBe(panel);
});

test("a header action stands beside the close button, and nowhere else", () => {
  const { container } = render(
    <Modal
      title="Party"
      onClose={vi.fn()}
      headerAction={
        <button type="button" aria-label="Show every party">
          eye
        </button>
      }
    >
      <p>Pick one</p>
    </Modal>,
  );

  const header = container.querySelector(".modal-header") as HTMLElement;
  // The heading keeps the left; the two controls sit together at the far end,
  // the close last (ui-guidelines §5).
  expect(
    within(header)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Show every party", "Close"]);
  expect(within(header).getByLabelText("Show every party").parentElement).toBe(
    header.querySelector(".modal-header-actions"),
  );
});

test("without one the header is the heading and the close alone", () => {
  const { panel } = renderModal();

  expect(
    within(panel.querySelector(".modal-header") as HTMLElement).getAllByRole(
      "button",
    ),
  ).toHaveLength(1);
});
