import type { DownloadRead } from "../api";
import { Icon } from "./icons";
import { Ring } from "./UsdbSongItem";
import "./DownloadsPanel.css";

interface DownloadsPanelProps {
  downloads: DownloadRead[];
  onRetry: (download: DownloadRead) => void;
}

const RUNNING = new Set(["queued", "running"]);

/** The first clause of an error — see the twin in UsdbSongItem.tsx. */
function shortError(error: string | null): string {
  const first = (error ?? "Download failed")
    .split("\n")[0]
    .split(":")[0]
    .trim();
  return first.length > 100 ? `${first.slice(0, 99)}…` : first;
}

function name(download: DownloadRead): string {
  // Title and artist only exist once the song text was parsed.
  if (download.title) return `${download.artist ?? "?"} – ${download.title}`;
  return `${download.source.toUpperCase()} #${download.source_song_id}`;
}

function stateIcon(download: DownloadRead) {
  switch (download.status) {
    case "queued":
      return (
        <span className="downloads-state downloads-state-queued">
          <Icon name="clock" />
        </span>
      );
    case "running":
      return (
        <span className="downloads-state">
          <Ring progress={download.progress} />
        </span>
      );
    case "failed":
      return (
        <span className="downloads-state downloads-state-failed">
          <Icon name="alert" />
        </span>
      );
    default:
      return (
        <span className="downloads-state downloads-state-done">
          <Icon name="check" />
        </span>
      );
  }
}

/** Recent downloads with live progress — the body of the Downloads modal. */
export default function DownloadsPanel({
  downloads,
  onRetry,
}: DownloadsPanelProps) {
  if (downloads.length === 0) {
    return <p className="downloads-empty">Nothing downloaded yet.</p>;
  }

  return (
    <ul className="downloads-list">
      {downloads.map((download) => (
        <li key={download.id}>
          <div className="downloads-row">
            {stateIcon(download)}
            <span className="downloads-name">{name(download)}</span>
            {download.status === "failed" && (
              <button
                type="button"
                className="icon-button icon-button-bordered downloads-retry"
                aria-label={`Retry download of ${name(download)}`}
                onClick={() => onRetry(download)}
              >
                <Icon name="refresh" />
              </button>
            )}
          </div>
          {download.status === "running" && (
            <p className="downloads-step">
              {download.step ?? "running"}
              {download.progress !== null &&
                ` · ${Math.round(download.progress)}%`}
            </p>
          )}
          {RUNNING.has(download.status) && (
            <progress
              className="downloads-progress"
              max={100}
              // No value at all: the bar is indeterminate until yt-dlp
              // reports a percentage.
              value={download.progress ?? undefined}
              aria-label={`Progress of ${name(download)}`}
            />
          )}
          {download.error && (
            <details className="downloads-error">
              <summary>{shortError(download.error)}</summary>
              <pre>{download.error}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
