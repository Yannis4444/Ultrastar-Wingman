/**
 * Words that plain capitalization gets wrong. Everything else is turned into
 * sentence case, so a new registry entry needs no UI change at all.
 */
const WORD_OVERRIDES: Record<string, string> = {
  url: "URL",
  db: "DB",
  id: "ID",
  oidc: "OIDC",
  dir: "directory",
  ytdlp: "yt-dlp",
  ffmpeg: "ffmpeg",
};

/**
 * Human label for a setting key, from its last segment:
 * `usdb.base_url` -> `Base URL`. The group heading already says which area a
 * setting belongs to, so the prefix is dropped.
 */
export function labelize(key: string): string {
  const words = (key.split(".").pop() ?? "").split("_").filter(Boolean);
  const label = words
    .map((word) => WORD_OVERRIDES[word] ?? word.toLowerCase())
    .join(" ");
  // An override keeps the casing it was written with, so `downloads.ytdlp_path`
  // stays "yt-dlp path" instead of becoming "Yt-dlp path".
  const first = words[0];
  return first !== undefined && first in WORD_OVERRIDES
    ? label
    : label.charAt(0).toUpperCase() + label.slice(1);
}
