# Troubleshooting

The things that actually go wrong at a party, and what fixes them.

## "Could not start the song — check the USDX settings"

Wingman could not find Ultrastar Deluxe, or Windows refused to start it. Go
through **User → Settings** once — Wingman checks all of the following:

| What has to be true | If it is not |
|---|---|
| **USDX → Base path** is filled in | Fill it in. It is the folder that contains `ultrastardx.exe`. |
| `ultrastardx.exe` is really in that folder | The base path is wrong, or the program has another name — set **USDX → Executable**. |
| **Songs → Directory** is filled in | Fill it in. Wingman has to know where the songs are. |
| That folder exists | The path is misspelled, or the drive it is on is not connected. |
| Windows starts the program | The paths are right but the start failed. Start Ultrastar Deluxe by hand once, then try again. |

Then press **Play** again.

!!! note
    `config.ini` and `Ultrastar.db` are not checked. Ultrastar Deluxe creates
    them itself, so neither has to exist yet.

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
- New downloads appear on their own. Only songs you copied in by hand need a
  rescan.

!!! note
    The library is also scanned once every time Wingman starts, in the
    background.

## The USDB login fails

The **Explore USDB** page says what went wrong:

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
  library. Wingman never writes over it. Delete the folder yourself if it is a
  broken leftover, then retry; a rescan afterwards is a good idea either way.
- **Interrupted** — Wingman was restarted while the download ran. Press download
  again.

## Guests cannot open Wingman

- Everybody has to be on the same Wi-Fi. A guest phone on mobile data cannot see
  your PC.
- The QR code on the host screen contains the address the host screen was opened
  at. If the host screen runs on `localhost`, the QR code sends every guest to
  their own phone. Open the host screen at the network address of the PC
  (`http://192.168.1.20:8080`) and the QR code will be right.
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

Check the role, not the button. **User → Users** shows every account's role, and
**Permissions** decides what each role may do. See
[Accounts and permissions](accounts-and-permissions.md).
