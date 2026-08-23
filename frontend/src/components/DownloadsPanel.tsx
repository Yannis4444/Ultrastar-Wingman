import type { DownloadRead } from "../api";
import "./DownloadsPanel.css";

interface DownloadsPanelProps {
  downloads: DownloadRead[];
  onRetry: (download: DownloadRead) => void;
}

const RUNNING = new Set(["queued", "running"]);

function name(download: DownloadRead): string {
  // Title and artist only exist once the song text was parsed.
  if (download.title) return `${download.artist ?? "?"} – ${download.title}`;
  return `${download.source}:${download.source_song_id}`;
}

/**
 * Recent downloads with live progress. `<details>` because collapsing is the
 * one thing it does and the browser already does it.
 */
export default function DownloadsPanel({
  downloads,
  onRetry,
}: DownloadsPanelProps) {
  const active = downloads.filter((row) => RUNNING.has(row.status)).length;

  return (
    <details className="downloads-panel" open={active > 0}>
      <summary>
        Downloads
        {downloads.length > 0 && (
          <span className="downloads-count">
            {active > 0 ? `${active} active` : `${downloads.length} recent`}
          </span>
        )}
      </summary>
      {downloads.length === 0 ? (
        <p className="downloads-empty">Nothing downloaded yet.</p>
      ) : (
        <ul className="downloads-list">
          {downloads.map((download) => (
            <li key={download.id}>
              <div className="downloads-row">
                <span className="downloads-name">{name(download)}</span>
                <span className="downloads-step">
                  {download.status === "running"
                    ? (download.step ?? "running")
                    : download.status}
                  {download.progress !== null &&
                    download.status === "running" &&
                    ` · ${Math.round(download.progress)}%`}
                </span>
                {download.status === "failed" && (
                  <button
                    type="button"
                    className="button downloads-retry"
                    aria-label={`Retry download of ${name(download)}`}
                    onClick={() => onRetry(download)}
                  >
                    Retry
                  </button>
                )}
              </div>
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
                <p className="error-notice downloads-error">{download.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
