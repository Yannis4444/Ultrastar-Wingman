import { useState, type CSSProperties } from "react";
import type { DownloadRead, UsdbSong } from "../api";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import "./SongListItem.css";
import "./UsdbSongItem.css";

interface UsdbSongItemProps {
  song: UsdbSong;
  /** The row for this song, live from the downloads cache; absent = never tried. */
  download: DownloadRead | undefined;
  onDownload: () => void;
}

type RowState = "idle" | "queued" | "running" | "done" | "failed";

/** The row's single source of truth: the live download wins, the library flag
 *  is the fallback — so a failed re-download of a library song shows the
 *  failure, not a stale checkmark. */
function rowState(
  song: UsdbSong,
  download: DownloadRead | undefined,
): RowState {
  if (download?.status === "queued") return "queued";
  if (download?.status === "running") return "running";
  if (download?.status === "finished") return "done";
  if (download?.status === "failed") return "failed";
  return song.downloaded ? "done" : "idle";
}

/** The first clause of an error. Backend errors read "code — message"; ffmpeg
 *  dumps its whole version banner after the first colon, and nobody reads that
 *  in a row. Duplicated in DownloadsPanel.tsx: exporting a non-component here
 *  would break fast refresh. */
function shortError(error: string | null): string {
  const first = (error ?? "Download failed")
    .split("\n")[0]
    .split(":")[0]
    .trim();
  return first.length > 100 ? `${first.slice(0, 99)}…` : first;
}

/** Five glyphs whatever the rating: a clipped gold overlay over a dim track,
 *  so halves are real halves and the block never changes width. */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="usdb-stars" role="img" aria-label={`Rated ${rating} of 5`}>
      <span
        className="usdb-stars-fill"
        aria-hidden="true"
        style={{ width: `${(rating / 5) * 100}%` }}
      >
        ★★★★★
      </span>
      <span aria-hidden="true">★★★★★</span>
    </span>
  );
}

/** Determinate progress ring; `null` progress spins until a percentage lands. */
export function Ring({ progress }: { progress: number | null }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={
        progress === null ? "usdb-ring usdb-ring-indeterminate" : "usdb-ring"
      }
      style={
        progress === null
          ? undefined
          : ({ "--p": progress / 100 } as CSSProperties)
      }
      aria-hidden="true"
      focusable="false"
    >
      <circle className="usdb-ring-track" cx="12" cy="12" r="10.5" />
      <circle className="usdb-ring-value" cx="12" cy="12" r="10.5" />
    </svg>
  );
}

export default function UsdbSongItem({
  song,
  download,
  onDownload,
}: UsdbSongItemProps) {
  const [showError, setShowError] = useState(false);
  const label = `${song.artist} – ${song.title}`;
  const state = rowState(song, download);
  const detailTitle =
    [song.edition, song.language].filter(Boolean).join(" · ") || undefined;
  const pct =
    download?.progress == null ? "…" : `${Math.round(download.progress)}%`;

  return (
    <div className="song-list-item usdb-item">
      {/* No cover: USDB's images go through the backend only once downloaded. */}
      <span className="song-cover song-cover-fallback" aria-hidden="true">
        {song.artist.slice(0, 1).toUpperCase()}
      </span>
      <span className="song-text">
        <span className="usdb-item-line">
          <span className="song-title usdb-item-title">{song.title}</span>
          {song.rating != null && <Stars rating={song.rating} />}
        </span>
        <span className="song-artist usdb-item-sub" title={detailTitle}>
          {song.artist}
          {song.language && <> · {song.language}</>}
        </span>
      </span>
      {/* One fixed 40x40 slot per state, so rows never reflow as downloads
          progress. */}
      {state === "idle" && (
        <button
          type="button"
          className="icon-button usdb-state"
          aria-label={`Download ${label}`}
          onClick={onDownload}
        >
          <Icon name="download" />
        </button>
      )}
      {state === "queued" && (
        <span
          className="icon-button usdb-state usdb-state-queued"
          role="img"
          aria-label={`Queued: ${label}`}
        >
          <Icon name="clock" />
        </span>
      )}
      {state === "running" && (
        <span
          className="icon-button usdb-state"
          role="img"
          aria-label={`Downloading ${label}, ${pct}`}
          title={download?.step ?? undefined}
        >
          <Ring progress={download?.progress ?? null} />
        </span>
      )}
      {state === "done" && (
        <span
          className="icon-button usdb-state usdb-state-done"
          role="img"
          aria-label="In the library"
          title="In the library"
        >
          <Icon name="check" />
        </span>
      )}
      {state === "failed" && (
        <button
          type="button"
          className="icon-button icon-button-danger usdb-state"
          aria-label={`Download of ${label} failed — show the error`}
          onClick={() => setShowError(true)}
        >
          <Icon name="alert" />
        </button>
      )}
      {showError && (
        <ConfirmModal
          title="Download failed"
          message={shortError(download?.error ?? null)}
          confirmLabel="Try again"
          onConfirm={() => {
            // `onDownload` already forces on a failed row (see Usdb.tsx).
            onDownload();
            setShowError(false);
          }}
          onCancel={() => setShowError(false)}
        />
      )}
    </div>
  );
}
