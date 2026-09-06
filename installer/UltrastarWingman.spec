# PyInstaller spec for the Windows exe. Build with installer\build.ps1, never by hand:
# it builds the frontend first, and this spec bundles whatever is in frontend\dist.
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

ROOT = Path(SPECPATH).parent  # noqa: F821  (SPECPATH is injected by PyInstaller)
PACKAGE = ROOT / "backend" / "src" / "ultrastar_wingman"

datas = [
    # Alembic loads migration scripts from the filesystem, so they ship as data next to the
    # archived package — where `db.migrations_dir()` looks when frozen.
    (str(PACKAGE / "migrations"), "ultrastar_wingman/migrations"),
    # For running the alembic CLI against a bundled copy; the app builds its config in code.
    (str(ROOT / "backend" / "alembic.ini"), "."),
    # The shipped badge pictures — where `achievements.pictures.images_dir()` looks when
    # frozen. Data files, so `collect_submodules` does not pick them up.
    (str(PACKAGE / "achievements" / "images"), "ultrastar_wingman/achievements/images"),
    # The device firmware image and its manifest, built by installer\build.ps1 before this
    # spec runs — where the `devices` firmware routes look when frozen.
    (str(PACKAGE / "devices" / "firmware"), "ultrastar_wingman/devices/firmware"),
    # Where `frontend.resolve_frontend_dir()` looks when frozen.
    (str(ROOT / "frontend" / "dist"), "frontend"),
    # `ultrastar_wingman.__version__` reads the installed distribution's metadata.
    *copy_metadata("ultrastar-wingman"),
]

hiddenimports = [
    # uvicorn picks its loop/http/ws implementations by string, and it imports the app
    # factory by string too ("ultrastar_wingman.app:create_app") — neither is in the graph.
    *collect_submodules("uvicorn"),
    *collect_submodules("ultrastar_wingman"),
    # SQLAlchemy resolves dialects by URL, and the dialect imports its driver by name.
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "aiosqlite",
]

a = Analysis(  # noqa: F821
    [str(Path(SPECPATH) / "wingman_main.py")],  # noqa: F821
    pathex=[str(ROOT / "backend" / "src")],  # independent of how the backend was installed
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="UltrastarWingman",
    # Generated from frontend\public\logo.png by installer\make_icon.py; rerun that
    # when the logo changes.
    icon=str(Path(SPECPATH) / "UltrastarWingman.ico"),  # noqa: F821
    # One file: users download one exe. Console: the log lines (data dir, host URL with the
    # one-time token) are the only interface when the browser did not open.
    console=True,
    upx=False,
)
