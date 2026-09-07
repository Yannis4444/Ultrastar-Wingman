import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getPlaylistOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SongSpinner from "../components/SongSpinner";
import "./Playlists.css";

/**
 * The reel with one playlist as its pool. Same page as `/spinner`, minus the
 * scopes: the playlist *is* the scope, so there is nothing left to choose.
 *
 * Gated on `playlists.view` alone, like the playlist itself — the songs arrive
 * with the playlist, so the library is never asked.
 */
export default function PlaylistSpinner() {
  const { playlistId = "" } = useParams();
  const auth = useAuth();

  const allowed = auth.loaded && auth.can("playlists.view");
  const playlist = useQuery({
    ...getPlaylistOptions({ path: { playlist_id: playlistId } }),
    enabled: allowed && playlistId !== "",
  });
  const back = `/songs/playlists/${encodeURIComponent(playlistId)}`;

  return (
    <>
      {/* The playlist's name, not "Random song": the dice and the reel below
          say what the page does, and the name is what the reader would
          otherwise have to remember. */}
      <PageHeader title={playlist.data?.name ?? "Playlist"} back={back} />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (allowed ? (
          <>
            {playlist.isPending && <Loading />}

            {playlist.isError && (
              <p className="error-notice playlists-notice" role="alert">
                This playlist is gone.{" "}
                <Link to="/songs/playlists">Back to the playlists</Link>
              </p>
            )}

            {playlist.isSuccess && (
              <SongSpinner
                songs={playlist.data.entries.map((entry) => entry.song)}
                playlistId={playlist.data.id}
              />
            )}
          </>
        ) : (
          <p className="settings-notice">
            Playlists are not open to your role. Log in or ask the host for
            access.
          </p>
        ))}
    </>
  );
}
