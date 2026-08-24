import { useEffect, useRef, type ReactNode } from "react";
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
  children,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={fullscreen ? "modal modal-fullscreen" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
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
