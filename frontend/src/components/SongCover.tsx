import { useState } from "react";
import type { SongRead } from "../api";
import "./SongCover.css";

interface SongCoverProps {
  song: SongRead;
  className?: string;
}

export default function SongCover({ song, className }: SongCoverProps) {
  // The cover endpoint 404s for songs without one; the <img> error event is
  // the only signal we get, so the fallback tile is rendered on demand.
  const [failed, setFailed] = useState(false);
  const classes = `song-cover${className ? ` ${className}` : ""}`;

  if (failed) {
    return (
      <span className={`${classes} song-cover-fallback`} aria-hidden="true">
        {song.artist.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={classes}
      src={`/api/v1/songs/${encodeURIComponent(song.id)}/cover`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
