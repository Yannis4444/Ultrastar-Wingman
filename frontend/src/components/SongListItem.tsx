import type { ReactNode } from "react";
import type { SongRead } from "../api";
import { Icon } from "./icons";
import SongCover from "./SongCover";
import "./SongListItem.css";

interface SongListItemProps {
  song: SongRead;
  onClick: () => void;
  /** Small passive marker after the title: this song is in my favorites. */
  favorite?: boolean;
  /** Small passive marker after the title: I have sung this song before. */
  sung?: boolean;
  /**
   * Right-aligned trailing text inside the row: the one value this list is
   * about (the time a song was played, a duration). Not a control — anything
   * clickable belongs in `actions`.
   */
  meta?: ReactNode;
  /**
   * Controls next to the row (playlist reordering). They sit beside the row
   * button, never inside it: nested buttons are invalid HTML.
   */
  actions?: ReactNode;
}

export default function SongListItem({
  song,
  onClick,
  favorite,
  sung,
  meta,
  actions,
}: SongListItemProps) {
  const item = (
    <button type="button" className="song-list-item" onClick={onClick}>
      <SongCover song={song} />
      <span className="song-text">
        {/* The title attribute recovers what the ellipsis cuts ("[DUET]"). */}
        <span className="song-title" title={song.title}>
          <span className="song-title-text">{song.title}</span>
          {sung && (
            <span className="song-mark song-mark-sung" title="You sang this">
              <Icon name="mic" />
            </span>
          )}
          {favorite && (
            <span
              className="song-mark song-mark-favorite"
              title="In your favorites"
            >
              <Icon name="heart" />
            </span>
          )}
        </span>
        <span className="song-artist">{song.artist}</span>
      </span>
      {meta && <span className="song-meta">{meta}</span>}
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
