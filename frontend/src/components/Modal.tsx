import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./icons";
import "./Modal.css";

interface ModalProps {
  title: string;
  onClose: () => void;
  /** Fills the viewport instead of being a centered card (player selection). */
  fullscreen?: boolean;
  /** The body carries the visible title (song hero); the header keeps only
   *  the close button while the title stays the dialog's accessible name. */
  hideTitle?: boolean;
  /** No panel surface: the content floats on a darkened, blurred backdrop. */
  bare?: boolean;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), audio[controls], [tabindex]:not([tabindex="-1"])';

/**
 * Generic centered overlay. Not a native `<dialog>`: jsdom has no
 * `showModal()`, so the whole component would be untestable.
 */
export default function Modal({
  title,
  onClose,
  fullscreen,
  hideTitle,
  bare,
  children,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  /** Where the last press started — see `closeOnOwnSurface`. */
  const pressedOn = useRef<EventTarget | null>(null);

  // Keyed on the title, not on every render: `onClose` is an inline arrow at
  // most call sites, so an `[onClose]` dependency would yank focus back to the
  // dialog on every keystroke and every parent refetch. The title changes
  // exactly when the body swaps to a sub-view, which is when the previously
  // focused element unmounts and focus really does have to be recovered.
  useEffect(() => {
    panel.current?.focus();
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      // Focus stays inside the dialog: behind the backdrop are hundreds of
      // focusable rows a keyboard user would silently tab into.
      if (event.key === "Tab" && panel.current) {
        const focusable =
          panel.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panel.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Closes only when the whole press happened on this element's own surface.
   * The target check ignores clicks bubbling out of the content; the press
   * check ignores drags that merely *ended* here — a `click` is dispatched on
   * the common ancestor of mousedown and mouseup, so selecting the song title
   * and releasing over the empty space beside it would otherwise dismiss the
   * modal.
   */
  const closeOnOwnSurface = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget &&
      pressedOn.current === event.target
    )
      onClose();
  };

  return (
    <div
      className={bare ? "modal-backdrop modal-backdrop-blur" : "modal-backdrop"}
      // Bubbles from the whole overlay, so it records where any press started.
      onMouseDown={(event) => {
        pressedOn.current = event.target;
      }}
      onClick={closeOnOwnSurface}
    >
      <div
        className={[
          "modal",
          fullscreen ? "modal-fullscreen" : "",
          bare ? "modal-bare" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        // A bare panel has no visible surface, so its empty stretches read as
        // backdrop and must close too. A panel modal keeps its own surface
        // inert.
        onClick={bare ? closeOnOwnSurface : undefined}
      >
        <div
          className={
            hideTitle ? "modal-header modal-header-bare" : "modal-header"
          }
        >
          {!hideTitle && <h2>{title}</h2>}
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
