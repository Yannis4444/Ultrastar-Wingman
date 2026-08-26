"""Regenerate UltrastarWingman.ico from the logo. Run when the logo changes.

    pip install --target <tmp> pillow
    PYTHONPATH=<tmp> python installer/make_icon.py

Pillow is deliberately not a project dependency: the .ico is committed, and
PyInstaller embeds a real .ico without needing to convert anything.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "frontend" / "public" / "logo.png"
TARGET = Path(__file__).resolve().parent / "UltrastarWingman.ico"
# Every size Windows asks for, so nothing is ever downscaled at display time.
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    logo = Image.open(SOURCE).convert("RGBA")
    # The logo is drawn with transparent margins that suit a web page but waste
    # an icon's few pixels, so the artwork is cropped out and re-centred on a
    # square canvas — it ends up filling the icon along its longer axis.
    artwork = logo.crop(logo.getchannel("A").getbbox())
    side = max(artwork.size)
    icon = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    icon.paste(artwork, ((side - artwork.width) // 2, (side - artwork.height) // 2))
    icon.save(TARGET, format="ICO", sizes=SIZES)
    print(f"{logo.size[0]}px logo -> {side}px artwork -> {TARGET}")


if __name__ == "__main__":
    main()
