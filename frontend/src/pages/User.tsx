import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PlayerRead } from "../api";
import {
  createPlayerMutation,
  deletePlayerMutation,
  listPlayersOptions,
  listPlayersQueryKey,
  setPlayerAvatarMutation,
} from "../api/@tanstack/react-query.gen";
import ConfirmModal from "../components/ConfirmModal";
import PlayerAvatar from "../components/PlayerAvatar";
import { errorDetail } from "../errors";
import "./User.css";

/** Mirrors the backend's limit so an oversized file never leaves the browser. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_MESSAGES: Record<string, string> = {
  avatar_too_large: "That image is larger than 5 MB.",
  unsupported_avatar_type:
    "Only jpeg, png and webp images work — and the file has to really be one.",
};

export default function User() {
  const queryClient = useQueryClient();
  const players = useQuery(listPlayersOptions());
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<PlayerRead | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });

  const addPlayer = useMutation({
    ...createPlayerMutation(),
    onSuccess: () => {
      setNewName("");
      setAddError(null);
      refresh();
    },
    onError: (error) =>
      setAddError(
        errorDetail(error) === "duplicate_name"
          ? "There is already a player with that name."
          : "Could not add the player.",
      ),
  });

  const deletePlayer = useMutation({
    ...deletePlayerMutation(),
    onSuccess: refresh,
  });

  const setAvatar = useMutation({
    ...setPlayerAvatarMutation(),
    onSuccess: () => {
      setAvatarError(null);
      refresh();
    },
    onError: (error, variables) =>
      setAvatarError({
        id: variables.path.player_id,
        message:
          AVATAR_MESSAGES[errorDetail(error) ?? ""] ??
          "Could not upload the image.",
      }),
  });

  const upload = (player: PlayerRead, file: File | undefined): void => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError({
        id: player.id,
        message: AVATAR_MESSAGES.avatar_too_large,
      });
      return;
    }
    setAvatar.mutate({ path: { player_id: player.id }, body: { file } });
  };

  return (
    <>
      <h1>User</h1>

      <h2>Players</h2>
      <form
        className="players-add"
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
      {addError && (
        <p className="error-notice players-notice" role="alert">
          {addError}
        </p>
      )}

      {players.isError && (
        <p className="error-notice players-notice" role="alert">
          Could not load the players.
        </p>
      )}

      {players.data?.players.length === 0 && (
        <p className="players-empty">No players yet.</p>
      )}

      <ul className="players-list">
        {(players.data?.players ?? []).map((player) => (
          <li key={player.id}>
            <div className="players-row">
              <PlayerAvatar player={player} />
              <span className="players-name">{player.name}</span>
              <label className="button players-avatar-button">
                {player.has_avatar ? "Change avatar" : "Add avatar"}
                <input
                  type="file"
                  className="visually-hidden"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={`Avatar for ${player.name}`}
                  onChange={(event) =>
                    upload(player, event.target.files?.[0] ?? undefined)
                  }
                />
              </label>
              <button
                type="button"
                className="button button-danger"
                aria-label={`Delete ${player.name}`}
                onClick={() => setDeleting(player)}
              >
                Delete
              </button>
            </div>
            {avatarError?.id === player.id && (
              <p className="error-notice players-notice" role="alert">
                {avatarError.message}
              </p>
            )}
          </li>
        ))}
      </ul>

      {deleting && (
        <ConfirmModal
          title="Delete player"
          message={`Delete "${deleting.name}"? Recorded scores keep the name.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deletePlayer.mutate({ path: { player_id: deleting.id } });
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
