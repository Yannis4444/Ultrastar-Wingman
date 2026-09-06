import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { PlayerRead, SelectionRead, SlotCreate, SongRead } from "../api";
import {
  closePlayerSelectionMutation,
  getPlayerSelectionOptions,
  listKaraokeSlotsOptions,
  listPlayersOptions,
  openPlayerSelectionMutation,
  setPlayerSelectionSlotsMutation,
  startPlayerSelectionMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { parseServerTime } from "../duration";
import { errorDetail, errorMessage, usdxProblems } from "../errors";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import AddPlayerForm from "./AddPlayerForm";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import Loading from "./Loading";
import Modal from "./Modal";
import PlayerAvatar from "./PlayerAvatar";
import UsdxSetupGuide from "./UsdxSetupGuide";
import "./PlayerSelection.css";

const SLOTS_STORAGE_KEY = "wingman.playerSlots";

/** The route the unmount close talks to, the one call the generated client cannot make. */
const SELECTION_URL = "/api/v1/karaoke/selection";

/**
 * Above this many players the roster gets a filter field. Under it the grid is
 * two or three flicks long and a field would only be one more thing to skip —
 * on the keyboard as much as under the thumb.
 */
const FILTER_FROM = 12;

/** Color name -> player id. Slots come from the backend; nothing is hardcoded. */
type Assignment = Record<string, string>;

/**
 * What the modal is doing. `opening` is the request that takes the room's
 * selection lock, `blocked` is somebody else holding it, and `lost` is this
 * phone's selection gone out from under it — taken over, or expired. Only
 * `picking` shows a roster: in the other three there is nothing to tap.
 */
type Phase = "opening" | "picking" | "blocked" | "lost";

/** `selection.changed`: the whole selection, or `null` once there is none. */
interface SelectionChanged extends WingmanEvent {
  selection: SelectionRead | null;
}

/**
 * The last configuration, so the same group does not have to re-pick every
 * song. Unknown colors, deleted players and hidden ones fall out before the
 * selection is opened with it, so a stale entry can never resurrect somebody
 * who is not singing — and can never 404 the request either.
 */
function readAssignment(): Assignment {
  try {
    const stored = window.localStorage.getItem(SLOTS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Assignment) : {};
  } catch {
    return {};
  }
}

function writeAssignment(assignment: Assignment): void {
  try {
    window.localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(assignment));
  } catch {
    // Private mode or a full quota: preselection is a convenience, not a feature.
  }
}

/** An assignment as the body both writes take: only the slots somebody stands on. */
function slotBody(colors: string[], assignment: Assignment): SlotCreate[] {
  return colors
    .filter((color) => assignment[color] !== undefined)
    .map((color) => ({ color, player_id: assignment[color] }));
}

/**
 * The stored configuration, reduced to colors that exist and players who are
 * still here and not hidden. The backend answers an unknown player with a 404,
 * so the filtering has to happen before the request rather than at render time.
 */
function rememberedAssignment(
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

/**
 * Give the room's selection back over a request that outlives this component.
 * The page may be going away with it, which cancels the generated client's
 * fetch halfway; `keepalive` is what carries this one out of a closing tab.
 */
function release(token: string): void {
  void fetch(`${SELECTION_URL}?token=${encodeURIComponent(token)}`, {
    method: "DELETE",
    keepalive: true,
    credentials: "same-origin",
    // Nobody is waiting for the answer, and there is nothing to report it to.
  }).catch(() => {});
}

/**
 * Whole seconds left until `target`, at least one, `null` without one. The
 * floor is one rather than zero: the last tick before the song starts is a
 * second long like every other, and "Starting in 0…" is a line that says the
 * countdown is over while it is still on the screen.
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

interface PlayerSelectionProps {
  song: SongRead;
  onClose: () => void;
}

/**
 * Who sings the song, picked on the room's one shared selection: the phone
 * opens it, everybody's screen draws it, and the player selector device fills
 * slots in while the picking goes on. The token that comes back with it is what
 * makes this phone the opener; it stays in this component and is never drawn.
 */
export default function PlayerSelection({
  song,
  onClose,
}: PlayerSelectionProps) {
  const auth = useAuth();
  // The host's setting decides how many people sing and in which colors. The
  // open selection carries the same colors; this is what has their hex, and
  // what seeds the very first request.
  const slots = useQuery(listKaraokeSlotsOptions());
  const players = useQuery(listPlayersOptions());

  const [phase, setPhase] = useState<Phase>("opening");
  const [selection, setSelection] = useState<SelectionRead | null>(null);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [askReplace, setAskReplace] = useState(false);
  const [askTakeOver, setAskTakeOver] = useState(false);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Non-null while the setup guide is up: the backend's problem list.
  const [setupProblems, setSetupProblems] = useState<string[] | null>(null);

  // The opener's secret. A ref, not state: the unmount close reads it from a
  // cleanup that was written when there was no token yet.
  const tokenRef = useRef<string | null>(null);
  // When the selection this phone holds was opened. A ref beside the token
  // because the two have to agree the moment the answer lands: a broadcast can
  // be read between `onSuccess` and the render that would put it in state, and
  // the selection this phone just took over would be read as somebody else's.
  const openedAtRef = useRef<string | null>(null);
  // True from Play until its answer. The start closes the selection, so the
  // `null` broadcast that follows is this phone's own doing, not a take-over.
  const startingRef = useRef(false);
  // The mount effect runs twice under React's development double-invoke, and
  // the second run would take the room's lock off the first.
  const openedRef = useRef(false);
  // Set once this modal is done with the room, so an answer that lands after
  // Cancel gives its token straight back instead of leaving the room locked.
  const closedRef = useRef(false);
  // One write at a time, in order. `queued` is the tap that came in while a PUT
  // was in flight (the newest one wins), `desired` what this phone last asked
  // for — the base the next tap is computed from, so two taps inside one round
  // trip compose instead of overwriting each other.
  const pendingRef = useRef(false);
  const queuedRef = useRef<Assignment | null>(null);
  const desiredRef = useRef<Assignment | null>(null);

  // What somebody else is picking, so the blocked head can name their song.
  const other = useQuery({
    ...getPlayerSelectionOptions(),
    enabled: phase === "blocked",
  });

  const drawn = selection?.slots ?? [];
  const colorNames = drawn.map((slot) => slot.color);
  const assignment: Assignment = {};
  for (const slot of drawn) {
    if (slot.player !== null) assignment[slot.color] = slot.player.id;
  }

  // This is the one surface hiding a player is for: somebody put out of sight
  // for the evening is not offered here and not standing on a slot either.
  const roster = (players.data?.players ?? []).filter(
    (player) => !player.hidden,
  );
  const takenColor = (playerId: string): string | undefined =>
    colorNames.find((color) => assignment[color] === playerId);

  /** The selection is not this phone's any more: the token is dead, say so. */
  const lose = (): void => {
    tokenRef.current = null;
    openedAtRef.current = null;
    queuedRef.current = null;
    desiredRef.current = null;
    pendingRef.current = false;
    setActiveColor(null);
    // Whatever the last write complained about is over with the selection it
    // was about, and the head has one line to say.
    setNotice(null);
    setPhase("lost");
  };

  /**
   * Draw what the server says. Never an older state than what is on the screen:
   * a broadcast can overtake the answer to the write that caused it.
   */
  const apply = (next: SelectionRead): void => {
    setSelection((previous) =>
      previous !== null &&
      parseServerTime(next.updated_at) < parseServerTime(previous.updated_at)
        ? previous
        : next,
    );
  };

  const open = useMutation({
    ...openPlayerSelectionMutation(),
    onSuccess: (opened) => {
      // Cancelled while this was in flight. The room would otherwise stay
      // locked for two minutes over a song nobody is picking any more.
      if (closedRef.current) {
        release(opened.token);
        return;
      }
      tokenRef.current = opened.token;
      openedAtRef.current = opened.selection.opened_at;
      setNotice(null);
      setSelection(opened.selection);
      setPhase("picking");
    },
    onError: (error) => {
      if (errorDetail(error) === "selection_open") {
        setPhase("blocked");
        return;
      }
      setNotice(
        errorMessage(
          error,
          errorDetail(error) ?? "Could not start picking singers.",
        ),
      );
      setPhase("lost");
    },
  });

  const write = useMutation({
    ...setPlayerSelectionSlotsMutation(),
    onSuccess: apply,
    onError: (error) => {
      const detail = errorDetail(error);
      if (detail === "not_the_opener" || detail === "no_selection") {
        lose();
        return;
      }
      setNotice(errorMessage(error, detail ?? "Could not move the singers."));
    },
    onSettled: () => {
      pendingRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued !== null) send(queued);
      else desiredRef.current = null;
    },
  });

  /** One PUT at a time: a second tap waits for the first answer, and wins. */
  function send(next: Assignment): void {
    const token = tokenRef.current;
    if (token === null) return;
    desiredRef.current = next;
    if (pendingRef.current) {
      queuedRef.current = next;
      return;
    }
    pendingRef.current = true;
    write.mutate({ body: { token, slots: slotBody(colorNames, next) } });
  }

  const start = useMutation({
    ...startPlayerSelectionMutation(),
    onSuccess: () => {
      // The group that just started is the group the next song opens with.
      writeAssignment(desiredRef.current ?? assignment);
      tokenRef.current = null;
      openedAtRef.current = null;
      onClose();
    },
    onError: (error) => {
      const detail = errorDetail(error);
      if (detail === "already_playing") {
        // Replacing means stopping the running song, which is its own capability.
        if (auth.can("karaoke.stop")) setAskReplace(true);
        else setNotice("Another song is playing. Ask the host to stop it.");
        return;
      }
      if (detail === "not_the_opener" || detail === "no_selection") {
        lose();
        return;
      }
      // USDX not being set up is not the singer's mistake to read as an error —
      // it gets the guide that says what is missing.
      const problems = usdxProblems(error);
      if (problems !== null) {
        setSetupProblems(problems);
        return;
      }
      setNotice(
        errorMessage(
          error,
          detail ?? "Could not start the song. Check the USDX settings.",
        ),
      );
    },
    // The selection stands again once a failed start is over, so a slot the
    // device fills after it is drawn instead of read as a take-over.
    onSettled: () => {
      startingRef.current = false;
    },
  });

  const close = useMutation(closePlayerSelectionMutation());

  const { mutate: openSelection } = open;
  const playerRows = players.data?.players;
  const slotColors = slots.data?.slots;

  // Opened once both lists are in: the remembered assignment is filtered
  // against them first, so a player who left the party since cannot 404 the
  // request that opens the evening's next song.
  useEffect(() => {
    if (openedRef.current) return;
    if (playerRows === undefined || slotColors === undefined) return;
    openedRef.current = true;
    const colors = slotColors.map((color) => color.name);
    openSelection({
      body: {
        song_id: song.id,
        slots: slotBody(colors, rememberedAssignment(playerRows, colors)),
      },
    });
  }, [openSelection, playerRows, slotColors, song.id]);

  // The modal going away gives the room's lock back, however it went — the
  // component unmounting, or the whole page going with it. Both paths go
  // through the one function that takes the token out of the ref before it
  // sends it, so the room is given back exactly once.
  //
  // The flag is reset in the effect body rather than only in the cleanup:
  // React's development double-invoke runs the cleanup once on a component that
  // is staying, and a selection opened afterwards would be released for it.
  useEffect(() => {
    closedRef.current = false;

    const releaseToken = (): void => {
      const token = tokenRef.current;
      if (token === null) return;
      tokenRef.current = null;
      openedAtRef.current = null;
      release(token);
    };

    // `pagehide`, not the effect cleanup: a closing tab, a back gesture and a
    // navigation away all end the page without running one, and the room would
    // stay locked for the two minutes the selection takes to expire. A
    // `persisted` hide is the page going into the back/forward cache, which it
    // can come back out of with this modal still on it — that one keeps its
    // token, or the singer would return to a selection nothing can write to.
    const onPageHide = (event: PageTransitionEvent): void => {
      if (event.persisted) return;
      releaseToken();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      closedRef.current = true;
      releaseToken();
    };
  }, []);

  // The device may fill a slot at any moment, and somebody may take the whole
  // selection over. `opened_at` is what tells the two apart: a taken-over
  // selection is a new one, and this phone's token died with the old.
  useWingmanEvent<SelectionChanged>("selection.changed", (message) => {
    if (tokenRef.current === null) return;
    const next = message.selection;
    if (next === null) {
      // Play closes the selection: the broadcast that says so is the answer to
      // this phone's own request, and the modal is already on its way out.
      if (!startingRef.current) lose();
      return;
    }
    // The ref, not the drawn selection: this phone's own take-over is answered
    // by a broadcast that may be read before the answer to it is in state.
    if (
      openedAtRef.current !== null &&
      next.opened_at !== openedAtRef.current
    ) {
      lose();
      return;
    }
    apply(next);
  });

  /** Puts a player on the active slot (or the first free one) and nowhere else. */
  const assign = (playerId: string): void => {
    const base = desiredRef.current ?? assignment;
    const target =
      activeColor ?? colorNames.find((color) => base[color] === undefined);
    if (target === undefined) return;
    const next: Assignment = {};
    for (const [color, id] of Object.entries(base)) {
      if (id !== playerId && color !== target) next[color] = id;
    }
    next[target] = playerId;
    send(next);
    setActiveColor(null);
  };

  const clear = (color: string): void => {
    const next = { ...(desiredRef.current ?? assignment) };
    delete next[color];
    send(next);
  };

  /**
   * A tap on a player row. With a slot picked, the tap always means "put them
   * here" — even for someone already standing on another slot, who then moves
   * instead of dropping out. Without a picked slot it is a plain toggle.
   */
  const toggle = (playerId: string): void => {
    const on = takenColor(playerId);
    if (on !== undefined && (activeColor === null || activeColor === on))
      clear(on);
    else assign(playerId);
  };

  const play = (force: boolean): void => {
    const token = tokenRef.current;
    if (token === null) return;
    startingRef.current = true;
    start.mutate({ body: { token, force } });
  };

  /**
   * Take the room's lock, either from somebody else or after losing it. With a
   * selection on the screen its own slots are what comes back; without one —
   * nothing was ever drawn here — the stored configuration is.
   */
  const reopen = (force: boolean): void => {
    const configured = slotColors?.map((color) => color.name) ?? [];
    const colors = colorNames.length > 0 ? colorNames : configured;
    const next =
      desiredRef.current ??
      (selection !== null
        ? assignment
        : rememberedAssignment(playerRows ?? [], colors));
    setNotice(null);
    setPhase("opening");
    openSelection({
      body: { song_id: song.id, slots: slotBody(colors, next), force },
    });
  };

  const cancel = (): void => {
    // Before the token is read: an open that lands after this has to give the
    // room back what this modal is no longer picking with.
    closedRef.current = true;
    const token = tokenRef.current;
    tokenRef.current = null;
    if (token !== null) close.mutate({ query: { token } });
    onClose();
  };

  const hexFor = (color: string): string | undefined =>
    slots.data?.slots.find((slot) => slot.name === color)?.hex;

  const chosen = drawn.filter((slot) => slot.player !== null).length;
  const full = drawn.length > 0 && chosen === drawn.length;
  const countdown = useSecondsUntil(selection?.auto_start_at ?? null);
  const picking = phase === "picking";

  // Whether the field is offered is decided by the *whole* roster, so it cannot
  // disappear under the cursor the moment a query narrows the list past twelve.
  const filtering = roster.length > FILTER_FROM;
  const needle = filter.trim().toLowerCase();
  // Backend order throughout: a filter hides rows, it never reorders them —
  // rows that move under the finger are how the wrong person gets picked.
  const shown =
    filtering && needle !== ""
      ? roster.filter((player) => player.name.toLowerCase().includes(needle))
      : roster;
  // Only a query that came up empty says so. An empty `shown` also means "the
  // roster has not arrived yet" — the loading and the failed fetch both land
  // here, and neither is the reader having mistyped a name.
  const noMatch = filtering && needle !== "" && shown.length === 0;

  // One line that always says what a tap on a player will do — the two-step
  // "pick a slot, then a person" is invisible without it, and a full board
  // would otherwise swallow taps in silence.
  const hint =
    activeColor !== null
      ? "Pick a player for the outlined slot."
      : full
        ? "All slots are full. Tap a slot to change it."
        : "Tap a player to fill the next free slot.";

  const blockedTitle = other.data?.selection?.song.title;

  const slotName = (
    player: PlayerRead | null,
    cardUid: string | null,
  ): string => player?.name ?? (cardUid !== null ? "Unknown card" : "empty");

  return (
    <>
      <Modal title="Player selection" onClose={cancel} fullscreen>
        <div className="player-selection">
          <div className="player-selection-head">
            <p className="player-selection-song">{song.title}</p>
            {notice && (
              <p className="error-notice player-selection-error" role="alert">
                {notice}
              </p>
            )}
            {phase === "blocked" && (
              <div className="player-selection-taken">
                <p className="player-selection-taken-line">
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
            {phase === "lost" && (
              <div className="player-selection-taken">
                {notice === null && (
                  <p className="player-selection-taken-line">
                    Somebody else took over the selection.
                  </p>
                )}
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => reopen(false)}
                >
                  Pick again
                </button>
              </div>
            )}
          </div>

          {phase === "opening" && <Loading />}

          {picking && (
            <ul className="player-selection-slots">
              {drawn.map((slot) => {
                const active = activeColor === slot.color;
                const unknown = slot.player === null && slot.card_uid !== null;
                const name = slotName(slot.player, slot.card_uid);
                return (
                  <li
                    key={slot.color}
                    className={`player-selection-slot${
                      active ? " player-selection-slot-active" : ""
                    }${unknown ? " player-selection-slot-card" : ""}`}
                    // The slot's USDX color as a bar on the leading edge: readable
                    // on every hue, unlike a wash behind the name.
                    style={{
                      boxShadow: `inset 4px 0 0 ${hexFor(slot.color) ?? "transparent"}`,
                    }}
                  >
                    <button
                      type="button"
                      className="player-selection-slot-button"
                      aria-label={`Slot ${slot.color}: ${name}`}
                      aria-pressed={active}
                      onClick={() => setActiveColor(active ? null : slot.color)}
                    >
                      <PlayerAvatar player={slot.player} />
                      <span
                        className={
                          slot.player !== null
                            ? "player-selection-slot-name"
                            : "player-selection-slot-name player-selection-empty"
                        }
                      >
                        {name}
                      </span>
                    </button>
                    {slot.player !== null && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Clear slot ${slot.color}`}
                        onClick={() => clear(slot.color)}
                      >
                        <Icon name="close" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {picking && countdown !== null && (
            <p className="player-selection-countdown" aria-live="polite">
              Starting in {countdown}…
            </p>
          )}

          {picking && (
            <div className="player-selection-pick">
              {players.isSuccess && roster.length === 0 ? (
                <p className="player-selection-none">
                  {/* "Nobody yet" would be a lie with a roster full of hidden
                    players, and the way out of it is a different one. Both
                    lines split on `players.manage`, because that is the right
                    behind the eye that shows somebody again and behind the row
                    that adds one — the Players & accounts page itself opens on
                    any of four rights, but the other three lead to nothing that
                    would help here. */}
                  {(players.data?.players.length ?? 0) > 0
                    ? auth.can("players.manage")
                      ? "Everybody is hidden. Show somebody on the players page."
                      : "Everybody is hidden. Ask the host to show somebody."
                    : auth.can("players.manage")
                      ? "No players yet. Add the first one below."
                      : "No players yet. Ask the host to add one."}
                </p>
              ) : (
                <>
                  <p className="player-selection-hint" aria-live="polite">
                    {hint}
                  </p>
                  {filtering && (
                    <input
                      className="text-input text-input-quiet player-selection-filter"
                      value={filter}
                      placeholder="Filter players"
                      aria-label="Filter players"
                      autoComplete="off"
                      maxLength={64}
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  )}
                  {noMatch ? (
                    // A status region, not a plain line: the reader who typed the
                    // query is in the field with the grid out of view, so the one
                    // thing that changed has to be spoken.
                    <p className="player-selection-none" role="status">
                      No player matches that.
                    </p>
                  ) : (
                    <div className="player-selection-players">
                      {shown.map((player) => {
                        const on = takenColor(player.id);
                        return (
                          <button
                            key={player.id}
                            type="button"
                            className={
                              on
                                ? "player-selection-player player-selection-player-on"
                                : "player-selection-player"
                            }
                            aria-pressed={on !== undefined}
                            onClick={() => toggle(player.id)}
                          >
                            <PlayerAvatar player={player} />
                            <span>{player.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="player-selection-foot">
            {picking && auth.can("players.manage") && (
              <AddPlayerForm onAdded={(player) => assign(player.id)} />
            )}

            <div className="player-selection-actions">
              <button type="button" className="button" onClick={cancel}>
                Cancel
              </button>
              {picking && (
                <button
                  type="button"
                  className="button button-primary"
                  // Off while a tap is still on its way: Play and a `PUT` take
                  // separate connections, and the song must not start with the
                  // slots as they were before the last tap.
                  disabled={chosen === 0 || start.isPending || write.isPending}
                  onClick={() => play(false)}
                >
                  Play
                </button>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {askReplace && (
        <ConfirmModal
          title="Already playing"
          message="Another song is playing. Replace it?"
          confirmLabel="Replace"
          danger
          onConfirm={() => {
            setAskReplace(false);
            play(true);
          }}
          onCancel={() => setAskReplace(false)}
        />
      )}

      {askTakeOver && (
        <ConfirmModal
          title="Take over the selection"
          message="Whoever is picking now loses their singers."
          confirmLabel="Take over"
          danger
          onConfirm={() => {
            setAskTakeOver(false);
            reopen(true);
          }}
          onCancel={() => setAskTakeOver(false)}
        />
      )}

      {setupProblems !== null && (
        <UsdxSetupGuide
          problems={setupProblems}
          onClose={() => setSetupProblems(null)}
        />
      )}
    </>
  );
}
