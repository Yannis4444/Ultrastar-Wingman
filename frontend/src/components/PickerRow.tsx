import type { ReactNode } from "react";
import { Icon } from "./icons";
import "./PickerRow.css";

interface PickerRowProps {
  /** The 40px square the row leads with: a `SongCover` or a `PlaylistCover`. */
  lead: ReactNode;
  /** First line — the song's title, or the playlist's name. */
  title: string;
  /** Second line — the artist, or "12 songs". */
  meta: string;
  /** Whether the song is already on the list; draws the accent `list-check`. */
  pressed: boolean;
  /** While the round trip for this very row is in flight. */
  disabled?: boolean;
  onClick: () => void;
}

/**
 * One row of a membership picker: does this list hold this song? Both pickers
 * ask that question from opposite ends — the song modal's "Add to playlist"
 * runs over the playlists, the playlist page's "Add songs" over the library —
 * so they are the same row with the lead and the two lines swapped.
 *
 * The trailing mark is the bulleted-list family of §3: `list` when the song is
 * not on the list, `list-check` in the accent when it is.
 */
export default function PickerRow({
  lead,
  title,
  meta,
  pressed,
  disabled,
  onClick,
}: PickerRowProps) {
  return (
    <li>
      <button
        type="button"
        className="picker-row"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {lead}
        <span className="picker-row-text">
          {/* The title attribute recovers what the ellipsis cuts. */}
          <span className="picker-row-title" title={title}>
            {title}
          </span>
          <span className="picker-row-meta">{meta}</span>
        </span>
        <Icon
          name={pressed ? "list-check" : "list"}
          className={
            pressed ? "picker-row-mark picker-row-mark-on" : "picker-row-mark"
          }
        />
      </button>
    </li>
  );
}
