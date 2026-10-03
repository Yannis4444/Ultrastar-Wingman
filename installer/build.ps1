<#
.SYNOPSIS
Builds UltrastarWingman.exe (frontend + backend + migrations + firmware in one file) and the
installer that wraps it, UltrastarWingman-<version>-setup.exe.

.DESCRIPTION
Run from anywhere: .\installer\build.ps1. The stages run in order: frontend, backend,
firmware, exe, installer. docs\dev\building.md explains each one and how a release is cut.

.PARAMETER OutDir
Where the exe and the installer land. Default installer\dist. A running Wingman locks its
exe, so build somewhere else while one runs out of this folder.

.PARAMETER SkipFrontend
Bundle the frontend\dist already there instead of rebuilding it.

.PARAMETER SkipFirmware
Bundle the firmware image already in the backend package instead of rebuilding it.

.PARAMETER SkipInstaller
Build the exe alone; Inno Setup is then not needed.
#>
param(
    [string]$OutDir,
    [switch]$SkipFrontend,
    [switch]$SkipFirmware,
    [switch]$SkipInstaller
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
if (Test-Path $exe) {
    # A running exe can be read but not rewritten; PyInstaller would only find out at the
    # very end, after the whole build.
    try { [IO.File]::Open($exe, "Open", "ReadWrite", "None").Dispose() }
    catch { throw "$exe is in use, most likely by a running Wingman. Stop it, or build elsewhere with -OutDir." }
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

Invoke-Step "pyinstaller" {
    & $python -m PyInstaller --noconfirm `
        --distpath $OutDir `
        --workpath $work `
        (Join-Path $PSScriptRoot "UltrastarWingman.spec")
}

$built = @($exe)
if (-not $SkipInstaller) {
    Invoke-Step "installer" {
        & $iscc /Q `
            "/DAppVersion=$version" `
            "/DFileVersion=$fileVersion" `
            "/DExeDir=$OutDir" `
            "/DOutputDir=$OutDir" `
            (Join-Path $PSScriptRoot "UltrastarWingman.iss")
    }
    $built += Join-Path $OutDir "UltrastarWingman-$version-setup.exe"
}

foreach ($file in $built) {
    Write-Host ("built {0} ({1} MB)" -f $file, [math]::Round((Get-Item $file).Length / 1MB, 1)) -ForegroundColor Green
}
