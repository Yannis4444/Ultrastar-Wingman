import { fireEvent, render, within } from "@testing-library/react";
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
    /** Re-renders with fresh props, as a parent re-render would. */
    rerender: (next: { title?: string } = {}) =>
      rerender(
        <Modal
          title={next.title ?? "Bohemian Rhapsody"}
          // A new identity every time, like the inline arrows at every real
          // call site.
          onClose={() => onClose()}
          {...props}
        >
          <button type="button">Sing</button>
        </Modal>,
      ),
  };
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

test("swapping to a sub-view moves focus back into the dialog", () => {
  const { body, panel, rerender } = renderModal({
    bare: true,
    hideTitle: true,
  });
  body.getByRole("button", { name: "Sing" }).focus();

  // The sub-views render their own title; whatever was focused is gone.
  rerender({ title: "Add to playlist" });
  expect(document.activeElement).toBe(panel);
});
