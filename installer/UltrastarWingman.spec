# PyInstaller spec for the Windows exe. Build with installer\build.ps1, never by hand:
# it builds the frontend first, and this spec bundles whatever is in frontend\dist.
#
# Two layouts out of the one Analysis, picked by a spec argument after "--":
#   (none)      the portable one-file <distpath>\UltrastarWingman.exe, the download
#   --onedir    <distpath>\UltrastarWingman\ holding UltrastarWingman.exe + _internal\, what
#               the installer carries: nothing unpacked into %TEMP%\_MEI* on every start
# build.ps1 runs PyInstaller once per layout, each with its own --workpath: both EXEs are
# named UltrastarWingman, and PyInstaller derives the work file of an EXE's archive from
# that name alone (<workpath>\UltrastarWingman.pkg), so one run building both would have
# them overwrite each other's.
import argparse
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

parser = argparse.ArgumentParser(prog="UltrastarWingman.spec")
parser.add_argument("--onedir", action="store_true", help="the installer's folder build")
ONEDIR = parser.parse_args(sys.argv[1:]).onedir

ROOT = Path(SPECPATH).parent  # noqa: F821  (SPECPATH is injected by PyInstaller)
PACKAGE = ROOT / "backend" / "src" / "ultrastar_wingman"
VERSION_INFO = Path(SPECPATH) / "build" / "version_info.txt"  # noqa: F821

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
# A checkout that has run the backend holds __pycache__ beside the migrations, and a folder
# in datas is copied whole. That bytecode is the build machine's, and in the folder build
# its names are the deepest paths of an installation (130 characters below the exe), close
# enough to Windows' 260 to break a long install folder. A frozen Wingman writes none.
a.datas = [entry for entry in a.datas if "__pycache__" not in Path(entry[0]).parts]
pyz = PYZ(a.pure)  # noqa: F821

# Everything both layouts' exe share, in one place, so the two cannot drift apart. Every
# path a frozen Wingman reads its bundled files from goes through sys._MEIPASS, which is
# the unpacked folder in one layout and _internal\ in the other; the bundled Ultrastar
# Deluxe is found next to sys.executable, the exe itself in both.
exe_options = dict(
    name="UltrastarWingman",
    # Generated from frontend\public\logo.png by installer\make_icon.py; rerun that
    # when the logo changes.
    icon=str(Path(SPECPATH) / "UltrastarWingman.ico"),  # noqa: F821
    # The Windows version resource, written by installer\build.ps1 from the pyproject
    # version on every build. A build without it still works, just without the details tab.
    version=str(VERSION_INFO) if VERSION_INFO.exists() else None,
    # Console: the log lines (data dir, host URL with the one-time token) are the only
    # interface when the browser did not open.
    console=True,
    upx=False,
)

if ONEDIR:
    exe = EXE(pyz, a.scripts, exclude_binaries=True, **exe_options)  # noqa: F821
    # COLLECT empties <distpath>\UltrastarWingman\ before it fills it.
    COLLECT(exe, a.binaries, a.datas, name="UltrastarWingman", upx=False)  # noqa: F821
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, **exe_options)  # noqa: F821
