import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { PlayerRead, ScoreWithContext } from "../api";
import {
  deleteScoreMutation,
  reassignScoreMutation,
} from "../api/@tanstack/react-query.gen";
import { errorMessage } from "../errors";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import Modal from "./Modal";
import PickerRow from "./PickerRow";
import PlayerAvatar from "./PlayerAvatar";
import "./PickerRow.css";
import "./ScoreActions.css";

interface ScoreActionsProps {
  score: ScoreWithContext;
  /** The registered players a score may be moved to, in the order they came. */
  players: PlayerRead[];
  /** Something changed on the server — refetch whatever list holds this row. */
  onChanged: () => void;
}

/**
 * The two corrections `stats.moderate` may make to a recorded score: put it on
 * the singer who actually sang it, or take it off the record.
 *
 * Neither the number nor the song is editable, on purpose — Ultrastar Deluxe
 * awarded that score for that song, and the only thing Wingman can get wrong is
 * which player was on the microphone.
 */
export default function ScoreActions({
  score,
  players,
  onChanged,
}: ScoreActionsProps) {
  const [picking, setPicking] = useState(false);
  /** The player the reader picked, waiting for the confirmation. */
  const [moveTo, setMoveTo] = useState<PlayerRead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reassign = useMutation({
    ...reassignScoreMutation(),
    onSuccess: () => {
      setMoveTo(null);
      setPicking(false);
      onChanged();
    },
    onError: (failure) => {
      // Back to the picker: the message belongs where the reader can act on it,
      // and a confirmation left standing over it would say nothing at all.
      setMoveTo(null);
      setError(errorMessage(failure, "Could not move that score."));
    },
  });

  const remove = useMutation({
    ...deleteScoreMutation(),
    onSuccess: () => {
      setDeleting(false);
      onChanged();
    },
    onError: (failure) => {
      setDeleting(false);
      setError(errorMessage(failure, "Could not delete that score."));
    },
  });

  const song = score.song?.title ?? "a song that has left the library";

  return (
    <>
      <span className="score-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Change who sang ${score.score}`}
          onClick={() => {
            setError(null);
            setPicking(true);
          }}
        >
          <Icon name="pencil" />
        </button>
        <button
          type="button"
          className="icon-button icon-button-danger"
          aria-label={`Delete the score ${score.score}`}
          onClick={() => {
            setError(null);
            setDeleting(true);
          }}
        >
          <Icon name="trash" />
        </button>
      </span>

      {picking && (
        <Modal title="Who sang this?" onClose={() => setPicking(false)}>
          <p className="score-actions-note">
            {score.score} on {song}, recorded for {score.player_name}.
          </p>
          {error !== null && (
            <p className="error-notice" role="alert">
              {error}
            </p>
          )}
          {players.length === 0 ? (
            <p className="score-actions-note">There are no players to pick.</p>
          ) : (
            <ul className="picker-list">
              {players.map((player) => (
                <PickerRow
                  key={player.id}
                  lead={<PlayerAvatar player={player} />}
                  title={player.name}
                  meta={player.registered ? "Account" : "Guest player"}
                  pressed={player.id === score.player_id}
                  disabled={reassign.isPending}
                  onClick={() => {
                    setError(null);
                    setMoveTo(player);
                  }}
                />
              ))}
            </ul>
          )}
        </Modal>
      )}

      {/* Over the picker, never instead of it: cancelling here comes back to
          the list of players rather than closing the whole correction. */}
      {moveTo !== null && (
        <ConfirmModal
          title="Move this score?"
          message={`${score.score} on ${song} moves from ${score.player_name} to ${moveTo.name}.`}
          confirmLabel="Move"
          onConfirm={() =>
            reassign.mutate({
              path: { score_id: score.id },
              body: { player_id: moveTo.id },
            })
          }
          onCancel={() => setMoveTo(null)}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete this score?"
          message={`${score.score} for ${score.player_name} on ${song} is gone for good. The song stays in what was played.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove.mutate({ path: { score_id: score.id } })}
          onCancel={() => setDeleting(false)}
        />
      )}

      {/* The picker carries its own copy while it is open; this one is for a
          deletion that failed with no dialog left to say so in. */}
      {error !== null && !picking && (
        <p className="error-notice score-actions-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
