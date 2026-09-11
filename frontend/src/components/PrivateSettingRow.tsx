import { useState, type ReactNode } from "react";
import { SettingSaved } from "./SettingField";
import "./SettingField.css";

interface FieldProps {
  id: string;
  label: string;
  description: string;
  saved: boolean;
  children: (inputId: string, describedBy: string) => ReactNode;
  /** Set on the label's line for a checkbox, which has no second line. */
  inline?: boolean;
}

/**
 * One settings row in the Settings page's shape (§7): the label with its
 * acknowledgement on the first line, the quiet box alone on the second, the
 * 0.85em description under both.
 *
 * For the settings the Settings page never sees. A module that keeps its
 * options private — behind its own capability rather than `settings.manage`,
 * the `devices/settings.py` and `music/settings.py` pattern — has to rebuild
 * the row, and three surfaces rebuilding it identically is three chances for
 * them to drift. The player selector's page, the background music's panel and
 * whatever comes next all key on this one.
 *
 * `id` only has to be unique on the page it is drawn on.
 */
export function PrivateSettingRow({
  id,
  label,
  description,
  saved,
  children,
  inline = false,
}: FieldProps) {
  const inputId = `private-setting-${id}`;
  const describedBy = `${inputId}-description`;

  return (
    <div className="setting-field">
      <div className="setting-row">
        <label className="setting-label" htmlFor={inputId}>
          {label}
        </label>
        <SettingSaved shown={saved} />
        {inline && children(inputId, describedBy)}
      </div>

      {!inline && (
        <div className="setting-control">{children(inputId, describedBy)}</div>
      )}

      <p className="setting-description" id={describedBy}>
        {description}
      </p>
    </div>
  );
}

interface SecondsProps {
  inputId: string;
  describedBy: string;
  /** What the backend holds. Drawn whenever nobody is typing over it. */
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (seconds: number) => void;
}

/**
 * A number of seconds in the quiet box of a settings row, written when the
 * field is left or Enter is pressed. The commit rule is fiddly enough (blank is
 * a cancel, an unchanged number is not a write, Enter is a blur rather than a
 * submit) that one copy of it is one behaviour.
 *
 * The draft is non-null only while somebody is typing in it, so a change from
 * another browser still reaches a field nobody is editing.
 */
export function SecondsInput({
  inputId,
  describedBy,
  value,
  min,
  max,
  disabled,
  onCommit,
}: SecondsProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className="text-input text-input-quiet setting-input"
      id={inputId}
      aria-describedby={describedBy}
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const typed = draft;
        setDraft(null);
        if (typed === null || typed.trim() === "") return;
        const parsed = Number(typed);
        if (Number.isNaN(parsed) || parsed === value) return;
        onCommit(parsed);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}
