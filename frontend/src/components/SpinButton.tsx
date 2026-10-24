import type { ReactNode } from "react";
import { useDieRoll } from "../hooks/useDieRoll";
import { Icon } from "./icons";
import "./SpinButton.css";

interface SpinButtonProps {
  /**
   * A reel is running for this button — the one under it on the Random song
   * page, or the one on the host screen a phone is waiting on. The die rolls,
   * and the gradient stays lit even while the button is disabled: busy, not
   * off.
   */
  spinning: boolean;
  disabled?: boolean;
  /**
   * Not pressable for a moment, and still the focused control: a press is
   * ignored and `aria-disabled` says so, where `disabled` would throw keyboard
   * focus off the button — the hold on *Show it* right after SPIN (§7).
   */
  held?: boolean;
  onClick: () => void;
  className?: string;
  /** The word beside the die. Uppercased in CSS: the caps are the look. */
  children: ReactNode;
}

/**
 * The gradient die: the blue→pink sweep with the rolling die that marks the
 * SPIN action (ui-guidelines §4). The Random song page's SPIN — on a
 * playlist's reel too, and in both places the reel runs, reading *Show it*
 * while a reel runs and, on the host screen, *Spin again* after — carries it as a fill, and it is
 * this component, so the look is declared once.
 */
export default function SpinButton({
  spinning,
  disabled = false,
  held = false,
  onClick,
  className,
  children,
}: SpinButtonProps) {
  const face = useDieRoll(spinning);
  const classes = ["spinner-spin"];
  if (spinning) classes.push("spinner-spin-running");
  if (className) classes.push(className);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled}
      aria-disabled={held || undefined}
      onClick={() => {
        if (!held) onClick();
      }}
    >
      <Icon name={face} className="spinner-spin-dice" />
      {children}
    </button>
  );
}
