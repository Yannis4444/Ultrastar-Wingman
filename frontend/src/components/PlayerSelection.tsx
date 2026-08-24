import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PlayerRead, SlotCreate, SongRead } from "../api";
import {
  createPlayerMutation,
  listKaraokeColorsOptions,
  listPlayersOptions,
  listPlayersQueryKey,
  singSongMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail, errorMessage, usdxProblems } from "../errors";
import ConfirmModal from "./ConfirmModal";
import Modal from "./Modal";
import PlayerAvatar from "./PlayerAvatar";
import UsdxSetupGuide from "./UsdxSetupGuide";
import "./PlayerSelection.css";

const SLOTS_STORAGE_KEY = "wingman.playerSlots";

/** Color name -> player id. Colors come from the backend; nothing is hardcoded. */
type Assignment = Record<string, string>;

/**
 * The last configuration, so the same group does not have to re-pick every
 * song. Unknown colors and deleted players fall out at render time, so a stale
 * entry can never resurrect a player who no longer exists.
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
  const queryClient = useQueryClient();
  const auth = useAuth();
  const colors = useQuery(listKaraokeColorsOptions());
  const players = useQuery(listPlayersOptions());

  const [assignment, setAssignment] = useState<Assignment>(readAssignment);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [askReplace, setAskReplace] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Non-null while the setup guide is up: the backend's problem list.
  const [setupProblems, setSetupProblems] = useState<string[] | null>(null);

  const colorNames = colors.data?.colors.map((color) => color.name) ?? [];
  const byId = new Map(
    (players.data?.players ?? []).map((player) => [player.id, player]),
  );
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

  const addPlayer = useMutation({
    ...createPlayerMutation(),
    onSuccess: (player) => {
      setNewName("");
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });
      assign(player.id);
    },
    onError: (error) =>
      setNotice(
        errorDetail(error) === "duplicate_name"
          ? "There is already a player with that name."
          : errorMessage(error, "Could not add the player."),
      ),
  });

  const start = (force: boolean): void => {
    // Every color is sent so USDX gets the colors in its own order; the backend
    // drops the trailing empty ones.
    const slots: SlotCreate[] = colorNames.map((color) => ({
      color,
      player_id: playerFor(color)?.id ?? null,
    }));
    sing.mutate({ body: { song_id: song.id, slots, force } });
  };

  const chosen = colorNames.filter((color) => playerFor(color) !== null).length;

  return (
    <>
      <Modal title="Player Selection" onClose={onClose} fullscreen>
        <div className="player-selection">
          <p className="player-selection-song">{song.title}</p>

          {notice && (
            <p className="error-notice" role="alert">
              {notice}
            </p>
          )}

          <div className="player-selection-slots">
            {(colors.data?.colors ?? []).map((color) => {
              const player = playerFor(color.name);
              return (
                <div
                  key={color.name}
                  className="player-selection-slot"
                  style={{
                    borderColor: `${color.hex}aa`,
                    backgroundColor: `${color.hex}28`,
                  }}
                >
                  <button
                    type="button"
                    aria-label={`Slot ${color.name}: ${player?.name ?? "empty"}`}
                    aria-pressed={activeColor === color.name}
                    onClick={() =>
                      setActiveColor(
                        activeColor === color.name ? null : color.name,
                      )
                    }
                  >
                    <PlayerAvatar player={player} />
                    <span className={player ? "" : "player-selection-empty"}>
                      {player?.name ?? "empty"}
                    </span>
                  </button>
                  {player && (
                    <button
                      type="button"
                      className="player-selection-clear"
                      aria-label={`Clear slot ${color.name}`}
                      onClick={() => clear(color.name)}
                    >
                      &times;
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="player-selection-players">
            {(players.data?.players ?? []).map((player) => {
              const on = takenColor(player.id);
              return (
                <button
                  key={player.id}
                  type="button"
                  className={on ? "selected" : ""}
                  aria-pressed={on !== undefined}
                  onClick={() => (on ? clear(on) : assign(player.id))}
                >
                  <PlayerAvatar player={player} />
                  <span>{player.name}</span>
                </button>
              );
            })}
          </div>

          {auth.can("players.manage") && (
            <form
              className="player-selection-add"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newName.trim();
                if (name) addPlayer.mutate({ body: { name } });
              }}
            >
              <input
                className="text-input"
                value={newName}
                placeholder="New player"
                aria-label="New player name"
                maxLength={64}
                onChange={(event) => setNewName(event.target.value)}
              />
              <button
                type="submit"
                className="button"
                disabled={newName.trim() === "" || addPlayer.isPending}
              >
                Add
              </button>
            </form>
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
