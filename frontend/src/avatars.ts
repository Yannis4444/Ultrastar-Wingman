/**
 * Where a player's picture comes from. Its own module because both the avatar
 * component and the bottom nav need the URL, and the nav cannot use the
 * component: it falls back to an inline path, not to an initial.
 */

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
