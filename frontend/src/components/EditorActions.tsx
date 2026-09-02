import type { ReactNode } from "react";
import "./EditorActions.css";

interface EditorActionsProps {
  /** Why Save will not go, in the reader's words — or what it is doing right
   *  now. `null` when there is nothing to say, which is when Save is live. */
  note?: string | null;
  /** A save that landed. Said in the same slot as `note`, which wins: a page
   *  that has been saved and then broken says what is broken. */
  saved?: boolean;
  /** What the acknowledgement says, for a write that is not a save — a reset
   *  puts the form back and settles with nothing pending, and "Saved" is not
   *  what happened. */
  savedLabel?: string;
  saveDisabled?: boolean;
  saveLabel?: string;
  /** The editor's second action — a danger Delete, a plain Reset — or nothing.
   *  It goes to the far end of the row; it must be `type="button"`, the row
   *  living inside the form Save submits. */
  children?: ReactNode;
}

/**
 * The foot of a full-page editor, stuck to the bottom of the screen: the one
 * primary Save (§4), one quiet line about it, and the editor's other action.
 *
 * Shared rather than copied because the geometry is the interesting part — the
 * row has to sit exactly on the bottom nav's height and count the safe-area
 * inset once — and because the tag editor and the achievement editor are the
 * same page in two flavours (§7). It belongs **inside** the `<form>`: Save is
 * its submit button, and anything rendered after the form would scroll behind
 * the row and end up below it once the reader reaches the foot.
 */
export default function EditorActions({
  note = null,
  saved = false,
  savedLabel = "Saved",
  saveDisabled = false,
  saveLabel = "Save",
  children,
}: EditorActionsProps) {
  const line = note ?? (saved ? savedLabel : "");

  return (
    <div className="editor-actions">
      {/* One live region that stays in the document, so what it says is
          announced whether it is a refusal or an acknowledgement. */}
      <p
        className={
          note === null && saved
            ? "editor-actions-note editor-actions-saved"
            : "editor-actions-note"
        }
        role="status"
      >
        {line}
      </p>
      <div className="editor-actions-row">
        <button
          type="submit"
          className="button button-primary"
          disabled={saveDisabled}
        >
          {saveLabel}
        </button>
        {children}
      </div>
    </div>
  );
}
