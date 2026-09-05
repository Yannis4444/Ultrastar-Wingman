import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useState } from "react";
import type { SelectionRead } from "../api";
import {
  getCurrentSingOptions,
  getPlayerSelectionOptions,
  getPlayerSelectionQueryKey,
  listKaraokeColorsOptions,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { parseServerTime } from "../duration";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
// The cover, the title and the artist are the running song's, down to the
// stylesheet: one look for the song on the stage, whichever half of the evening
// it is in.
import "./CurrentlyPlaying.css";
import "./HostSelection.css";

/** `selection.changed`: the whole selection, or `null` once there is none. */
interface SelectionChanged extends WingmanEvent {
  selection: SelectionRead | null;
}

/** Whether the stage is this block's. The page arbitrates with it. */
export type HostSelectionPhase = "idle" | "selecting";

interface HostSelectionProps {
  /** Called whenever the stage changes hands. */
  onPhase?: (phase: HostSelectionPhase) => void;
  /**
   * True while something else owns the stage — the badges a finished song
   * earned, which take the whole screen. The block waits rather than draws;
   * what it listens for carries on, so it is up to date when it is let go.
   */
  suppressed?: boolean;
}

/**
 * Whole seconds left until `target`, at least one, `null` without one. The
 * floor is one rather than zero, the same as the phone's copy: a TV holding
 * "Starting in 0…" says the song is already going when it is not.
 */
function useSecondsUntil(target: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (target === null) return;
    setNow(Date.now());
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [target]);

  if (target === null) return null;
  return Math.max(1, Math.ceil((parseServerTime(target) - now) / 1000));
}

/**
 * The host stage while the room is picking singers: the song somebody chose and
 * the colored slots filling up, from a phone and from the player selector
 * standing in the room. A live song owns the stage instead, and so do the
 * badges a finished one earned.
 *
 * No controls. Stopping is the host page's own overlay, and taking a selection
 * away from the room is not something a TV does.
 */
export default function HostSelection({
  onPhase,
  suppressed = false,
}: HostSelectionProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  // Seeded on load, so a host screen that was turned on mid-pick catches up.
  const selectionQuery = useQuery({
    ...getPlayerSelectionOptions(),
    enabled: auth.loaded && auth.can("songs.view"),
  });
  const colors = useQuery(listKaraokeColorsOptions());
  // Shares CurrentlyPlaying's cache entry: the running song owns the stage, and
  // a reload mid-song must not put a stale selection next to it.
  const current = useQuery(getCurrentSingOptions());

  // The event carries the whole selection, so no refetch is needed — and the
  // cache is where it goes, so every reader of it redraws at once.
  useWingmanEvent<SelectionChanged>("selection.changed", (message) =>
    queryClient.setQueryData(getPlayerSelectionQueryKey(), {
      selection: message.selection,
    }),
  );

  const selection = selectionQuery.data?.selection ?? null;
  const sing = current.data?.sing ?? null;
  const showing = selection !== null && sing === null && !current.isPending;
  const phase: HostSelectionPhase = showing ? "selecting" : "idle";

  // A layout effect, like the achievements stage: the page decides what else it
  // draws from this, and it must never paint a frame with two blocks on it.
  useLayoutEffect(() => {
    onPhase?.(phase);
  }, [onPhase, phase]);

  const countdown = useSecondsUntil(
    showing ? (selection?.auto_start_at ?? null) : null,
  );

  if (selection === null || !showing || suppressed) return null;

  const hexFor = (name: string): string | undefined =>
    colors.data?.colors.find((color) => color.name === name)?.hex;

  return (
    <section className="host-selection" aria-label="Picking singers">
      <SongCover song={selection.song} className="currently-playing-cover" />

      <div className="currently-playing-info">
        <h2 className="currently-playing-title">{selection.song.title}</h2>
        <p className="currently-playing-artist">{selection.song.artist}</p>
        <p className="host-selection-what">Picking singers</p>
      </div>

      <ul className="host-selection-slots">
        {selection.slots.map((slot) => {
          const unknown = slot.player === null && slot.card_uid !== null;
          const name =
            slot.player?.name ?? (unknown ? "Unknown card" : "empty");
          return (
            <li
              key={slot.color}
              className={
                unknown
                  ? "host-selection-slot host-selection-slot-card"
                  : "host-selection-slot"
              }
            >
              <span
                className="host-selection-bar"
                /* The slot's USDX color, fetched from the backend. */
                style={{
                  backgroundColor:
                    hexFor(slot.color) ?? "var(--color-darkerer)",
                }}
                aria-hidden="true"
              />
              <PlayerAvatar player={slot.player} />
              <span
                className={
                  slot.player !== null
                    ? "host-selection-name"
                    : "host-selection-name host-selection-empty"
                }
              >
                {name}
              </span>
            </li>
          );
        })}
      </ul>

      {countdown !== null && (
        <p className="host-selection-countdown" aria-live="polite">
          Starting in {countdown}…
        </p>
      )}
    </section>
  );
}
