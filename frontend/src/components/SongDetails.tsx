import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import type { SongRead } from "../api";
import {
  addPlaylistEntryMutation,
  getPlaylistOptions,
  getPlaylistQueryKey,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
  listPlayersOptions,
  listSongScoresOptions,
  removePlaylistEntryMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail, errorMessage } from "../errors";
import { useFavorites } from "../hooks/useFavorites";
import { useWishlist } from "../hooks/useWishlist";
import { songHistory } from "../stats";
import IconStat from "./IconStat";
import { Icon, type IconName } from "./icons";
import Modal from "./Modal";
import PlayerSelection from "./PlayerSelection";
import RankedScoreList from "./RankedScoreList";
import SongCover from "./SongCover";
// The control row is shared with the Home stage.
import "./SongControls.css";
import "./SongDetails.css";

interface SongDetailsProps {
  song: SongRead;
  onClose: () => void;
  /**
   * Which view the modal opens on. Currently Playing's playlist button jumps
   * straight into the picker instead of making the user find the option row.
   */
  initialView?: "main" | "playlists";
}

/** How many all-time scores the best-scores view lists. */
const BEST_SCORES = 10;

export default function SongDetails({
  song,
  onClose,
  initialView = "main",
}: SongDetailsProps) {
  const [selectingPlayers, setSelectingPlayers] = useState(false);
  // Sub-views swap the modal content; closing them returns to the song.
  const [view, setView] = useState<"main" | "scores" | "playlists">(
    initialView,
  );
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

  // Which of my playlists already hold this song — the picker's check marks.
  // Fetched only once the picker opens; a handful of small requests.
  const memberships = useQueries({
    queries: mine.map((list) => ({
      ...getPlaylistOptions({ path: { playlist_id: list.id } }),
      enabled: view === "playlists",
    })),
  });
  const containing = new Set(
    memberships.flatMap((query) =>
      query.data?.entries.some((entry) => entry.song.id === song.id)
        ? [query.data.id]
        : [],
    ),
  );

  // All-time and newest first, so the top of the list needs sorting here.
  const songScores = useQuery({
    ...listSongScoresOptions({ path: { song_id: song.id } }),
    enabled: auth.loaded && auth.can("stats.view"),
  });
  const allScores = songScores.data?.scores ?? [];
  const ranked = [...allScores].sort((a, b) => b.score - a.score);
  const best = ranked.slice(0, BEST_SCORES);
  // The whole history, not the listed ten: the summary describes the song.
  const history = songHistory(allScores);

  // Only for the avatars in the ranking, so it waits for the sub-view. A singer
  // without a player record — a guest, a deleted player, or a caller who may
  // not list players at all — still gets the initial `PlayerAvatar` draws.
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && auth.can("players.view") && view === "scores",
  });
  const players = new Map(
    (playerList.data?.players ?? []).map((player) => [player.id, player]),
  );

  // Both directions refetch the playlist (the check mark) and the list
  // (`song_count`, which the playlist dialog shows).
  const refreshPlaylist = (playlistId: string): void => {
    void queryClient.invalidateQueries({
      queryKey: getPlaylistQueryKey({ path: { playlist_id: playlistId } }),
    });
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
  };

  const addToPlaylist = useMutation({
    ...addPlaylistEntryMutation(),
    onSuccess: (_data, options) => refreshPlaylist(options.path.playlist_id),
    onError: (error, options) => {
      if (errorDetail(error) === "duplicate_entry") {
        // Already in there is what the tap wanted; the refetch shows the check.
        refreshPlaylist(options.path.playlist_id);
        return;
      }
      setNotice(errorMessage(error, "Could not add the song to the playlist."));
    },
  });

  const removeFromPlaylist = useMutation({
    ...removePlaylistEntryMutation(),
    onSuccess: (_data, options) => refreshPlaylist(options.path.playlist_id),
    onError: (error) =>
      setNotice(errorMessage(error, "Could not remove the song.")),
  });

  // Duration lives in the preview player and artist in the hero, so the
  // details keep only what the modal does not show anyway.
  const rows: { icon: IconName; label: string; value: string | null }[] = [
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

  if (view === "scores") {
    return (
      <Modal title="Best scores" bare onClose={() => setView("main")}>
        {/* The song's whole history in the scores page's idiom, so the ranking
            below has something to be read against. The best and worst singers
            are left out of it: rank 1 names one of them one row further down. */}
        {history !== null && (
          <p className="song-scores-stats">
            <IconStat icon="hash" label="Times sung" value={history.sings} />
            <IconStat icon="arrow-up" label="Best" value={history.best} />
            <IconStat icon="arrow-down" label="Worst" value={history.worst} />
            <IconStat icon="average" label="Average" value={history.average} />
          </p>
        )}
        <RankedScoreList scores={best} players={players} label="Best scores" />
      </Modal>
    );
  }

  if (view === "playlists") {
    const busy = addToPlaylist.isPending || removeFromPlaylist.isPending;
    return (
      <Modal title="Add to playlist" bare onClose={() => setView("main")}>
        <ul className="song-playlists-list">
          {mine.map((list) => {
            const added = containing.has(list.id);
            return (
              <li key={list.id}>
                <button
                  type="button"
                  className="song-playlists-row"
                  aria-pressed={added}
                  disabled={busy}
                  onClick={() => {
                    setNotice(null);
                    if (added) {
                      removeFromPlaylist.mutate({
                        path: { playlist_id: list.id, song_id: song.id },
                      });
                    } else {
                      addToPlaylist.mutate({
                        path: { playlist_id: list.id },
                        body: { song_id: song.id },
                      });
                    }
                  }}
                >
                  <Icon
                    name={added ? "list-check" : "list"}
                    className={
                      added
                        ? "song-playlists-glyph song-playlists-added"
                        : "song-playlists-glyph"
                    }
                  />
                  <span className="song-playlists-text">
                    <span className="song-playlists-name">{list.name}</span>
                    <span className="song-playlists-meta">
                      {list.song_count}{" "}
                      {list.song_count === 1 ? "song" : "songs"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {notice && (
          <p className="song-details-notice" role="alert">
            {notice}
          </p>
        )}
      </Modal>
    );
  }

  const wished = wishlist.mine(song.id);
  const favorite = favorites.ids.has(song.id);
  const hasControls =
    favorites.available || auth.can("karaoke.sing") || auth.can("wishlist.add");

  return (
    <Modal title={song.title} hideTitle bare onClose={onClose}>
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
              className="song-control song-control-lead song-control-sing"
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
              <Icon name={wished ? "playlist-check" : "playlist-plus"} />
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

      <div className="song-options">
        <button
          type="button"
          className="song-option"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <Icon name="info" className="song-option-icon" />
          <span className="song-option-label">Details</span>
          {/* A glyph swap, not a rotation: every collapsed option row points
              right, whether it expands inline or opens a sub-view, and
              rotating `chevron-down` by 180° would point it up. */}
          <Icon
            name={detailsOpen ? "chevron-down" : "chevron-right"}
            className="song-option-chevron"
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
          <button
            type="button"
            className="song-option"
            onClick={() => setView("scores")}
          >
            <Icon
              name="trophy"
              className="song-option-icon song-option-trophy"
            />
            <span className="song-option-label">Best scores</span>
            <span className="song-option-score">{best[0].score}</span>
            <Icon name="chevron-right" className="song-option-chevron" />
          </button>
        )}

        {canManagePlaylists && mine.length > 0 && (
          <button
            type="button"
            className="song-option"
            onClick={() => setView("playlists")}
          >
            <Icon name="list-plus" className="song-option-icon" />
            <span className="song-option-label">Add to playlist</span>
            <Icon name="chevron-right" className="song-option-chevron" />
          </button>
        )}
      </div>
    </Modal>
  );
}
