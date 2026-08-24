/**
 * The stored form of `karaoke.player_colors`: the singing slots as Ultrastar
 * Deluxe color names, separated by commas, one per player. Pure list handling —
 * which colors and counts exist at all comes from the backend.
 */

/** The slot colors in a stored setting value, in order. */
export function parseSlots(value: string | number | boolean | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Grown or shrunk to `count`. New slots take the next colors Ultrastar Deluxe
 * itself would have used, skipping the ones already on a slot.
 */
export function resized(
  slots: string[],
  count: number,
  palette: string[],
): string[] {
  const next = slots.slice(0, count);
  for (const name of palette) {
    if (next.length >= count) break;
    if (!next.includes(name)) next.push(name);
  }
  return next;
}

/**
 * Slot `index` painted `name`. Picking a color another slot already has swaps
 * the two: two slots of one color is not a configuration the backend accepts,
 * and refusing the click would just be a dead dropdown entry.
 */
export function recolored(
  slots: string[],
  index: number,
  name: string,
): string[] {
  const next = [...slots];
  const taken = next.indexOf(name);
  if (taken !== -1) next[taken] = next[index];
  next[index] = name;
  return next;
}
