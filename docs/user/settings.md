# Settings

**User → Settings** holds everything the host configures. Only an administrator
can open it by default; a role that may look but not change sees the values greyed
out.

A change is saved when you leave the field or press Enter, and every open browser
gets the new value immediately. A changed field grows a **Reset to …** button that
puts the default back.

Two fields are all Wingman really needs: the USDX base path and the songs
directory. The rest has sensible defaults.

The settings are grouped by area, and each field carries its own one-line
explanation. Below, every field is listed with the name it has in the app and the
key it is stored under.

## USDX

Where Ultrastar Deluxe lives.

| Field | What it is |
|---|---|
| **Base path** (`usdx.base_path`) | The Ultrastar Deluxe installation folder. Everything below is derived from it. |
| **Executable** (`usdx.executable`) | Overrides the derived `<base path>\ultrastardx.exe`. |
| **Config file** (`usdx.config_file`) | Overrides the derived `<base path>\config.ini` — the file that holds players, colours and avatars. |
| **Avatars directory** (`usdx.avatars_dir`) | Overrides the derived `<base path>\avatars`, where Ultrastar Deluxe reads avatar pictures from. |
| **Ultrastar DB** (`usdx.ultrastar_db`) | Overrides the derived `<base path>\Ultrastar.db`. Wingman only reads it, to import the scores. |

For a normal installation, fill in the base path and leave the four overrides
empty. They exist for portable installations spread over several folders.

!!! note
    `config.ini` is created by Ultrastar Deluxe on demand and `Ultrastar.db` only
    exists after the first score, so neither has to be there yet.

## Songs

Where your songs are.

| Field | What it is |
|---|---|
| **Directory** (`songs.directory`) | The Ultrastar Deluxe songs folder Wingman scans. Downloads land here. |
| **Additional directories** (`songs.additional_directories`) | Further folders to scan, one path per line. |

Every direct subfolder of a scanned folder that holds a song text file counts as
one song. Scanning never writes anything into a song folder.

## USDB

The song database Wingman downloads from. See
[Download songs](downloading-songs.md).

| Field | What it is |
|---|---|
| **Username** (`usdb.username`) | The account used to search and download from usdb.animux.de. |
| **Password** (`usdb.password`) | The password of that account. It is stored but never shown again — the box only says whether one is set, and **Clear** removes it. |
| **Base URL** (`usdb.base_url`) | The address of USDB. Default `https://usdb.animux.de`. |

## Downloads

| Field | What it is |
|---|---|
| **Parallel** (`downloads.parallel`) | How many songs download at the same time. Default 2, applied after a restart. |
| **ffmpeg** (`downloads.ffmpeg`) | The ffmpeg program, used to pull the audio track out of the video. Default `ffmpeg`, which means "wherever the system finds it". |
| **yt-dlp path** (`downloads.ytdlp_path`) | The yt-dlp program. Leave it empty and Wingman downloads and updates its own copy. |

!!! warning
    Only fill in the yt-dlp path if you want to manage yt-dlp yourself. Wingman
    does not update a copy you point it at — and YouTube breaks old yt-dlp
    versions every few weeks.
