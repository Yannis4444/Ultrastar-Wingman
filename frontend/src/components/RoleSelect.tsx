import type { Color } from "../api";
import {
  colorLabel,
  SEQUENTIAL,
  slotColor,
  slotRole,
  UNUSED,
} from "../devices";

interface RoleSelectProps {
  /** The layout class of the surface it stands on; both callers use the
   *  device page's own `.device-select`, which `Device.css` owns. */
  className?: string;
  id?: string;
  /** What a screen reader calls it: "Reader 3 role". */
  label: string;
  /** The configured singing slots, in the host's own order. */
  slots: Color[];
  value: string;
  disabled?: boolean;
  onChange: (role: string) => void;
}

/**
 * What one reader does: a slot color, everybody in turn, or nothing.
 *
 * Shared by the device page and the setup wizard's Map step, which offer the
 * same choice over the same roles. Which colors exist is the host's setting
 * (`GET /karaoke/slots`), never a list hardcoded here.
 */
export default function RoleSelect({
  className,
  id,
  label,
  slots,
  value,
  disabled = false,
  onChange,
}: RoleSelectProps) {
  const color = slotColor(value);
  const hex = slots.find((slot) => slot.name === color)?.hex;

  return (
    <select
      className={className}
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      // The chosen slot's own colour as a bar on the leading edge, the way
      // player selection paints a slot: readable on every hue, unlike a wash
      // behind the words.
      style={{ boxShadow: `inset 4px 0 0 ${hex ?? "transparent"}` }}
      onChange={(event) => onChange(event.target.value)}
    >
      {slots.map((slot) => (
        <option key={slot.name} value={slotRole(slot.name)}>
          {colorLabel(slot.name)}
        </option>
      ))}
      {/* A colour that is no longer a configured slot would leave the select
          blank, so whatever the device carries is an option of its own. */}
      {color !== null && !slots.some((slot) => slot.name === color) && (
        <option value={value}>{colorLabel(color)}</option>
      )}
      <option value={SEQUENTIAL}>Everybody in turn</option>
      <option value={UNUSED}>Not used</option>
    </select>
  );
}
