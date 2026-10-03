# Files and configuration

Wingman keeps what it remembers in one folder, and reads songs out of another.
Both are plain files on the karaoke PC.

## The data directory

On Windows the default is:

```text
C:\Users\<you>\AppData\Local\Ultrastar Wingman
```

`WINGMAN_DATA_DIR` moves it. Wingman names the folder it settled on in a
startup line, `data directory: ...`, so the log is the reliable answer.

| Name | What it holds |
|---|---|
| `wingman.db` | Everything Wingman remembers |
| `avatars/` | One picture per player, added when somebody uploads one |
| `achievement_icons/` | One uploaded picture per achievement |
| `bin/` | The yt-dlp and ffmpeg builds Wingman fetched for downloads |

Only `wingman.db` is there from the start. The other three appear the first
time something needs them. Songs are never in here.

## The database

`wingman.db` is SQLite, and it is the app's own store. Wingman brings it up to
date on every start, so its tables are whatever this build wants. Treat the
schema as a moving target and the REST API as the supported way in.

Open it read only. Nothing outside Wingman writes to it, whether the app is
running or not.

To back it up, stop Wingman and copy the file. Copying the whole data directory
gets the pictures along with it.

!!! example "Read the library without the API"
    Open the file read only. On Windows the path needs forward slashes inside
    the URI.

    ```bash
    sqlite3 "file:C:/Users/you/AppData/Local/Ultrastar Wingman/wingman.db?mode=ro" \
      "select artist, title from songs order by artist limit 5;"
    ```

## The song folders

Wingman scans the **Directory** setting in the **Songs** group.
**Additional directories** in the same group, behind **Advanced**, adds one
more path per line. It reads those folders, and the three cases at the end of
this section are the only times it writes.

- Every direct subfolder of a scanned folder is one song. Wingman does not go
  deeper.
- The first `.txt` in a folder, in alphabetical order, is the song file. A
  folder without one is skipped.
- A song file without both `#TITLE` and `#ARTIST` is skipped as well.
- The file headers name a file inside the same folder. One that points outside
  it is ignored.

These are the headers Wingman reads:

| Header | What Wingman does with it |
|---|---|
| `#TITLE`, `#ARTIST` | The song's name. Both are required |
| `#AUDIO`, or `#MP3` in older files | The audio file to play |
| `#COVER` | The picture the song list and the TV show |
| `#VIDEO` | The video file, and what `has_video` on a song is answered from |
| `#BACKGROUND` | Read along with the rest, and left to Ultrastar Deluxe |
| `#LANGUAGE`, `#GENRE`, `#YEAR`, `#EDITION` | What the filters and the facets go by |
| `#CREATOR` | Who built the karaoke file |
| `#START`, `#END` | The window Ultrastar Deluxe plays, and so the length Wingman reports. `#START` is in seconds and `#END` in milliseconds |
| `#DUETSINGERP1` and `#DUETSINGERP2`, or `#P1` and `#P2` | A duet. A `P1` or `P2` line in the body says the same |

Text encoding is detected, not assumed. UTF-8, a file with a byte order mark,
and the older single byte code pages all read. A file whose bytes do not
survive a round trip is still read, but Wingman refuses to write it back.

Every song has an id. A song that came from USDB is `usdb:<number>`, and every
other song is `local:` and a random string. A song keeps its id as long as its
folder stays where it is. A folder holding a `wingman.json` that names a USDB
id is imported under that id.

Wingman changes a song folder in three cases. A download assembles a new folder
under the songs directory. The metadata editor rewrites `#TITLE`, `#ARTIST`,
`#LANGUAGE`, `#GENRE`, `#YEAR`, and `#EDITION` in one song file, and leaves
every other byte of it alone. Deleting a song removes its whole folder from the
disk, which takes `songs.delete`.

## Environment variables

These are the variables Wingman itself reads, and it reads them when it starts.
Everything else it is configured with is a setting inside the app.

| Variable | What it does | Default |
|---|---|---|
| `WINGMAN_DATA_DIR` | The folder above | The Wingman folder in your app data |
| `WINGMAN_PORT` | The port to listen on | `8080` |
| `WINGMAN_HOST` | The address to listen on | `0.0.0.0`, meaning every address the PC has |
| `WINGMAN_OPEN_BROWSER` | Open the host screen in a browser at startup | `true` |
| `WINGMAN_FRONTEND_DIR` | The built web app to serve | The copy inside the exe, or `frontend/dist` when you run from source |
| `WINGMAN_USDX_DIR` | An Ultrastar Deluxe folder Wingman treats as its own. See [Install and run](../start/install.md#bring-your-own-ultrastar-deluxe-along) | A `usdx` folder next to the exe that holds `ultrastardx.exe`, otherwise none |

A file called `.env` in the folder Wingman is started from does the same, one
name and value per line:

```text
WINGMAN_PORT=9000
WINGMAN_OPEN_BROWSER=false
```

## The port

There is one port, and everything is on it: the web app, the REST API, the
WebSocket, and the OpenAPI document. `WINGMAN_HOST` at its default listens on
every address the PC has, so a phone on the same network reaches it.
