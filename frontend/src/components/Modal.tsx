import {
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
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
  /**
   * One control beside the close button, and the only thing besides the
   * heading and the close a panel header may carry (ui-guidelines §5). The
   * party picker's *show all* toggle is what it exists for: it changes what
   * the whole list holds, so it belongs to the panel and not to a row in it.
   */
  headerAction?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), audio[controls], [tabindex]:not([tabindex="-1"])';

/**
 * Every open modal, oldest first — a confirmation opened from inside a dialog
 * is the last one on it.
 *
 * Escape and the focus trap listen on `document`, so without this every layer
 * would answer the same keypress: one Escape over a nested `ConfirmModal` used
 * to close the confirmation *and* the dialog behind it, and the outer trap saw
 * the confirmation's own buttons (it renders inside the outer panel) and fought
 * the inner one over where Tab goes. Only the top of the stack acts.
 */
const openModals: RefObject<HTMLDivElement | null>[] = [];

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
  headerAction,
  children,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  /** Where the last press started — see `closeOnOwnSurface`. */
  const pressedOn = useRef<EventTarget | null>(null);
  /** What held the focus when this dialog opened, to give it back. */
  const opener = useRef<Element | null>(null);

  // First, so `document.activeElement` is still whatever opened this dialog
  // when it is read: the focus effect below moves it into the panel.
  useEffect(() => {
    opener.current = document.activeElement;
    openModals.push(panel);
    return () => {
      const at = openModals.indexOf(panel);
      if (at !== -1) openModals.splice(at, 1);
      // Focus falls to `document.body` when a dialog unmounts, and from there
      // the next Tab starts at the top of the page — behind whatever is still
      // open. The control that opened this one gets it back; if that control
      // is gone with the view it lived in, the dialog underneath takes it.
      const previous = opener.current;
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous !== document.body
      )
        previous.focus();
      else openModals[openModals.length - 1]?.current?.focus();
    };
  }, []);

  // Keyed on the title, not on every render: `onClose` is an inline arrow at
  // most call sites, so an `[onClose]` dependency would yank focus back to the
  // dialog on every keystroke and every parent refetch. The title changes
  // exactly when the body swaps to a sub-view, which is when the previously
  // focused element unmounts and focus really does have to be recovered — and
  // recovered is all it is: a dialog that already holds the focus somewhere
  // leaves it there, so a field the body autofocuses (the New playlist panel's
  // name) keeps what it just took, on the way in and across a swap.
  useEffect(() => {
    if (!panel.current?.contains(document.activeElement))
      panel.current?.focus();
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A confirmation opened from inside this dialog answers for both of them.
      if (openModals[openModals.length - 1] !== panel) return;
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
          {/* Beside the close, at the far end of the header — the heading keeps
              the left, and the two controls stay together. */}
          <div className="modal-header-actions">
            {headerAction}
            <button type="button" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
