# Building the exe and the installer

`installer\build.ps1` builds the Windows deliverables from a checkout:

- `UltrastarWingman.exe`: the portable one-file exe (PyInstaller). Frontend, backend,
  migrations, the shipped badge pictures and the device firmware are all inside it.
- `UltrastarWingman-<version>-setup.exe`: the Inno Setup installer wrapping that exe. Per
  user, no administrator rights, updates an installed Wingman in place.
- `UltrastarWingman-<version>-with-usdx-setup.exe`, only with `-UsdxDir`: the same
  installer carrying Ultrastar Deluxe under `{app}\usdx`. See
  [The edition with Ultrastar Deluxe](#the-edition-with-ultrastar-deluxe).

The user-facing side (what the wizard asks, update, uninstall) is
[docs/user/start/install.md](../user/start/install.md). The silent switches are
[below](#silent-installs), because a host page carries no command lines.

## Prerequisites

| What | Why | Notes |
|---|---|---|
| The repo venv (`venv\Scripts\python.exe`, Python 3.12+, 64-bit) | Backend install, PyInstaller, the firmware toolchain | The script refuses to run without it. The bitness of this Python is the exe's, and the installer only allows x64 |
| Node.js 20+ | `npm ci` / `npm run build` of the frontend | `npm ci` only runs when `frontend\node_modules` is missing |
| PlatformIO and its ESP32 toolchain | The device firmware the exe serves | Pinned in `firmware\requirements.txt`, which the script pip-installs into the venv; PlatformIO downloads the toolchain itself on the first build. Run the script from PowerShell, not Git Bash ([firmware.md](firmware.md)) |
| Inno Setup 6.2+ | The installer stage | <https://jrsoftware.org/isdl.php>. Not a dependency of the app: the script finds `ISCC.exe` on the machine (Inno's uninstall key in HKLM or HKCU, then `PATH`, then `Program Files (x86)\Inno Setup 6`). The script is written against 6.2 (`ArchitecturesAllowed=x64`, not 6.3's `x64compatible`) |

Pillow is **not** a prerequisite. The icon and the wizard bitmaps are committed; see
[Art](#art).

## Stages and parameters

A bare `.\installer\build.ps1` runs every stage, in this order:

| Stage | What it does | Skip with |
|---|---|---|
| frontend | `npm run build` into `frontend\dist` | `-SkipFrontend` (bundles the `frontend\dist` already there) |
| backend | `pip install -e backend[packaging]` (refreshes the package metadata `__version__` reads, and installs PyInstaller) | never |
| firmware | `firmware\build.py`: builds the image and writes it into the backend package | `-SkipFirmware` (bundles the image already there) |
| exe | PyInstaller over `installer\UltrastarWingman.spec`, with a Windows version resource | never |
| installer | `ISCC.exe installer\UltrastarWingman.iss` with the version and paths as `/D` defines; with `-UsdxDir`, then the USDX stage and a second ISCC run with `/DBundleUsdx` | `-SkipInstaller` (the exe alone; Inno Setup is then not needed) |

`-OutDir <dir>` (default `installer\dist`) is where the files land. PyInstaller's work
files stay in `installer\build`, which also holds the generated `version_info.txt` and the
USDX stage.

Before anything runs, the script fails fast on what would otherwise fail at the end: no
`ISCC.exe` while the installer stage is wanted (naming the download page), a `-Skip…` with
nothing prebuilt to bundle, an `UltrastarWingman.exe` in `-OutDir` that is locked, and a
`-UsdxDir` without `ultrastardx.exe`, without USDX's license text, or beside `-SkipInstaller`.
Every native tool (npm, pip, PyInstaller, ISCC) is judged by its exit code, not by what it
prints to stderr. The last lines list what was built, with sizes.

### The live-exe lock

A running `UltrastarWingman.exe` cannot be overwritten. If the host's Wingman runs out of
`installer\dist` (it often does on the development machine), build somewhere else:

```powershell
.\installer\build.ps1 -OutDir "$env:TEMP\wingman-build"
```

Never stop somebody else's Wingman to make room; see [verifying.md](verifying.md).

## Versions

`version` in `backend\pyproject.toml` is the only place a version is written down. The
script reads it and passes it on:

- `ultrastar_wingman.__version__` and `/api/v1/health` report it (package metadata).
- The exe's version resource (Properties > Details) and the installer's `AppVersion`, its
  file name and the version Apps & features shows carry the string as is.
- `VersionInfoVersion` and the exe's binary file version need four numbers, so the script
  takes the leading numbers and pads them: `0.2.0` → `0.2.0.0`, `0.2.0rc1` → `0.2.0.0`.

The installer's downgrade check compares the same leading numbers, so a pre-release and
its final release count as the same version there.

## The installer script

`installer\UltrastarWingman.iss` compiles on its own from the Inno IDE too: every define
has an `#ifndef` default (version `0.0.0`, the exe and the output in `installer\dist`).
The decisions inside it, each commented where it is made:

- **AppId** `{66ABF566-D476-4D71-97CE-158493516D4E}` is fixed forever. Every edition of
  the installer uses it, so whichever one is run updates the same installation. (The old
  project's AppId belongs to that app and is not reused.)
- **Per user** (`PrivilegesRequired=lowest`, no override): installs to
  `%LOCALAPPDATA%\Programs\Ultrastar Wingman`, uninstall key under HKCU. The edition
  with Ultrastar Deluxe needs a user-writable install folder: the game writes its
  `config.ini`, `Ultrastar.db` and songs next to its exe.
- **Update in place**: `UsePreviousAppDir` and `DisableDirPage=auto` are Inno's defaults,
  so an update reuses the folder and does not ask for one.
- **`CloseApplications=force`**, measured, not assumed: Restart Manager cannot close a
  console program gracefully, so `yes` ended Wingman after about six seconds anyway,
  reported failure and aborted a silent update with the old exe in place. `force` ends it
  the same way and the update completes. The wizard asks first either way.
  `RestartApplications=no`: Wingman never registers for restart.
- **The uninstaller refuses while Wingman runs** (a WMI query for a process running the
  installed exe, in `InitializeUninstall`), because otherwise it removes everything but
  the locked exe and leaves a server without an installation. The same for a running
  `{app}\usdx\ultrastardx.exe`, its own message. A silent uninstall gives up (exit code 1).
- **Downgrade warning** in `InitializeSetup`, defaulting to Yes for a silent install.
- **No `AppMutex`**: Wingman creates no mutex, and adding one is an app change.
- **User data is never touched**: no `[UninstallDelete]`; the data directory
  (`%LOCALAPPDATA%\Ultrastar Wingman`) lies outside `{app}` anyway.
- No code signing (no certificate), no firewall rule (needs admin), no autostart.

## The edition with Ultrastar Deluxe

```powershell
.\installer\build.ps1 -UsdxDir D:\git\USDX-new\game
```

`-UsdxDir` is the game directory of a built Ultrastar Deluxe, the folder holding
`ultrastardx.exe`; the example is the development machine's build of the fork
<https://github.com/Yannis4444/USDX>. It has no default, so no user's path is written into
the repo. Given, the installer stage builds the plain setup first and then
`UltrastarWingman-<version>-with-usdx-setup.exe` beside it, one build for both editions.

**Prebuilt, never compiled here.** USDX builds with Free Pascal, MSYS2 and its own DLL
pipeline, in a separate repo with its own CI; Wingman's build takes a finished game
directory, the way it takes Inno Setup.

**The allowlist.** A game directory somebody plays from holds the host's runtime state:
`config.ini` and Wingman's `config.ini.wingman-backup`, the scores in `Ultrastar.db`,
`Error.log`, `songs\`, `playlists\`, `screenshots\`, and in `avatars\` the player pictures
Wingman copied there. So `build.ps1` copies only what is named (`$UsdxShipDirs`,
`$UsdxShipFiles`), and anything a newer USDX adds has to be added there on purpose:

| Ships | What |
|---|---|
| Folders | `avatars`, `covers`, `fonts`, `languages`, `plugins`, `resources`, `sounds`, `themes`, `visuals`, `webs` |
| Files | `ultrastardx.exe`, every `*.dll`, `LICENSE.*.txt` (its libraries), `LuaCommands.odt`, `README.ijg` |
| Never | `avatars\` files named `<32 hex>.jpg/.png/.webp` (a player id plus `images.IMAGE_TYPES`' extension, which is what `usdx_config._place_avatar` writes), and everything not listed above |

USDX's own license is not in the game directory. Its NSIS installer ships
`installer\dependencies\documents\license.txt` of the USDX checkout (the GPLv2 under a line
saying "or a newer version"; the repo's bare `LICENSE` lacks that line), so the script takes
that file, or a `license.txt` inside `-UsdxDir` (where an installed USDX keeps it), and
stages it as `usdx\LICENSE.txt` beside the `LICENSE.<library>.txt` files. Neither found
fails the build.

**The stage** is `installer\build\usdx`, wiped and refilled on every run, so a file an
earlier USDX build had never ships by accident. `ISCC` gets it as `/DUsdxStage` and the
`.iss` takes it whole (`recursesubdirs`, `ignoreversion`).

What the edition does on top of the plain one (the folder warning is under
`#ifdef BundleUsdx`; the rest follows from the files it carries):

- **Not-ASCII warning.** A folder with a character beyond ASCII in its path makes USDX
  unable to start songs, and a per-user install lands under the Windows user name. The
  directory page asks (default No). An update that skips the page asks on the Ready page,
  and only while `{app}\usdx\ultrastardx.exe` is not there yet, so a folder the host
  accepted once is not asked about on every update. A silent install logs the line and
  goes on.
- **Update** replaces the game's files. `config.ini`, `Ultrastar.db`, `songs\` and the rest
  of what USDX and Wingman write are no installed files, so they stay. A running
  `ultrastardx.exe` out of `{app}\usdx` is closed by `CloseApplications=force` like Wingman.
- **Uninstall** removes the installed files and leaves the rest of `usdx\` behind. Like a
  running Wingman, a running `{app}\usdx\ultrastardx.exe` makes it refuse (the same WMI
  query, in both editions, since the plain one inherits the uninstall log).

The plain edition run over a bundled install leaves `{app}\usdx` alone and says so in an
informational box (logged and skipped when silent); the frozen exe keeps finding it, and
Inno's uninstall log, appended to for the same AppId, still lists the game's files. The
bundled edition over a plain install simply adds `usdx\`.

## Art

`installer\make_icon.py` regenerates `UltrastarWingman.ico` and the four wizard bitmaps
(`wizard-image*.bmp`, `wizard-small*.bmp`, 100 % and 200 % DPI, on the app's
`--tile-bg`) from `frontend\public\logo.png`. Run it when the logo changes, with Pillow
from a throwaway directory so it never becomes a dependency:

```powershell
venv\Scripts\python.exe -m pip install --target $env:TEMP\pillow pillow
$env:PYTHONPATH = "$env:TEMP\pillow"; venv\Scripts\python.exe installer\make_icon.py
```

## Testing an installer

Never install into `%LOCALAPPDATA%\Programs` on a machine with a real installation, and
never start an installed exe without `WINGMAN_DATA_DIR`, `WINGMAN_PORT` and
`WINGMAN_OPEN_BROWSER=false` ([verifying.md](verifying.md)): the app migrates its data
directory before it binds the port.

```powershell
UltrastarWingman-<version>-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="<scratch>\Wingman Test" /LOG="<scratch>\install.log"
"<scratch>\Wingman Test\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Always pass `/NORESTART`: a very silent setup that needs a restart restarts Windows without
asking. One AppId means one uninstall key and one Start menu entry, so test one scratch
install at a time and uninstall it before the next. Never start the `ultrastardx.exe` of a
scratch install of the edition with Ultrastar Deluxe; `GET /api/v1/karaoke/status` saying
`"bundled": true` is the check that Wingman found it. Afterwards, check that the key
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{66ABF566-D476-4D71-97CE-158493516D4E}_is1`
and the Start menu shortcut are gone.

## Silent installs

What a scripted install or uninstall does, measured on Inno Setup 6.2.0:

| Switch | Effect |
|---|---|
| `/VERYSILENT` or `/SILENT`, with `/SUPPRESSMSGBOXES /NORESTART` | No wizard; every question takes its scripted default. The `[Run]` launch entry is `skipifsilent`, so Wingman is never started afterwards |
| `/DIR="<folder>"` | Another install folder. Leave it out on an update: the setup then reuses the installed one |
| `/MERGETASKS="desktopicon"` / `/MERGETASKS="!desktopicon"` | Add or take away the desktop icon; taking it away removes the one a previous install made |
| `/LOG="<file>"`, `/LOGCLOSEAPPLICATIONS` | A log, and Restart Manager's part in it |
| `/NOCLOSEAPPLICATIONS` | Leaves a running Wingman alone: the locked exe cannot be replaced and the setup rolls back (exit code 5) |
| (default, a Wingman running from `{app}`) | Restart Manager ends it after about six seconds without a graceful shutdown, and the update completes (exit code 0) |
| downgrade | The warning takes its suppressed default, Yes, and logs it |
| `unins000.exe /VERYSILENT /SUPPRESSMSGBOXES` | Uninstalls; while Wingman runs from `{app}` it refuses (exit code 1) and leaves everything in place. Without `/SUPPRESSMSGBOXES` the Retry/Cancel box still shows (Inno's documented behavior, not measured) |

## Cutting a release

1. Bump `version` in `backend\pyproject.toml` (and nothing else) and commit it.
2. Run `.\installer\build.ps1 -UsdxDir <USDX game directory>` on a clean checkout of that
   commit, outside any folder a running Wingman uses.
3. Publish the three files from the output directory on the GitHub release:
   `UltrastarWingman-<version>-setup.exe`, `UltrastarWingman-<version>-with-usdx-setup.exe`
   and `UltrastarWingman.exe`. Say in the release notes which USDX commit the bundled
   edition carries, since the GPL asks for its source to be reachable.
