import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PlaylistRead } from "../api";
import {
  createPlaylistMutation,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import Modal from "../components/Modal";
import PageHeader from "../components/PageHeader";
import PlaylistCover from "../components/PlaylistCover";
import { formatTotalDuration } from "../duration";
import { errorMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Playlists.css";

/**
 * Which heading a playlist lives under. The backend hands out everything the
 * caller may see in one listing and leaves the grouping to the client:
 *
 * - `mine` — theirs, whether shared with anybody or not.
 * - `shared` — a member row they still follow.
 * - `global` — everybody's, including a global list they were named on but
 *   unfollowed: unfollowing cannot hide what everybody sees anyway.
 * - `hidden` — a member row they unfollowed. Only these fold away.
 */
function groupOf(list: PlaylistRead): "mine" | "shared" | "global" | "hidden" {
  if (list.my_access === "owner") return "mine";
  if (list.my_access !== null && list.followed) return "shared";
  if (list.is_global) return "global";
  return "hidden";
}

/** "12 songs · 48 min · by alice" — the owner only where the reader is not it. */
function meta(list: PlaylistRead, withOwner: boolean): string {
  const parts = [
    `${list.song_count} ${list.song_count === 1 ? "song" : "songs"}`,
  ];
  if (list.duration_seconds > 0)
    parts.push(formatTotalDuration(list.duration_seconds));
  if (withOwner && list.owner_username !== null)
    parts.push(`by ${list.owner_username}`);
  return parts.join(" · ");
}

function PlaylistRow({
  list,
  withOwner,
}: {
  list: PlaylistRead;
  withOwner: boolean;
}) {
  return (
    <li className="playlists-row">
      <Link
        className="playlists-open"
        to={`/songs/playlists/${encodeURIComponent(list.id)}`}
      >
        <PlaylistCover songIds={list.cover_song_ids} />
        <span className="playlists-text">
          <span className="playlists-name">
            <span className="playlists-name-text">{list.name}</span>
            {/* A passive mark, never a control: what a list is shared with is
                changed on the manage page, not from a row. */}
            {list.is_global && (
              <span
                className="playlists-mark"
                title="Everybody can see this playlist"
              >
                <Icon name="globe" />
              </span>
            )}
          </span>
          <span className="playlists-meta">{meta(list, withOwner)}</span>
        </span>
        <Icon name="chevron-right" className="playlists-chevron" />
      </Link>
    </li>
  );
}

function PlaylistGroup({
  title,
  rows,
  withOwner,
}: {
  title: string;
  rows: PlaylistRead[];
  withOwner: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="playlists-group">
      <h2>{title}</h2>
      <ul className="playlists-list">
        {rows.map((list) => (
          <PlaylistRow key={list.id} list={list} withOwner={withOwner} />
        ))}
      </ul>
    </section>
  );
}

/** Every playlist the caller may see, in the four groups of §7. */
export default function Playlists() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: auth.loaded && auth.can("playlists.view"),
  });

  // Somebody else sharing a list with me, or taking it back, changes what this
  // page shows without me touching anything.
  useWingmanEvent("playlists.changed", () => {
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
  });

  const closeForm = () => {
    setCreating(false);
    setName("");
    setDescription("");
    setIsGlobal(false);
  };

  const create = useMutation({
    ...createPlaylistMutation(),
    onSuccess: (created) => {
      closeForm();
      void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
      // Straight into the new list: it is empty, and adding songs is the only
      // reason anybody creates one.
      void navigate(`/songs/playlists/${encodeURIComponent(created.id)}`);
    },
    onError: (cause) =>
      setError(errorMessage(cause, "Could not create the playlist.")),
  });

  // A playlist needs an account to belong to, so a guest never gets the form.
  const canManage = auth.user !== null && auth.can("playlists.manage");
  const rows = playlists.data?.playlists ?? [];
  const grouped = {
    mine: rows.filter((list) => groupOf(list) === "mine"),
    shared: rows.filter((list) => groupOf(list) === "shared"),
    global: rows.filter((list) => groupOf(list) === "global"),
    hidden: rows.filter((list) => groupOf(list) === "hidden"),
  };
  const empty = playlists.isSuccess && rows.length === 0;

  return (
    <div className="playlists-page">
      <PageHeader title="Playlists" back="/songs">
        {canManage && (
          <button
            type="button"
            className="icon-button icon-button-bordered"
            aria-label="New playlist"
            title="New playlist"
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" />
          </button>
        )}
      </PageHeader>
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (auth.can("playlists.view") ? (
          <>
            {/* While the panel is up the notice belongs inside it: behind the
                backdrop nobody would ever read why the create was refused. */}
            {error && !creating && (
              <p className="error-notice playlists-notice" role="alert">
                {error}
              </p>
            )}

            {playlists.isPending && <Loading />}

            {playlists.isError && (
              <p className="error-notice playlists-notice" role="alert">
                Could not load the playlists.
              </p>
            )}

            {empty && (
              /* One empty state for the page, not one per heading: three of
                 them stacked on a fresh install would say the same thing three
                 times. A reader who cannot create one is not invited to. */
              <EmptyState
                icon="list"
                title="No playlists yet"
                action={
                  canManage ? (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => setCreating(true)}
                    >
                      New playlist
                    </button>
                  ) : undefined
                }
              >
                {canManage
                  ? "Create one, then add songs to it."
                  : "Playlists shared with everybody show up here."}
              </EmptyState>
            )}

            <PlaylistGroup
              title="Your playlists"
              rows={grouped.mine}
              withOwner={false}
            />
            <PlaylistGroup
              title="Shared with you"
              rows={grouped.shared}
              withOwner
            />
            <PlaylistGroup title="Global" rows={grouped.global} withOwner />

            {grouped.hidden.length > 0 && (
              /* Unfollowed lists are out of the way but not gone: the reader
                 said "not on my page", not "never again". */
              <details className="playlists-hidden">
                <summary>
                  <Icon name="bookmark-off" />
                  <span>Hidden</span>
                  <span className="playlists-hidden-count">
                    {grouped.hidden.length}
                  </span>
                </summary>
                <ul className="playlists-list">
                  {grouped.hidden.map((list) => (
                    <PlaylistRow key={list.id} list={list} withOwner />
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="settings-notice">
            Playlists are not open to you. Log in or ask the host for access.
          </p>
        ))}

      {creating && (
        <Modal title="New playlist" onClose={closeForm}>
          <form
            className="playlists-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() === "") return;
              setError(null);
              create.mutate({
                body: {
                  name: name.trim(),
                  description:
                    description.trim() === "" ? null : description.trim(),
                  is_global: isGlobal,
                },
              });
            }}
          >
            <label className="playlists-field">
              <span>Name</span>
              <input
                className="text-input text-input-quiet"
                // The one thing the dialog exists to ask for.
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="playlists-field">
              <span>Description</span>
              <textarea
                className="text-input text-input-quiet"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="playlists-check">
              <input
                type="checkbox"
                checked={isGlobal}
                onChange={(event) => setIsGlobal(event.target.checked)}
              />
              <span>Global: everyone can see it</span>
            </label>
            {error && (
              <p className="error-notice" role="alert">
                {error}
              </p>
            )}
            <div className="playlists-create-actions">
              <button type="button" className="button" onClick={closeForm}>
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={name.trim() === "" || create.isPending}
              >
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
