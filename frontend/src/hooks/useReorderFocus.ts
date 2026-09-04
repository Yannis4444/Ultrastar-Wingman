import { useEffect, useRef } from "react";

/** The two ways a row moves one place. */
export type ReorderDirection = "up" | "down";

/** One row's one arrow, as the focus goes looking for it after a move. An id
 *  may hold anything a slug or a song id may, so the direction leads: what
 *  follows the one space is the id, whatever is in it. */
function arrowKey(id: string, direction: ReorderDirection): string {
  return `${direction} ${id}`;
}

export interface ReorderFocus {
  /** The `ref` of one row's one arrow, so the focus can find it again. */
  register: (
    id: string,
    direction: ReorderDirection,
  ) => (node: HTMLButtonElement | null) => void;
  /** Called from that arrow's `onClick`, before the new order is sent. */
  press: (id: string, direction: ReorderDirection) => void;
}

/**
 * Keeps the keyboard on the arrows of a list being rearranged, shared by the
 * playlist's edit mode and the achievements admin's reorder mode.
 *
 * A move costs the reader their place: the row's own node is moved in the DOM
 * and both its arrows are disabled for the length of the request, and neither a
 * moved nor a disabled control keeps the focus — so without this the keyboard
 * is dropped at the top of the page after every single press. It goes back to
 * the arrow that was pressed, or to the row's other one where the move used the
 * last of them up (the row now leads or ends the list, and that arrow is
 * disabled for good). A refused order puts it back the same way: the rows go
 * back where they were, which is another move of the same node.
 *
 * `pending` is whether the list's one request is in flight and `order` the ids
 * as they now stand — the two things that change when a move runs its course.
 * The pointer's own gesture never comes through here: a grip is `aria-hidden`
 * scenery and takes no focus to lose.
 */
export function useReorderFocus(
  pending: boolean,
  order: readonly string[],
): ReorderFocus {
  /** Every arrow there is, by row and direction: what the focus goes back to
   *  after a move. Kept by id rather than by index, because the row the reader
   *  pressed is the one that moved. */
  const arrows = useRef(new Map<string, HTMLButtonElement>());
  /** Which arrow the last move was made with, until the focus is back on it. */
  const pressed = useRef<{ id: string; direction: ReorderDirection } | null>(
    null,
  );
  /** Whether that move's request has been seen in flight. */
  const held = useRef(false);

  useEffect(() => {
    if (pending) {
      held.current = true;
      return;
    }
    const move = pressed.current;
    if (move === null) return;
    const active = document.activeElement;
    // Nothing is holding the focus any more: the browser dropped it on the
    // body when the row moved or its arrow went `disabled`, or it is sitting
    // on a control that can no longer be used (the arrow this move used up,
    // which some browsers leave it on rather than dropping it).
    const lost =
      !(active instanceof HTMLElement) ||
      active === document.body ||
      (active instanceof HTMLButtonElement && active.disabled);
    // Nothing to put back until the move has run its course — the request has
    // been seen in flight, or the focus is already gone.
    if (!held.current && !lost) return;
    held.current = false;
    pressed.current = null;
    // And nothing to put back where the move never cost it: the reader moved
    // the focus themselves while the order was saving, and taking that off
    // them would be worse than the walk this is here to save.
    if (!lost) return;
    const same = arrows.current.get(arrowKey(move.id, move.direction));
    const other = arrows.current.get(
      arrowKey(move.id, move.direction === "up" ? "down" : "up"),
    );
    const target = same !== undefined && !same.disabled ? same : other;
    if (target !== undefined && !target.disabled) target.focus();
  }, [pending, order]);

  return {
    register: (id, direction) => (node) => {
      const key = arrowKey(id, direction);
      if (node === null) arrows.current.delete(key);
      else arrows.current.set(key, node);
    },
    press: (id, direction) => {
      pressed.current = { id, direction };
      held.current = false;
    },
  };
}
