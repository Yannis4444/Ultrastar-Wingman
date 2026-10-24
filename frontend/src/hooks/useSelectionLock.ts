import { useEffect, useRef, type RefObject } from "react";
import type { SelectionOpened, SelectionRead } from "../api";
import { parseServerTime } from "../duration";
import { useWingmanEvent, type WingmanEvent } from "./useWingmanEvents";

/** The one route every close goes to. The token rides in a header, never in the
 *  query: a `DELETE …?token=` lands in the access log of whatever sits in front
 *  of Wingman, and the room's lock would be readable there. */
const SELECTION_URL = "/api/v1/karaoke/selection";

/** `selection.changed`: the whole selection, or `null` once there is none. */
interface SelectionChanged extends WingmanEvent {
  selection: SelectionRead | null;
}

/**
 * A selection somebody else opened, handed on with its token — the Random song
 * page's spin on the host screen giving its pick to the player selection. Whoever adopts it opens nothing and
 * carries on with this token as if it had opened the selection itself.
 */
export interface SelectionAdoption {
  selection: SelectionRead;
  token: string;
}

/**
 * Why the selection this component held is no longer its own: `closed` is the
 * room broadcasting that there is no selection at all, `replaced` a selection
 * with another `opened_at` — a take-over, which is a new selection and not an
 * update to this one.
 */
export type SelectionLostReason = "closed" | "replaced";

export interface SelectionLockOptions {
  /** A selection to carry on with instead of opening one. */
  adopt?: SelectionAdoption;
  /** The selection went out from under this component. The token is not
      dropped here: the component decides, because a `closed` broadcast may be
      the answer to its own Play. Call `forget` to drop it. */
  onLost: (reason: SelectionLostReason) => void;
  /** The same selection, updated — a card landed, a slot moved, a respin. */
  onChanged: (next: SelectionRead) => void;
}

export interface SelectionLock {
  /** The opener's secret, `null` while this component holds no selection. */
  token(): string | null;
  /**
   * About to take the room again after a `close`, for a component that stays
   * on the page between selections — the Random song page in *Host screen*
   * mode. Returns the ticket the answer is held with: an open sent before the
   * last `close` carries an older one, and its token is given straight back.
   */
  begin(): number;
  /** Whether an open sent with `ticket` is still this component's to hold. */
  isCurrent(ticket: number): boolean;
  /**
   * Take the token out of an opened answer. `false` when this component was
   * closed while the request was in flight — or, with a `ticket`, closed since
   * the request was sent: the token is given straight back, because the room
   * would otherwise stay locked over a song nobody is picking.
   */
  hold(opened: SelectionOpened, ticket?: number): boolean;
  /** Drop the token without giving the room back — the selection lives on
      without this component: Play started it, or another modal took it on. */
  forget(): void;
  /**
   * Done with the room: give the selection back, and give it back once. The
   * promise settles when the room has answered the DELETE (or it failed), for
   * a caller about to open a selection of its own right after: sent at once,
   * that open could reach the server first and find its own old one there.
   */
  close(): Promise<void>;
}

/**
 * Give the room's selection back. Every close comes through here, Cancel
 * included: the page may be going away with the request, which cancels the
 * generated client's fetch halfway, and `keepalive` is what carries this one
 * out of a closing tab.
 */
function release(token: string): Promise<void> {
  return fetch(SELECTION_URL, {
    method: "DELETE",
    headers: { "X-Selection-Token": token },
    keepalive: true,
    credentials: "same-origin",
  }).then(
    () => undefined,
    // Nothing to report it to: a refusal is a selection that is gone already.
    () => undefined,
  );
}

/** The token out of its ref and the room given back, if there is one to give. */
function giveBack(
  tokenRef: RefObject<string | null>,
  openedAtRef: RefObject<string | null>,
): Promise<void> {
  const token = tokenRef.current;
  if (token === null) return Promise.resolve();
  tokenRef.current = null;
  openedAtRef.current = null;
  return release(token);
}

/**
 * Never an older selection than what is on the screen: a broadcast can
 * overtake the answer to the write that caused it.
 */
export function latest(
  previous: SelectionRead | null,
  next: SelectionRead,
): SelectionRead {
  return previous !== null &&
    parseServerTime(next.updated_at) < parseServerTime(previous.updated_at)
    ? previous
    : next;
}

/**
 * The lifecycle of holding the room's one player selection, shared by
 * everything that opens one — the player selection, and the Random song page's
 * *Host screen* mode (`useHostSpin`): the token, kept in a ref and never drawn;
 * the one hand-written `keepalive` DELETE that gives it back on Cancel (or the
 * page's pills back on *This screen*), on unmount and when the tab closes —
 * exactly once; and the reading of `selection.changed` that tells an update to
 * this selection from its loss. A component that stays mounted across several
 * selections takes the room again with `begin`.
 *
 * What the component draws and what it writes with the token stay its own.
 */
export function useSelectionLock({
  adopt,
  onLost,
  onChanged,
}: SelectionLockOptions): SelectionLock {
  // The opener's secret. A ref, not state: the unmount close reads it from a
  // cleanup that was written when there was no token yet.
  const tokenRef = useRef<string | null>(adopt?.token ?? null);
  // When the selection this component holds was opened. A ref beside the token
  // because the two have to agree the moment the answer lands: a broadcast can
  // be read between `onSuccess` and the render that would put it in state, and
  // the selection this component just took over would be read as somebody
  // else's.
  const openedAtRef = useRef<string | null>(adopt?.selection.opened_at ?? null);
  // Set once this component is done with the room, so an answer that lands
  // after Cancel gives its token straight back instead of leaving the room
  // locked.
  const closedRef = useRef(false);
  // One more on every `close`: an open sent before it carries an older ticket,
  // and its answer is not this component's any more even once `begin` has
  // opened the door again for the next one.
  const generationRef = useRef(0);
  // The unmount's release, queued and still cancellable — see the effect below.
  const unmountReleaseRef = useRef<{ cancelled: boolean } | null>(null);
  const isCurrent = (ticket?: number): boolean =>
    !closedRef.current &&
    (ticket === undefined || ticket === generationRef.current);

  // The component going away gives the room's lock back, however it went — the
  // component unmounting, or the whole page going with it. Both paths go
  // through the one function that takes the token out of the ref before it
  // sends it, so the room is given back exactly once.
  //
  // React's development double-invoke runs the cleanup once on a component
  // that is staying and runs the body again right after, in the same
  // synchronous pass. So the flag is reset in the body rather than only in the
  // cleanup (a selection opened afterwards would be released for it), and the
  // unmount's release is queued as a microtask the body's re-run cancels: an
  // *adopted* token is in the ref from the first render, and a release fired
  // straight from that cleanup would give the room back under the picker that
  // had just been handed it. A real unmount runs no body again, and the
  // microtask sends it before anything else can happen.
  useEffect(() => {
    closedRef.current = false;
    if (unmountReleaseRef.current !== null) {
      unmountReleaseRef.current.cancelled = true;
      unmountReleaseRef.current = null;
    }

    // `pagehide`, not the effect cleanup: a closing tab, a back gesture and a
    // navigation away all end the page without running one, and the room would
    // stay locked for the two minutes the selection takes to expire. A
    // `persisted` hide is the page going into the back/forward cache, which it
    // can come back out of with this modal still on it — that one keeps its
    // token, or the singer would return to a selection nothing can write to.
    const onPageHide = (event: PageTransitionEvent): void => {
      if (event.persisted) return;
      void giveBack(tokenRef, openedAtRef);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      closedRef.current = true;
      const release = { cancelled: false };
      unmountReleaseRef.current = release;
      queueMicrotask(() => {
        if (release.cancelled) return;
        unmountReleaseRef.current = null;
        void giveBack(tokenRef, openedAtRef);
      });
    };
  }, []);

  // The device may fill a slot at any moment, and somebody may take the whole
  // selection over. `opened_at` is what tells the two apart: a taken-over
  // selection is a new one, and this component's token died with the old.
  useWingmanEvent<SelectionChanged>("selection.changed", (message) => {
    if (tokenRef.current === null) return;
    const next = message.selection;
    if (next === null) {
      onLost("closed");
      return;
    }
    // The ref, not the drawn selection: this component's own take-over is
    // answered by a broadcast that may be read before the answer to it is in
    // state.
    if (
      openedAtRef.current !== null &&
      next.opened_at !== openedAtRef.current
    ) {
      onLost("replaced");
      return;
    }
    onChanged(next);
  });

  return {
    token: () => tokenRef.current,
    begin: () => {
      closedRef.current = false;
      return generationRef.current;
    },
    isCurrent: (ticket) => isCurrent(ticket),
    hold: (opened, ticket) => {
      if (!isCurrent(ticket)) {
        void release(opened.token);
        return false;
      }
      tokenRef.current = opened.token;
      openedAtRef.current = opened.selection.opened_at;
      return true;
    },
    forget: () => {
      tokenRef.current = null;
      openedAtRef.current = null;
    },
    close: () => {
      // Before the token is read: an open that lands after this has to give the
      // room back what this component is no longer picking with.
      closedRef.current = true;
      generationRef.current += 1;
      return giveBack(tokenRef, openedAtRef);
    },
  };
}
