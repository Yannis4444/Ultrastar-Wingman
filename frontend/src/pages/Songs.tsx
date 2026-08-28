import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SongRead } from "../api";
import {
  listSongsOptions,
  listSongsQueryKey,
  rescanSongsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import AddSongsModal from "../components/AddSongsModal";
import { Icon, type IconName } from "../components/icons";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { shortTime } from "../duration";
import { errorMessage } from "../errors";
import { useDownloadEvents } from "../hooks/useDownloadEvents";
import { useFavorites } from "../hooks/useFavorites";
import { useRecentlyPlayed } from "../hooks/useRecentlyPlayed";
import { useSungSongs } from "../hooks/useSungSongs";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { SONG_SOURCES } from "../songSources";
import "./Songs.css";

/** The filters this page owns; playlists live on /songs/playlists. */
const ALL = "all";
const FAVORITES = "favorites";
const RECENT = "recent";
const SUNG = "sung";

/**
 * The clock time a song last started, on the recently-played tab only. The 24h
 * clock rather than "3 minutes ago": a party runs for one evening, so the time
 * is unambiguous, it matches the captions the scores already print, and it does
 * not need a timer ticking behind the list.
 */
function recentTime(
  filter: string,
  startedAt: Map<string, string>,
  songId: string,
): ReactNode {
  const at = startedAt.get(songId);
  if (filter !== RECENT || at === undefined) return null;
  return <span className="song-duration">{shortTime(at)}</span>;
}

/**
 * One filter chip. Only the pressed one spells its filter out; the others are
 * their glyph alone, named for a screen reader and for a hover. Four labelled
 * chips no longer fit a phone's width, and the label that earns the room is the
 * one saying which list the reader is looking at.
 */
function FilterChip({
  value,
  label,
  icon,
  iconClassName,
  filter,
  onSelect,
}: {
  value: string;
  label: string;
  icon: IconName;
  iconClassName?: string;
  filter: string;
  onSelect: (value: string) => void;
}) {
  const on = filter === value;
  return (
    <button
      type="button"
      className={on ? "songs-chip songs-chip-on" : "songs-chip songs-chip-icon"}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onSelect(value)}
    >
      <Icon name={icon} className={iconClassName} />
      {on && label}
    </button>
  );
}

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
  const recent = useRecentlyPlayed();
  const sung = useSungSongs();
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

  // Nothing sung yet (or the party is over) means no tab: an empty one nobody
  // in the room can fill is worse than none at all. It stays while the reader
  // is standing on it, though — a chip vanishing under the finger would leave
  // the page with no pressed filter and no way back.
  const showRecent = recent.songs.length > 0 || filter === RECENT;

  const all = songs.data?.songs;
  const needle = search.trim().toLowerCase();
  const base =
    filter === FAVORITES
      ? (all ?? []).filter((song) => favorites.ids.has(song.id))
      : filter === RECENT
        ? // Undefined while it loads, so the tab shows the skeleton instead of
          // claiming nothing has been sung.
          recent.isPending
          ? undefined
          : recent.songs
        : filter === SUNG
          ? // Same reason: an empty set while the history is in flight would
            // flash "you have not sung anything yet" over a full record.
            sung.isPending
            ? undefined
            : (all ?? []).filter((song) => sung.ids.has(song.id))
          : all;
  const shown = useMemo(
    () => (needle ? base?.filter((song) => matches(song, needle)) : base),
    [base, needle],
  );

  // `All` only earns its place next to another filter; on its own beside a link
  // it would be a chip that does nothing.
  const canFilter = favorites.available || showRecent || sung.available;
  const canBrowsePlaylists = auth.loaded && auth.can("playlists.view");
  // No source this role may search means nothing for the picker to offer.
  const canAddSongs = SONG_SOURCES.some((source) =>
    auth.can(source.capability),
  );

  return (
    /* One column for the whole page, so the sticky toolbar, the chips and the
       rows share a gutter on the desktop as they do on a phone. */
    <div className="songs-page">
      {/* The bottom nav already names the page; the heading stays for the
          document outline and for screen readers. */}
      <h1 className="visually-hidden">Songs</h1>
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
          {/* Only the chips that filter this page are the filter group; the
              playlists chip leaves it. */}
          {canFilter && (
            <div className="songs-filters" role="group" aria-label="Filter">
              {/* The one chip with no glyph of its own, so it keeps its label
                  whether it is pressed or not. */}
              <button
                type="button"
                className={
                  filter === ALL ? "songs-chip songs-chip-on" : "songs-chip"
                }
                aria-pressed={filter === ALL}
                onClick={() => setFilter(ALL)}
              >
                All
              </button>
              {favorites.available && (
                <FilterChip
                  value={FAVORITES}
                  label="Favorites"
                  icon="heart"
                  iconClassName="songs-chip-heart"
                  filter={filter}
                  onSelect={setFilter}
                />
              )}
              {showRecent && (
                <FilterChip
                  value={RECENT}
                  label="Recent"
                  icon="clock"
                  filter={filter}
                  onSelect={setFilter}
                />
              )}
              {sung.available && (
                <FilterChip
                  value={SUNG}
                  label="Sung"
                  icon="mic"
                  iconClassName="songs-chip-mic"
                  filter={filter}
                  onSelect={setFilter}
                />
              )}
            </div>
          )}
          {/* Icon only like the unpressed filters, and for the same reason —
              the `list` glyph beside them is unambiguous. */}
          {canBrowsePlaylists && (
            <Link
              to="/songs/playlists"
              className="songs-chip songs-chip-link"
              aria-label="Playlists"
              title="Playlists"
            >
              <Icon name="list" />
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

      {/* The recently-played tab has a list of its own, so it waits for that one. */}
      {(filter === RECENT ? recent.isPending : songs.isPending) && (
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
                  : filter === RECENT
                    ? "Nothing has been sung yet."
                    : filter === SUNG
                      ? "You have not sung anything yet. Songs you get a score on show up here."
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
                  sung={sung.ids.has(song.id)}
                  meta={recentTime(filter, recent.startedAt, song.id)}
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
    </div>
  );
}
