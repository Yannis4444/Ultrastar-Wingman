import { useSyncExternalStore } from "react";

/**
 * What the screen making the sound wants to say to the rest of the page.
 *
 * A module store rather than context or a query: the `<audio>` lives at the app
 * root and the thing that draws its fault lives on the host page, with routes
 * in between. The one-shared-socket module in `useWingmanEvents.ts` is the same
 * shape, and it costs no provider.
 */
export interface MusicSinkStatus {
  /** The browser refused to play without a gesture. Until somebody clicks,
   *  nothing comes out of the speakers — so this is drawn, not swallowed. */
  blocked: boolean;
  /** Song after song would not play. The music has stood down and the host has
   *  something to look into. */
  failed: boolean;
  /** Try again, from a real user gesture. Registered by the sink. */
  unlock: () => void;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let unlockHandler: (() => void) | null = null;
let snapshot: MusicSinkStatus = { blocked: false, failed: false, unlock: noop };

function noop(): void {}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A new object every time something moves, so `useSyncExternalStore` sees the
 *  change — and the same object while nothing does, or it would loop. */
function set(next: Partial<Omit<MusicSinkStatus, "unlock">>): void {
  const blocked = next.blocked ?? snapshot.blocked;
  const failed = next.failed ?? snapshot.failed;
  if (blocked === snapshot.blocked && failed === snapshot.failed) return;
  snapshot = { blocked, failed, unlock: snapshot.unlock };
  emit();
}

export const musicSinkStore = {
  setBlocked(blocked: boolean): void {
    set({ blocked });
  },
  setFailed(failed: boolean): void {
    set({ failed });
  },
  /** The sink hands in the press it wants; unmounting hands in nothing. */
  onUnlock(handler: (() => void) | null): void {
    unlockHandler = handler;
    snapshot = { ...snapshot, unlock: handler ?? noop };
    emit();
  },
  /** Only for the tests: forget everything between two renders. */
  reset(): void {
    unlockHandler = null;
    snapshot = { blocked: false, failed: false, unlock: noop };
    emit();
  },
};

/** What the host page reads to decide whether to ask for a click. */
export function useMusicSinkStatus(): MusicSinkStatus {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/** Whether anything is listening for the press — the sink is mounted. */
export function hasUnlockHandler(): boolean {
  return unlockHandler !== null;
}
