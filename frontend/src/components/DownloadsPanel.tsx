import { useState } from "react";
import type { DownloadRead } from "../api";
import CheckOption from "./CheckOption";
import { Icon } from "./icons";
import { Ring } from "./UsdbSongItem";
import "./DownloadsPanel.css";

interface DownloadsPanelProps {
  downloads: DownloadRead[];
  onRetry: (download: DownloadRead) => void;
  /** Takes one finished or failed row off the panel, for everybody. */
  onDismiss: (download: DownloadRead) => void;
  onClearFinished: () => void;
  /**
   * Retrying, dismissing and clearing all write, so they all need
   * `downloads.manage` — the panel only reports without it.
   */
  mayManage: boolean;
  /** What went wrong with the last action started from here, if anything. */
  error: string | null;
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

/**
 * The queue with live progress — the body of the Downloads modal.
 *
 * Shows this Wingman run by default: a failure from a party three weeks ago is
 * history, not something to act on, and leaving it in the list is what made the
 * panel fill up and never empty again. Older rows are one checkbox away, and
 * anything the user is done with can be dismissed for good.
 */
export default function DownloadsPanel({
  downloads,
  onRetry,
  onDismiss,
  onClearFinished,
  mayManage,
  error,
}: DownloadsPanelProps) {
  const [sessionOnly, setSessionOnly] = useState(true);

  // The panel is a modal on top of the page, so an action started in here has
  // to report in here — the page's own notice is behind the backdrop.
  const notice = error && (
    <p className="error-notice downloads-notice" role="alert">
      {error}
    </p>
  );

  if (downloads.length === 0) {
    return (
      <>
        {notice}
        <p className="downloads-empty">Nothing downloaded yet.</p>
      </>
    );
  }

  const visible = sessionOnly
    ? downloads.filter((download) => download.current_session)
    : downloads;
  const finished = visible.filter(
    (download) => download.status === "finished",
  ).length;

  return (
    <>
      {notice}

      <div className="downloads-controls">
        <CheckOption
          type="checkbox"
          label="Since Wingman started"
          checked={sessionOnly}
          onChange={() => setSessionOnly((old) => !old)}
        />
      </div>

      {/* The filter stays on screen above this: the way out of an empty view
          has to be visible from inside it, and the message says where the rest
          of the history went. */}
      {visible.length === 0 ? (
        <p className="downloads-empty">
          Nothing downloaded since Wingman started. Turn the filter off for the
          older history.
        </p>
      ) : (
        <ul className="downloads-list">
          {visible.map((download) => (
            <li key={download.id}>
              <div className="downloads-row">
                {stateIcon(download)}
                <span className="downloads-name">{name(download)}</span>
                {/* Retrying queues a new download, which is `downloads.manage`
                    like everything else here: without it the button could only
                    ever answer 403. */}
                {mayManage && download.status === "failed" && (
                  <button
                    type="button"
                    className="icon-button icon-button-bordered downloads-retry"
                    aria-label={`Retry download of ${name(download)}`}
                    onClick={() => onRetry(download)}
                  >
                    <Icon name="refresh" />
                  </button>
                )}
                {mayManage && !RUNNING.has(download.status) && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Dismiss ${name(download)}`}
                    onClick={() => onDismiss(download)}
                  >
                    <Icon name="close" />
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
      )}

      {/* Successes only. A failure leaves the screen when its owner says so —
          never as a side effect of tidying up. */}
      {mayManage && finished > 0 && (
        <div className="downloads-actions">
          <button type="button" className="button" onClick={onClearFinished}>
            Clear finished
          </button>
        </div>
      )}
    </>
  );
}
