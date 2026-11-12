<p align="center">
  <img src="frontend/public/logo.png" alt="The Ultrastar Wingman logo" width="140">
</p>

# Ultrastar Wingman

Karaoke companion for [Ultrastar Deluxe](https://usdx.eu). Ultrastar Deluxe
plays the song and scores the singing. Wingman does everything around it:
everybody at the party searches the song list on their own phone, puts wishes
on the list, and picks who sings. Wingman starts the song in Ultrastar Deluxe on
the karaoke PC and keeps the scores of the evening.

There is nothing to install on a phone. Guests scan the QR code on the TV and
are in.

![The host screen on the TV after a song: the scores of the two singers, the QR code to join, tonight's standing, and the most wished song](docs/user/assets/screenshots/scores/host-results.png)

<p align="center">
  <img src="docs/user/assets/screenshots/party/home.png" alt="Home on a phone, with the wishlist and the Random song button" width="195">
  <img src="docs/user/assets/screenshots/songs/songs-list.png" alt="The song list on a phone, with search and filter chips" width="195">
  <img src="docs/user/assets/screenshots/scores/scores-party.png" alt="A party's scores on a phone, with a chart of every score" width="195">
  <img src="docs/user/assets/screenshots/scores/scores-share.png" alt="The share card of a party, with its podium" width="195">
</p>

> [!NOTE]
> Wingman is in beta. It has run real parties, but expect rough edges, and back
> up your data folder before you update. Report what breaks in the
> [issues](https://github.com/Yannis4444/Ultrastar-Wingman/issues).

## What it does

**For everybody at the party, on a phone**

- Browse the song list: search, sort, and filter by language, genre, decade,
  duet, video, and tags.
- Wish for songs. The wishlist is the room's, and the TV shows what is wished
  for most.
- Start a song: pick who sings on which microphone color and tap **Play**.
  Ultrastar Deluxe opens with that song.
- Let the reel pick a random song, on your phone or on the TV for the whole
  room. It picks from every song, your favorites, the wishlist, or a playlist.
  A fair mode keeps one person's twenty wishes from drowning out everybody
  else's.
- Keep favorites, make playlists and share them, and comment on songs.
- Open a song in Spotify, Apple Music, YouTube Music, Tidal, or Deezer.
- See the scores of the party and your own record, with charts.
- Share a party, a score, your stats, or a badge as a picture.
- Earn achievements. Wingman comes with 35 badges, and the TV shows the ones a
  song earned.

**For the host, on the karaoke PC**

- The host screen for the TV: the QR code to join, tonight's standing, the most
  wished songs, the song that is playing, and the results after it.
- Download songs from [USDB](https://usdb.animux.de) with a queue, audio and
  video included. You need your own USDB account.
- Background music from your own library while nobody is singing, at an even
  loudness.
- A setup that brings Ultrastar Deluxe along, so there is one thing to install.

**For the administrator**

- Accounts are optional. A guest needs none.
- Groups and permissions decide who may do what, down to single rights.
- Single sign-on through an OpenID Connect provider.
- Tags on songs, with a say over who sees a tag and the songs under it.
- Your own achievements, built from conditions, with your own badge pictures.
- Fix a song's details or delete it, and correct a score filed under the wrong
  name.

**For tinkerers**

- The player selector: a box you build from an ESP32 and RFID readers. Singers
  put their card on a microphone slot, and a button starts the song. Wingman
  flashes and sets up the board from the browser.
- A REST API with an OpenAPI schema, and live events over a WebSocket.

<p align="center">
  <img src="docs/user/assets/screenshots/achievements/host-achievements.png" alt="The host screen showing two badges a singer earned" width="49%">
  <img src="docs/user/assets/screenshots/selector/host-picking.png" alt="The host screen while the player selector's cards pick the singers" width="49%">
</p>

## Run it

Wingman runs on Windows 10 and 11 (64-bit), on the PC that runs Ultrastar
Deluxe. Get it from the
[releases](https://github.com/Yannis4444/Ultrastar-Wingman/releases).

| Download | What it is |
|---|---|
| `UltrastarWingman-<version>-with-usdx-setup.exe` | The setup of Wingman with Ultrastar Deluxe. Take this one if you are not sure |
| `UltrastarWingman-<version>-setup.exe` | The setup of Wingman alone, for an Ultrastar Deluxe you already have |
| `UltrastarWingman.exe` | Wingman in one file, to run without installing |

1. Download a setup and run it. It installs Wingman for your Windows account
   (no administrator rights) and updates an installed one in place. The setup
   carries no signature, so Windows may say **Windows protected your PC**.
   Click **More info**, then **Run anyway**.
2. Start Wingman. It opens the host screen in your browser, and the QR code on
   it carries the address for the phones on the same network.
3. Tell Wingman where your songs are:
   [Get started](docs/user/start/index.md).

Wingman starts a song with the `-Song` argument, which a stock Ultrastar Deluxe
does not know. [This Ultrastar Deluxe build](https://github.com/Yannis4444/USDX)
does, and the setup with Ultrastar Deluxe installs it. Use that build if you
take Wingman alone.

The user guide lives in [`docs/user/`](docs/user/index.md): songs, wishes,
accounts, scores, achievements, the player selector, and troubleshooting.

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

Build the exe and the installer with `.\installer\build.ps1` (frontend,
firmware, PyInstaller and Inno Setup 6, into `installer\dist` or `-OutDir`;
`-UsdxDir` adds the setup with Ultrastar Deluxe; see
[`docs/dev/building.md`](docs/dev/building.md), which also says how a release is
cut). Build the user-guide site with:

```powershell
venv\Scripts\python.exe -m pip install -r docs\requirements.txt
cd docs
..\venv\Scripts\python.exe -m zensical serve     # or `build`, into docs\site
```

Component details: [`backend/README.md`](backend/README.md),
[`frontend/README.md`](frontend/README.md). How we work (style, architecture,
git, testing): [`CLAUDE.md`](CLAUDE.md) and [`docs/dev/`](docs/dev/architecture.md).

## License

Wingman is free software under the [GNU General Public License v3](LICENSE).
The setup with Ultrastar Deluxe carries that program under its own license,
with a `SOURCE.txt` naming where its source is.
