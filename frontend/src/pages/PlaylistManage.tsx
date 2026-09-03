import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PlaylistMemberRead, PlaylistUpdate } from "../api";
import {
  deletePlaylistMutation,
  getPlaylistOptions,
  getPlaylistQueryKey,
  listPlaylistMembersOptions,
  listPlaylistMembersQueryKey,
  listPlaylistsQueryKey,
  removePlaylistMemberMutation,
  setPlaylistMemberMutation,
  updatePlaylistMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { asPlayer } from "../avatars";
import ConfirmModal from "../components/ConfirmModal";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import PlayerAvatar from "../components/PlayerAvatar";
import { errorDetail, errorMessage } from "../errors";
import { useUserLookup } from "../hooks/useUserLookup";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import "./Playlists.css";
import "./PlaylistManage.css";

interface PlaylistsChanged extends WingmanEvent {
  /** Null when several lists changed at once (an account was deleted). */
  playlist_id: string | null;
}

/** What a member row may be set to. `owner` is not one of them: it is not a
 *  member row at all, and nothing on this page hands a playlist over. */
const ACCESS: PlaylistMemberRead["access"][] = ["read", "write", "admin"];

/** Somebody shared with starts by being allowed to look, never to change. */
const DEFAULT_ACCESS: PlaylistMemberRead["access"] = "read";

/** The three fields the form owns, as the reader last saw them saved. */
interface Draft {
  name: string;
  description: string;
  isGlobal: boolean;
}

const EMPTY: Draft = { name: "", description: "", isGlobal: false };

/** The saved state to measure the fields against, trimmed the way they are. */
function baseline(playlist: {
  name: string;
  description?: string | null;
  is_global: boolean;
}): Draft {
  return {
    name: playlist.name.trim(),
    description: (playlist.description ?? "").trim(),
    isGlobal: playlist.is_global,
  };
}

/**
 * The settings of one playlist: what it is called, who may see it and who may
 * change it. A §6 sub-page behind the playlist header's gear, gated on the
 * `can_manage` the backend worked out for this caller — the owner, an `admin`
 * member, or somebody who may moderate playlists.
 */
export default function PlaylistManage() {
  const { playlistId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();

  // The form's own copy of the three fields, seeded once from the playlist and
  // then left alone: `playlists.changed` refetches while somebody is typing,
  // and a name that rewrites itself mid-word is worse than a stale one.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);
  // What the fields held when they were seeded. The PATCH is the difference
  // against *this*, not against the latest answer from the server: if somebody
  // else renames the list while the page is open, a reader who only touched the
  // description must not send the name they never typed and undo the rename.
  const [base, setBase] = useState<Draft>(EMPTY);

  // Two notices, because the two halves of the page are a screen apart: saving
  // and deleting fail at the form up top, sharing fails at the "Add people"
  // search far below it, and a message about the row somebody just tapped has
  // to appear where they are looking.
  const [error, setError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const allowed = auth.loaded && auth.can("playlists.manage");
  const playlist = useQuery({
    ...getPlaylistOptions({ path: { playlist_id: playlistId } }),
    enabled: allowed && playlistId !== "",
  });
  const loaded = playlist.data;
  // The role has to hold the capability *and* the row has to allow it: the
  // backend decides the second and the page only reads its answer.
  const canManage = loaded !== undefined && allowed && loaded.can_manage;

  // A page kept mounted across a change of id (back and forward between two
  // lists) has to re-seed, so the id is what the draft is tagged with.
  if (loaded !== undefined && seeded !== loaded.id) {
    setSeeded(loaded.id);
    setName(loaded.name);
    setDescription(loaded.description ?? "");
    setIsGlobal(loaded.is_global);
    setBase(baseline(loaded));
    setError(null);
    setMemberError(null);
    setSaved(false);
  }

  const members = useQuery({
    // A `read` member may open this URL; the endpoint answers them 403, so it
    // is only asked once the playlist says the caller manages it.
    ...listPlaylistMembersOptions({ path: { playlist_id: playlistId } }),
    enabled: canManage,
  });

  const { search, setSearch, searching, suggestions, clear } =
    useUserLookup(canManage);

  const playlistKey = getPlaylistQueryKey({
    path: { playlist_id: playlistId },
  });
  const memberKey = listPlaylistMembersQueryKey({
    path: { playlist_id: playlistId },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: playlistKey });
    void queryClient.invalidateQueries({ queryKey: memberKey });
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
  };

  useWingmanEvent<PlaylistsChanged>("playlists.changed", (message) => {
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
    if (message.playlist_id === null || message.playlist_id === playlistId) {
      void queryClient.invalidateQueries({ queryKey: playlistKey });
      void queryClient.invalidateQueries({ queryKey: memberKey });
    }
  });

  const failed = (fallback: string) => (cause: unknown) => {
    setSaved(false);
    setError(errorMessage(cause, fallback));
  };

  /** The same, for what goes wrong down at the members. */
  const memberFailed = (fallback: string) => (cause: unknown) =>
    setMemberError(errorMessage(cause, fallback));

  const save = useMutation({
    ...updatePlaylistMutation(),
    onSuccess: (updated) => {
      // The server's own answer becomes both the fields and the new baseline:
      // the reader just pressed Save, so there is no half-typed word to lose,
      // and Save goes quiet again instead of offering to send the same thing.
      setName(updated.name);
      setDescription(updated.description ?? "");
      setIsGlobal(updated.is_global);
      setBase(baseline(updated));
      setError(null);
      setSaved(true);
      refresh();
    },
    onError: failed("Could not save the playlist."),
  });

  const setMember = useMutation({
    ...setPlaylistMemberMutation(),
    onSuccess: () => {
      setMemberError(null);
      clear();
      refresh();
    },
    onError: (cause) => {
      if (errorDetail(cause) === "already_owner")
        setMemberError("That account already owns this playlist.");
      else memberFailed("Could not share the playlist.")(cause);
    },
  });

  const dropMember = useMutation({
    ...removePlaylistMemberMutation(),
    onSuccess: () => {
      setMemberError(null);
      refresh();
    },
    onError: memberFailed("Could not take that person off the playlist."),
  });

  const remove = useMutation({
    ...deletePlaylistMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
      void navigate("/songs/playlists");
    },
    onError: failed("Could not delete the playlist."),
  });

  /** Only what the reader actually changed — a PATCH names nothing else. */
  const changes = (): PlaylistUpdate => {
    if (loaded === undefined) return {};
    const trimmed = name.trim();
    const text = description.trim();
    const body: PlaylistUpdate = {};
    if (trimmed !== base.name) body.name = trimmed;
    // An emptied field clears the description, and clearing needs the key to
    // be there: a missing one means "leave it alone".
    if (text !== base.description) body.description = text === "" ? null : text;
    if (isGlobal !== base.isGlobal) body.is_global = isGlobal;
    return body;
  };

  const pending = Object.keys(changes()).length > 0;
  const memberRows = members.data?.members ?? [];
  const named = new Set(memberRows.map((member) => member.user_id));
  // Somebody already on the list is not a suggestion — tapping them would
  // silently reset their access to `read`. The owner stays in: the backend
  // refuses that one with a message worth reading.
  const found = (suggestions.data?.users ?? []).filter(
    (user) => !named.has(user.id),
  );
  const busy = setMember.isPending || dropMember.isPending;

  return (
    <div className="playlists-page">
      <PageHeader
        title="Manage playlist"
        back={`/songs/playlists/${encodeURIComponent(playlistId)}`}
      />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && (
        <>
          {playlist.isPending && allowed && <Loading />}

          {playlist.isError && (
            <p className="error-notice playlists-notice" role="alert">
              This playlist is gone.{" "}
              <Link to="/songs/playlists">Back to the playlists</Link>
            </p>
          )}

          {!allowed && (
            <p className="settings-notice">
              Playlists are not open to your role. Log in or ask the host for
              access.
            </p>
          )}

          {loaded !== undefined && !canManage && (
            <p className="settings-notice">
              Only the owner of this playlist, somebody it was shared with as an
              admin, and accounts that may moderate playlists can change it.
            </p>
          )}

          {loaded !== undefined && canManage && (
            <>
              {error && (
                <p className="error-notice playlists-notice" role="alert">
                  {error}
                </p>
              )}

              <form
                className="playlist-manage-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() === "" || !pending) return;
                  setError(null);
                  save.mutate({
                    path: { playlist_id: playlistId },
                    body: changes(),
                  });
                }}
              >
                <label className="playlists-field">
                  <span>Name</span>
                  <input
                    className="text-input text-input-quiet"
                    value={name}
                    onChange={(event) => {
                      setSaved(false);
                      setName(event.target.value);
                    }}
                  />
                </label>
                <label className="playlists-field">
                  <span>Description</span>
                  <textarea
                    className="text-input text-input-quiet"
                    rows={2}
                    value={description}
                    onChange={(event) => {
                      setSaved(false);
                      setDescription(event.target.value);
                    }}
                  />
                </label>
                <label className="playlists-check">
                  <input
                    type="checkbox"
                    checked={isGlobal}
                    onChange={(event) => {
                      setSaved(false);
                      setIsGlobal(event.target.checked);
                    }}
                  />
                  <span>Global: everyone can see it</span>
                </label>
                <div className="playlist-manage-save">
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={name.trim() === "" || !pending || save.isPending}
                  >
                    Save
                  </button>
                  {/* An acknowledgement, not a state: the page stays where it
                      is after a save, so something has to say it happened. */}
                  {saved && (
                    <span className="playlist-manage-saved" role="status">
                      Saved
                    </span>
                  )}
                </div>
              </form>

              <h2 id="playlist-members">Members</h2>
              <p className="playlist-manage-hint">
                Read may look at the list, write may change its songs, and admin
                may also rename, share, and delete it.
              </p>

              <label className="playlists-field playlist-manage-search">
                <span>Add people</span>
                <input
                  className="text-input text-input-quiet"
                  type="search"
                  placeholder="Search by username"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              {/* Under the search, not up at the form: everything that can go
                  wrong here was started from a row down here. */}
              {memberError && (
                <p className="error-notice playlists-notice" role="alert">
                  {memberError}
                </p>
              )}

              {searching && (
                <>
                  {suggestions.isPending && <Loading />}
                  {suggestions.isError && (
                    <p className="error-notice playlists-notice" role="alert">
                      Could not search for accounts.
                    </p>
                  )}
                  {suggestions.isSuccess && found.length === 0 && (
                    <p className="playlist-manage-hint">
                      {/* The filter above eats matches that are already
                          members, and "no account matches that" would be a lie
                          about a name the reader can see on the list below. */}
                      {(suggestions.data?.users ?? []).length > 0
                        ? "Everybody matching that is already on the playlist."
                        : "No account matches that."}
                    </p>
                  )}
                  {found.length > 0 && (
                    <>
                      {/* Named, because the rows below are people rows too:
                          without the caption a search result and a member read
                          as one list, and the owner turns up in both. */}
                      <p
                        className="playlist-manage-caption"
                        id="playlist-matches"
                      >
                        Matching accounts
                      </p>
                      <ul
                        className="playlist-manage-people"
                        aria-labelledby="playlist-matches"
                      >
                        {found.map((user) => (
                          <li key={user.id}>
                            <div className="playlist-manage-row">
                              <PlayerAvatar
                                player={asPlayer(
                                  user.username,
                                  user.player_id,
                                  user.avatar_version,
                                )}
                              />
                              <span className="playlist-manage-name">
                                {user.username}
                              </span>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Share with ${user.username}`}
                                disabled={busy}
                                onClick={() => {
                                  setMemberError(null);
                                  setMember.mutate({
                                    path: { playlist_id: playlistId },
                                    body: {
                                      user_id: user.id,
                                      access: DEFAULT_ACCESS,
                                    },
                                  });
                                }}
                              >
                                <Icon name="user-plus" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}

              <ul
                className="playlist-manage-people"
                aria-labelledby="playlist-members"
              >
                {/* The owner heads the list and carries no controls: theirs is
                    not a member row, and nothing here hands a playlist over. */}
                <li>
                  <div className="playlist-manage-row">
                    <PlayerAvatar
                      player={asPlayer(
                        loaded.owner_username ?? "unknown",
                        loaded.owner_player_id,
                      )}
                    />
                    <span className="playlist-manage-name">
                      {loaded.owner_username ?? "unknown"}
                    </span>
                    <span className="playlist-manage-owner">owner</span>
                  </div>
                </li>
                {memberRows.map((member) => (
                  <li key={member.user_id}>
                    <div className="playlist-manage-row">
                      <PlayerAvatar
                        player={asPlayer(member.username, member.player_id)}
                      />
                      <span className="playlist-manage-name">
                        {member.username}
                      </span>
                      <select
                        className="text-input text-input-quiet"
                        aria-label={`Access of ${member.username}`}
                        value={member.access}
                        disabled={busy}
                        onChange={(event) => {
                          setMemberError(null);
                          setMember.mutate({
                            path: { playlist_id: playlistId },
                            body: {
                              user_id: member.user_id,
                              access: event.target
                                .value as PlaylistMemberRead["access"],
                            },
                          });
                        }}
                      >
                        {ACCESS.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="icon-button icon-button-danger"
                        aria-label={`Remove ${member.username}`}
                        disabled={busy}
                        onClick={() => {
                          setMemberError(null);
                          dropMember.mutate({
                            path: {
                              playlist_id: playlistId,
                              user_id: member.user_id,
                            },
                          });
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {members.isSuccess && memberRows.length === 0 && (
                <p className="playlist-manage-hint">
                  Nobody else is named on this playlist yet.
                </p>
              )}

              <div className="playlist-manage-delete">
                <button
                  type="button"
                  className="button button-danger"
                  disabled={remove.isPending}
                  onClick={() => setDeleting(true)}
                >
                  Delete playlist
                </button>
              </div>
            </>
          )}
        </>
      )}

      {deleting && loaded !== undefined && (
        <ConfirmModal
          title="Delete playlist"
          message={`Delete "${loaded.name}"? The list and everybody's access to it are gone. The songs themselves stay in the library.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setDeleting(false);
            remove.mutate({ path: { playlist_id: playlistId } });
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
