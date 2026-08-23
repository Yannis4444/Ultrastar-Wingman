import { useState } from "react";
import type { PlayerRead } from "../api";
import "./PlayerAvatar.css";

interface PlayerAvatarProps {
  /** `null` renders the empty-slot placeholder. */
  player: PlayerRead | null;
  className?: string;
}

export default function PlayerAvatar({ player, className }: PlayerAvatarProps) {
  // The avatar endpoint 404s when the file vanished behind `has_avatar`; the
  // failing id is remembered so switching players re-tries the new image.
  const [failedId, setFailedId] = useState<string | null>(null);
  const classes = `player-avatar${className ? ` ${className}` : ""}`;

  if (!player) {
    return (
      <span className={`${classes} player-avatar-empty`} aria-hidden="true" />
    );
  }
  if (!player.has_avatar || failedId === player.id) {
    return (
      <span className={`${classes} player-avatar-letter`} aria-hidden="true">
        {player.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={classes}
      src={`/api/v1/players/${encodeURIComponent(player.id)}/avatar`}
      alt=""
      loading="lazy"
      onError={() => setFailedId(player.id)}
    />
  );
}
