"""Export the app's icons as Material-style custom icons for the docs site.

Reads ``ICON_PATHS`` in ``frontend/src/components/icons.tsx`` and writes one SVG
per icon to ``docs/overrides/.icons/wingman/<name>.svg``. A file ``heart.svg``
there becomes the shortcode ``:wingman-heart:`` in a Markdown page.

Each SVG carries the app's own ``viewBox="0 0 24 24"`` and a bare ``<path>``
with no ``fill`` and no ``fill-rule``, so the glyph inherits the text color and
the browser's default nonzero fill. That is exactly what the app does through
the ``.icon`` rule in ``frontend/src/index.css``.

Rerun it whenever an icon is added, renamed, removed or redrawn in
``icons.tsx``. Icons the file no longer defines are deleted from the target
directory, so a rename leaves nothing behind.

From the repository root::

    venv\\Scripts\\python.exe docs\\tools\\export_icons.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "frontend" / "src" / "components" / "icons.tsx"
TARGET = REPO / "docs" / "overrides" / ".icons" / "wingman"

# One key per line: a bare identifier or a quoted name, then a colon.
KEY_LINE = re.compile(r'^\s*(?:"[^"]+"|[A-Za-z][A-Za-z0-9_-]*)\s*:')
# The key again, with its string value, which may sit on the following line.
ENTRY = re.compile(r'(?:"([^"]+)"|([A-Za-z][A-Za-z0-9_-]*))\s*:\s*"([^"]*)"')

SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="{path}"/></svg>\n'


def read_icon_paths(source: Path) -> dict[str, str]:
    """Parse the ``ICON_PATHS`` object literal into a name to path mapping."""
    text = source.read_text(encoding="utf-8")
    start = text.index("export const ICON_PATHS = {")
    end = text.index("} as const", start)
    block = text[start:end]

    # Drop the comments that explain how a glyph is drawn. No path data
    # contains a double slash, so a line test is enough.
    lines = [line for line in block.splitlines() if not line.strip().startswith("//")]
    body = "\n".join(lines[1:])

    icons = {(quoted or bare): path for quoted, bare, path in ENTRY.findall(body)}
    keys = [line for line in lines[1:] if KEY_LINE.match(line)]
    if len(icons) != len(keys):
        raise SystemExit(f"parsed {len(icons)} icons but found {len(keys)} keys in {source}")
    return icons


def main() -> int:
    icons = read_icon_paths(SOURCE)
    TARGET.mkdir(parents=True, exist_ok=True)

    written = 0
    for name, path in sorted(icons.items()):
        target = TARGET / f"{name}.svg"
        content = SVG.format(path=path)
        if not target.exists() or target.read_text(encoding="utf-8") != content:
            target.write_text(content, encoding="utf-8", newline="\n")
            written += 1

    stale = [f for f in TARGET.glob("*.svg") if f.stem not in icons]
    for f in stale:
        f.unlink()

    print(f"{len(icons)} icons in {SOURCE.name}")
    print(f"{written} written, {len(stale)} removed, in {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
