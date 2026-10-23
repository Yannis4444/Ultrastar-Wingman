/**
 * The host screen's keyboard shortcuts (ui-guidelines §7), decided without
 * rendering anything: which key does what, and when a key is somebody else's.
 */

/** What one key press on the host screen does. */
export type HostShortcut =
  "play-pause" | "skip" | "volume-up" | "volume-down" | "fullscreen";

/** How far one press of an arrow key moves the master volume, in percent. */
export const VOLUME_STEP = 5;

/**
 * The keys each control announces in its `aria-keyshortcuts`, spelled the way
 * that attribute spells them. The `title`s name the letter alone (*Pause (K)*):
 * a tooltip is read at a glance.
 */
export const SHORTCUT_KEYS: Record<
  "play-pause" | "skip" | "volume" | "fullscreen",
  string
> = {
  "play-pause": "Space K",
  skip: "N",
  volume: "ArrowUp ArrowDown",
  fullscreen: "F",
};

/** The part of a `KeyboardEvent` the decision reads. */
export interface ShortcutPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

export interface ShortcutContext {
  /** A dialog is open: a key pressed in it is the dialog's (`openModals`). */
  modalOpen: boolean;
  /** The shortcuts whose control is drawn right now. A key does what its
   *  control does, and nothing at all where there is no control: F in a
   *  browser without full screen, K for a reader who may not pause. */
  available: ReadonlySet<HostShortcut>;
}

/**
 * Where a key belongs to the element it was pressed in: Space presses a
 * focused button, an arrow moves a focused slider, a letter types into a
 * field. A shortcut there would do the thing twice, or instead.
 */
const OWNS_KEYS =
  'input, select, textarea, button, a[href], [contenteditable]:not([contenteditable="false"])';

const BY_KEY: Record<string, HostShortcut> = {
  " ": "play-pause",
  k: "play-pause",
  n: "skip",
  f: "fullscreen",
  arrowup: "volume-up",
  arrowdown: "volume-down",
};

/** The two that may repeat: a held arrow keeps turning the volume, a held K
 *  must not toggle the music on and off as fast as the keyboard repeats. */
const REPEATS: ReadonlySet<HostShortcut> = new Set([
  "volume-up",
  "volume-down",
]);

/**
 * What a key press does, or `null` when it is not a shortcut here. Esc is
 * never one: full screen and `Modal` own it. Shift is allowed, so Caps Lock
 * or a shifted K still reads as K; Ctrl, Alt and Meta are the browser's and
 * the system's.
 */
export function hostShortcut(
  press: ShortcutPress,
  context: ShortcutContext,
): HostShortcut | null {
  if (press.ctrlKey || press.altKey || press.metaKey) return null;
  if (press.isComposing === true) return null;
  if (context.modalOpen) return null;
  if (press.target instanceof Element && press.target.closest(OWNS_KEYS))
    return null;
  const shortcut = BY_KEY[press.key.toLowerCase()];
  if (shortcut === undefined) return null;
  if (press.repeat && !REPEATS.has(shortcut)) return null;
  return context.available.has(shortcut) ? shortcut : null;
}

/** The master volume one arrow press away, kept inside 0 to 100. */
export function nudgedVolume(volume: number, shortcut: HostShortcut): number {
  const step =
    shortcut === "volume-up"
      ? VOLUME_STEP
      : shortcut === "volume-down"
        ? -VOLUME_STEP
        : 0;
  return Math.min(100, Math.max(0, volume + step));
}
