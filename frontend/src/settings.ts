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
 * Settings whose key does not say what they do. A key is stored in every
 * database that ever wrote it, so it keeps its name and the label moves on:
 * `sound.reel_preview` was the reel's song alone, and since 2026-10-22 it is
 * the song of every selection, spun or not. `sound.effects` would read
 * *Effects* alone, a word that under the Sound heading still leaves a reader
 * guessing which.
 */
const KEY_LABELS: Record<string, string> = {
  "sound.reel_preview": "Song preview",
  "sound.effects": "Sound effects",
};

/**
 * Human label for a setting key, from its last segment:
 * `usdb.base_url` -> `Base URL`. The group heading already says which area a
 * setting belongs to, so the prefix is dropped.
 */
export function labelize(key: string): string {
  const named = KEY_LABELS[key];
  if (named !== undefined) return named;
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
