import { ICON_PATHS, type IconName } from "./components/icons";

/** The colours a tag may be drawn in, in the order the editor offers them.
 *  Mirrors `TAG_COLORS` in the backend's `tags/model.py`. */
export const TAG_COLORS = ["neutral", "blue", "pink", "gold"] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/**
 * The glyph of a tag. The backend only checks the *shape* of an icon name — it
 * ships no icon list — so a tag can name a glyph this frontend does not have,
 * and a tag may have no icon at all. Both fall back to `tag` itself (§3), never
 * to an empty `<path>`.
 */
export function tagGlyph(icon: string | null): IconName {
  return icon !== null && icon in ICON_PATHS ? (icon as IconName) : "tag";
}

/**
 * The class that paints a tag in its colour. An unknown colour — a value the
 * backend grew after this build — reads as the plain one rather than as no
 * class at all, which would leave the glyph in whatever colour it inherited.
 */
export function tagColorClass(color: string): string {
  const known = (TAG_COLORS as readonly string[]).includes(color);
  return `tag-color-${known ? color : "neutral"}`;
}
