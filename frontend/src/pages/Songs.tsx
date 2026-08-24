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
  rescanSongsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { Icon } from "../components/icons";
import PlaylistsModal from "../components/PlaylistsModal";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { errorMessage } from "../errors";
import { useDownloadEvents } from "../hooks/useDownloadEvents";
import { useFavorites } from "../hooks/useFavorites";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { useWishlist } from "../hooks/useWishlist";
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
  const wishlist = useWishlist();
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
  // The owner edits the playlist; an administrator may fix anybody's.
  const editable =
    playlist.data !== undefined &&
    (playlist.data.mine || auth.role === "admin");

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

  const canManage = auth.user !== null && auth.can("playlists.manage");
  // A guest with nothing to filter by gets no chip row: a lone, already
  // selected "All" chip is dead weight on a phone.
  const hasFilters =
    favorites.available ||
    (playlists.data?.playlists ?? []).length > 0 ||
    canManage;

  return (
    <>
      <h1>Songs</h1>
      <div className="songs-toolbar">
        <label className="songs-search">
          <Icon name="search" />
          <input
            type="search"
            value={search}
            placeholder="Search songs"
            aria-label="Search songs"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {auth.can("songs.rescan") && (
          <button
            type="button"
            className="icon-button icon-button-bordered songs-tool"
            disabled={scanning || rescan.isPending}
            aria-label={scanning ? "Scanning…" : "Rescan"}
            title={scanning ? "Scanning…" : "Rescan the library"}
            onClick={() => rescan.mutate({})}
          >
            <Icon
              name="refresh"
              className={scanning ? "songs-tool-spin" : undefined}
            />
          </button>
        )}
        {auth.can("usdb.search") && (
          <Link
            to="/usdb"
            className="icon-button icon-button-bordered songs-tool"
            aria-label="Explore USDB"
            title="Explore USDB"
          >
            <Icon name="search" />
          </Link>
        )}
      </div>

      {hasFilters && (
        <div className="songs-chips" role="group" aria-label="Filter">
          <button
            type="button"
            className={chip(ALL)}
            aria-pressed={filter === ALL}
            onClick={() => setFilter(ALL)}
          >
            All
          </button>
          {favorites.available && (
            <button
              type="button"
              className={chip(FAVORITES)}
              aria-pressed={filter === FAVORITES}
              onClick={() => setFilter(FAVORITES)}
            >
              <Icon name="heart" className="songs-chip-heart" />
              Favorites
            </button>
          )}
          {(playlists.data?.playlists ?? []).map((list) => (
            <button
              key={list.id}
              type="button"
              className={chip(list.id)}
              aria-pressed={filter === list.id}
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
          {canManage && (
            <button
              type="button"
              className="songs-chip songs-chip-manage"
              onClick={() => setManaging(true)}
            >
              Playlists…
            </button>
          )}
        </div>
      )}

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
                  ? "No favorites yet. Open a song and tap the heart."
                  : inPlaylist
                    ? "This playlist is empty. Add songs from a song's details."
                    : "The library is empty. Run a rescan once songs are on disk."}
            </p>
          ) : (
            <div className="songs-list">
              {shown.map((song) => {
                return (
                  <SongListItem
                    key={song.id}
                    song={song}
                    favorite={favorites.ids.has(song.id)}
                    wished={wishlist.mine(song.id)}
                    onClick={() => setSelected(song)}
                    actions={
                      inPlaylist &&
                      editable && (
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
                          <Icon name="close" />
                        </button>
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
