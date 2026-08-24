import type { ReactNode } from "react";
import type { SongRead } from "../api";
import SongCover from "./SongCover";
import "./SongListItem.css";

interface SongListItemProps {
  song: SongRead;
  onClick: () => void;
  /**
   * Controls next to the row (favorite heart, playlist reordering). They sit
   * beside the row button, never inside it: nested buttons are invalid HTML.
   */
  actions?: ReactNode;
}

export default function SongListItem({
  song,
  onClick,
  actions,
}: SongListItemProps) {
  const item = (
    <button type="button" className="song-list-item" onClick={onClick}>
      <SongCover song={song} />
      <span className="song-text">
        {/* The title attribute recovers what the ellipsis cuts ("[DUET]"). */}
        <span className="song-title" title={song.title}>
          {song.title}
        </span>
        <span className="song-artist">{song.artist}</span>
      </span>
    </button>
  );

  if (!actions) return item;
  return (
    <div className="song-list-row">
      {item}
      <span className="song-list-actions">{actions}</span>
    </div>
  );
}
