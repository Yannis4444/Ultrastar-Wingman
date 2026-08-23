import type { DownloadRead, UsdbSong } from "../api";
import "./SongListItem.css";
import "./UsdbSongItem.css";

interface UsdbSongItemProps {
  song: UsdbSong;
  /** The row for this song, live from the downloads cache; absent = never tried. */
  download: DownloadRead | undefined;
  onDownload: () => void;
}

/** "3.5" → "★★★½": USDB rates in halves, so the half star is its own glyph. */
function stars(rating: number): string {
  return "★".repeat(Math.floor(rating)) + (rating % 1 >= 0.5 ? "½" : "");
}

function percent(progress: number | null): string {
  return progress === null ? "…" : `${Math.round(progress)}%`;
}

export default function UsdbSongItem({
  song,
  download,
  onDownload,
}: UsdbSongItemProps) {
  const label = `${song.artist} – ${song.title}`;

  return (
    <div className="song-list-item usdb-item">
      {/* No cover: USDB's images go through the backend only once downloaded. */}
      <span className="song-cover song-cover-fallback" aria-hidden="true">
        {song.artist.slice(0, 1).toUpperCase()}
      </span>
      <span className="song-text">
        <span className="song-title">{song.title}</span>
        <span className="song-artist">{song.artist}</span>
      </span>
      <span className="song-meta usdb-item-meta">
        {song.rating != null && (
          <span
            className="usdb-stars"
            title={`Rated ${song.rating} of 5`}
            aria-label={`Rated ${song.rating} of 5`}
          >
            {stars(song.rating)}
          </span>
        )}
        {song.golden && <span className="song-badge">GOLDEN</span>}
        {song.language && <span className="usdb-tag">{song.language}</span>}
        {song.edition && <span className="usdb-tag">{song.edition}</span>}
        {download?.status === "queued" && (
          <span className="usdb-status">Queued</span>
        )}
        {download?.status === "running" && (
          <span className="usdb-status" title={download.step ?? undefined}>
            {percent(download.progress)}
          </span>
        )}
        {(download?.status === "finished" ||
          (!download && song.downloaded)) && (
          <span className="usdb-status usdb-status-done" title="In the library">
            ✓
          </span>
        )}
        {(download === undefined || download.status === "failed") &&
          !song.downloaded && (
            <button
              type="button"
              className="button usdb-download"
              aria-label={`${download ? "Retry" : "Download"} ${label}`}
              onClick={onDownload}
            >
              {download ? "Retry" : "Download"}
            </button>
          )}
        {download?.status === "failed" && (
          <span
            className="usdb-status usdb-status-failed"
            title={download.error ?? "Download failed"}
          >
            Failed
          </span>
        )}
      </span>
    </div>
  );
}
