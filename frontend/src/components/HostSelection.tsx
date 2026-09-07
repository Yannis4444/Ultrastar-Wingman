import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { SelectionRead } from "../api";
import {
  getCurrentSingOptions,
  getPlayerSelectionOptions,
  getPlayerSelectionQueryKey,
  listKaraokeColorsOptions,
  listSongsOptions,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { parseServerTime } from "../duration";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
import SongReel, { REVEAL_MS } from "./SongReel";
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
  /**
   * The head alone, centred in the stage, and no slot cards under it: a spin
   * a phone started shows the reel and its result and nothing else, the slots
   * being the next screen's — the picker's. The next round reads it off the
   * selection (`spin.origin === "phone"`); until then nothing sets it.
   */
  soloHead?: boolean;
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
 * The host stage while the room is picking singers: the song somebody chose at
 * the top, and along the foot one card per slot filling up, from a phone and
 * from the player selector standing in the room. It takes the whole screen the
 * way the badges of a finished song do, so `Host` puts the rail down for it.
 * A live song owns the stage instead, and so do those badges.
 *
 * No controls. Stopping is the host page's own overlay, and taking a selection
 * away from the room is not something a TV does.
 */
export default function HostSelection({
  onPhase,
  suppressed = false,
  soloHead = false,
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
  // The covers that fly past on a spin. Fetched as soon as the host is in, not
  // when a spin arrives: the reel reads its fillers the instant it starts, and
  // a list still loading would leave it with the winner's cover forty times.
  const songs = useQuery({
    ...listSongsOptions(),
    enabled: auth.loaded && auth.can("songs.view"),
  });
  // Which spin the reel has landed on: the selection it belongs to and the
  // spin's number in it, because this block stays mounted from one selection
  // to the next and every fresh selection's first spin is number one again.
  const [landed, setLanded] = useState<string | null>(null);

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
  // Whether the reel is on the screen at all: a live song and the badges of a
  // finished one both keep this block off it.
  const visible = showing && !suppressed;

  const spin = selection?.spin ?? null;
  const spunAt = spin?.spun_at ?? null;
  // Whether the spin was over before its reel was drawn here — a host turned on
  // after it landed draws the reel at rest. Read *once* per spin, at the moment
  // it arrives: read live it would flip on a re-render mid-spin (a card
  // landing) and put the title up while the covers are still flying past — a
  // TV that came in a moment late, or whose clock runs ahead of the server's.
  // Read again on the visibility edge, because a spin that arrived while a
  // song still played is drawn only once that song is over.
  const over = useMemo(
    () =>
      visible &&
      spunAt !== null &&
      Date.now() >= parseServerTime(spunAt) + REVEAL_MS,
    [spunAt, visible],
  );

  // A layout effect, like the achievements stage: the page decides what else it
  // draws from this, and it must never paint a frame with two blocks on it.
  useLayoutEffect(() => {
    onPhase?.(phase);
  }, [onPhase, phase]);

  // Never on a spun selection: the room presses until the song is right, and
  // that must not race a countdown. The backend sends none; this is the guard.
  const countdown = useSecondsUntil(
    showing && !selection?.spin ? (selection?.auto_start_at ?? null) : null,
  );

  if (selection === null || !showing || suppressed) return null;

  const hexFor = (name: string): string | undefined =>
    colors.data?.colors.find((color) => color.name === name)?.hex;

  const spinKey = spin === null ? null : `${selection.opened_at}:${spin.id}`;
  // The reel is running until it says it has landed — or was over before it
  // was ever drawn here. The title and the artist wait for it.
  const running = spin !== null && !over && landed !== spinKey;

  return (
    <section
      className={
        soloHead ? "host-selection host-selection-solo" : "host-selection"
      }
      aria-label="Picking singers"
    >
      {/* The song, and under it the one line that changes every second. The
          countdown belongs to the picking, not to a card, so it stands here
          rather than in the row. */}
      <div className="host-selection-head">
        {/* One centred column: the cover (or the reel) on top, the words under
            it inside a bounded width, so the length of a title never moves the
            cover — the user's request of 2026-09-06. */}
        <div className="host-selection-song">
          {spin === null ? (
            <SongCover song={selection.song} className="host-selection-cover" />
          ) : (
            // The reel where the cover stands, at the cover's size: the wrapper
            // sets `--spinner-cover`, and the stylesheet takes the frame's
            // border off it so nothing on the screen moves.
            <div className="host-selection-reel">
              <SongReel
                spin={{ id: spin.id, winner: selection.song }}
                fillers={songs.data?.songs ?? []}
                settled={over}
                onSettled={() => setLanded(spinKey)}
              />
            </div>
          )}
          <div className="host-selection-text">
            {/* Held back while the reel runs, but still in the layout: the
                block keeps its height, so the landing moves nothing. */}
            {/* Two lines reserved around the title, so nothing under it moves
                from one song to the next. */}
            <div className="host-selection-title-box">
              <h2
                className={
                  running
                    ? "host-selection-title host-selection-held"
                    : "host-selection-title"
                }
                aria-hidden={running || undefined}
              >
                {selection.song.title}
              </h2>
            </div>
            <p
              className={
                running
                  ? "host-selection-artist host-selection-held"
                  : "host-selection-artist"
              }
              aria-hidden={running || undefined}
            >
              {selection.song.artist}
            </p>
            <p className="host-selection-what">
              {running ? "Spinning…" : "Picking singers"}
            </p>
          </div>
        </div>

        {countdown !== null && (
          <p className="host-selection-countdown" aria-live="polite">
            Starting in {countdown}…
          </p>
        )}
      </div>

      {/* Not drawn at all for a phone's spin, rather than hidden: the row's
          items are what a screen reader would still find. */}
      {!soloHead && (
        <ul className="host-selection-slots">
          {selection.slots.map((slot) => {
            const unknown = slot.player === null && slot.card_uid !== null;
            const name =
              slot.player?.name ?? (unknown ? "Unknown card" : "empty");
            return (
              <li
                key={slot.color}
                className={
                  slot.player !== null
                    ? "host-selection-slot"
                    : "host-selection-slot host-selection-slot-empty"
                }
                /* The slot's USDX color, fetched from the backend: the outline is
                 it, and the fill of an empty card is it darkened. One custom
                 property, so the stylesheet owns every mix. */
                style={
                  {
                    "--slot": hexFor(slot.color) ?? "var(--color-darkerer)",
                  } as CSSProperties
                }
              >
                {/* The card inside the slot: a slot nobody has taken is a short
                  box along the foot of the row, and it grows to the full card
                  the moment somebody takes it. An unknown card counts as
                  taken: something is lying on that reader. */}
                <div
                  className={
                    slot.player !== null || unknown
                      ? "host-selection-card"
                      : "host-selection-card host-selection-card-empty"
                  }
                >
                  {(slot.player !== null || unknown) && (
                    <PlayerAvatar
                      player={slot.player}
                      className="host-selection-avatar"
                    />
                  )}
                  <span
                    className={
                      slot.player !== null
                        ? "host-selection-name"
                        : "host-selection-name host-selection-empty"
                    }
                  >
                    {name}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
