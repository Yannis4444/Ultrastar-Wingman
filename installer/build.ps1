# Builds dist\UltrastarWingman.exe: frontend bundle + backend + migrations in one file.
# Run from anywhere: .\installer\build.ps1
$ErrorActionPreference = "Stop"

function Invoke-Step {
    param([string]$Name, [scriptblock]$Step)
    Write-Host "==> $Name" -ForegroundColor Cyan
    # npm and pip write progress to stderr; with $ErrorActionPreference = "Stop" that alone
    # would abort the build. The exit code below is the actual verdict.
    $ErrorActionPreference = "Continue"
    & $Step
    # Native tools (npm, pip, pyinstaller) fail by exit code, not by throwing.
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "No venv at $python" }

$frontend = Join-Path $root "frontend"
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Invoke-Step "npm ci" { npm ci --prefix $frontend }
}
Invoke-Step "frontend build" { npm run build --prefix $frontend }

Invoke-Step "install backend + pyinstaller" {
    & $python -m pip install -e "$root\backend[packaging]" --quiet
}

Invoke-Step "install firmware tools" {
    & $python -m pip install -r (Join-Path $root "firmware\requirements.txt") --quiet
}

# The device firmware is never committed; it is built here and bundled by the spec below.
Invoke-Step "firmware build" {
    & $python (Join-Path $root "firmware\build.py")
}

Invoke-Step "pyinstaller" {
    & $python -m PyInstaller --noconfirm `
        --distpath (Join-Path $PSScriptRoot "dist") `
        --workpath (Join-Path $PSScriptRoot "build") `
        (Join-Path $PSScriptRoot "UltrastarWingman.spec")
}

$exe = Join-Path $PSScriptRoot "dist\UltrastarWingman.exe"
Write-Host "built $exe ($([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB)" -ForegroundColor Green
