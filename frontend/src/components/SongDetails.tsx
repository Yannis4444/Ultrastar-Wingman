import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SongRead } from "../api";
import {
  addPlaylistEntryMutation,
  getPlaylistQueryKey,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { formatDuration } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import { useWishlist } from "../hooks/useWishlist";
import Modal from "./Modal";
import PlayerSelection from "./PlayerSelection";
import "./SongDetails.css";

interface SongDetailsProps {
  song: SongRead;
  onClose: () => void;
}

export default function SongDetails({ song, onClose }: SongDetailsProps) {
  const [selectingPlayers, setSelectingPlayers] = useState(false);
  const [playlistId, setPlaylistId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const wishlist = useWishlist();

  const canManagePlaylists = auth.user !== null && auth.can("playlists.manage");
  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: auth.loaded && canManagePlaylists,
  });
  const mine = (playlists.data?.playlists ?? []).filter((list) => list.mine);

  const addToPlaylist = useMutation({
    ...addPlaylistEntryMutation(),
    onSuccess: (_data, options) => {
      setNotice("Added to the playlist.");
      void queryClient.invalidateQueries({
        queryKey: getPlaylistQueryKey({
          path: { playlist_id: options.path.playlist_id },
        }),
      });
      // The list carries `song_count`, which the playlist dialog shows — without
      // this the count stays behind until something else refetches.
      void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
    },
    onError: (error) =>
      setNotice(
        errorDetail(error) === "duplicate_entry"
          ? "That playlist already has this song."
          : errorMessage(error, "Could not add the song to the playlist."),
      ),
  });

  const rows: [string, string | null][] = [
    ["Artist", song.artist],
    ["Duration", formatDuration(song.duration_seconds)],
    ["Video", song.has_video ? "yes" : "no"],
    ["Language", song.language],
    ["Genre", song.genre],
    ["Year", song.year === null ? null : String(song.year)],
    ["Edition", song.edition],
    ["Creator", song.creator],
    ["Source", song.source],
    ["ID", song.id],
  ];

  if (selectingPlayers) {
    return <PlayerSelection song={song} onClose={onClose} />;
  }

  const wished = wishlist.mine(song.id);

  return (
    <Modal title={song.title} onClose={onClose}>
      <dl className="song-details">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? "unknown"}</dd>
          </div>
        ))}
      </dl>

      {(notice || wishlist.error !== null) && (
        <p className="song-details-notice" role="alert">
          {notice ??
            errorMessage(
              wishlist.error,
              "Could not change your wish. Log in or ask the host for access.",
            )}
        </p>
      )}

      <div className="song-details-actions">
        {auth.can("karaoke.sing") && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => setSelectingPlayers(true)}
          >
            Sing
          </button>
        )}
        {auth.can("wishlist.add") && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setNotice(null);
              if (wished) wishlist.unwish(song.id);
              else wishlist.wish(song.id);
            }}
          >
            {wished ? "Remove wish" : "Wish"}
          </button>
        )}
      </div>

      {canManagePlaylists && mine.length > 0 && (
        <div className="song-details-playlist">
          <label>
            Add to playlist
            <select
              className="text-input"
              value={playlistId}
              onChange={(event) => setPlaylistId(event.target.value)}
            >
              <option value="">Choose a playlist…</option>
              {mine.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button"
            disabled={playlistId === "" || addToPlaylist.isPending}
            onClick={() => {
              setNotice(null);
              addToPlaylist.mutate({
                path: { playlist_id: playlistId },
                body: { song_id: song.id },
              });
            }}
          >
            Add
          </button>
        </div>
      )}
    </Modal>
  );
}
