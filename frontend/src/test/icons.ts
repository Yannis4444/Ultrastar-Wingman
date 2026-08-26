import { ICON_PATHS, type IconName } from "../components/icons";

const BY_PATH = new Map<string, IconName>(
  (Object.entries(ICON_PATHS) as [IconName, string][]).map(([name, d]) => [
    d,
    name,
  ]),
);

/**
 * Which glyphs an element renders, in document order. An `Icon` is
 * `aria-hidden` and carries no text, so its path data is the only handle a test
 * has on *which* glyph was chosen — and glyph choice is what the wishlist and
 * playlist families are about.
 */
export function iconNames(element: Element): string[] {
  return [...element.querySelectorAll("path")].map(
    (path) => BY_PATH.get(path.getAttribute("d") ?? "") ?? "unknown",
  );
}
