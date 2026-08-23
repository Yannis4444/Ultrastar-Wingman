import { useState } from "react";
import type { SongRead } from "../api";
import { formatDuration } from "../duration";
import "./SongListItem.css";

interface SongListItemProps {
  song: SongRead;
  onClick: () => void;
}

export default function SongListItem({ song, onClick }: SongListItemProps) {
  // The cover endpoint 404s for songs without one; the <img> error event is
  // the only signal we get, so the fallback tile is rendered on demand.
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <button type="button" className="song-list-item" onClick={onClick}>
      {coverFailed ? (
        <span className="song-cover song-cover-fallback" aria-hidden="true">
          {song.artist.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          className="song-cover"
          src={`/api/v1/songs/${encodeURIComponent(song.id)}/cover`}
          alt=""
          loading="lazy"
          onError={() => setCoverFailed(true)}
        />
      )}
      <span className="song-text">
        <span className="song-title">{song.title}</span>
        <span className="song-artist">{song.artist}</span>
      </span>
      <span className="song-meta">
        {song.has_video && <span className="song-badge">VIDEO</span>}
        <span className="song-duration">
          {formatDuration(song.duration_seconds)}
        </span>
      </span>
    </button>
  );
}
