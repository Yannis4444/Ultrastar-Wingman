import "./CheckOption.css";

interface CheckOptionProps {
  /** `radio` for one-of-N, `checkbox` where several may be on. Same look. */
  type?: "radio" | "checkbox";
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Radios of one group share a name; a checkbox needs none. */
  name?: string;
  value?: string;
}

/**
 * The old app's selection control: a small round box with a check mark that
 * overshoots it. One component for radios and checkboxes — the difference is
 * the input type, never the visuals.
 */
export default function CheckOption({
  type = "radio",
  label,
  checked,
  onChange,
  disabled = false,
  name,
  value,
}: CheckOptionProps) {
  return (
    <label
      className={
        disabled ? "check-option check-option-disabled" : "check-option"
      }
    >
      <input
        // Hidden, not removed: the label is the visible affordance, the input
        // keeps the keyboard and screen-reader semantics.
        className="visually-hidden"
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {/* The mark draws itself on mount, which is what animates the tick. */}
      {checked && <span className="check-option-mark" />}
      <span className="check-option-text">{label}</span>
    </label>
  );
}
