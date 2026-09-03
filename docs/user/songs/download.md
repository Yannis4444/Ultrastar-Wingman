# Download songs

New songs come from USDB (usdb.animux.de), the community song database. Wingman
searches it, downloads the song text, the cover, the audio and the video, and
puts the finished song into your song folder.

## Set up the USDB account

USDB only answers to logged-in accounts, so Wingman needs one.

1. Create a free account at usdb.animux.de if you do not have one.
2. Open **Songs**, press the **+** button next to the song count, and pick
   **USDB** from *Add songs*. Without credentials the page says
   *Wingman has no USDB account yet.*
3. Type the username and password into the form and press **Log in**. Wingman
   saves them and immediately tries the login.
4. When it worked, the page says *Logged in to USDB*.

The credentials are the settings `usdb.username` and `usdb.password`, so they can
also be changed under **Settings → USDB**. The password is never shown again —
the settings page only shows that one is stored.

!!! note
    Only somebody who may change settings gets the login form. Everybody else
    just sees why USDB cannot be used right now.

## Search

Fill in **Artist**, **Title**, or both, and press **Search**. Best-rated songs
come first; **More filters** opens the sort order (newest, artist, title, most
viewed …) and how many results a page holds. Changing one of those searches
again straight away.

**Previous** and **Next** page through the results — USDB often does not say how
many pages there are, so stepping past the last page is how you find the end.

Each result shows its cover, what USDB knows about the song, and whether you
already have it. A result that is already in your library opens the normal song
details when you tap it, so you can play it, favorite it or wish for it without
leaving the search.

## Download

Press the download button on a result. The song joins the download queue, and
the row's icon shows what is happening: a clock while it waits, a progress ring
while it downloads, a check once the song is in the library. The downloads
button at the top of the page opens the full list with each download's current
step.

- Two songs download at the same time by default. Change that under
  **Settings → Downloads → `downloads.parallel`** (it applies after a restart).
- A finished download appears in **Songs** on its own. No rescan needed.
- A song you already have is not downloaded twice. A failed row shows a warning
  icon — tap it to read what went wrong and to retry, which downloads the song
  even if Wingman thinks it is already in the library.
- A song that arrives with a misspelt artist or no year is corrected in its own
  view with [Edit details](fix-or-delete.md); one that turns out to be unusable
  is deleted with its files on the same page.
- Downloads survive a restart: a queued one is picked up again, and one that was
  running when Wingman stopped is marked as failed so you can retry it.

## The downloads panel

The panel behind the downloads button shows what this Wingman has been doing
**since it was started**, with the reason for every failure. Older downloads are
still there: turn **Only this session** off to see them.

- The `×` next to a finished or failed download dismisses it — it leaves the
  panel for everybody, and the warning on the downloads button goes with it.
- **Clear finished** at the bottom dismisses every download that succeeded. It
  never touches a failure: an error stays until you have read it and dismissed
  it yourself.
- Wingman cleans up after itself. Anything finished or dismissed is dropped once
  the history grows past a couple of hundred entries, and everything that is done
  goes after a month — so the panel cannot fill up over time. A failure you have
  not dismissed is only ever removed by that one-month limit.

Retrying, dismissing and clearing all need the right to manage downloads;
without it the panel only reports what happened.

!!! info
    Downloading needs two helper programs: yt-dlp for the video and ffmpeg for
    the audio track. Wingman takes care of both — yt-dlp is downloaded and kept
    up to date, and on Windows a missing ffmpeg is fetched during the first
    download that needs it (a one-time ~100 MB step you can watch in the
    download row). If ffmpeg is already on your system, that copy is used.

    On Linux and macOS, install ffmpeg yourself (`apt install ffmpeg`,
    `brew install ffmpeg`) — see [Fix a problem](../help/index.md) if a
    download fails right at the audio step.
