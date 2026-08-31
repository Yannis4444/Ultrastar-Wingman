import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PlayerRead, SlotCreate, SongRead } from "../api";
import {
  listKaraokeSlotsOptions,
  listPlayersOptions,
  singSongMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail, errorMessage, usdxProblems } from "../errors";
import AddPlayerForm from "./AddPlayerForm";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import Modal from "./Modal";
import PlayerAvatar from "./PlayerAvatar";
import UsdxSetupGuide from "./UsdxSetupGuide";
import "./PlayerSelection.css";

const SLOTS_STORAGE_KEY = "wingman.playerSlots";

/**
 * Above this many players the roster gets a filter field. Under it the grid is
 * two or three flicks long and a field would only be one more thing to skip —
 * on the keyboard as much as under the thumb.
 */
const FILTER_FROM = 12;

/** Color name -> player id. Slots come from the backend; nothing is hardcoded. */
type Assignment = Record<string, string>;

/**
 * The last configuration, so the same group does not have to re-pick every
 * song. Unknown colors, deleted players and hidden ones fall out at render
 * time, so a stale entry can never resurrect somebody who is not singing.
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

interface PlayerSelectionProps {
  song: SongRead;
  onClose: () => void;
}

export default function PlayerSelection({
  song,
  onClose,
}: PlayerSelectionProps) {
  const auth = useAuth();
  // The host's setting decides how many people sing and in which colors.
  const slots = useQuery(listKaraokeSlotsOptions());
  const players = useQuery(listPlayersOptions());

  const [assignment, setAssignment] = useState<Assignment>(readAssignment);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [askReplace, setAskReplace] = useState(false);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Non-null while the setup guide is up: the backend's problem list.
  const [setupProblems, setSetupProblems] = useState<string[] | null>(null);

  const colorNames = slots.data?.slots.map((color) => color.name) ?? [];
  // This is the one surface hiding a player is for: somebody put out of sight
  // for the evening is not offered here and not standing on a slot either. The
  // filter comes before `byId` on purpose — a stored assignment would otherwise
  // put them straight back into a slot the grid no longer offers.
  const roster = (players.data?.players ?? []).filter(
    (player) => !player.hidden,
  );
  const byId = new Map(roster.map((player) => [player.id, player]));
  const playerFor = (color: string): PlayerRead | null =>
    byId.get(assignment[color] ?? "") ?? null;
  const takenColor = (playerId: string): string | undefined =>
    colorNames.find((color) => assignment[color] === playerId);

  const update = (next: Assignment): void => {
    setAssignment(next);
    writeAssignment(next);
  };

  /** Puts a player on the active slot (or the first free one) and nowhere else. */
  const assign = (playerId: string): void => {
    const target =
      activeColor ?? colorNames.find((color) => playerFor(color) === null);
    if (target === undefined) return;
    const next: Assignment = {};
    for (const [color, id] of Object.entries(assignment)) {
      if (id !== playerId && color !== target) next[color] = id;
    }
    next[target] = playerId;
    update(next);
    setActiveColor(null);
  };

  const clear = (color: string): void => {
    const next = { ...assignment };
    delete next[color];
    update(next);
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

  const sing = useMutation({
    ...singSongMutation(),
    onSuccess: onClose,
    onError: (error) => {
      if (errorDetail(error) === "already_playing") {
        // Replacing means stopping the running song, which is its own capability.
        if (auth.can("karaoke.stop")) setAskReplace(true);
        else setNotice("Another song is playing — ask the host to stop it.");
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
          errorDetail(error) ??
            "Could not start the song — check the USDX settings.",
        ),
      );
    },
  });

  const start = (force: boolean): void => {
    // Every configured slot is sent so USDX gets them in the host's order; the
    // backend drops the trailing empty ones.
    const slots: SlotCreate[] = colorNames.map((color) => ({
      color,
      player_id: playerFor(color)?.id ?? null,
    }));
    sing.mutate({ body: { song_id: song.id, slots, force } });
  };

  const chosen = colorNames.filter((color) => playerFor(color) !== null).length;
  const full = colorNames.length > 0 && chosen === colorNames.length;

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
        ? "All slots are full — tap a slot to change it."
        : "Tap a player to fill the next free slot.";

  return (
    <>
      <Modal title="Player Selection" onClose={onClose} fullscreen>
        <div className="player-selection">
          <div className="player-selection-head">
            <p className="player-selection-song">{song.title}</p>
            {notice && (
              <p className="error-notice player-selection-error" role="alert">
                {notice}
              </p>
            )}
          </div>

          <ul className="player-selection-slots">
            {(slots.data?.slots ?? []).map((color) => {
              const player = playerFor(color.name);
              const active = activeColor === color.name;
              return (
                <li
                  key={color.name}
                  className={
                    active
                      ? "player-selection-slot player-selection-slot-active"
                      : "player-selection-slot"
                  }
                  // The slot's USDX color as a bar on the leading edge: readable
                  // on every hue, unlike a wash behind the name.
                  style={{ boxShadow: `inset 4px 0 0 ${color.hex}` }}
                >
                  <button
                    type="button"
                    className="player-selection-slot-button"
                    aria-label={`Slot ${color.name}: ${player?.name ?? "empty"}`}
                    aria-pressed={active}
                    onClick={() => setActiveColor(active ? null : color.name)}
                  >
                    <PlayerAvatar player={player} />
                    <span
                      className={
                        player
                          ? "player-selection-slot-name"
                          : "player-selection-slot-name player-selection-empty"
                      }
                    >
                      {player?.name ?? "empty"}
                    </span>
                  </button>
                  {player && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Clear slot ${color.name}`}
                      onClick={() => clear(color.name)}
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="player-selection-pick">
            {players.isSuccess && roster.length === 0 ? (
              <p className="player-selection-none">
                {/* "Nobody yet" would be a lie with a roster full of hidden
                    players, and the way out of it is a different one. Both
                    lines still split on the right, because the players page is
                    shut to everybody under `players.manage`. */}
                {(players.data?.players.length ?? 0) > 0
                  ? auth.can("players.manage")
                    ? "Everybody is hidden — show somebody on the players page."
                    : "Everybody is hidden — ask the host to show somebody."
                  : auth.can("players.manage")
                    ? "No players yet — add the first one below."
                    : "No players yet — ask the host to add one."}
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

          <div className="player-selection-foot">
            {auth.can("players.manage") && (
              <AddPlayerForm onAdded={(player) => assign(player.id)} />
            )}

            <div className="player-selection-actions">
              <button type="button" className="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={chosen === 0 || sing.isPending}
                onClick={() => start(false)}
              >
                Play
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {askReplace && (
        <ConfirmModal
          title="Already playing"
          message="Another song is playing — replace it?"
          confirmLabel="Replace"
          danger
          onConfirm={() => {
            setAskReplace(false);
            start(true);
          }}
          onCancel={() => setAskReplace(false)}
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
