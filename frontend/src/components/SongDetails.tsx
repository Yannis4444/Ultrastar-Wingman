import { useState } from "react";
import type { SongRead } from "../api";
import { useAuth } from "../auth";
import { formatDuration } from "../duration";
import Modal from "./Modal";
import PlayerSelection from "./PlayerSelection";
import "./SongDetails.css";

interface SongDetailsProps {
  song: SongRead;
  onClose: () => void;
}

export default function SongDetails({ song, onClose }: SongDetailsProps) {
  const [selectingPlayers, setSelectingPlayers] = useState(false);
  const auth = useAuth();

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

  if (selectingPlayers) {
    return <PlayerSelection song={song} onClose={onClose} />;
  }

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
      {auth.can("karaoke.sing") && (
        <div className="song-details-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => setSelectingPlayers(true)}
          >
            Sing
          </button>
        </div>
      )}
    </Modal>
  );
}
