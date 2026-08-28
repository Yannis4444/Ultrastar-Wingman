import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SongRead } from "../api";
import {
  getPlaylistOptions,
  getPlaylistQueryKey,
  listPlaylistsQueryKey,
  removePlaylistEntryMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { errorMessage } from "../errors";
import { useFavorites } from "../hooks/useFavorites";
import { useWishlist } from "../hooks/useWishlist";
import "./Playlists.css";

/** One playlist's songs — what the playlist chips on the songs page used to do. */
export default function Playlist() {
  const { playlistId = "" } = useParams();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const favorites = useFavorites();
  const wishlist = useWishlist();
  const [selected, setSelected] = useState<SongRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = auth.loaded && auth.can("playlists.view");
  const playlist = useQuery({
    ...getPlaylistOptions({ path: { playlist_id: playlistId } }),
    enabled: allowed && playlistId !== "",
  });

  const removeEntry = useMutation({
    ...removePlaylistEntryMutation(),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: getPlaylistQueryKey({ path: { playlist_id: playlistId } }),
      });
      void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
    },
    onError: (cause) =>
      setError(errorMessage(cause, "Could not remove the song.")),
  });

  // The owner edits the playlist; `playlists.moderate` extends that to anybody
  // else's shared one.
  const editable =
    playlist.data !== undefined &&
    auth.can("playlists.manage") &&
    (playlist.data.mine || auth.can("playlists.moderate"));
  const songs = playlist.data?.entries.map((entry) => entry.song) ?? [];

  return (
    <div className="playlists-page">
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
                {/* No count above the empty sentence: it already says "empty". */}
                {songs.length === 0 ? (
                  <p className="playlists-empty">
                    This playlist is empty. Add songs from a song&apos;s
                    details.
                  </p>
                ) : (
                  <>
                    <p className="playlist-count">
                      {songs.length} {songs.length === 1 ? "song" : "songs"}
                    </p>
                    <div className="playlist-songs">
                      {songs.map((song) => (
                        <SongListItem
                          key={song.id}
                          song={song}
                          favorite={favorites.ids.has(song.id)}
                          wished={wishlist.mine(song.id)}
                          onClick={() => setSelected(song)}
                          actions={
                            editable && (
                              <button
                                type="button"
                                aria-label={`Remove ${song.title} from the playlist`}
                                onClick={() =>
                                  removeEntry.mutate({
                                    path: {
                                      playlist_id: playlistId,
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
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <p className="settings-notice">
            Playlists are not open to your role. Log in or ask the host for
            access.
          </p>
        ))}

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
