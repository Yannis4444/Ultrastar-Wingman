import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SongRead } from "../api";
import {
  listSongsOptions,
  listSongsQueryKey,
  rescanSongsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import AddSongsModal from "../components/AddSongsModal";
import { Icon } from "../components/icons";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { errorMessage } from "../errors";
import { useDownloadEvents } from "../hooks/useDownloadEvents";
import { useFavorites } from "../hooks/useFavorites";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { useWishlist } from "../hooks/useWishlist";
import { SONG_SOURCES } from "../songSources";
import "./Songs.css";

/** The two filters this page still owns; playlists live on /songs/playlists. */
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
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingSongs, setAddingSongs] = useState(false);

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
  const base =
    filter === FAVORITES
      ? (all ?? []).filter((song) => favorites.ids.has(song.id))
      : all;
  const shown = useMemo(
    () => (needle ? base?.filter((song) => matches(song, needle)) : base),
    [base, needle],
  );

  const chip = (value: string): string =>
    filter === value ? "songs-chip songs-chip-on" : "songs-chip";

  // `All` only earns its place next to `Favorites`; on its own beside a link it
  // would be a chip that does nothing.
  const canFilter = favorites.available;
  const canBrowsePlaylists = auth.loaded && auth.can("playlists.view");
  // No source this role may search means nothing for the picker to offer.
  const canAddSongs = SONG_SOURCES.some((source) =>
    auth.can(source.capability),
  );

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
      </div>

      {(canFilter || canBrowsePlaylists) && (
        <div className="songs-chips">
          {/* Only the two chips that filter this page are the filter group; the
              playlists chip leaves it. */}
          {canFilter && (
            <div className="songs-filters" role="group" aria-label="Filter">
              <button
                type="button"
                className={chip(ALL)}
                aria-pressed={filter === ALL}
                onClick={() => setFilter(ALL)}
              >
                All
              </button>
              <button
                type="button"
                className={chip(FAVORITES)}
                aria-pressed={filter === FAVORITES}
                onClick={() => setFilter(FAVORITES)}
              >
                <Icon name="heart" className="songs-chip-heart" />
                Favorites
              </button>
            </div>
          )}
          {canBrowsePlaylists && (
            <Link to="/songs/playlists" className="songs-chip songs-chip-link">
              <Icon name="list" />
              Playlists
            </Link>
          )}
        </div>
      )}

      {/* What the library holds and the two ways to change it. Outside the list
          branch on purpose: adding songs is exactly what an empty or unreadable
          library calls for. */}
      <div className="songs-count">
        {shown && (
          <span>
            {shown.length} {shown.length === 1 ? "song" : "songs"}
          </span>
        )}
        {auth.can("songs.rescan") && (
          <button
            type="button"
            className="icon-button songs-count-reload"
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
        {canAddSongs && (
          <button
            type="button"
            className="icon-button icon-button-bordered songs-add"
            aria-label="Add songs"
            title="Add songs from an online source"
            onClick={() => setAddingSongs(true)}
          >
            <Icon name="plus" />
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

      {songs.isError && (
        <p className="songs-notice songs-notice-error" role="alert">
          Could not load the song library.{" "}
          <button type="button" onClick={() => void songs.refetch()}>
            Retry
          </button>
        </p>
      )}

      {shown && (
        <>
          {shown.length === 0 ? (
            <p className="songs-notice">
              {needle
                ? `No song matches "${search.trim()}".`
                : filter === FAVORITES
                  ? "No favorites yet. Open a song and tap the heart."
                  : canAddSongs
                    ? "The library is empty. Add songs from an online source, or run a rescan once they are on disk."
                    : "The library is empty. Run a rescan once songs are on disk."}
            </p>
          ) : (
            <div className="songs-list">
              {shown.map((song) => (
                <SongListItem
                  key={song.id}
                  song={song}
                  favorite={favorites.ids.has(song.id)}
                  wished={wishlist.mine(song.id)}
                  onClick={() => setSelected(song)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}

      {addingSongs && <AddSongsModal onClose={() => setAddingSongs(false)} />}
    </>
  );
}
