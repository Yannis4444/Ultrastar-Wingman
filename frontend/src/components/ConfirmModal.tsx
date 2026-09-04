import Modal from "./Modal";
import "./ConfirmModal.css";

interface ConfirmModalProps {
  title: string;
  message: string;
  /** The bare verb of the action, never "OK" and never a second copy of the
   *  title (documentation.md §11): "Delete", "Stop", "Move". It has
   *  no default for that reason — the button the reader pressed to get here is
   *  what says the whole thing. */
  confirmLabel: string;
  /** Paints the confirm button as destructive (delete, replace, stop). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The app's only confirmation dialog — `window.confirm` is never used. */
export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="confirm-message">{message}</p>
      <div className="confirm-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "button button-danger" : "button button-primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
