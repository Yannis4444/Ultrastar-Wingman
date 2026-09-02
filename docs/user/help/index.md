# Fix a problem

The things that actually go wrong at a party, and what fixes them.

## Ultrastar Deluxe is not set up

Wingman checks its Ultrastar Deluxe settings by itself and says so before
anybody presses Play: the **Home** tab carries a *"Ultrastar Deluxe is not set
up yet"* banner for as long as a song could not be started. Press **Fix it**
and Wingman lists what is missing, in plain words, with a link straight to the
settings. Guests see the banner too, with a note to ask the host — the paths
themselves are only shown to whoever may see the settings.

Pressing **Play** while it is unset opens the same list instead of an error.

The banner disappears on its own the moment the settings are right, on every
open page — no reload needed.

The full list of what has to be true, if you would rather go through
**User → Settings** yourself:

| What has to be true | If it is not |
|---|---|
| **USDX → Base path** is filled in | Fill it in. It is the folder that contains `ultrastardx.exe`. |
| `ultrastardx.exe` is really in that folder | The base path is wrong, or the program has another name — set **USDX → Executable**. |
| **Songs → Directory** is filled in | Fill it in. Wingman has to know where the songs are. |
| That folder exists | The path is misspelled, or the drive it is on is not connected. |
| Windows starts the program | The paths are right but the start failed. Start Ultrastar Deluxe by hand once, then try again. |

Then press **Play** again.

The last row reads the same way: the list then says the program refused to
start, which means the paths were right and Windows was the problem.

A plain *"Could not start the song — check the USDX settings"* notice instead of
that list means the failure was not one of these at all — read the console
window.

!!! note
    `config.ini`, `Ultrastar.db` and Ultrastar Deluxe's own songs folder are not
    checked. Each of them is created when it is first needed, so none has to
    exist yet.

## Ultrastar Deluxe opens the whole song list

The song starts, but Ultrastar Deluxe comes up with its full song list instead
of the song that was picked.

Wingman starts every song from inside Ultrastar Deluxe's own songs folder — that
is what keeps Ultrastar Deluxe from loading the rest of the library next to it.
Three things get in the way:

- **Wingman is pointed at the wrong folder.** It derives Ultrastar Deluxe's
  songs folder from **USDX → Base path**. An installation that keeps its songs
  somewhere else needs **USDX → Songs directory** filled in — that field is
  Ultrastar Deluxe's folder, not the one Wingman scans.
- **Ultrastar Deluxe has a song folder of its own on top.** A `SongDir1` line
  (or `SongDir2`, and so on) in its `config.ini` pointing outside its songs
  folder is loaded every time.
  Wingman never touches that part of the file; take the line out yourself while
  Ultrastar Deluxe is closed.
- **The path has unusual characters in it.** A song folder called `Björk - Jóga`
  is copied to a plain name automatically, but the folders above it are not — if
  Ultrastar Deluxe itself lives under an accented path, move it.

## The song list is empty

- Set **Settings → Songs → Directory**, then press **Rescan** on the **Songs**
  tab.
- Wingman looks exactly one level deep. `Songs\Artist - Title\song.txt` is
  found; `Songs\Artist\Title\song.txt` is not. Point Wingman at the folder whose
  direct subfolders are the songs, or add the inner folders as additional
  directories.
- A song folder needs a song text file (`.txt`). A folder with only audio and a
  cover is not a song.
- A song that is on disk but not in the list is usually a broken song text.
- A song everybody else can see but you cannot is not missing: a tag is holding
  it back. See [Songs you do not see](../songs/index.md#songs-you-do-not-see).
- New downloads appear on their own. Only songs you copied in by hand need a
  rescan.

!!! note
    The library is also scanned once every time Wingman starts, in the
    background.

## Somebody is missing from the player selection

They are hidden, or they are gone. The **eye** on their row under
**User → Players & accounts** takes a player out of the selection for the
evening and puts them back — see
[Manage players and accounts](../people/index.md#manage-players-and-accounts).
Their name goes quiet in that list while it lasts, and logging in unhides them.
With every player hidden the selection says so, rather than claiming there is
nobody. If the row is not on that page at all, the player was deleted — add the
name again, or let them register it.

## The USDB login fails

The **USDB** page (**Songs → + → USDB**) says what went wrong:

| Message | What it means |
|---|---|
| *Wingman has no USDB account yet* | Username or password is empty. |
| *USDB rejected those credentials* | The account or password is wrong. Try it on usdb.animux.de in a browser. |
| *The USDB login failed* | USDB answered, but never as logged in. Usually a wrong password, sometimes USDB being unhappy — try again in a minute. |
| *USDB could not be reached* | No internet, or USDB is down. |
| *The song library directory is not configured yet* | Set **Settings → Songs → Directory** — a download needs somewhere to go. |

Wingman remembers the login. If it expires mid-party, saving the credentials
again logs in fresh.

## A download fails

Read the reason in the download row.

- **Something about ffmpeg** — Wingman fetches ffmpeg itself on Windows, so this
  usually means the download failed: no internet, or GitHub was unreachable. Try
  again. On Linux and macOS, install ffmpeg yourself (`apt install ffmpeg`,
  `brew install ffmpeg`). Either way you can point Wingman at a copy you already
  have by putting its full path into **Settings → Downloads → ffmpeg** — a path
  you fill in there is used as it is, with no fallback.
- **Something about yt-dlp** — Wingman manages yt-dlp itself and needs internet
  to fetch and update it. If you filled in a yt-dlp path yourself, check that the
  file is there and current.
- **A YouTube error** — the video is gone, private, or region-locked. Nothing
  Wingman can do; pick another version of the song.
- **The song directory already exists** — that folder is already in your song
  library. Wingman never writes over it. If Wingman lists it as a song,
  [delete the song](../songs/index.md#delete-a-song); otherwise delete the folder
  yourself. Then retry; a rescan afterwards is a good idea either way.
- **Interrupted** — Wingman was restarted while the download ran. Press download
  again.

## Guests cannot open Wingman

- Everybody has to be on the same Wi-Fi. A guest phone on mobile data cannot see
  your PC.
- The QR code carries the address Wingman worked out for itself: your PC's
  address on the local network, never `localhost`, no matter which address the
  host screen itself was opened at. A VPN, a virtual machine adapter or a
  second network card can make it pick the wrong one of your PC's addresses —
  then put the right one into **User → Settings → Host → Join URL**, as
  described under
  [Let the guests in](../start/index.md#let-the-guests-in). The line under the
  field, and the text under the QR code, always say which address is being
  handed out right now.
- Windows Firewall blocks the port the first time. Allow the app when Windows
  asks, or open port 8080 by hand.
- Guests must type the port too: `http://192.168.1.20:8080`, not just the
  address.

## Wingman does not start

Read the console window. If it complains that the address is already in use,
something else on the PC has port 8080 — an older Wingman that is still running,
most likely. Close it and start again.

## The host link does not work any more

The host link works exactly once. Restart Wingman and use the new line from the
console. Existing host browsers stay logged in — the link is only needed to make
a new one the host.

## Nothing on the page updates

Wingman pushes changes live. A page that has gone quiet has lost that connection;
it reconnects on its own after a moment. Reload if it does not.

## Somebody cannot do something they should

Check the role, not the button. **User → Players & accounts** shows every
account's role, and **Permissions** decides what each role may do. See
[People](../people/index.md).
