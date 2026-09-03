# Ultrastar Wingman

Karaoke companion for [Ultrastar Deluxe](https://usdx.eu): everybody at the
party searches and downloads songs from their phone, puts wishes on the list
and sees the scores, while Wingman starts the songs in Ultrastar Deluxe on the
karaoke PC.

## Run it

1. Download `UltrastarWingman.exe` and start it. It opens the host page in your
   browser and prints its address for the phones on the same network.
2. Tell Wingman where your songs are, and let it connect Ultrastar Deluxe:
   [Get started](docs/user/start/index.md).

The user guide lives in [`docs/user/`](docs/user/index.md) — songs, wishes,
accounts, statistics, troubleshooting.

## Develop it

Windows, Python 3.12+ and Node 20+:

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -e "backend[dev]"
venv\Scripts\python.exe -m ultrastar_wingman        # API on :8080

cd frontend
npm install
npm run dev                                         # UI on :5173, proxies /api
```

Before pushing, both check suites have to be green:

```powershell
cd backend
..\venv\Scripts\python.exe -m ruff check . ; ..\venv\Scripts\python.exe -m ruff format --check .
..\venv\Scripts\python.exe -m mypy src tests ; ..\venv\Scripts\python.exe -m pytest

cd ..\frontend
npm run build ; npm run lint ; npm run format:check ; npm test
```

Build the exe with `.\installer\build.ps1` (frontend build + PyInstaller, one
file in `installer\dist`). Build the user-guide site with:

```powershell
venv\Scripts\python.exe -m pip install -r docs\requirements.txt
cd docs
..\venv\Scripts\python.exe -m zensical serve     # or `build`, into docs\site
```

Component details: [`backend/README.md`](backend/README.md),
[`frontend/README.md`](frontend/README.md). How we work — style, architecture,
git, testing: [`CLAUDE.md`](CLAUDE.md) and [`docs/dev/`](docs/dev/architecture.md).
