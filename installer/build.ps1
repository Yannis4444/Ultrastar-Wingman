<#
.SYNOPSIS
Builds the portable UltrastarWingman.exe (frontend + backend + migrations + firmware in one
file), the UltrastarWingman folder (the same program as an exe beside an _internal folder)
and the installer that carries that folder, UltrastarWingman-<version>-setup.exe. With
-UsdxDir also UltrastarWingman-<version>-with-usdx-setup.exe, the edition that brings
Ultrastar Deluxe.

.DESCRIPTION
Run from anywhere: .\installer\build.ps1. The stages run in order: frontend, backend,
firmware, exe, folder, installer. docs\dev\building.md explains each one and how a release
is cut.

.PARAMETER OutDir
Where the exe, the folder and the installer land. Default installer\dist. A running Wingman
locks its exe, so build somewhere else while one runs out of this folder.

.PARAMETER SkipFrontend
Bundle the frontend\dist already there instead of rebuilding it.

.PARAMETER SkipFirmware
Bundle the firmware image already in the backend package instead of rebuilding it.

.PARAMETER SkipInstaller
Build the portable exe alone, without the folder only the installer carries; Inno Setup is
then not needed.

.PARAMETER UsdxDir
A built Ultrastar Deluxe game directory (the one holding ultrastardx.exe). Given, the
installer stage also writes UltrastarWingman-<version>-with-usdx-setup.exe, which carries
that Ultrastar Deluxe under {app}\usdx. Only an allowlist of its files ships: a game
directory that has been played holds the host's config.ini, scores and songs.
#>
param(
    [string]$OutDir,
    [switch]$SkipFrontend,
    [switch]$SkipFirmware,
    [switch]$SkipInstaller,
    [string]$UsdxDir
)
$ErrorActionPreference = "Stop"

function Invoke-Step {
    param([string]$Name, [scriptblock]$Step)
    Write-Host "==> $Name" -ForegroundColor Cyan
    # npm and pip write progress to stderr; with $ErrorActionPreference = "Stop" that alone
    # would abort the build. The exit code below is the actual verdict.
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    & $Step
    # Native tools (npm, pip, pyinstaller, ISCC) fail by exit code, not by throwing.
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

function Find-Iscc {
    # Inno Setup's own installer records where it went; a copy on D:\ or installed per user
    # is invisible to the Program Files guess at the end.
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1"
    )
    foreach ($key in $keys) {
        $location = (Get-ItemProperty -Path $key -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation
        if ($location -and (Test-Path (Join-Path $location "ISCC.exe"))) {
            return Join-Path $location "ISCC.exe"
        }
    }
    $onPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    # Only a 64-bit Windows has Program Files (x86); Join-Path on a missing one would throw.
    if (${env:ProgramFiles(x86)}) {
        $guess = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
        if (Test-Path $guess) { return $guess }
    }
    return $null
}

# What of a built Ultrastar Deluxe game directory the bundled edition ships. An allowlist,
# not a blocklist: the directory a developer builds USDX into is also the one they play
# from, so it holds config.ini (+ Wingman's .wingman-backup), Ultrastar.db, Error.log,
# songs\, playlists\ and screenshots\: the host's runtime state, which must never travel
# in an installer. Anything new USDX grows has to be added here on purpose.
$UsdxShipDirs = @("avatars", "covers", "fonts", "languages", "plugins", "resources", "sounds", "themes", "visuals", "webs")
$UsdxShipFiles = @("ultrastardx.exe", "*.dll", "LICENSE.*.txt", "LuaCommands.odt", "README.ijg")
# The pictures Wingman copies into USDX's avatars folder before a song
# (karaoke.usdx_config._place_avatar): named after the player, <uuid4 hex><extension>, the
# extensions being images.IMAGE_TYPES'. USDX's own avatars (1.png, female1.jpg, ...) are
# not named like that.
$WingmanAvatar = '^[0-9a-f]{32}\.(jpg|png|webp)$'

# USDX's license does not live in the game directory: its NSIS installer ships
# installer\dependencies\documents\license.txt from the USDX checkout (the GPLv2 text under
# a line saying "v2 or any later version"; the repo's bare LICENSE lacks that line). An
# installed USDX carries the same file as license.txt next to its exe.
function Find-UsdxLicense {
    param([string]$GameDir)
    foreach ($candidate in @(
            (Join-Path $GameDir "license.txt"),
            (Join-Path $GameDir "..\installer\dependencies\documents\license.txt"))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    return $null
}

# Wipes $Stage and copies the allowlist of $GameDir into it, plus USDX's license as
# LICENSE.txt (next to the LICENSE.<library>.txt of its libraries).
function Copy-UsdxStage {
    param([string]$GameDir, [string]$Stage, [string]$License)
    if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
    New-Item -ItemType Directory -Force $Stage | Out-Null
    foreach ($pattern in $UsdxShipFiles) {
        # -Filter alone is Win32's matching, which also tries the 8.3 short name: "*.dll"
        # would take "foo.dllx" (short name FOO~1.DLL). -like holds it to the long name.
        Get-ChildItem -LiteralPath $GameDir -File -Filter $pattern |
            Where-Object { $_.Name -like $pattern } | ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $Stage
            }
    }
    foreach ($dir in $UsdxShipDirs) {
        $source = Join-Path $GameDir $dir
        if (-not (Test-Path -LiteralPath $source -PathType Container)) {
            Write-Warning "Ultrastar Deluxe has no $dir folder; the bundled edition ships without it."
            continue
        }
        Get-ChildItem -LiteralPath $source -File -Recurse | ForEach-Object {
            if ($dir -eq "avatars" -and $_.DirectoryName -eq $source -and $_.Name -cmatch $WingmanAvatar) {
                Write-Host "  leaving out avatars\$($_.Name) (a Wingman player's picture)"
                return
            }
            $target = Join-Path (Join-Path $Stage $dir) $_.FullName.Substring($source.Length).TrimStart("\")
            New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $target
        }
    }
    Copy-Item -LiteralPath $License -Destination (Join-Path $Stage "LICENSE.txt")
    Write-UsdxSource -GameDir $GameDir -Stage $Stage
}

# The GPLv2 (section 3) asks whoever passes the game's binaries on to make its source
# available, so SOURCE.txt beside LICENSE.txt says where it is: the fork, the commit the
# game directory was built from when it sits in a git checkout, and USDX's VERSION file.
function Write-UsdxSource {
    param([string]$GameDir, [string]$Stage)
    $lines = @(
        "The Ultrastar Deluxe in this folder is free software under the GNU General Public",
        "License (LICENSE.txt). Its source code:",
        "",
        "https://github.com/Yannis4444/USDX"
    )
    # git writes to stderr when the folder is no checkout, which "Stop" would turn into a
    # failed build; the exit code is the verdict, as in Invoke-Step.
    $ErrorActionPreference = "Continue"
    $commit = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $commit = & git -C $GameDir rev-parse HEAD 2>$null
        if ($LASTEXITCODE -ne 0) { $commit = $null }
    }
    if ($commit) {
        $lines += "Commit: $commit"
        if (& git -C $GameDir status --porcelain --untracked-files=no 2>$null) {
            Write-Warning "The Ultrastar Deluxe checkout has uncommitted changes; SOURCE.txt names commit $commit all the same."
        }
    } else {
        Write-Warning "$GameDir is not inside a git checkout; SOURCE.txt names no commit."
    }
    $global:LASTEXITCODE = 0
    $versionFile = Join-Path $GameDir "..\VERSION"
    if (Test-Path -LiteralPath $versionFile -PathType Leaf) {
        $lines += "Version: " + (Get-Content -LiteralPath $versionFile -TotalCount 1).Trim()
    }
    [IO.File]::WriteAllText((Join-Path $Stage "SOURCE.txt"), ($lines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
    Write-Host "  SOURCE.txt: $(($lines | Select-Object -Skip 3) -join ', ')"
}

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "No venv at $python" }
$frontend = Join-Path $root "frontend"
$firmware = Join-Path $root "backend\src\ultrastar_wingman\devices\firmware"
$work = Join-Path $PSScriptRoot "build"

if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot "dist" }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$exe = Join-Path $OutDir "UltrastarWingman.exe"
# The installer's input: the same program, unpacked once into a folder at build time rather
# than into %TEMP% on every start. Only built when the installer stage runs.
$appDir = Join-Path $OutDir "UltrastarWingman"
$appExe = Join-Path $appDir "UltrastarWingman.exe"

# Everything that can fail without building anything fails here, before minutes of npm and
# PyInstaller: a missing tool, a missing prebuilt part, or an exe that cannot be replaced.
$iscc = $null
if (-not $SkipInstaller) {
    $iscc = Find-Iscc
    if (-not $iscc) {
        throw "Inno Setup 6 (ISCC.exe) not found. Install it from https://jrsoftware.org/isdl.php, or pass -SkipInstaller to build the exe alone."
    }
}
if ($SkipFrontend -and -not (Test-Path (Join-Path $frontend "dist\index.html"))) {
    throw "-SkipFrontend, but there is no frontend\dist to bundle. Build once without it."
}
if ($SkipFirmware -and -not (Test-Path (Join-Path $firmware "manifest.json"))) {
    throw "-SkipFirmware, but there is no firmware image in $firmware. Build once without it."
}
$usdxLicense = $null
if ($UsdxDir) {
    if ($SkipInstaller) { throw "-UsdxDir only feeds the installer stage; drop -SkipInstaller or -UsdxDir." }
    if (-not (Test-Path -LiteralPath (Join-Path $UsdxDir "ultrastardx.exe") -PathType Leaf)) {
        throw "-UsdxDir $UsdxDir holds no ultrastardx.exe. Pass the game directory of a built Ultrastar Deluxe."
    }
    $UsdxDir = (Resolve-Path -LiteralPath $UsdxDir).Path
    $usdxLicense = Find-UsdxLicense $UsdxDir
    if (-not $usdxLicense) {
        throw "Ultrastar Deluxe's license text was not found: neither $UsdxDir\license.txt nor installer\dependencies\documents\license.txt of the USDX checkout around it. The GPL asks for it to travel with the game."
    }
}
$replaced = @($exe)
if (-not $SkipInstaller) { $replaced += $appExe }
foreach ($file in $replaced) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    # A running exe can be read but not rewritten; PyInstaller would only find out at the
    # very end, after the whole build. A running folder build also locks the DLLs in its
    # _internal, which PyInstaller empties first; its exe stands for all of them.
    try { [IO.File]::Open($file, "Open", "ReadWrite", "None").Dispose() }
    catch { throw "$file is in use, most likely by a running Wingman. Stop it, or build elsewhere with -OutDir." }
}

# backend\pyproject.toml is the one place the version is written down; the exe reports the
# same string through the package metadata the backend install below refreshes.
$version = & $python -c "import tomllib, pathlib; print(tomllib.loads(pathlib.Path(r'$root\backend\pyproject.toml').read_text('utf-8'))['project']['version'])"
if ($LASTEXITCODE -ne 0 -or -not $version) { throw "Could not read the version from backend\pyproject.toml" }
# Windows version resources hold four numbers, so "0.2.0rc1" becomes 0.2.0.0.
$numbers = @(([regex]::Match($version, "^\d+(\.\d+){0,3}").Value -split "\.") | Where-Object { $_ })
if ($numbers.Count -eq 0) { throw "Version '$version' does not start with a number" }
while ($numbers.Count -lt 4) { $numbers += "0" }
$fileVersion = $numbers -join "."
Write-Host "Ultrastar Wingman $version ($fileVersion) -> $OutDir"

if (-not $SkipFrontend) {
    if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
        Invoke-Step "npm ci" { npm ci --prefix $frontend }
    }
    Invoke-Step "frontend build" { npm run build --prefix $frontend }
}

Invoke-Step "install backend + pyinstaller" {
    & $python -m pip install -e "$root\backend[packaging]" --quiet
}

if (-not $SkipFirmware) {
    Invoke-Step "install firmware tools" {
        & $python -m pip install -r (Join-Path $root "firmware\requirements.txt") --quiet
    }
    # The device firmware is never committed; it is built here and bundled by the spec.
    Invoke-Step "firmware build" {
        & $python (Join-Path $root "firmware\build.py")
    }
}

# The spec embeds this as the exe's Windows version resource (Properties > Details).
New-Item -ItemType Directory -Force $work | Out-Null
$versionTuple = $numbers -join ", "
$versionInfo = @"
VSVersionInfo(
    ffi=FixedFileInfo(filevers=($versionTuple), prodvers=($versionTuple), mask=0x3F, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("CompanyName", "Yannis Vierkoetter"),
            StringStruct("FileDescription", "Ultrastar Wingman"),
            StringStruct("FileVersion", "$version"),
            StringStruct("InternalName", "UltrastarWingman"),
            StringStruct("LegalCopyright", "Copyright (C) Yannis Vierkoetter, GPL-3.0"),
            StringStruct("OriginalFilename", "UltrastarWingman.exe"),
            StringStruct("ProductName", "Ultrastar Wingman"),
            StringStruct("ProductVersion", "$version"),
        ])]),
        VarFileInfo([VarStruct("Translation", [1033, 1200])]),
    ],
)
"@
# No BOM: Windows PowerShell's -Encoding utf8 writes one.
[IO.File]::WriteAllText((Join-Path $work "version_info.txt"), $versionInfo, [Text.UTF8Encoding]::new($false))

# Two runs of the one spec, each with its own work folder: both layouts name their exe
# UltrastarWingman, and PyInstaller names an exe's work files after it (the spec says more).
$spec = Join-Path $PSScriptRoot "UltrastarWingman.spec"
Invoke-Step "pyinstaller: portable exe" {
    & $python -m PyInstaller --noconfirm `
        --distpath $OutDir `
        --workpath (Join-Path $work "onefile") `
        $spec
}

$built = @($exe)
if (-not $SkipInstaller) {
    Invoke-Step "pyinstaller: folder for the installer" {
        & $python -m PyInstaller --noconfirm `
            --distpath $OutDir `
            --workpath (Join-Path $work "onedir") `
            $spec "--" "--onedir"
    }
    $built += $appDir

    Invoke-Step "installer" {
        & $iscc /Q `
            "/DAppVersion=$version" `
            "/DFileVersion=$fileVersion" `
            "/DAppDir=$appDir" `
            "/DOutputDir=$OutDir" `
            (Join-Path $PSScriptRoot "UltrastarWingman.iss")
    }
    $built += Join-Path $OutDir "UltrastarWingman-$version-setup.exe"

    if ($UsdxDir) {
        # The same script again, with Ultrastar Deluxe's allowlisted files staged under the
        # work folder, so the .iss can take the stage whole. Rebuilt from scratch every
        # time: a file left over from an earlier USDX build must not ship.
        $stage = Join-Path $work "usdx"
        # Not through Invoke-Step: that relaxes $ErrorActionPreference for native tools,
        # and a copy that fails here has to stop the build.
        Write-Host "==> stage Ultrastar Deluxe from $UsdxDir" -ForegroundColor Cyan
        Copy-UsdxStage -GameDir $UsdxDir -Stage $stage -License $usdxLicense
        Invoke-Step "installer with Ultrastar Deluxe" {
            & $iscc /Q `
                "/DAppVersion=$version" `
                "/DFileVersion=$fileVersion" `
                "/DAppDir=$appDir" `
                "/DOutputDir=$OutDir" `
                "/DBundleUsdx" `
                "/DUsdxStage=$stage" `
                (Join-Path $PSScriptRoot "UltrastarWingman.iss")
        }
        $built += Join-Path $OutDir "UltrastarWingman-$version-with-usdx-setup.exe"
    }
}

foreach ($file in $built) {
    # A folder's size is what its files add up to.
    $bytes = (Get-ChildItem -LiteralPath $file -File -Recurse | Measure-Object -Property Length -Sum).Sum
    Write-Host ("built {0} ({1} MB)" -f $file, [math]::Round($bytes / 1MB, 1)) -ForegroundColor Green
}
