import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SongRead } from "../api";
import {
  getPlaylistOptions,
  getPlaylistQueryKey,
  listPlaylistsQueryKey,
  listPlaylistsOptions,
  listSongsOptions,
  listSongsQueryKey,
  removePlaylistEntryMutation,
  reorderPlaylistEntriesMutation,
  rescanSongsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import PlaylistsModal from "../components/PlaylistsModal";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { errorMessage } from "../errors";
import { useDownloadEvents } from "../hooks/useDownloadEvents";
import { useFavorites } from "../hooks/useFavorites";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Songs.css";

/** Reserved filter values; every other one is a playlist id (uuid4 hex). */
const ALL = "all";
const FAVORITES = "favorites";

function matches(song: SongRead, needle: string): boolean {
  return (
    song.id === needle ||
    song.title.toLowerCase().includes(needle) ||
    song.artist.toLowerCase().includes(needle)
  );
}

export default function Songs() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const favorites = useFavorites();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(ALL);
  const [selected, setSelected] = useState<SongRead | null>(null);
  const [managing, setManaging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const songs = useQuery(listSongsOptions());
  const rescan = useMutation({
    ...rescanSongsMutation(),
    onSuccess: () => {
      setScanning(true);
      setNotice(null);
    },
    onError: (error) =>
      setNotice(
        error?.status === "running"
          ? "A scan is already running."
          : errorMessage(error, "Could not start the scan."),
      ),
  });

  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: auth.loaded && auth.can("playlists.view"),
  });
  const inPlaylist = filter !== ALL && filter !== FAVORITES;
  // Keyed by the playlist the request was for, not by the chip that happens to
  // be selected when the answer arrives.
  const playlistKey = (playlistId: string) =>
    getPlaylistQueryKey({ path: { playlist_id: playlistId } });
  const playlist = useQuery({
    ...getPlaylistOptions({ path: { playlist_id: filter } }),
    enabled: inPlaylist,
  });
  const entryIds = (playlist.data?.entries ?? []).map((entry) => entry.song.id);
  // The owner edits the order; an administrator may fix anybody's playlist.
  const editable =
    playlist.data !== undefined &&
    (playlist.data.mine || auth.role === "admin");

  // The reorder answers with the whole playlist, so the cache takes the
  // response instead of refetching.
  const reorder = useMutation({
    ...reorderPlaylistEntriesMutation(),
    onSuccess: (data, options) =>
      queryClient.setQueryData(playlistKey(options.path.playlist_id), data),
    onError: (error) =>
      setNotice(errorMessage(error, "Could not reorder the playlist.")),
  });
  const removeEntry = useMutation({
    ...removePlaylistEntryMutation(),
    onSuccess: (_data, options) => {
      void queryClient.invalidateQueries({
        queryKey: playlistKey(options.path.playlist_id),
      });
      void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
    },
    onError: (error) =>
      setNotice(errorMessage(error, "Could not remove the song.")),
  });

  // A finished download refetches the list — no rescan needed for a new song.
  useDownloadEvents();

  useWingmanEvent("songs.scan_started", () => {
    setScanning(true);
    setNotice(null);
  });
  useWingmanEvent("songs.scan_finished", () => {
    setScanning(false);
    void queryClient.invalidateQueries({ queryKey: listSongsQueryKey() });
  });

  const move = (songId: string, delta: number): void => {
    const order = [...entryIds];
    const from = order.indexOf(songId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    setNotice(null);
    reorder.mutate({
      path: { playlist_id: filter },
      body: { song_ids: order },
    });
  };

  const all = songs.data?.songs;
  const needle = search.trim().toLowerCase();
  const base = inPlaylist
    ? playlist.data?.entries.map((entry) => entry.song)
    : filter === FAVORITES
      ? (all ?? []).filter((song) => favorites.ids.has(song.id))
      : all;
  const shown = useMemo(
    () => (needle ? base?.filter((song) => matches(song, needle)) : base),
    [base, needle],
  );

  const chip = (value: string): string =>
    filter === value ? "songs-chip songs-chip-on" : "songs-chip";

  return (
    <>
      <h1>Songs</h1>
      <div className="songs-toolbar">
        <input
          type="search"
          value={search}
          placeholder="Search title, artist or id"
          aria-label="Search songs"
          onChange={(event) => setSearch(event.target.value)}
        />
        {auth.can("songs.rescan") && (
          <button
            type="button"
            className="songs-rescan"
            disabled={scanning || rescan.isPending}
            onClick={() => rescan.mutate({})}
          >
            {scanning ? "Scanning…" : "Rescan"}
          </button>
        )}
        {auth.can("usdb.search") && (
          <Link to="/usdb" className="songs-rescan songs-explore">
            Explore USDB
          </Link>
        )}
      </div>

      <div className="songs-chips">
        <button
          type="button"
          className={chip(ALL)}
          onClick={() => setFilter(ALL)}
        >
          All
        </button>
        {favorites.available && (
          <button
            type="button"
            className={chip(FAVORITES)}
            onClick={() => setFilter(FAVORITES)}
          >
            ♥ Favorites
          </button>
        )}
        {(playlists.data?.playlists ?? []).map((list) => (
          <button
            key={list.id}
            type="button"
            className={chip(list.id)}
            onClick={() => setFilter(list.id)}
          >
            {list.name}
            {list.shared && (
              <span className="songs-chip-shared">
                {list.mine ? "shared" : (list.owner_username ?? "shared")}
              </span>
            )}
          </button>
        ))}
        {auth.user !== null && auth.can("playlists.manage") && (
          <button
            type="button"
            className="songs-chip songs-chip-manage"
            onClick={() => setManaging(true)}
          >
            Playlists…
          </button>
        )}
      </div>

      {notice && <p className="songs-notice songs-notice-error">{notice}</p>}

      {songs.isPending && (
        <div className="songs-skeleton" aria-label="Loading songs">
          {[0, 1, 2, 3, 4].map((row) => (
            <span key={row} />
          ))}
        </div>
      )}

      {(songs.isError || playlist.isError) && (
        <p className="songs-notice songs-notice-error" role="alert">
          {playlist.isError
            ? "This playlist is gone."
            : "Could not load the song library."}{" "}
          <button
            type="button"
            onClick={() =>
              playlist.isError ? setFilter(ALL) : void songs.refetch()
            }
          >
            {playlist.isError ? "Show all songs" : "Retry"}
          </button>
        </p>
      )}

      {shown && (
        <>
          <p className="songs-count">
            {shown.length} {shown.length === 1 ? "song" : "songs"}
          </p>
          {shown.length === 0 ? (
            <p className="songs-notice">
              {needle
                ? `No song matches "${search.trim()}".`
                : filter === FAVORITES
                  ? "No favorites yet. Tap the heart next to a song."
                  : inPlaylist
                    ? "This playlist is empty. Add songs from a song's details."
                    : "The library is empty. Run a rescan once songs are on disk."}
            </p>
          ) : (
            <div className="songs-list">
              {shown.map((song) => {
                const position = entryIds.indexOf(song.id);
                return (
                  <SongListItem
                    key={song.id}
                    song={song}
                    onClick={() => setSelected(song)}
                    actions={
                      (favorites.available || (inPlaylist && editable)) && (
                        <>
                          {favorites.available && (
                            <button
                              type="button"
                              className={
                                favorites.ids.has(song.id)
                                  ? "song-favorite-on"
                                  : undefined
                              }
                              aria-label={
                                favorites.ids.has(song.id)
                                  ? `Remove ${song.title} from favorites`
                                  : `Add ${song.title} to favorites`
                              }
                              onClick={() => favorites.toggle(song.id)}
                            >
                              {favorites.ids.has(song.id) ? "♥" : "♡"}
                            </button>
                          )}
                          {inPlaylist && editable && (
                            <>
                              <button
                                type="button"
                                aria-label={`Move ${song.title} up`}
                                disabled={position <= 0 || reorder.isPending}
                                onClick={() => move(song.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${song.title} down`}
                                disabled={
                                  position < 0 ||
                                  position >= entryIds.length - 1 ||
                                  reorder.isPending
                                }
                                onClick={() => move(song.id, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${song.title} from the playlist`}
                                onClick={() =>
                                  removeEntry.mutate({
                                    path: {
                                      playlist_id: filter,
                                      song_id: song.id,
                                    },
                                  })
                                }
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </>
                      )
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}

      {managing && (
        <PlaylistsModal
          onClose={() => setManaging(false)}
          onDeleted={(playlistId) => {
            if (filter === playlistId) setFilter(ALL);
          }}
        />
      )}
    </>
  );
}
