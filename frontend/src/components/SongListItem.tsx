import type { SongRead } from "../api";
import { formatDuration } from "../duration";
import SongCover from "./SongCover";
import "./SongListItem.css";

interface SongListItemProps {
  song: SongRead;
  onClick: () => void;
}

export default function SongListItem({ song, onClick }: SongListItemProps) {
  return (
    <button type="button" className="song-list-item" onClick={onClick}>
      <SongCover song={song} />
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
