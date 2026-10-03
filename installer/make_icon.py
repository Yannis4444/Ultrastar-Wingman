"""Regenerate the installer's art from the logo. Run when the logo changes.

    pip install --target <tmp> pillow
    PYTHONPATH=<tmp> python installer/make_icon.py

Writes UltrastarWingman.ico (the exe's and the setup's icon) and the four
wizard bitmaps installer/UltrastarWingman.iss shows: wizard-image*.bmp on the
left of the first and last page, wizard-small*.bmp in the corner of the others.

Pillow is deliberately not a project dependency: every output is committed,
PyInstaller embeds a real .ico without needing to convert anything, and Inno
Setup reads the bitmaps as they are.
"""

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "frontend" / "public" / "logo.png"
ICON = HERE / "UltrastarWingman.ico"
# Every size Windows asks for, so nothing is ever downscaled at display time.
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
# `--tile-bg` in frontend/src/index.css, so the wizard reads as part of the app.
TILE_BG = (0x1B, 0x33, 0x47)
# Inno Setup 6.2's recommended sizes at 100 % and 200 % DPI (the 200 % ones are not exact
# doubles, and the small one is not square). Setup picks the closest and stretches it.
WIZARD_IMAGES = {
    "wizard-image.bmp": (164, 314),
    "wizard-image-2x.bmp": (328, 604),
    "wizard-small.bmp": (55, 55),
    "wizard-small-2x.bmp": (110, 106),
}
# How much of the bitmap's width the logo takes: the tall image leaves room around it, the
# small corner one has none to spare.
WIZARD_FILL = {"wizard-image": 0.8, "wizard-small": 0.9}


def artwork() -> Image.Image:
    """The logo cropped to its drawn pixels and centred on a transparent square."""
    logo = Image.open(SOURCE).convert("RGBA")
    # The logo is drawn with transparent margins that suit a web page but waste
    # an icon's few pixels, so the artwork is cropped out and re-centred.
    drawn = logo.crop(logo.getchannel("A").getbbox())
    side = max(drawn.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(drawn, ((side - drawn.width) // 2, (side - drawn.height) // 2))
    return square


def wizard_bitmap(art: Image.Image, size: tuple[int, int], fill: float) -> Image.Image:
    width, height = size
    side = round(min(width, height) * fill)
    logo = art.resize((side, side), Image.Resampling.LANCZOS)
    # RGB, not RGBA: Inno draws a 32-bit bitmap's alpha wrongly unless
    # WizardImageAlphaFormat says how it was stored, so the logo is flattened here.
    canvas = Image.new("RGB", size, TILE_BG)
    canvas.paste(logo, ((width - side) // 2, (height - side) // 2), logo)
    return canvas


def main() -> None:
    art = artwork()
    art.save(ICON, format="ICO", sizes=ICON_SIZES)
    print(f"{art.size[0]}px artwork -> {ICON}")
    for name, size in WIZARD_IMAGES.items():
        fill = WIZARD_FILL[name.removesuffix(".bmp").removesuffix("-2x")]
        target = HERE / name
        wizard_bitmap(art, size, fill).save(target, format="BMP")
        print(f"{size[0]}x{size[1]} -> {target}")


if __name__ == "__main__":
    main()
