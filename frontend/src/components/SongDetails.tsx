import type { SongRead } from "../api";
import { formatDuration } from "../duration";
import Modal from "./Modal";
import "./SongDetails.css";

interface SongDetailsProps {
  song: SongRead;
  onClose: () => void;
}

export default function SongDetails({ song, onClose }: SongDetailsProps) {
  const rows: [string, string | null][] = [
    ["Artist", song.artist],
    ["Duration", formatDuration(song.duration_seconds)],
    ["Video", song.has_video ? "yes" : "no"],
    ["Language", song.language],
    ["Genre", song.genre],
    ["Year", song.year === null ? null : String(song.year)],
    ["Edition", song.edition],
    ["Creator", song.creator],
    ["Source", song.source],
    ["ID", song.id],
  ];

  return (
    <Modal title={song.title} onClose={onClose}>
      <dl className="song-details">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? "unknown"}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
