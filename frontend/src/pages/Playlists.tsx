import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { PlaylistRead } from "../api";
import {
  createPlaylistMutation,
  deletePlaylistMutation,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
  updatePlaylistMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { errorMessage } from "../errors";
import "./Playlists.css";

/** Every playlist the caller may see, with the create/rename/delete controls. */
export default function Playlists() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  // `null` means "the reader has not said": the form then opens by itself on an
  // empty page and stays shut everywhere else. The header toggle and the empty
  // state's button write a real boolean and take over from there.
  const [creating, setCreating] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PlaylistRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: auth.loaded && auth.can("playlists.view"),
  });

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
      // The list stops being empty, so without this the form would vanish
      // under the reader's hands. A second playlist is one word away.
      setCreating(true);
      nameField.current?.focus();
      refresh();
    },
    onError: failed("Could not create the playlist."),
  });
  const update = useMutation({
    ...updatePlaylistMutation(),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: failed("Could not change the playlist."),
  });
  const remove = useMutation({
    ...deletePlaylistMutation(),
    onSuccess: refresh,
    onError: failed("Could not delete the playlist."),
  });

  // A playlist needs an account to belong to, so a guest never gets the form.
  const canManage = auth.user !== null && auth.can("playlists.manage");
  // The owner edits their own; an administrator may fix anybody's — including
  // the host session, which is an administrator without an account of its own.
  const mutable = (list: PlaylistRead) =>
    auth.can("playlists.manage") && (list.mine || auth.role === "admin");

  const rows = playlists.data?.playlists ?? [];
  const empty = playlists.isSuccess && rows.length === 0;
  const showForm = canManage && (creating ?? empty);

  return (
    <div className="playlists-page">
      <PageHeader title="Playlists" back="/songs">
        {canManage && (
          <button
            type="button"
            className="icon-button icon-button-bordered"
            aria-label="New playlist"
            aria-expanded={showForm}
            title="New playlist"
            onClick={() => setCreating(!showForm)}
          >
            <Icon name="plus" />
          </button>
        )}
      </PageHeader>
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (auth.can("playlists.view") ? (
          <>
            {error && (
              <p className="error-notice playlists-notice" role="alert">
                {error}
              </p>
            )}

            {showForm && (
              <form
                className="playlists-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() !== "")
                    create.mutate({ body: { name, shared } });
                }}
              >
                <input
                  className="text-input text-input-quiet"
                  ref={nameField}
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
            )}

            {playlists.isPending && <Loading />}

            {playlists.isError && (
              <p className="error-notice playlists-notice" role="alert">
                Could not load the playlists.
              </p>
            )}

            {empty && (
              <div className="playlists-blank">
                <Icon name="list" className="playlists-blank-icon" />
                <h2>No playlists yet</h2>
                {/* A guest cannot act on the invitation, so it is not offered. */}
                {canManage && (
                  <>
                    <p>
                      Create one, then add songs from a song&apos;s details.
                    </p>
                    {!showForm && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => setCreating(true)}
                      >
                        New playlist
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <ul className="playlists-list">
              {rows.map((list) =>
                editing === list.id ? (
                  <li key={list.id}>
                    <form
                      className="playlists-edit"
                      // Enter saves (the form's own submit), so Escape has to
                      // be the way out — the Cancel button is the only other
                      // one, and a keyboard reader typing a name should not
                      // have to tab past Shared and Cancel to abandon the edit.
                      // Blur deliberately does nothing: the Shared checkbox and
                      // both buttons take focus off the field.
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const renamed = String(form.get("name") ?? "").trim();
                        if (renamed === "") return;
                        update.mutate({
                          path: { playlist_id: list.id },
                          body: {
                            name: renamed,
                            shared: form.get("shared") !== null,
                          },
                        });
                      }}
                    >
                      <input
                        className="text-input text-input-quiet"
                        name="name"
                        defaultValue={list.name}
                        aria-label={`Name of ${list.name}`}
                      />
                      <label className="playlists-shared">
                        <input
                          type="checkbox"
                          name="shared"
                          defaultChecked={list.shared}
                          aria-label={`Share ${list.name}`}
                        />
                        Shared
                      </label>
                      <div className="playlists-edit-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="button button-primary"
                          disabled={update.isPending}
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={list.id} className="playlists-row">
                    <Link
                      className="playlists-open"
                      to={`/songs/playlists/${encodeURIComponent(list.id)}`}
                    >
                      {/* A 40px square, not a stack of covers: it keeps every
                          list in the app on one text axis and costs no
                          requests. */}
                      <span className="playlists-glyph">
                        <Icon name="list" />
                      </span>
                      <span className="playlists-text">
                        <span className="playlists-name">{list.name}</span>
                        <span className="playlists-meta">
                          {list.song_count}{" "}
                          {list.song_count === 1 ? "song" : "songs"}
                          {list.shared &&
                            ` · ${list.mine ? "shared" : (list.owner_username ?? "shared")}`}
                        </span>
                      </span>
                      {/* Two icon buttons already say "this row does things";
                          a third glyph beside them is clutter. */}
                      {!mutable(list) && (
                        <Icon
                          name="chevron-right"
                          className="playlists-chevron"
                        />
                      )}
                    </Link>
                    {mutable(list) && (
                      <span className="playlists-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Edit ${list.name}`}
                          onClick={() => setEditing(list.id)}
                        >
                          <Icon name="pencil" />
                        </button>
                        <button
                          type="button"
                          className="icon-button icon-button-danger"
                          aria-label={`Delete playlist ${list.name}`}
                          onClick={() => setDeleting(list)}
                        >
                          <Icon name="trash" />
                        </button>
                      </span>
                    )}
                  </li>
                ),
              )}
            </ul>
          </>
        ) : (
          <p className="settings-notice">
            Playlists are not open to your role. Log in or ask the host for
            access.
          </p>
        ))}

      {deleting && (
        <ConfirmModal
          title="Delete playlist"
          message={`Delete the playlist "${deleting.name}"? The songs themselves stay in the library.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            remove.mutate({ path: { playlist_id: deleting.id } });
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
