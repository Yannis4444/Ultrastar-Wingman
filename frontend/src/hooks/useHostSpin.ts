import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SelectionRead, SongRead, SpinRequest } from "../api";
import {
  getPlayerSelectionOptions,
  listKaraokeSlotsOptions,
  listPlayersOptions,
  openPlayerSelectionMutation,
  pickPlayerSelectionMutation,
  spinPlayerSelectionMutation,
} from "../api/@tanstack/react-query.gen";
import { REVEAL_MS } from "../components/SongReel";
import { parseServerTime } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import { rememberedAssignment, slotBody } from "../playerSlots";
import {
  latest,
  useSelectionLock,
  type SelectionAdoption,
} from "./useSelectionLock";

/**
 * What the Random song page's *Host screen* mode is doing. `idle` holds
 * nothing — a kept *Host screen* on entry, after the pills came back, or after
 * the player selection it handed over to has closed. `opening` is the request
 * that takes the room's selection lock and spins, `spun` a song picked on the
 * host screen (shown here once the reel there has landed), `blocked` somebody
 * else holding the lock, `empty` a scope with nothing in it, and `lost` this
 * phone's selection gone out from under it — taken over, or expired.
 */
export type HostSpinPhase =
  "idle" | "opening" | "spun" | "blocked" | "empty" | "lost";

/** What SPIN reads in this mode: it names what the next press does. */
export type HostSpinLabel = "Spin" | "Show it" | "Spin again";

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
export function emptyPoolLine(scope: SpinRequest["scope"]): string {
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

/** The same pool: a change of either is the next press giving the TV back. */
function samePool(a: SpinRequest, b: SpinRequest): boolean {
  return (
    a.scope === b.scope && (a.playlist_id ?? null) === (b.playlist_id ?? null)
  );
}

export interface HostSpin {
  phase: HostSpinPhase;
  /** The spun selection this phone holds, `null` without one. */
  selection: SelectionRead | null;
  /** The TV's reel has landed on `selection`'s song. */
  revealed: boolean;
  /**
   * The song the page shows in the window and the words: the spun one once it
   * is revealed, or the one handed over to the player selection, which stays
   * up after the picker has closed. `null` while the TV spins and in every
   * state that is a sentence.
   */
  shown: SongRead | null;
  /** What this phone last asked the TV to pick from. */
  asked: SpinRequest | null;
  /** The state's own sentence: the empty pool. `null` otherwise. */
  emptyLine: string | null;
  /** The other selection's song while `blocked`, once it has been read. */
  blockedTitle: string | undefined;
  /** A refusal said over the action row; the state under it stands. */
  notice: string | null;
  label: HostSpinLabel;
  /** The die tumbles: the room is being taken, or the TV's reel runs. */
  rolling: boolean;
  /** A request is on the wire: SPIN and Play wait for its answer. */
  busy: boolean;
  /** The lists the remembered slots are filtered against have answered. */
  ready: boolean;
  /** Play may move the room on to its singers. */
  playable: boolean;
  /** Set by Play: the selection and its token, for the player selection. */
  adoption: SelectionAdoption | null;
  /** SPIN: open, show the result early, spin again — or, over another pool
      than the TV's, give it back and open anew. */
  press(request: SpinRequest): void;
  /** Take the room off whoever is picking now, for this pool. */
  takeOver(request: SpinRequest): void;
  /** `/pick`, then the hand-over in `adoption`. */
  play(): void;
  /** The player selection the room was handed to has closed. */
  handedOver(): void;
  /** Give the room back and hold nothing: the pills back on *This screen*. */
  release(): void;
}

/**
 * The Random song page's *Host screen* mode (ui-guidelines §7): it runs the
 * room's one player selection with a spin instead of a song, so the server
 * picks and the TV's reel lands on the pick. Nothing is opened until the first
 * SPIN; the page draws the window, the words and the one action row from what
 * this returns. Play tells the server the room is moving on to its singers
 * (`/pick`, which takes the spin off the selection) and then hands the
 * selection and its token on to `PlayerSelection` through `adoption`; nothing
 * is given back in that case.
 *
 * There is no close and no Cancel: `release` (the pills back on *This
 * screen*), leaving the page and closing the tab give the room back, the
 * latter two through `useSelectionLock`'s unmount and `pagehide`.
 */
export function useHostSpin({ active }: { active: boolean }): HostSpin {
  // The remembered group seeds the selection the way the player selection's
  // own open does, so Play lands on the board the room had last time.
  const slots = useQuery({ ...listKaraokeSlotsOptions(), enabled: active });
  const players = useQuery({ ...listPlayersOptions(), enabled: active });

  const [phase, setPhase] = useState<HostSpinPhase>("idle");
  const [selection, setSelection] = useState<SelectionRead | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asked, setAsked] = useState<SpinRequest | null>(null);
  // The song handed over to the player selection, kept on the page after it.
  const [kept, setKept] = useState<SongRead | null>(null);
  const [adoption, setAdoption] = useState<SelectionAdoption | null>(null);
  // The ticket the selection this phone holds was opened with: an answer to a
  // respin or a Play sent before the pills gave the room back is nobody's.
  const ticketRef = useRef(0);
  // One more on every press that opens, on every release and on unmount, so a
  // reopen waiting on its own DELETE does not open after the pills came back —
  // or after the page has gone, where nothing would ever give that one back.
  const epochRef = useRef(0);
  useEffect(
    () => () => {
      epochRef.current += 1;
    },
    [],
  );

  // What somebody else is picking, so the blocked line can name their song.
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
    setSelection(null);
    setPhase("lost");
  };

  const open = useMutation(openPlayerSelectionMutation());
  const respin = useMutation(spinPlayerSelectionMutation());
  const pick = useMutation(pickPlayerSelectionMutation());

  const playerRows = players.data?.players;
  const slotColors = slots.data?.slots;
  // A list that failed is no reason to keep SPIN off: the room opens with
  // nobody remembered instead.
  const ready =
    (playerRows !== undefined || players.isError) &&
    (slotColors !== undefined || slots.isError);

  /**
   * Take the room's lock with a spin over `request`, the remembered group
   * filtered against the live lists first, so a player who left the party
   * since cannot 404 the request.
   */
  const openWith = (request: SpinRequest, force: boolean): void => {
    const ticket = lock.begin();
    ticketRef.current = ticket;
    const colors = slotColors?.map((color) => color.name) ?? [];
    const body = slotBody(
      colors,
      rememberedAssignment(playerRows ?? [], colors),
    );
    setAsked(request);
    setNotice(null);
    setSelection(null);
    setPhase("opening");
    open
      .mutateAsync({
        body: force
          ? { spin: request, slots: body, force }
          : { spin: request, slots: body },
      })
      .then(
        (opened) => {
          // Given back while this was in flight: the lock returned the token.
          if (!lock.hold(opened, ticket)) return;
          setKept(null);
          setSelection(opened.selection);
          setPhase("spun");
        },
        (error: unknown) => {
          if (!lock.isCurrent(ticket)) return;
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
          setPhase("idle");
        },
      );
  };

  /**
   * The die over a selection this phone holds: one route, two answers. While
   * the TV's reel still runs the server shows the result at once (the same
   * song, `revealed`), and after it has landed it spins again. The phone never
   * decides which — its clock is not the server's.
   */
  const spinAgain = (token: string, scope: SpinRequest["scope"]): void => {
    const ticket = ticketRef.current;
    setNotice(null);
    respin.mutateAsync({ headers: { "X-Selection-Token": token } }).then(
      (next) => {
        if (lock.isCurrent(ticket)) apply(next);
      },
      (error: unknown) => {
        if (!lock.isCurrent(ticket)) return;
        const detail = errorDetail(error);
        if (detail === "not_the_opener" || detail === "no_selection") {
          lose();
          return;
        }
        // The selection stands with its song: only the line says why nothing
        // moved on the TV.
        setNotice(
          detail === "empty_pool"
            ? emptyPoolLine(scope)
            : errorMessage(error, detail ?? "Could not spin again."),
        );
      },
    );
  };

  // The hand-over counts as busy: the selection is the player selection's
  // until it closes, and a press under it would open the room a second time.
  const busy =
    phase === "opening" ||
    respin.isPending ||
    pick.isPending ||
    adoption !== null;

  const press = (request: SpinRequest): void => {
    if (busy || !ready) return;
    const token = lock.token();
    if (phase === "spun" && token !== null && asked !== null) {
      if (samePool(request, asked)) {
        spinAgain(token, asked.scope);
        return;
      }
      // Another pool than the TV's: give that one back, and open anew once the
      // room has answered — sent at once, the open could find this phone's
      // own selection still standing and be refused.
      epochRef.current += 1;
      const epoch = epochRef.current;
      setNotice(null);
      setPhase("opening");
      void lock.close().then(() => {
        if (epochRef.current === epoch) openWith(request, false);
      });
      return;
    }
    epochRef.current += 1;
    openWith(request, false);
  };

  const takeOver = (request: SpinRequest): void => {
    if (busy) return;
    epochRef.current += 1;
    openWith(request, true);
  };

  /**
   * On to picking the singers, over this same selection: `/pick` first, so the
   * server takes the spin off it and the TV shows the picking screen, then the
   * hand-over. A refusal keeps the phone here.
   */
  const play = (): void => {
    const token = lock.token();
    if (token === null || selection === null || busy) return;
    const ticket = ticketRef.current;
    setNotice(null);
    pick.mutateAsync({ headers: { "X-Selection-Token": token } }).then(
      (picked) => {
        // Given back while this was in flight: a picker over a selection this
        // phone no longer holds is nobody's.
        const held = lock.token();
        if (held === null || !lock.isCurrent(ticket)) return;
        // Forgotten, not given back: the selection lives on under the picker.
        lock.forget();
        setAdoption({ selection: picked, token: held });
      },
      (error: unknown) => {
        if (!lock.isCurrent(ticket)) return;
        const detail = errorDetail(error);
        if (detail === "not_the_opener" || detail === "no_selection") {
          lose();
          return;
        }
        setNotice(
          errorMessage(error, detail ?? "Could not move on to the singers."),
        );
      },
    );
  };

  const handedOver = (): void => {
    setKept(adoption?.selection.song ?? null);
    setAdoption(null);
    setSelection(null);
    setNotice(null);
    setPhase("idle");
  };

  const release = (): void => {
    epochRef.current += 1;
    void lock.close();
    setKept(null);
    setSelection(null);
    setNotice(null);
    setPhase("idle");
  };

  const landed = useRevealed(
    phase === "spun" ? (selection?.spin?.spun_at ?? null) : null,
    selection?.spin?.revealed ?? false,
  );
  // A spun selection whose spin is gone has been picked: the broadcast `/pick`
  // sends can be read before the answer to it, and a picked song has nothing
  // left to wait on — the wait must not come back up for the frames between.
  const revealed =
    phase === "spun" &&
    selection !== null &&
    (landed || (selection.spin ?? null) === null);

  const spun = phase === "spun" && selection !== null;

  return {
    phase,
    selection,
    revealed,
    shown: spun && revealed ? selection.song : phase === "idle" ? kept : null,
    asked,
    emptyLine:
      phase === "empty" && asked !== null ? emptyPoolLine(asked.scope) : null,
    blockedTitle: other.data?.selection?.song.title,
    notice,
    label: spun ? (revealed ? "Spin again" : "Show it") : "Spin",
    rolling: phase === "opening" || (spun && !revealed),
    busy,
    ready,
    playable: spun && revealed && !busy,
    adoption,
    press,
    takeOver,
    play,
    handedOver,
    release,
  };
}
