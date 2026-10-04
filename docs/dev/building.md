# Building the exe and the installer

`installer\build.ps1` builds the Windows deliverables from a checkout:

- `UltrastarWingman.exe`: the portable one-file exe (PyInstaller). Frontend, backend,
  migrations, the shipped badge pictures and the device firmware are all inside it.
- `UltrastarWingman\`: the same program as PyInstaller's folder build,
  `UltrastarWingman.exe` beside an `_internal` folder. Not published; it is the
  installer's input. See [Two layouts](#two-layouts).
- `UltrastarWingman-<version>-setup.exe`: the Inno Setup installer carrying that folder. Per
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
| The repo venv (`venv\Scripts\python.exe`, Python 3.12+, 64-bit) | Backend install, PyInstaller, the firmware toolchain | Create it once in the repo root with `py -3.12 -m venv venv`. The script refuses to run without it. The bitness of this Python is the exe's, and the installer only allows x64 |
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
| backend | `pip install -e backend[packaging]` (refreshes the package metadata `__version__` reads, and installs PyInstaller, pinned to one version in that extra because it decides what goes into every exe: upgrading it is a deliberate change of the pin) | never |
| firmware | `firmware\build.py`: builds the image and writes it into the backend package | `-SkipFirmware` (bundles the image already there) |
| exe | PyInstaller over `installer\UltrastarWingman.spec`, with a Windows version resource: the portable `UltrastarWingman.exe` | never |
| folder | the same spec again with `-- --onedir`: `UltrastarWingman\` | `-SkipInstaller`, since only the installer carries it |
| installer | `ISCC.exe installer\UltrastarWingman.iss` with the version and paths as `/D` defines (`/DAppDir` is the folder); with `-UsdxDir`, then the USDX stage and a second ISCC run with `/DBundleUsdx` | `-SkipInstaller` (the portable exe alone; Inno Setup is then not needed) |

`-OutDir <dir>` (default `installer\dist`) is where the files land. PyInstaller's work
files stay in `installer\build\onefile` and `installer\build\onedir`, beside the generated
`version_info.txt` and the USDX stage in `installer\build`.

Before anything runs, the script fails fast on what would otherwise fail at the end: no
`ISCC.exe` while the installer stage is wanted (naming the download page), a `-Skip…` with
nothing prebuilt to bundle, an `UltrastarWingman.exe` in `-OutDir` that is locked (or, when
the folder is built, `UltrastarWingman\UltrastarWingman.exe`), and a `-UsdxDir` that is no
folder, without `ultrastardx.exe`, without USDX's license text, or beside `-SkipInstaller`.
`-OutDir` is created only after those checks, so a refused run leaves no empty folder. Both
paths lose a trailing backslash (unless they are a drive root): Windows PowerShell 5.1
quotes a native argument holding a space without escaping the backslash before the closing
quote, so `-OutDir "C:\a b\"` reached PyInstaller merged with the next argument. Every native
tool (npm, pip, PyInstaller, ISCC) is judged by its exit code, not by what it prints to
stderr. The last lines list what was built, with sizes (a folder's is its files' sum).

### Two layouts

The portable download is one file because "download one exe and double-click it" is a
documented way to run Wingman. A one-file exe pays for that on every start: its
bootloader unpacks about 95 MB (measured) into `%TEMP%\_MEI<number>` before Python runs
and deletes it on exit, so it starts slower, and an exe ended hard leaves that folder
behind. An update
ends a running Wingman exactly that way (`CloseApplications=force`, below), and four such
folders were found on the development machine. So the installer carries the folder
build: `UltrastarWingman.exe` with everything it loads in `_internal\`, unpacked once at
install time.

One spec, one `Analysis`, two outputs, picked by a spec argument: none is the one-file
`EXE`, `--onedir` is an `EXE` with `exclude_binaries=True` plus a `COLLECT` named
`UltrastarWingman`. Both exe share one `exe_options` dict (name, icon, version resource,
`console=True`, `upx=False`) and the same `datas` and `hiddenimports`, so a difference
between the two is a bug. The script runs PyInstaller once per layout with its own
`--workpath`: PyInstaller names an exe's archive in the work folder after the exe
(`UltrastarWingman.pkg`), so two exe of that name in one run would overwrite each other's.
The cost is a second analysis, about 30 seconds on the development machine. Giving the
folder's exe another name and renaming it afterwards would save that, but would leave the
spec building a misnamed exe for anyone running it by hand. `COLLECT` empties
`-OutDir\UltrastarWingman\` before it fills it.

The folder build puts the bundle's paths on the disk, so their length counts. Inno Setup
6.2 is not long-path aware: ISCC fails on a source path past Windows' 259 characters, and
Setup fails on a destination path past it. Measured: the edition with Ultrastar Deluxe run
over a plain install in a 152-character folder failed with `MoveFile` code 3 on a
262-character projectM preset, after `[InstallDelete]` had already swept `_internal`, and
left a Wingman that did not start. So the script measures the deepest path of each payload
below `{app}` and passes it as `/DLongestPath`: 98 characters for the plain edition (a
migration's file name in `_internal`), 109 for the one with Ultrastar Deluxe (a projectM
preset under `usdx\visuals`). A folder counts 13 more, because Setup writes every file into
it as a 12-character `is-XXXXX.tmp` before `MoveFile` names it (and `CreateDirectory` keeps
room for an 8.3 name below it); the deepest folders (72 and 29 characters) stay under the
file maxima that way, so one number covers both. `FolderFits` in the `.iss` refuses a folder
longer than 259 - 1 - `LongestPath` (160 and 149 characters) on the directory page and
again on the Ready page, the only page an update shows, before anything is deleted. A
silent setup logs the refusal and exits with code 1, having written nothing. Measured at
the edge: a 149-character folder installed the bundled edition, its deepest file exactly
259 characters, and a 150-character one was refused. Without `/DLongestPath` (the IDE) the
`.iss` assumes 130.

The spec drops `__pycache__` from the bundled data for the same reason: a checkout that
ran the backend holds one beside the migrations, its bytecode is the build machine's and a
frozen Wingman writes none, and its names added 30 characters, enough to make ISCC fail
with "The system cannot find the path specified" over an `-OutDir` deep in `%TEMP%`. Keep
`-OutDir` short.

Nothing in the app assumes either layout. The four places that read bundled files
(`frontend.resolve_frontend_dir`, `db.migrations_dir`, `achievements.pictures.images_dir`,
`devices.firmware.firmware_dir`) go through `sys._MEIPASS`, which is the unpacked folder in
one and `_internal` in the other, and `config.bundled_usdx_dir` looks next to
`sys.executable`, the outer exe in both: `{app}\usdx` once installed.

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
has an `#ifndef` default (version `0.0.0`, the folder build and the output in
`installer\dist`).
The decisions inside it, each commented where it is made:

- **AppId** `{66ABF566-D476-4D71-97CE-158493516D4E}` is fixed forever. Every edition of
  the installer uses it, so whichever one is run updates the same installation. (The old
  project's AppId belongs to that app and is not reused.)
- **Per user** (`PrivilegesRequired=lowest`, no override): installs to
  `%LOCALAPPDATA%\Programs\Ultrastar Wingman`, uninstall key under HKCU. Ultrastar
  Deluxe writes its `config.ini`, `Ultrastar.db` and songs next to its exe, so in
  Program Files the edition with it would need a users-modify grant on the folder
  holding `ultrastardx.exe` and its DLLs, which Inno's documentation of `[Dirs]`
  `Permissions` warns against (USDX's own NSIS installer makes that grant, as a
  stopgap). Every update would also bring a UAC prompt for an unsigned setup, and
  Wingman's own data is per user anyway.
- **Update in place**: `UsePreviousAppDir` and `DisableDirPage=auto` are Inno's defaults,
  so an update reuses the folder and does not ask for one. An update (an uninstall key
  with a `DisplayVersion`, `IsUpdate()`) also skips the License and Select Tasks pages in
  `ShouldSkipPage`, leaving the Ready page alone: `AlwaysShowDirOnReadyPage=yes` names
  the folder there, and its label reads "Ultrastar Wingman <installed> is installed …
  replace it with version <new>" (`ReadyToUpdate`). The cost: a wizard update cannot add
  or take away the desktop icon; `/MERGETASKS` still can ([below](#silent-installs)).
- **`CloseApplications=force`**, measured, not assumed: Restart Manager cannot close a
  console program gracefully, so `yes` ended Wingman after about six seconds anyway,
  reported failure and aborted a silent update with the old exe in place. `force` ends it
  the same way and the update completes. The wizard asks first either way.
  `RestartApplications=no`: Wingman never registers for restart.
- **The uninstaller refuses while Wingman runs** (`ProcessRunning`, in
  `InitializeUninstall`), because otherwise it removes everything but the locked exe and
  leaves a server without an installation. The same for a running
  `{app}\usdx\ultrastardx.exe`, its own message. A silent uninstall gives up (exit code 1).
  `ProcessRunning` asks WMI for a process running that exe, and when that finds none, tries
  to open the exe for writing while sharing everything, which Windows refuses for the exe
  of any running process: WMI leaves `ExecutablePath` empty for a process of higher
  integrity, so a Wingman started with "Run as administrator" is invisible to the query.
  When WMI itself fails, the answer is "running". A wrong "running" costs a skipped sweep
  or one more Retry, a wrong "not running" deletes files under a live program.
- **The install folder's length** is capped by `FolderFits`; see
  [Two layouts](#two-layouts) for the measurement.
- **The folder build whole** (`Source: "{#AppDir}\*"`, `recursesubdirs`), so the exe lands
  at `{app}\UltrastarWingman.exe`, where the shortcuts, `[Run]`, `UninstallDisplayIcon`
  and the uninstaller's process check look, with `{app}\_internal\` beside it. First,
  `[InstallDelete]` removes `{app}\_internal` whole, because a file a newer build dropped
  would otherwise stay and could still be imported. It runs after `CloseApplications` has
  ended a running Wingman. Inno does not roll `[InstallDelete]` back, so it is skipped
  while the installed exe still runs (`Check: not WingmanRunning`, the uninstaller's
  `ProcessRunning`): under `/NOCLOSEAPPLICATIONS`, or "Do not close the applications" in the wizard,
  it would take every file the server does not hold open before the locked exe aborts the
  update. An update that fails after it for another reason (a full disk) leaves an
  installation that does not start until the setup is run again.
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

**`usdx\SOURCE.txt`** ships beside it, because GPLv2 §3 asks whoever passes the game's
binaries on to make its corresponding source available, and the copy itself should say
where. The script writes the fork's URL, `git -C <UsdxDir> rev-parse HEAD` when
`-UsdxDir` sits inside a git checkout (otherwise a warning and no commit line; a checkout
with uncommitted changes to tracked files warns too) and the first line of
`<UsdxDir>\..\VERSION` when that file exists.

**The stage** is `installer\build\usdx`, wiped and refilled on every run, so a file an
earlier USDX build had never ships by accident. `ISCC` gets it as `/DUsdxStage` and the
`.iss` takes it whole (`recursesubdirs`, `ignoreversion`).

What the edition does on top of the plain one (everything `#ifdef BundleUsdx` in the
`.iss`, and what follows from the files it carries):

- **Not-ASCII warning.** A folder with a character beyond ASCII in its path makes USDX
  unable to start songs, and a per-user install lands under the Windows user name. The
  directory page asks (default No). An update that skips the page asks on the Ready page,
  and only while `{app}\usdx\ultrastardx.exe` is not there yet, so a folder the host
  accepted once is not asked about on every update. A silent install logs the line and
  goes on.
- **The songs folder.** `[Dirs]` creates `{app}\usdx\songs` with `uninsneveruninstall`,
  so it is there before Wingman ever ran and the uninstaller never removes it, even
  empty. A Start menu entry **Ultrastar Wingman songs** opens it, since
  `%LOCALAPPDATA%` is hidden (USDX's own installer names its entry "Songs", inside a
  Start menu folder Wingman does not have).
- **Update** replaces the game's files. `config.ini`, `Ultrastar.db`, `songs\` and the rest
  of what USDX and Wingman write are no installed files, so they stay. A running
  `ultrastardx.exe` out of `{app}\usdx` is closed by `CloseApplications=force` like Wingman.
  First `[InstallDelete]` removes `usdx\plugins\*.usdx` and `usdx\webs\*.dll`: USDX loads
  every file of those kinds in those folders (`ULuaCore.pas`, `UDLLManager.pas`), so one a
  newer build dropped would go on loading. The fork's build ships no web DLL today, but
  the folder loads whatever lands in it. A host's own plugin in either folder is lost on
  update, as with USDX's own installer (which wipes both folders whole). Nothing else is
  deleted ahead: Inno does not roll `[InstallDelete]` back, and an update that aborts
  must leave a game that starts, so themes, languages and the DLLs beside the exe stay
  until they are overwritten.
- **Uninstall** removes the installed files and leaves the rest of `usdx\` behind. Like a
  running Wingman, a running `{app}\usdx\ultrastardx.exe` makes it refuse (the same WMI
  query, in both editions, since the plain one inherits the uninstall log).

The plain edition run over a bundled install leaves `{app}\usdx` alone and says so in an
informational box (logged and skipped when silent); the frozen exe keeps finding it, and
Inno's uninstall log, appended to for the same AppId, still lists the game's files. The
bundled edition over a plain install adds `usdx\`, and on the Ready page, when
`{app}\UltrastarWingman.exe` is there and `{app}\usdx\ultrastardx.exe` is not, says in an
informational box (`UsdxNowBundled`, logged, skipped when silent) that Wingman now uses
the game it brings instead of the one in its settings. It says nothing about microphones:
the game itself does when none is set up, which the user ruled is enough.

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
and the Start menu shortcuts are gone (the edition with Ultrastar Deluxe makes two), and
that `usdx\songs` is still there.

On a machine where Wingman is really installed, that key and those shortcuts are the real
installation's: a test setup with the real AppId takes them over even with `/DIR`
elsewhere, and its uninstall deletes them. Compile a copy of the `.iss` instead, with
another `AppGuid`, `AppName` and `SetupMutex` and nothing else changed (the `.ico`, the
four bitmaps beside it and `LICENSE` one folder up), against the real payload and
`/DLongestPath`.

## Silent installs

What a scripted install or uninstall does, measured on Inno Setup 6.2.0:

| Switch | Effect |
|---|---|
| `/VERYSILENT` or `/SILENT`, with `/SUPPRESSMSGBOXES /NORESTART` | No wizard; every question takes its scripted default. The `[Run]` launch entry is `skipifsilent`, so Wingman is never started afterwards |
| `/DIR="<folder>"` | Another install folder. Leave it out on an update: the setup then reuses the installed one |
| `/MERGETASKS="desktopicon"` / `/MERGETASKS="!desktopicon"` | Add or take away the desktop icon; taking it away removes the one a previous install made. On an update this is the only way to change it: the wizard skips the Select Tasks page then |
| `/LOG="<file>"`, `/LOGCLOSEAPPLICATIONS` | A log, and Restart Manager's part in it |
| `/NOCLOSEAPPLICATIONS` | Leaves a running Wingman alone: `[InstallDelete]` skips `_internal` while the exe runs, the locked exe cannot be replaced, and the setup rolls back (exit code 5). The running Wingman goes on answering, and the installation starts as before. (Without that `Check`, the deletion took the 320 of 364 files the server did not hold open, Inno does not roll it back, and the closed Wingman did not start again until the setup was run again) |
| (default, a Wingman running from `{app}`) | Restart Manager ends it within a second (measured 0.3 to 0.55 s) without a graceful shutdown, and the update completes (exit code 0) |
| a folder too long for the deepest path | `FolderFits` logs the refusal and the setup exits with code 1, having written nothing ([Two layouts](#two-layouts)) |
| downgrade | The warning takes its suppressed default, Yes, and logs it |
| `unins000.exe /VERYSILENT /SUPPRESSMSGBOXES` | Uninstalls; while Wingman runs from `{app}` it refuses (exit code 1) and leaves everything in place. Without `/SUPPRESSMSGBOXES` the Retry/Cancel box still shows (Inno's documented behavior, not measured) |

## Cutting a release

1. Bump `version` in `backend\pyproject.toml` (and nothing else) and commit it.
2. Run `.\installer\build.ps1 -UsdxDir <USDX game directory>` on a clean checkout of that
   commit, outside any folder a running Wingman uses.
3. Publish the three files from the output directory on the GitHub release:
   `UltrastarWingman-<version>-setup.exe`, `UltrastarWingman-<version>-with-usdx-setup.exe`
   and `UltrastarWingman.exe`, not the `UltrastarWingman` folder, which both setups
   carry. Say in the release notes which USDX commit the bundled
   edition carries (the one in `usdx\SOURCE.txt`), since the GPL asks for its source to
   be reachable.
