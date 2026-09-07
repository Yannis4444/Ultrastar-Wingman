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
  onClick: () => void;
  className?: string;
  /** The word beside the die. Uppercased in CSS: the caps are the look. */
  children: ReactNode;
}

/**
 * The gradient die: the blue→pink sweep with the rolling die that marks the
 * SPIN action (ui-guidelines §4). The Random song page's SPIN and the phone's
 * *Spin again* over a spin on the host screen are the two that carry it as a
 * fill, and both are this component, so the look is declared once.
 */
export default function SpinButton({
  spinning,
  disabled = false,
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
      onClick={onClick}
    >
      <Icon name={face} className="spinner-spin-dice" />
      {children}
    </button>
  );
}
