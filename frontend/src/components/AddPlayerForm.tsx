import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PlayerRead } from "../api";
import {
  createPlayerMutation,
  listPlayersQueryKey,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage } from "../errors";

interface AddPlayerFormProps {
  /** Called with the created player, after the list is invalidated. */
  onAdded?: (player: PlayerRead) => void;
}

/** The shared "New player" row. Needs `players.manage`; the caller gates. */
export default function AddPlayerForm({ onAdded }: AddPlayerFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addPlayer = useMutation({
    ...createPlayerMutation(),
    onSuccess: (player) => {
      setName("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });
      onAdded?.(player);
    },
    onError: (cause) =>
      setError(
        errorDetail(cause) === "duplicate_name"
          ? "There is already a player with that name."
          : errorMessage(cause, "Could not add the player."),
      ),
  });

  return (
    <>
      <form
        className="players-add"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) addPlayer.mutate({ body: { name: trimmed } });
        }}
      >
        <input
          className="text-input"
          value={name}
          placeholder="New player"
          aria-label="New player name"
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="button"
          disabled={name.trim() === "" || addPlayer.isPending}
        >
          Add
        </button>
      </form>
      {error && (
        <p className="error-notice players-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
