# Download songs

New songs come from USDB (usdb.animux.de), the community song database. Wingman
searches it, downloads the song text, the cover, the audio and the video, and
puts the finished song into your song folder.

## Set up the USDB account

USDB only answers to logged-in accounts, so Wingman needs one.

1. Create a free account at usdb.animux.de if you do not have one.
2. Open **Songs → Explore USDB**. Without credentials the page says
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
come first. **Previous** and **Next** page through the results — USDB often does
not say how many pages there are, so stepping past the last page is how you find
the end.

Each result shows what USDB knows about the song, and whether you already have
it.

## Download

Press the download button on a result. The song joins the download queue, and the
row shows what is happening: fetching the song text, the images, the video,
extracting the audio, and finally moving the song into the library.

- Two songs download at the same time by default. Change that under
  **Settings → Downloads → `downloads.parallel`** (it applies after a restart).
- A finished download appears in **Songs** on its own. No rescan needed.
- A song you already have is not downloaded twice. A **failed** row has a retry
  button, which downloads it even if Wingman thinks the song is already in the
  library.
- Downloads survive a restart: a queued one is picked up again, and one that was
  running when Wingman stopped is marked as failed so you can retry it.

The **Downloads** panel at the bottom of the page keeps the history of this
Wingman, with the reason for every failure.

!!! warning
    Downloading needs two helper programs: yt-dlp for the video and ffmpeg for
    the audio track. Wingman downloads and updates yt-dlp itself. ffmpeg has to
    be on your system — see [Troubleshooting](troubleshooting.md) if a download
    fails right at the audio step.
