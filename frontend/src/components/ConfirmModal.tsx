import Modal from "./Modal";
import "./ConfirmModal.css";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Paints the confirm button as destructive (delete, replace, stop). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The app's only confirmation dialog — `window.confirm` is never used. */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = "OK",
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
