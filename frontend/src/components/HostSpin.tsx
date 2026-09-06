import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SelectionRead, SpinRequest } from "../api";
import {
  getPlayerSelectionOptions,
  listKaraokeSlotsOptions,
  listPlayersOptions,
  openPlayerSelectionMutation,
  spinPlayerSelectionMutation,
} from "../api/@tanstack/react-query.gen";
import { parseServerTime } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import {
  latest,
  useSelectionLock,
  type SelectionAdoption,
} from "../hooks/useSelectionLock";
import { rememberedAssignment, slotBody } from "../playerSlots";
import ConfirmModal from "./ConfirmModal";
import Loading from "./Loading";
import Modal from "./Modal";
import PlayerSelection from "./PlayerSelection";
import { REVEAL_MS } from "./SongReel";
import "./HostSpin.css";

/**
 * What the modal is doing. `opening` is the request that takes the room's
 * selection lock and spins, `spun` a song picked on the host screen (revealed
 * here once the reel there has landed), `blocked` somebody else holding the
 * lock, `empty` a scope with nothing in it, and `lost` this phone's selection
 * gone out from under it — taken over, or expired.
 */
type Phase = "opening" | "spun" | "blocked" | "empty" | "lost";

/** When the host's reel that started at `spunAt` lands, on the server's clock. */
function landsAt(spunAt: string): number {
  return parseServerTime(spunAt) + REVEAL_MS;
}

/**
 * True once the host's reel has landed: `REVEAL_MS` after the server's
 * `spun_at`. The wait is capped at `REVEAL_MS` from when the timestamp arrived,
 * so a phone whose clock runs behind never waits longer than the reel takes;
 * one running ahead reveals early, which nothing on the phone can tell.
 *
 * Keyed on the timestamp, not a bare flag: a respin changes the song and the
 * timestamp in one render, and a flag still standing from the last spin would
 * paint the new song for the frame before the effect takes it back.
 */
function useRevealed(spunAt: string | null): boolean {
  const [revealedFor, setRevealedFor] = useState<string | null>(null);

  useEffect(() => {
    if (spunAt === null) return;
    const wait = Math.max(0, Math.min(REVEAL_MS, landsAt(spunAt) - Date.now()));
    const timer = setTimeout(() => setRevealedFor(spunAt), wait);
    return () => clearTimeout(timer);
  }, [spunAt]);

  if (spunAt === null) return false;
  // A spin that landed before it was ever drawn here needs no waiting frame.
  return revealedFor === spunAt || Date.now() >= landsAt(spunAt);
}

/** The line a scope with nothing in it is answered with, in the reel's words. */
function emptyPoolLine(scope: SpinRequest["scope"]): string {
  switch (scope) {
    case "favorites":
      return "You have no favorites for the reel to land on.";
    case "wishlist":
    case "weighted":
      return "The wishlist is empty. The reel has nothing to land on.";
    case "playlist":
      return "This playlist is empty. The reel has nothing to land on.";
    default:
      return "The library has no song for the reel to land on.";
  }
}

interface HostSpinProps {
  /** What the reel on the host screen picks from. */
  spin: SpinRequest;
  onClose: () => void;
}

/**
 * The phone's side of a spin on the host screen: it opens the room's one
 * player selection with a spin instead of a song, so the server picks and the
 * TV's reel lands on the pick. The phone shows nothing of the animation — only
 * that it is running, then the title and the artist once the reel there has
 * landed — and offers *Spin again*, *Play* and *Cancel*. Play hands the
 * selection and its token on to `PlayerSelection`, which carries on with it as
 * if it had opened it itself; this modal gives nothing back in that case.
 *
 * Holding the lock — the token, the one `keepalive` DELETE that gives the room
 * back, the reading of `selection.changed` — is `useSelectionLock`, shared
 * with the player selection.
 */
export default function HostSpin({ spin, onClose }: HostSpinProps) {
  // The remembered group seeds the selection the way the player selection's
  // own open does, so Play lands on the board the room had last time.
  const slots = useQuery(listKaraokeSlotsOptions());
  const players = useQuery(listPlayersOptions());

  const [phase, setPhase] = useState<Phase>("opening");
  const [selection, setSelection] = useState<SelectionRead | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [askTakeOver, setAskTakeOver] = useState(false);
  // Set by Play: the selection and its token, handed on to the picker.
  const [adoption, setAdoption] = useState<SelectionAdoption | null>(null);
  // The mount effect runs twice under React's development double-invoke, and
  // the second run would take the room's lock off the first.
  const openedRef = useRef(false);

  // What somebody else is picking, so the blocked head can name their song.
  const other = useQuery({
    ...getPlayerSelectionOptions(),
    enabled: phase === "blocked",
  });

  /** Draw what the server says, never an older state than what is on the screen. */
  const apply = (next: SelectionRead): void => {
    setSelection((previous) => latest(previous, next));
  };

  const lock = useSelectionLock({
    onLost: () => lose(),
    onChanged: apply,
  });

  /** The selection is not this phone's any more: the token is dead, say so. */
  const lose = (): void => {
    lock.forget();
    setNotice(null);
    setPhase("lost");
  };

  const open = useMutation({
    ...openPlayerSelectionMutation(),
    onSuccess: (opened) => {
      // Cancelled while this was in flight: the lock gave the token back.
      if (!lock.hold(opened)) return;
      setNotice(null);
      setSelection(opened.selection);
      setPhase("spun");
    },
    onError: (error) => {
      const detail = errorDetail(error);
      if (detail === "selection_open") {
        setPhase("blocked");
        return;
      }
      if (detail === "empty_pool") {
        setPhase("empty");
        return;
      }
      setNotice(
        errorMessage(error, detail ?? "Could not spin on the host screen."),
      );
      setPhase("lost");
    },
  });

  const respin = useMutation({
    ...spinPlayerSelectionMutation(),
    onSuccess: apply,
    onError: (error) => {
      const detail = errorDetail(error);
      if (detail === "not_the_opener" || detail === "no_selection") {
        lose();
        return;
      }
      // The selection stands with its song: only the line says why nothing
      // moved on the TV.
      setNotice(
        detail === "empty_pool"
          ? emptyPoolLine(spin.scope)
          : errorMessage(error, detail ?? "Could not spin again."),
      );
    },
  });

  const { mutate: openSelection } = open;
  const playerRows = players.data?.players;
  const slotColors = slots.data?.slots;

  /**
   * Take the room's lock: on mount, from somebody else, or after losing it.
   * With a selection on the screen its own slots are what comes back; without
   * one the stored configuration is.
   */
  const openWith = (force: boolean): void => {
    const colors = slotColors?.map((color) => color.name) ?? [];
    const body = selection
      ? selection.slots.flatMap((slot) =>
          slot.player === null
            ? []
            : [{ color: slot.color, player_id: slot.player.id }],
        )
      : slotBody(colors, rememberedAssignment(playerRows ?? [], colors));
    setNotice(null);
    setPhase("opening");
    openSelection({ body: { spin, slots: body, force } });
  };

  // Opened once both lists are in: the remembered assignment is filtered
  // against them first, so a player who left the party since cannot 404 the
  // request.
  useEffect(() => {
    if (openedRef.current) return;
    if (playerRows === undefined || slotColors === undefined) return;
    openedRef.current = true;
    const colors = slotColors.map((color) => color.name);
    openSelection({
      body: {
        spin,
        slots: slotBody(colors, rememberedAssignment(playerRows, colors)),
      },
    });
  }, [openSelection, playerRows, slotColors, spin]);

  const spinAgain = (): void => {
    const token = lock.token();
    if (token === null) return;
    setNotice(null);
    respin.mutate({ headers: { "X-Selection-Token": token } });
  };

  /**
   * On to picking the singers, over this same selection. The token goes with
   * it and is forgotten here — not given back — so the room stays this phone's
   * across the hand-over, and this modal's own close finds nothing to send.
   */
  const play = (): void => {
    const token = lock.token();
    if (token === null || selection === null) return;
    lock.forget();
    setAdoption({ selection, token });
  };

  const cancel = (): void => {
    lock.close();
    onClose();
  };

  const revealed = useRevealed(
    phase === "spun" ? (selection?.spin?.spun_at ?? null) : null,
  );

  if (adoption !== null) {
    return (
      <PlayerSelection
        song={adoption.selection.song}
        onClose={onClose}
        adopt={adoption}
      />
    );
  }

  const spun = phase === "spun" && selection !== null;
  const blockedTitle = other.data?.selection?.song.title;

  return (
    <>
      <Modal title="Spin on the host screen" onClose={cancel} fullscreen>
        <div className="host-spin">
          <div className="host-spin-head">
            {notice && (
              <p className="error-notice host-spin-error" role="alert">
                {notice}
              </p>
            )}
            {phase === "blocked" && (
              <div className="host-spin-taken">
                <p className="host-spin-taken-line">
                  {blockedTitle === undefined ? (
                    "Somebody else is picking singers."
                  ) : (
                    <>
                      Somebody is picking singers for <em>{blockedTitle}</em>.
                    </>
                  )}
                </p>
                <button
                  type="button"
                  className="button"
                  onClick={() => setAskTakeOver(true)}
                >
                  Take over
                </button>
              </div>
            )}
            {phase === "empty" && (
              <p className="host-spin-taken-line">
                {emptyPoolLine(spin.scope)}
              </p>
            )}
            {phase === "lost" && (
              <div className="host-spin-taken">
                {notice === null && (
                  <p className="host-spin-taken-line">
                    Somebody else took over the selection.
                  </p>
                )}
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => openWith(false)}
                >
                  Spin again
                </button>
              </div>
            )}
          </div>

          {phase === "opening" && <Loading />}

          {spun && (
            <div className="host-spin-song">
              {revealed ? (
                <>
                  <p className="host-spin-title">{selection.song.title}</p>
                  <p className="host-spin-artist">{selection.song.artist}</p>
                </>
              ) : (
                // Said, not only drawn: the phone is in the singer's hand while
                // everybody looks at the TV.
                <p className="host-spin-waiting" role="status">
                  Spinning on the host screen…
                </p>
              )}
            </div>
          )}

          <div className="host-spin-foot">
            <div className="host-spin-actions">
              <button type="button" className="button" onClick={cancel}>
                Cancel
              </button>
              {spun && (
                <>
                  <button
                    type="button"
                    className="button"
                    // Off until the reel has landed: a respin before that would
                    // start a second reel over the first.
                    disabled={!revealed || respin.isPending}
                    onClick={spinAgain}
                  >
                    Spin again
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!revealed || respin.isPending}
                    onClick={play}
                  >
                    Play
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {askTakeOver && (
        <ConfirmModal
          title="Take over the selection"
          message="Whoever is picking now loses their singers."
          confirmLabel="Take over"
          danger
          onConfirm={() => {
            setAskTakeOver(false);
            openWith(true);
          }}
          onCancel={() => setAskTakeOver(false)}
        />
      )}
    </>
  );
}
