import CoverImage from "./CoverImage";
import { Icon } from "./icons";
import "./PlaylistCover.css";

interface PlaylistCoverProps {
  /**
   * The playlist's first songs — `cover_song_ids` from the listing, which the
   * backend already caps at four so a row costs no request of its own.
   */
  songIds: string[];
  className?: string;
}

/** How many covers fit the mosaic: a 2x2 box. */
const TILES = 4;

/**
 * The 40px square a playlist row leads with: a 2x2 mosaic of its first covers.
 * One cover fills the box, none falls back to the `list` glyph square every
 * other icon-led row in the app uses.
 */
export default function PlaylistCover({
  songIds,
  className,
}: PlaylistCoverProps) {
  const ids = songIds.slice(0, TILES);
  const classes = ["playlist-cover", className].filter(Boolean).join(" ");

  if (ids.length === 0) {
    return (
      <span className={`${classes} playlist-cover-empty`} aria-hidden="true">
        <Icon name="list" />
      </span>
    );
  }

  return (
    <span
      className={ids.length === 1 ? `${classes} playlist-cover-one` : classes}
      aria-hidden="true"
    >
      {ids.map((id) => (
        <CoverImage
          key={id}
          src={`/api/v1/songs/${encodeURIComponent(id)}/cover`}
          // No letter in a 20px quadrant: four initials in a 40px box read as
          // text, not as artwork. A missing cover is just an empty tile.
          initial=""
          className="playlist-cover-tile"
        />
      ))}
    </span>
  );
}
