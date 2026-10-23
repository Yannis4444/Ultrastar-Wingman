import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SelectionRead, SpinRequest } from "../api";
import {
  getPlayerSelectionOptions,
  listKaraokeSlotsOptions,
  listPlayersOptions,
  openPlayerSelectionMutation,
  pickPlayerSelectionMutation,
  spinPlayerSelectionMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { parseServerTime } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import {
  latest,
  useSelectionLock,
  type SelectionAdoption,
} from "../hooks/useSelectionLock";
import { useWishlist } from "../hooks/useWishlist";
import { rememberedAssignment, slotBody } from "../playerSlots";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import Loading from "./Loading";
import Modal from "./Modal";
import PlayerSelection from "./PlayerSelection";
import SongCover from "./SongCover";
import { LogoTile, REVEAL_MS } from "./SongReel";
import SpinButton from "./SpinButton";
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
 * `spun_at`, or the moment the server says `revealed` — a press in the room
 * that showed the result before the covers had stopped. The wait is capped at
 * `REVEAL_MS` from when the timestamp arrived, so a phone whose clock runs
 * behind never waits longer than the reel takes; one running ahead reveals
 * early, which nothing on the phone can tell.
 *
 * Keyed on the timestamp, not a bare flag: a respin changes the song and the
 * timestamp in one render, and a flag still standing from the last spin would
 * paint the new song for the frame before the effect takes it back. The
 * server's `revealed` is read live for the same reason: a respin sends it
 * false again with the new timestamp.
 */
function useRevealed(spunAt: string | null, shown: boolean): boolean {
  const [revealedFor, setRevealedFor] = useState<string | null>(null);

  useEffect(() => {
    if (spunAt === null) return;
    const wait = Math.max(0, Math.min(REVEAL_MS, landsAt(spunAt) - Date.now()));
    const timer = setTimeout(() => setRevealedFor(spunAt), wait);
    return () => clearTimeout(timer);
  }, [spunAt]);

  if (spunAt === null) return false;
  // A spin that landed before it was ever drawn here needs no waiting frame.
  return shown || revealedFor === spunAt || Date.now() >= landsAt(spunAt);
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
 * TV's reel lands on the pick. The phone shows nothing of the animation — the
 * reel's empty tile where the cover will be, and that the TV is spinning, then
 * the cover, the title and the artist once the reel there has landed, with the
 * Random song page's wishlist take-off beside them on a wishlist spin — and
 * offers the gradient die (*Show it* while the TV spins, which is the press
 * that skips the animation, and *Spin again* once it has landed), *Play* and
 * *Cancel*. Play tells the server the room is moving on to its singers
 * (`/pick`, which takes the spin off the selection) and then hands the
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
  const auth = useAuth();
  const wishlist = useWishlist();

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

  // Moving on to the singers: the spin comes off the selection on the server,
  // and the picker takes over what the server answers with.
  const pick = useMutation({
    ...pickPlayerSelectionMutation(),
    onSuccess: (picked) => {
      // Cancelled while this was in flight: the room was given back already,
      // and a picker over a selection this phone no longer holds is nobody's.
      const token = lock.token();
      if (token === null) return;
      // Forgotten, not given back: the selection lives on under the picker,
      // and this modal's own close must find nothing to send.
      lock.forget();
      setAdoption({ selection: picked, token });
    },
    onError: (error) => {
      const detail = errorDetail(error);
      if (detail === "not_the_opener" || detail === "no_selection") {
        lose();
        return;
      }
      setNotice(
        errorMessage(error, detail ?? "Could not move on to the singers."),
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

  /**
   * The die: one route, two answers. While the TV's reel still runs the server
   * shows the result at once (the same song, `revealed`), and after it has
   * landed it spins again. The phone never decides which — its clock is not
   * the server's — it only says what the press does on the button.
   */
  const spinAgain = (): void => {
    const token = lock.token();
    if (token === null) return;
    setNotice(null);
    respin.mutate({ headers: { "X-Selection-Token": token } });
  };

  /**
   * On to picking the singers, over this same selection: `/pick` first, so the
   * server takes the spin off it and the TV shows the picking screen, then the
   * hand-over in the mutation's `onSuccess`. A refusal keeps the phone here.
   */
  const play = (): void => {
    const token = lock.token();
    if (token === null || selection === null) return;
    setNotice(null);
    pick.mutate({ headers: { "X-Selection-Token": token } });
  };

  const cancel = (): void => {
    lock.close();
    onClose();
  };

  const landed = useRevealed(
    phase === "spun" ? (selection?.spin?.spun_at ?? null) : null,
    selection?.spin?.revealed ?? false,
  );
  // A spun selection whose spin is gone has been picked: the broadcast `/pick`
  // sends can be read before the answer to it, and a picked song has nothing
  // left to wait on — the wait must not come back up for the frames between.
  const revealed =
    landed ||
    (phase === "spun" &&
      selection !== null &&
      (selection.spin ?? null) === null);

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
  // The Random song page's take-off, asked in this view's own terms: a reel
  // over one of the two wishlist pools that has landed — here, on the TV — on
  // a song still wished for. The scope is the selection's own, or what this
  // phone asked for in the frames where `/pick` has already taken the spin off.
  const scope = selection?.spin?.scope ?? spin.scope;
  const takeOff =
    spun &&
    revealed &&
    (scope === "wishlist" || scope === "weighted") &&
    auth.can("wishlist.manage") &&
    wishlist.wishes.some((wish) => wish.song.id === selection.song.id)
      ? selection.song
      : null;

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
              {/* The reel page's sibling: a square where the reel's window is
                  there. The empty window's tile while the TV spins — no
                  spoiler — and the cover once the reel has landed, keyed on the
                  spin so every reveal rises in. */}
              <div className="host-spin-tile">
                {/* The cover is in the tile from the start, under the logo, so
                    it has loaded by the time it is shown and the reveal never
                    pops from black to artwork after its rise. */}
                <SongCover
                  key={selection.spin?.spun_at}
                  song={selection.song}
                  className={
                    revealed
                      ? "host-spin-cover host-spin-cover-revealed"
                      : "host-spin-cover"
                  }
                  loading="eager"
                />
                {!revealed && (
                  <LogoTile className="host-spin-cover host-spin-cover-logo" />
                )}
              </div>
              {/* The words hold two lines of title and one of artist whether
                  the wait or the song is in them, so the tile never moves. */}
              <div className="host-spin-words">
                {revealed ? (
                  // The Random song page's result grid: the song in the
                  // middle, the wishlist take-off beside it, the left cell its
                  // counterweight — drawn trash or not, so the title's measure
                  // never changes when the wish goes.
                  <div className="host-spin-result">
                    <div className="host-spin-names">
                      <p className="host-spin-title">{selection.song.title}</p>
                      <p className="host-spin-artist">
                        {selection.song.artist}
                      </p>
                    </div>
                    {takeOff && (
                      <button
                        type="button"
                        className="icon-button icon-button-bordered host-spin-take-off"
                        aria-label={`Take ${takeOff.title} off the wishlist for everybody`}
                        onClick={() => wishlist.clear(takeOff.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </div>
                ) : (
                  // Said, not only drawn: the phone is in the singer's hand
                  // while everybody looks at the TV.
                  <p className="host-spin-waiting" role="status">
                    Spinning on the host screen…
                  </p>
                )}
              </div>
              {/* Mounted before the reveal and filled on it: a live region that
                  appears with its text in it is not reliably read out. */}
              <p className="visually-hidden" aria-live="polite">
                {revealed
                  ? `${selection.song.title} by ${selection.song.artist}`
                  : ""}
              </p>
            </div>
          )}

          <div className="host-spin-foot">
            <div className="host-spin-actions">
              {spun && (
                <>
                  {/* The view's primary, in the reel page's own idiom: the
                      gradient die, rolling for as long as the TV's reel does.
                      Live the whole time, and named for what the press does
                      now: while the covers fly it shows the result — the
                      server answers the same song, revealed — and once they
                      have stopped it spins again. */}
                  <SpinButton
                    spinning={!revealed}
                    // Off while Play is on the wire too: the selection is
                    // about to be picked, and a spin on a picked one is a 409.
                    disabled={respin.isPending || pick.isPending}
                    onClick={spinAgain}
                  >
                    {revealed ? "Spin again" : "Show it"}
                  </SpinButton>
                  {/* Off until the reel has landed: the room has not seen the
                      song yet, and Play would take it straight to the singers
                      over a reel still turning on the TV. */}
                  <button
                    type="button"
                    className="button button-primary host-spin-play"
                    disabled={!revealed || respin.isPending || pick.isPending}
                    onClick={play}
                  >
                    Play
                  </button>
                </>
              )}
              <button type="button" className="button" onClick={cancel}>
                Cancel
              </button>
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
