import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SongRead } from "../api";
import {
  addPlaylistEntryMutation,
  getPlaylistQueryKey,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
  listSongScoresOptions,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { formatDuration } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import { useFavorites } from "../hooks/useFavorites";
import { useWishlist } from "../hooks/useWishlist";
import { Icon, type IconName } from "./icons";
import Modal from "./Modal";
import PlayerSelection from "./PlayerSelection";
import SongCover from "./SongCover";
import "./SongDetails.css";

interface SongDetailsProps {
  song: SongRead;
  onClose: () => void;
}

export default function SongDetails({ song, onClose }: SongDetailsProps) {
  const [selectingPlayers, setSelectingPlayers] = useState(false);
  const [playlistId, setPlaylistId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // There is no has_audio flag; the preview 404s for songs without audio and
  // the element's error event is the only signal.
  const [noAudio, setNoAudio] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const wishlist = useWishlist();
  const favorites = useFavorites();

  const canManagePlaylists = auth.user !== null && auth.can("playlists.manage");
  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: auth.loaded && canManagePlaylists,
  });
  const mine = (playlists.data?.playlists ?? []).filter((list) => list.mine);

  // All-time and newest first, so the top five need sorting here.
  const songScores = useQuery({
    ...listSongScoresOptions({ path: { song_id: song.id } }),
    enabled: auth.loaded && auth.can("stats.view"),
  });
  const best = [...(songScores.data?.scores ?? [])]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

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

  const rows: { icon: IconName; label: string; value: string | null }[] = [
    {
      icon: "clock",
      label: "Duration",
      value: formatDuration(song.duration_seconds),
    },
    { icon: "mic", label: "Artist", value: song.artist },
    {
      icon: "video",
      label: "Video",
      value: song.has_video ? "Video" : "No video",
    },
    { icon: "globe", label: "Language", value: song.language },
    { icon: "tag", label: "Genre", value: song.genre },
    {
      icon: "calendar",
      label: "Year",
      value: song.year === null ? null : String(song.year),
    },
    { icon: "disc", label: "Edition", value: song.edition },
    { icon: "user", label: "Creator", value: song.creator },
    // The id already names the source ("usdb:24435"), so one row covers both.
    { icon: "database", label: "Source", value: song.id },
  ];

  if (selectingPlayers) {
    return <PlayerSelection song={song} onClose={onClose} />;
  }

  const wished = wishlist.mine(song.id);
  const favorite = favorites.ids.has(song.id);
  const hasControls =
    favorites.available || auth.can("karaoke.sing") || auth.can("wishlist.add");

  return (
    <Modal title={song.title} hideTitle onClose={onClose}>
      <div className="song-hero">
        <SongCover song={song} className="song-hero-cover" />
        <h3 className="song-hero-title">{song.title}</h3>
        <p className="song-hero-artist">{song.artist}</p>
      </div>

      {!noAudio && (
        <audio
          className="song-preview"
          controls
          preload="metadata"
          src={`/api/v1/songs/${encodeURIComponent(song.id)}/audio`}
          onError={() => setNoAudio(true)}
        />
      )}

      {hasControls && (
        <div className="song-details-controls">
          {favorites.available && (
            <button
              type="button"
              className={
                favorite
                  ? "song-control song-control-favorite song-control-favorite-on"
                  : "song-control song-control-favorite"
              }
              aria-pressed={favorite}
              aria-label={
                favorite ? "Remove from favorites" : "Add to favorites"
              }
              onClick={() => favorites.toggle(song.id)}
            >
              <Icon name="heart" />
            </button>
          )}
          {auth.can("karaoke.sing") && (
            <button
              type="button"
              className="song-control song-control-sing"
              aria-label="Sing"
              onClick={() => setSelectingPlayers(true)}
            >
              <Icon name="play" />
            </button>
          )}
          {auth.can("wishlist.add") && (
            <button
              type="button"
              className={
                wished
                  ? "song-control song-control-wish song-control-wish-on"
                  : "song-control song-control-wish"
              }
              aria-pressed={wished}
              aria-label={wished ? "Remove wish" : "Wish"}
              onClick={() => {
                setNotice(null);
                if (wished) wishlist.unwish(song.id);
                else wishlist.wish(song.id);
              }}
            >
              <Icon name={wished ? "check" : "plus"} />
            </button>
          )}
        </div>
      )}

      {(notice || wishlist.error !== null) && (
        <p className="song-details-notice" role="alert">
          {notice ??
            errorMessage(
              wishlist.error,
              "Could not change your wish. Log in or ask the host for access.",
            )}
        </p>
      )}

      <button
        type="button"
        className="song-details-toggle"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen(!detailsOpen)}
      >
        <span>Details</span>
        <Icon
          name="chevron-down"
          className={detailsOpen ? "song-chevron-open" : undefined}
        />
      </button>
      {/* Always in the DOM: `hidden` keeps the metadata findable (search,
          screen-reader "show all") without conditional rendering. */}
      <ul className="song-details-list" hidden={!detailsOpen}>
        {rows.map(({ icon, label, value }) => (
          <li key={label} title={label}>
            <Icon name={icon} />
            <span>{value ?? "unknown"}</span>
          </li>
        ))}
      </ul>

      {best.length > 0 && (
        <div className="song-details-best">
          <h3>Best scores</h3>
          <ol>
            {best.map((score) => (
              <li key={score.id}>
                <span>{score.player_name}</span>
                <span>{score.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

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
