import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PlaylistDetail, SongRead } from "../api";
import {
  addPlaylistEntryMutation,
  copyPlaylistMutation,
  followPlaylistMutation,
  getPlaylistOptions,
  getPlaylistQueryKey,
  listPlaylistsQueryKey,
  listSongsOptions,
  removePlaylistEntryMutation,
  reorderPlaylistEntriesMutation,
  unfollowPlaylistMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import Modal from "../components/Modal";
import PageHeader from "../components/PageHeader";
import PickerRow from "../components/PickerRow";
import SongCover from "../components/SongCover";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { formatTotalDuration } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import { useFavorites } from "../hooks/useFavorites";
import {
  useReorderFocus,
  type ReorderDirection,
} from "../hooks/useReorderFocus";
import { useSungSongs } from "../hooks/useSungSongs";
import { useTags } from "../hooks/useTags";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { markTags } from "../tags";
import "./Playlists.css";

interface PlaylistsChanged extends WingmanEvent {
  /** Null when several lists changed at once (an account was deleted). */
  playlist_id: string | null;
}

/** The same needle the songs page matches on. */
function matches(song: SongRead, needle: string): boolean {
  return (
    song.id === needle ||
    song.title.toLowerCase().includes(needle) ||
    song.artist.toLowerCase().includes(needle)
  );
}

/** The array with the item at `from` put at `to`. */
function moved(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

/**
 * "12 songs · 48 min · Global · shared by alice · read access" — everything the
 * header cannot say, in one line under it.
 */
function summary(playlist: PlaylistDetail): string {
  const count = playlist.song_count;
  const parts = [`${count} ${count === 1 ? "song" : "songs"}`];
  if (playlist.duration_seconds > 0)
    parts.push(formatTotalDuration(playlist.duration_seconds));
  if (playlist.is_global) parts.push("Global");
  if (playlist.my_access !== "owner" && playlist.owner_username !== null)
    parts.push(`shared by ${playlist.owner_username}`);
  if (playlist.my_access !== null && playlist.my_access !== "owner")
    parts.push(`${playlist.my_access} access`);
  return parts.join(" · ");
}

/** One playlist: its songs, and everything the reader may do with the list. */
export default function Playlist() {
  const { playlistId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const favorites = useFavorites();
  const sung = useSungSongs();
  const tags = useTags();
  const [selected, setSelected] = useState<SongRead | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The order being edited. Seeded when edit mode opens and left alone by
  // refetches until it closes: a list rearranging itself under a dragging
  // finger is worse than a moment of staleness.
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const rows = useRef<HTMLUListElement>(null);
  /** Where the dragged row currently sits — a ref, so a move does not re-render
   *  the pointer handler out from under the gesture. */
  const dragFrom = useRef<number | null>(null);
  // Router keeps the page mounted when only the id changes ("Save a copy" opens
  // the copy, back and forward walk between two lists), so everything about the
  // list being looked at has to be dropped by hand — an order of another list's
  // songs would show the new one half empty and save a permutation it refuses.
  const [shown, setShown] = useState(playlistId);
  if (shown !== playlistId) {
    setShown(playlistId);
    setOrder(null);
    setDragged(null);
    setAdding(false);
    setSearch("");
    setSelected(null);
    setError(null);
  }

  const allowed = auth.loaded && auth.can("playlists.view");
  const playlist = useQuery({
    ...getPlaylistOptions({ path: { playlist_id: playlistId } }),
    enabled: allowed && playlistId !== "",
  });

  const playlistKey = getPlaylistQueryKey({
    path: { playlist_id: playlistId },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: playlistKey });
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
  };

  useWingmanEvent<PlaylistsChanged>("playlists.changed", (message) => {
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
    if (message.playlist_id === null || message.playlist_id === playlistId)
      void queryClient.invalidateQueries({ queryKey: playlistKey });
  });

  const failed = (fallback: string) => (cause: unknown) =>
    setError(errorMessage(cause, fallback));
  const succeeded = () => {
    setError(null);
    refresh();
  };

  const addEntry = useMutation({
    ...addPlaylistEntryMutation(),
    onSuccess: succeeded,
    onError: (cause) => {
      // Already in there is what the tap wanted; the refetch shows the mark.
      if (errorDetail(cause) === "duplicate_entry") succeeded();
      else setError(errorMessage(cause, "Could not add the song."));
    },
  });
  const removeEntry = useMutation({
    ...removePlaylistEntryMutation(),
    onSuccess: succeeded,
    onError: failed("Could not remove the song."),
  });
  const reorder = useMutation({
    ...reorderPlaylistEntriesMutation(),
    onSuccess: succeeded,
    onError: failed("Could not save the new order."),
  });
  const follow = useMutation({
    ...followPlaylistMutation(),
    onSuccess: succeeded,
    onError: failed("Could not follow the playlist."),
  });
  const unfollow = useMutation({
    ...unfollowPlaylistMutation(),
    onSuccess: succeeded,
    onError: failed("Could not unfollow the playlist."),
  });
  const copy = useMutation({
    ...copyPlaylistMutation(),
    onSuccess: (created) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
      void navigate(`/songs/playlists/${encodeURIComponent(created.id)}`);
    },
    onError: failed("Could not copy the playlist."),
  });

  const library = useQuery({
    ...listSongsOptions(),
    enabled: adding && auth.loaded && auth.can("songs.view"),
  });

  const entries = playlist.data?.entries ?? [];
  const stored = entries.map((entry) => entry.song.id);
  const byId = new Map(entries.map((entry) => [entry.song.id, entry.song]));
  const editing = order !== null;
  const songs = editing
    ? order.flatMap((id) => {
        const song = byId.get(id);
        return song === undefined ? [] : [song];
      })
    : entries.map((entry) => entry.song);
  const holds = new Set(stored);

  // A move costs the reader their place — the row's own node moves and both its
  // arrows go `disabled` for the length of the request — so the keyboard goes
  // back onto the arrow it was pressed with. The achievements admin's reorder
  // mode does the same, out of the same hook.
  const focus = useReorderFocus(reorder.isPending, order ?? stored);

  // Who may do what: the backend worked it out from the owner, the caller's
  // member row and `playlists.moderate`, so the page only has to check that the
  // role still holds `playlists.manage` at all.
  const canEdit =
    playlist.data !== undefined &&
    auth.can("playlists.manage") &&
    playlist.data.can_edit;
  const canManage =
    playlist.data !== undefined &&
    auth.can("playlists.manage") &&
    playlist.data.can_manage;
  // Only a member row can be followed: an owner and a passer-by on a global
  // list have none, and the backend refuses both.
  const access = playlist.data?.my_access ?? null;
  const isMember =
    access === "read" || access === "write" || access === "admin";
  // A copy needs an account of its own to belong to.
  const canCopy = auth.user !== null && auth.can("playlists.manage");

  const save = (next: string[]) => {
    const previous = order ?? stored;
    setOrder(next);
    if (sameOrder(next, stored)) return;
    reorder.mutate(
      { path: { playlist_id: playlistId }, body: { song_ids: next } },
      // A refused move puts the rows back where the server still has them: the
      // notice says what went wrong, and the list must not go on claiming the
      // order it failed to save.
      { onError: () => setOrder(previous) },
    );
  };

  /** Take a song out from inside edit mode, and put it back if the server says no. */
  const drop = (song: SongRead) => {
    const previous = order ?? stored;
    setError(null);
    setOrder(previous.filter((id) => id !== song.id));
    removeEntry.mutate(
      { path: { playlist_id: playlistId, song_id: song.id } },
      { onError: () => setOrder(previous) },
    );
  };

  const step = (index: number, delta: number) => {
    if (order === null) return;
    const to = index + delta;
    if (to < 0 || to >= order.length) return;
    save(moved(order, index, to));
  };

  /** One of a reorder row's two arrows: the same button but for the way it
   *  moves the song and the end of the list it runs out at. Both remember
   *  themselves, so the keyboard comes back to the arrow the move was made
   *  with rather than being dropped at the top of the page. */
  const arrow = (
    song: SongRead,
    index: number,
    direction: ReorderDirection,
  ) => (
    <button
      type="button"
      ref={focus.register(song.id, direction)}
      aria-label={`Move ${song.title} ${direction}`}
      disabled={
        (direction === "up" ? index === 0 : index === songs.length - 1) ||
        reorder.isPending
      }
      onClick={() => {
        focus.press(song.id, direction);
        step(index, direction === "up" ? -1 : 1);
      }}
    >
      <Icon name={direction === "up" ? "arrow-up" : "arrow-down"} />
    </button>
  );

  /** Which row the pointer is over, so a drag needs no library. */
  const rowAt = (clientY: number): number | null => {
    const list = rows.current;
    if (list === null) return null;
    const children = [...list.children];
    if (children.length === 0) return null;
    const over = children.findIndex(
      (row) => clientY < row.getBoundingClientRect().bottom,
    );
    return over === -1 ? children.length - 1 : over;
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLSpanElement>,
    index: number,
  ) => {
    if (order === null) return;
    // Or the browser starts a text selection / scrolls the page instead.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = index;
    setDragged(order[index]);
  };

  const dragOver = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const from = dragFrom.current;
    if (from === null || order === null) return;
    const to = rowAt(event.clientY);
    if (to === null || to === from) return;
    dragFrom.current = to;
    setOrder(moved(order, from, to));
  };

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (dragFrom.current === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragFrom.current = null;
    setDragged(null);
    // One request for the whole gesture, not one per row it crossed.
    if (order !== null) save(order);
  };

  const toggleMembership = (song: SongRead) => {
    setError(null);
    if (holds.has(song.id)) {
      removeEntry.mutate({
        path: { playlist_id: playlistId, song_id: song.id },
      });
    } else {
      addEntry.mutate({
        path: { playlist_id: playlistId },
        body: { song_id: song.id },
      });
    }
  };

  /**
   * The one song the sub-view is busy with, so filling a playlist stays a run
   * of taps: locking every row for every round trip would make adding ten
   * songs ten waits.
   */
  const busySong = addEntry.isPending
    ? addEntry.variables.body.song_id
    : removeEntry.isPending
      ? removeEntry.variables.path.song_id
      : null;

  const needle = search.trim().toLowerCase();
  const found = (library.data?.songs ?? []).filter(
    (song) => needle === "" || matches(song, needle),
  );

  return (
    <div className="playlists-page page-foot">
      <PageHeader
        title={playlist.data?.name ?? "Playlist"}
        back="/songs/playlists"
      >
        {/* Only with something to pick from: an empty playlist would open a
            reel that can never spin. The gradient of the Random-song button
            rides on the glyph itself here — the way into the reel looks the
            same wherever it is offered. */}
        {playlist.isSuccess && songs.length > 0 && (
          <Link
            className="icon-button playlist-spin"
            to={`/songs/playlists/${encodeURIComponent(playlistId)}/spinner`}
            aria-label="Random song from this playlist"
            title="Random song from this playlist"
          >
            <Icon name="dice" gradient />
          </Link>
        )}
        {canManage && (
          <Link
            className="icon-button"
            to={`/songs/playlists/${encodeURIComponent(playlistId)}/manage`}
            aria-label="Manage playlist"
            title="Manage playlist"
          >
            <Icon name="gear" />
          </Link>
        )}
      </PageHeader>
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (allowed ? (
          <>
            {error && (
              <p className="error-notice playlists-notice" role="alert">
                {error}
              </p>
            )}

            {playlist.isPending && <Loading />}

            {playlist.isError && (
              <p className="error-notice playlists-notice" role="alert">
                This playlist is gone.{" "}
                <Link to="/songs/playlists">Back to the playlists</Link>
              </p>
            )}

            {playlist.isSuccess && (
              <>
                {playlist.data.description !== null && (
                  <p className="playlist-description">
                    {playlist.data.description}
                  </p>
                )}
                <p className="playlist-summary">{summary(playlist.data)}</p>

                {(canEdit || isMember) && (
                  <div className="playlist-actions">
                    {canEdit && (
                      <button
                        type="button"
                        className="icon-button icon-button-bordered"
                        aria-label="Add songs"
                        title="Add songs"
                        onClick={() => {
                          setError(null);
                          setAdding(true);
                        }}
                      >
                        <Icon name="list-plus" />
                      </button>
                    )}
                    {/* Nothing to reorder or take out of an empty list — the
                        same reason the dice waits for a first song. It stays
                        while edit mode is open, so emptying the list from
                        inside it still has a way out. */}
                    {canEdit && (songs.length > 0 || editing) && (
                      <button
                        type="button"
                        className="icon-button icon-button-bordered"
                        aria-pressed={editing}
                        aria-label={editing ? "Done" : "Edit"}
                        title={editing ? "Done" : "Edit"}
                        onClick={() => {
                          setError(null);
                          setOrder(editing ? null : stored);
                        }}
                      >
                        <Icon name="pencil" />
                      </button>
                    )}
                    {isMember && (
                      <button
                        type="button"
                        className="icon-button icon-button-bordered"
                        aria-label={
                          playlist.data.followed ? "Unfollow" : "Follow"
                        }
                        title={playlist.data.followed ? "Unfollow" : "Follow"}
                        disabled={follow.isPending || unfollow.isPending}
                        onClick={() => {
                          setError(null);
                          const path = { playlist_id: playlistId };
                          if (playlist.data.followed) unfollow.mutate({ path });
                          else follow.mutate({ path });
                        }}
                      >
                        <Icon
                          name={
                            playlist.data.followed ? "bookmark-off" : "bookmark"
                          }
                        />
                      </button>
                    )}
                  </div>
                )}

                {songs.length === 0 ? (
                  <EmptyState icon="list" title="No songs yet">
                    {canEdit
                      ? "Add songs here, or from a song's details."
                      : undefined}
                  </EmptyState>
                ) : order !== null ? (
                  <ul className="playlist-reorder" ref={rows}>
                    {songs.map((song, index) => (
                      <li
                        key={song.id}
                        className={
                          dragged === song.id
                            ? "playlist-reorder-row playlist-reorder-dragged"
                            : "playlist-reorder-row"
                        }
                      >
                        {/* The same row as outside edit mode — marks, cover and
                            all — with a grip in front and the controls behind
                            it, so nothing about a song moves but the song. */}
                        <SongListItem
                          song={song}
                          favorite={favorites.ids.has(song.id)}
                          sung={sung.ids.has(song.id)}
                          tags={markTags(tags.bySong.get(song.id))}
                          builtIns={tags.builtIns}
                          onClick={() => setSelected(song)}
                          leading={
                            /* A grip, not a control: the same reordering is on
                               the two arrows beside it, which is where a
                               keyboard reader does it. A focusable handle would
                               only put a third stop in every row that does
                               nothing on Enter. */
                            <span
                              className="playlist-drag"
                              aria-hidden="true"
                              onPointerDown={(event) => startDrag(event, index)}
                              onPointerMove={dragOver}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                            >
                              <Icon name="drag-handle" />
                            </span>
                          }
                          actions={
                            <>
                              {arrow(song, index, "up")}
                              {arrow(song, index, "down")}
                              <button
                                type="button"
                                aria-label={`Remove ${song.title} from the playlist`}
                                disabled={removeEntry.isPending}
                                onClick={() => drop(song)}
                              >
                                <Icon name="close" />
                              </button>
                            </>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="playlist-songs">
                    {songs.map((song) => (
                      <SongListItem
                        key={song.id}
                        song={song}
                        favorite={favorites.ids.has(song.id)}
                        sung={sung.ids.has(song.id)}
                        tags={markTags(tags.bySong.get(song.id))}
                        builtIns={tags.builtIns}
                        onClick={() => setSelected(song)}
                      />
                    ))}
                  </div>
                )}

                {canCopy && (
                  /* A text row at the foot, never a fourth icon: taking a copy
                     is a thing you do once, not a control of the list. */
                  <button
                    type="button"
                    className="playlist-copy"
                    disabled={copy.isPending}
                    onClick={() => {
                      setError(null);
                      // No body: the copy keeps the default name.
                      copy.mutate({ path: { playlist_id: playlistId } });
                    }}
                  >
                    <Icon name="copy" className="playlist-copy-icon" />
                    <span>Save a copy</span>
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <p className="settings-notice">
            Playlists are not open to you. Log in or ask the host for access.
          </p>
        ))}

      {adding && (
        /* A sub-view in the song modal's idiom: the close button is the way
           back to the playlist. */
        <Modal title="Add songs" bare onClose={() => setAdding(false)}>
          <input
            className="text-input text-input-quiet playlist-add-search"
            aria-label="Search songs"
            placeholder="Search songs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {library.isLoading && <Loading />}
          <ul className="picker-list">
            {/* Every match, the way the songs page lists its own library: a
                cap would only hide the song somebody came here to add. */}
            {found.map((song) => (
              <PickerRow
                key={song.id}
                lead={<SongCover song={song} />}
                title={song.title}
                meta={song.artist}
                pressed={holds.has(song.id)}
                disabled={busySong === song.id}
                onClick={() => toggleMembership(song)}
              />
            ))}
          </ul>
          {library.isSuccess && found.length === 0 && (
            /* An empty library is not a search that found nothing: saying "no
               song matches that" about a search nobody typed sends the reader
               looking for a spelling mistake. The songs page owns the how-to
               (scan, or add from a source); here the state is enough. */
            <p className="playlist-add-more">
              {(library.data?.songs ?? []).length === 0
                ? "The library is empty. There is nothing to add yet."
                : "No song matches that."}
            </p>
          )}
          {error && (
            <p className="error-notice playlists-notice" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
