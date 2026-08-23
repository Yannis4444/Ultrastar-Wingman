import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PlaylistRead } from "../api";
import {
  createPlaylistMutation,
  deletePlaylistMutation,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
  updatePlaylistMutation,
} from "../api/@tanstack/react-query.gen";
import { errorMessage } from "../errors";
import ConfirmModal from "./ConfirmModal";
import Modal from "./Modal";
import "./PlaylistsModal.css";

interface PlaylistsModalProps {
  onClose: () => void;
  /** Lets the page drop a filter that pointed at the deleted playlist. */
  onDeleted: (playlistId: string) => void;
}

/** Create, rename, share and delete the caller's own playlists. */
export default function PlaylistsModal({
  onClose,
  onDeleted,
}: PlaylistsModalProps) {
  const queryClient = useQueryClient();
  const playlists = useQuery(listPlaylistsOptions());
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [deleting, setDeleting] = useState<PlaylistRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
  };
  const failed = (fallback: string) => (cause: unknown) =>
    setError(errorMessage(cause, fallback));

  const create = useMutation({
    ...createPlaylistMutation(),
    onSuccess: () => {
      setName("");
      setShared(false);
      refresh();
    },
    onError: failed("Could not create the playlist."),
  });
  const update = useMutation({
    ...updatePlaylistMutation(),
    onSuccess: refresh,
    onError: failed("Could not change the playlist."),
  });
  const remove = useMutation({
    ...deletePlaylistMutation(),
    onSuccess: refresh,
    onError: failed("Could not delete the playlist."),
  });

  const mine = (playlists.data?.playlists ?? []).filter((list) => list.mine);

  return (
    <>
      <Modal title="Playlists" onClose={onClose}>
        {error && (
          <p className="error-notice playlists-notice" role="alert">
            {error}
          </p>
        )}

        <form
          className="playlists-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== "") create.mutate({ body: { name, shared } });
          }}
        >
          <input
            className="text-input"
            aria-label="New playlist name"
            placeholder="New playlist"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="playlists-shared">
            <input
              type="checkbox"
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
            />
            Shared
          </label>
          <button
            type="submit"
            className="button button-primary"
            disabled={name.trim() === "" || create.isPending}
          >
            Create
          </button>
        </form>

        {mine.length === 0 ? (
          <p className="playlists-empty">
            No playlists yet. Create one, then add songs from a song's details.
          </p>
        ) : (
          <ul className="playlists-list">
            {mine.map((list) => (
              <li key={list.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const renamed = String(
                      new FormData(event.currentTarget).get("name") ?? "",
                    ).trim();
                    if (renamed !== "" && renamed !== list.name) {
                      update.mutate({
                        path: { playlist_id: list.id },
                        body: { name: renamed },
                      });
                    }
                  }}
                >
                  <input
                    className="text-input"
                    name="name"
                    // Re-keyed on the stored name so a rename resets the field.
                    key={list.name}
                    defaultValue={list.name}
                    aria-label={`Name of ${list.name}`}
                  />
                  <button type="submit" className="button">
                    Rename
                  </button>
                </form>
                <span className="playlists-meta">
                  {list.song_count} {list.song_count === 1 ? "song" : "songs"}
                </span>
                <label className="playlists-shared">
                  <input
                    type="checkbox"
                    checked={list.shared}
                    aria-label={`Share ${list.name}`}
                    onChange={(event) =>
                      update.mutate({
                        path: { playlist_id: list.id },
                        body: { shared: event.target.checked },
                      })
                    }
                  />
                  Shared
                </label>
                <button
                  type="button"
                  className="button button-danger"
                  aria-label={`Delete playlist ${list.name}`}
                  onClick={() => setDeleting(list)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {deleting && (
        <ConfirmModal
          title="Delete playlist"
          message={`Delete the playlist "${deleting.name}"? The songs themselves stay in the library.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            remove.mutate({ path: { playlist_id: deleting.id } });
            onDeleted(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
