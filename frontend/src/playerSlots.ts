import type { PlayerRead, SlotCreate } from "./api";

/**
 * The phone's memory of who stood on which slot the last time a song started:
 * what every modal that opens the room's player selection seeds it with, so
 * the same group does not have to re-pick every song. The player selection
 * writes it when Play succeeds; the host spin only reads it.
 */

const SLOTS_STORAGE_KEY = "wingman.playerSlots";

/** Color name -> player id. Slots come from the backend; nothing is hardcoded. */
export type Assignment = Record<string, string>;

/**
 * The last configuration as stored. Unknown colors, deleted players and hidden
 * ones fall out in `rememberedAssignment` before the selection is opened with
 * it, so a stale entry can never resurrect somebody who is not singing — and
 * can never 404 the request either.
 */
export function readAssignment(): Assignment {
  try {
    const stored = window.localStorage.getItem(SLOTS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Assignment) : {};
  } catch {
    return {};
  }
}

export function writeAssignment(assignment: Assignment): void {
  try {
    window.localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(assignment));
  } catch {
    // Private mode or a full quota: preselection is a convenience, not a feature.
  }
}

/** An assignment as the body both writes take: only the slots somebody stands on. */
export function slotBody(
  colors: string[],
  assignment: Assignment,
): SlotCreate[] {
  return colors
    .filter((color) => assignment[color] !== undefined)
    .map((color) => ({ color, player_id: assignment[color] }));
}

/**
 * The stored configuration, reduced to colors that exist and players who are
 * still here and not hidden. The backend answers an unknown player with a 404,
 * so the filtering has to happen before the request rather than at render time.
 */
export function rememberedAssignment(
  players: PlayerRead[],
  colors: string[],
): Assignment {
  const stored = readAssignment();
  const visible = new Set(
    players.filter((player) => !player.hidden).map((player) => player.id),
  );
  const remembered: Assignment = {};
  for (const color of colors) {
    const id = stored[color];
    if (id !== undefined && visible.has(id)) remembered[color] = id;
  }
  return remembered;
}
