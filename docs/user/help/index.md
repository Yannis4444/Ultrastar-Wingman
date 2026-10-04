---
icon: wingman/alert
---

# Fix a problem

The things that actually go wrong at a party, and what fixes them. Find your
symptom, read the cause, do the fix.

Everything to do with starting a song and getting its scores back has a page of
its own. See [Ultrastar Deluxe problems](ultrastar-deluxe.md).

## Wingman does not start

When Wingman cannot start, its console window stays open with the reason in
it. Press ++enter++ to close it.

- **A complaint about the port**, *Wingman is already running, or port 8080 is
  taken*, usually means you started Wingman twice. The second one stops before
  it does anything, and the first one runs on. Look for its console window on
  the taskbar and use that one. If no Wingman is running, another program has
  the port. Give Wingman a different one with `WINGMAN_PORT`. This holds even
  when you start Wingman twice within a few seconds: the first one takes the
  port before it does anything else.
- **A complaint about the database**, such as *Can't locate revision*, means an
  older Wingman met a database a newer one has updated. Install the newer
  version again, or put back the copy of the data folder you made before.

Wingman can take a while to start, for example when it updates its database
after you install a newer version. A browser you open in that time waits, then
shows the page.

See [Install and run](../start/install.md).

## Read the console

The console window follows the evening: songs and their scores, badges,
downloads, logins, changed settings, and player selectors. Every line starts
with the time, and a problem says so right after it:

```text
21:20:11  Queen - Bohemian Rhapsody is over: Anna 8,940, Ben 7,120
21:22:40  WARNING  Download of USDB song 12345 failed: the video is private
```

When something goes wrong, read the lines marked **WARNING** or **ERROR**, and
copy the details under an **ERROR** along when you report it. To see more, add
the line `WINGMAN_LOG_LEVEL=debug` to the `.env` file. See
[Install and run](../start/install.md#change-the-port-the-address-or-the-folder).

## A song will not start

**Home** says so in a banner before anybody presses **Play**. See
[Ultrastar Deluxe problems](ultrastar-deluxe.md).

## The song list is empty

- Fill in **Directory** in the **Songs** group of the settings, then click
  :wingman-refresh: **Rescan** on the **Songs** tab.
- With the setup that comes with Ultrastar Deluxe, **Directory** starts out as
  the empty `usdx\songs` in the program folder. Copy song folders in through
  the Start menu entry **Ultrastar Wingman songs**, or download songs.
- Wingman looks exactly one level deep. `Songs\Artist - Title\song.txt` is
  found. `Songs\Artist\Title\song.txt` is not. Point Wingman at the folder
  whose direct subfolders are the songs, or add the inner folders under
  **Additional directories** in the **Songs** group, behind **Advanced**.
- A song folder needs a song text file. A folder holding only audio and a cover
  is not a song.
- A song on disk that never shows up usually has a broken song text.
- A song everybody else sees and you do not is not missing. A tag is holding it
  back. See
  [Songs you do not see](../songs/index.md#songs-you-do-not-see).
- New downloads appear on their own. Only songs you copied in by hand need a
  rescan.

The library is also scanned once in the background every time Wingman starts.

## Guests cannot open Wingman

- Everybody has to be on the same Wi-Fi. A guest phone on mobile data cannot
  see your PC.
- Windows Firewall blocks the port the first time. Allow the app when Windows
  asks, or open port 8080 by hand.
- Guests have to type the port too: `http://192.168.1.20:8080`, not the address
  on its own.
- The QR code carries the address Wingman worked out for itself, and the
  console names it on the line `Guests join at`. When that is the wrong one of
  your PC's addresses, set it. See [Let guests in](../start/join.md).

## The host link does not work any more

It works once. Restart Wingman and use the new line from the console window.
Browsers that already hold host rights keep them. The link is only needed to
make a new browser the host. See [The host screen](../host-screen/index.md).

Starting Wingman a second time leaves the link alone. The second one stops
before it opens a browser. Two starts within a few seconds of each other can
both open one. Use the link from the window that says *Wingman is running*. See
[Wingman does not start](#wingman-does-not-start).

## The USDB login fails

The **USDB** page says what went wrong.

| Message | What it means |
|---|---|
| *Wingman has no USDB account yet* | The username or the password is empty. |
| *USDB rejected those credentials* | The account or the password is wrong. Try them on usdb.animux.de in a browser. |
| *The USDB login failed* | USDB answered, but never as logged in. Usually a wrong password, sometimes USDB being unhappy. Try again in a minute. |
| *USDB could not be reached* | No internet, or USDB is down. |
| *The song library directory is not configured yet* | Set **Directory** in the **Songs** group. A download needs somewhere to go. |

Wingman remembers the login. If it expires mid-party, saving the credentials
again logs in fresh.

## A download fails

Read the reason in the download row.

- **Something about ffmpeg.** Wingman fetches ffmpeg itself on Windows, so this
  usually means that fetch failed: no internet, or GitHub was unreachable. Try
  again. On Linux and macOS, install ffmpeg yourself. Either way you can point
  Wingman at a copy you already have with the **ffmpeg** setting in the
  **Downloads** group, behind **Advanced**. A path you fill in there is used as
  it is, with no fallback.
- **Something about yt-dlp.** Wingman manages yt-dlp itself and needs internet
  to fetch and update it. If you filled in the **yt-dlp path** setting in the
  **Downloads** group, behind **Advanced**, check that the file is there and
  current.
- **A YouTube error.** The video is gone, private, or region-locked. Pick
  another version of the song.
- **The song directory already exists.** That folder is already in your song
  library, and Wingman never writes over it. If Wingman lists it as a song,
  [delete the song](../songs/fix-or-delete.md). Otherwise delete the folder
  yourself. Then retry, and run a rescan afterwards.
- **Interrupted by restart.** Wingman was restarted while the download ran.
  Download it again.

See [Download songs](../songs/download.md) for the queue itself.

## Somebody is missing from the player selection

They are hidden, or they are gone. Their row under **User** >
**Players & accounts** carries :wingman-eye: **Hide from player selection**. It
takes a player out of the selection for the evening, and puts them back. Their
name goes quiet in that list while it lasts, and logging in unhides them. See
[Players and avatars](../people/players.md#take-somebody-out-of-the-picker).

If the row is not on that page at all, the player was deleted. Add the name
again, or let them register it.

## Nothing on the page updates

Wingman pushes changes live. A page that has gone quiet has lost that
connection. It reconnects on its own after a moment. Reload if it does not.

## Somebody cannot do something they should

Check the role, not the button. **User** > **Players & accounts** shows who has
an account, and whoever may manage accounts sees each one's role there.
**Permissions** decides what each role may do.
