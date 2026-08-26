import type { SongRead } from "../api";
import CoverImage from "./CoverImage";

interface SongCoverProps {
  song: SongRead;
  className?: string;
  loading?: "lazy" | "eager";
}

/** The cover of a song in the library. */
export default function SongCover({
  song,
  className,
  loading,
}: SongCoverProps) {
  return (
    <CoverImage
      src={`/api/v1/songs/${encodeURIComponent(song.id)}/cover`}
      initial={song.artist.slice(0, 1).toUpperCase()}
      className={className}
      loading={loading}
    />
  );
}
