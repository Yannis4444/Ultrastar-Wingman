import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { SongRead } from "../api";
import {
  listSongsOptions,
  listSongsQueryKey,
  rescanSongsMutation,
} from "../api/@tanstack/react-query.gen";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Songs.css";

function matches(song: SongRead, needle: string): boolean {
  return (
    song.id === needle ||
    song.title.toLowerCase().includes(needle) ||
    song.artist.toLowerCase().includes(needle)
  );
}

export default function Songs() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SongRead | null>(null);
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
          : "Could not start the scan.",
      ),
  });

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
  const shown = useMemo(
    () => (needle ? (all ?? []).filter((song) => matches(song, needle)) : all),
    [all, needle],
  );

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
        <button
          type="button"
          className="songs-rescan"
          disabled={scanning || rescan.isPending}
          onClick={() => rescan.mutate({})}
        >
          {scanning ? "Scanning…" : "Rescan"}
        </button>
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
          <p className="songs-count">
            {shown.length} {shown.length === 1 ? "song" : "songs"}
          </p>
          {shown.length === 0 ? (
            <p className="songs-notice">
              {needle
                ? `No song matches "${search.trim()}".`
                : "The library is empty. Run a rescan once songs are on disk."}
            </p>
          ) : (
            <div className="songs-list">
              {shown.map((song) => (
                <SongListItem
                  key={song.id}
                  song={song}
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
    </>
  );
}
