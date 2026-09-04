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
 * the singer who actually sang it, or take it off the record. The row carries
 * one control for both (§7) — two 40px buttons per row is chrome where the
 * numbers belong, and deleting is the rarer of the two — so the pencil opens a
 * panel that holds the players and, at its foot, the deletion.
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
      // The row this panel belongs to is about to leave the list, so the panel
      // goes with it rather than standing over a score that is no longer there.
      setPicking(false);
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
        {/* One button for both corrections, so the label names both (§7). */}
        <button
          type="button"
          className="icon-button"
          aria-label={`Correct the score ${score.score}`}
          onClick={() => {
            setError(null);
            setPicking(true);
          }}
        >
          <Icon name="pencil" />
        </button>
      </span>

      {picking && (
        <Modal title="Correct this score" onClose={() => setPicking(false)}>
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
          {/* The rarer correction, at the foot and out of the way of the
              players: the Manage page's idiom for a destructive action that
              belongs to the panel rather than to a row in it. */}
          <div className="score-actions-delete">
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending || reassign.isPending}
              onClick={() => {
                setError(null);
                setDeleting(true);
              }}
            >
              Delete score
            </button>
          </div>
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

      {/* Over the panel too, and for the same reason: cancelling comes back to
          the players rather than closing the whole correction. */}
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
    </>
  );
}
