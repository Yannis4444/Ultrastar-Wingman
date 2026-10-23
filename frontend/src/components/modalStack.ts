import type { RefObject } from "react";

/**
 * Every open `Modal`, oldest first — a confirmation opened from inside a
 * dialog is the last one on it.
 *
 * Escape and the focus trap listen on `document`, so without this every layer
 * would answer the same keypress: one Escape over a nested `ConfirmModal` used
 * to close the confirmation *and* the dialog behind it, and the outer trap saw
 * the confirmation's own buttons (it renders inside the outer panel) and fought
 * the inner one over where Tab goes. Only the top of the stack acts.
 *
 * Its own module rather than a second export of `Modal.tsx`, which would cost
 * that file its fast refresh: the host screen's keyboard shortcuts read it too,
 * and stand aside while any dialog is open, a key pressed in one being its own.
 */
export const openModals: RefObject<HTMLDivElement | null>[] = [];
