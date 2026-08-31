/**
 * Where a player's picture comes from. Its own module because both the avatar
 * component and the bottom nav need the URL, and the nav cannot use the
 * component: it falls back to an inline path, not to an initial.
 */

import type { PlayerRead } from "./api";

/**
 * The avatar endpoint of one player, cache-busted with the version the backend
 * reports for the stored file.
 *
 * Replacing an avatar changes neither the URL nor `has_avatar`, so without the
 * version the browser keeps showing the old picture until its cached copy goes
 * stale. `PlayerRead.avatar_version` moves when — and only when — the image
 * does, so an unchanged picture keeps one stable, cacheable URL.
 */
export function avatarUrl(playerId: string, version?: number | null): string {
  const url = `/api/v1/players/${encodeURIComponent(playerId)}/avatar`;
  return version === undefined || version === null
    ? url
    : `${url}?v=${version}`;
}

/**
 * Somebody who is not a player row — a comment's author, a playlist's member or
 * its owner — in the shape `PlayerAvatar` draws.
 *
 * `avatarVersion` says what is known about the picture, and the two kinds of
 * "nothing" mean different things. `null` is an answer: that player has no
 * picture, so the row goes straight to the initial instead of a request the
 * backend replies to with a 404. Leaving it out is *not knowing* — a member row
 * carries no version — so the avatar endpoint is asked and its own 404 is the
 * fallback; a replaced picture then appears once the browser's copy goes stale,
 * which is the whole cost of not pulling the player list into the page.
 *
 * Somebody with no player at all has no picture either way, and a deleted
 * account has neither picture nor initial: `null` is the empty square.
 */
export function asPlayer(
  username: string,
  playerId: string | null,
  avatarVersion?: number | null,
): PlayerRead {
  return {
    id: playerId ?? "",
    name: username,
    registered: true,
    // Hiding is a state of a player row in the picker; a stand-in is never one.
    hidden: false,
    has_avatar:
      playerId !== null &&
      (avatarVersion === undefined || avatarVersion !== null),
    avatar_version: avatarVersion ?? null,
  };
}
