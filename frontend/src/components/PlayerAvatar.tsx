import { useState } from "react";
import type { PlayerRead } from "../api";
import { avatarUrl } from "../avatars";
import "./PlayerAvatar.css";

interface PlayerAvatarProps {
  /** `null` renders the empty-slot placeholder. */
  player: PlayerRead | null;
  className?: string;
}

export default function PlayerAvatar({ player, className }: PlayerAvatarProps) {
  // The avatar endpoint 404s when the file vanished behind `has_avatar`; the
  // failing URL is remembered so another player — or a freshly uploaded image
  // under a new version — is tried again rather than written off.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const classes = `player-avatar${className ? ` ${className}` : ""}`;

  if (!player) {
    return (
      <span className={`${classes} player-avatar-empty`} aria-hidden="true" />
    );
  }
  const src = avatarUrl(player.id, player.avatar_version);
  if (!player.has_avatar || failedSrc === src) {
    return (
      <span className={`${classes} player-avatar-letter`} aria-hidden="true">
        {player.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={classes}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}
