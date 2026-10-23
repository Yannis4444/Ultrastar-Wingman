# Connect Ultrastar Deluxe

Wingman starts songs in Ultrastar Deluxe and reads the scores back out of it.
Two settings are all it needs before the first song.

!!! note
    A Wingman installed with the setup that comes with Ultrastar Deluxe
    already knows where it is. Skip step 2 below: the **USDX** group holds no
    paths then, only the **Run Ultrastar Deluxe** row. **Directory** starts
    out as that Ultrastar Deluxe's own `songs` folder, which is empty. Copy
    song folders in through the Start menu entry **Ultrastar Wingman songs**
    and click :wingman-refresh: **Rescan**, or download songs.

    Songs you already have elsewhere, such as in an older Ultrastar Deluxe's
    songs folder, go into **Directory** or **Additional directories**. That
    older Ultrastar Deluxe stays installed, and Wingman no longer uses it.
    See [Install and run](install.md#bring-your-own-ultrastar-deluxe-along).

## Point Wingman at the installation

!!! warning
    Wingman starts a song with the `-Song` argument, which only
    [the Ultrastar Deluxe build on GitHub](https://github.com/Yannis4444/USDX)
    knows. A stock Ultrastar Deluxe opens its menu and plays nothing, so take
    the setup that comes with Ultrastar Deluxe instead.

1. Open **User** > **Settings**. Changing a setting is an administrator's
   right, and the host browser holds it too.
2. In the **USDX** group, type the Ultrastar Deluxe installation folder into
   **Base path**. It is the folder that holds `ultrastardx.exe`.
3. In the **Songs** group, type the folder that holds your songs into
   **Directory**.
4. Open the **Songs** tab and click :wingman-refresh: **Rescan**.

A field is saved when you leave it, or when you press ++enter++. The rescan
icon turns while the scan runs. When the scan finishes, the songs appear in
every open browser at once.

## What Wingman finds under the base path

Wingman works five things out from **Base path**.

| What | Name under the base path | What it is for |
|---|---|---|
| The program | `ultrastardx.exe` | Starting a song |
| The configuration | `config.ini` | The singers, their colors, and their pictures |
| The pictures | `avatars` | Where Ultrastar Deluxe reads avatars from |
| The scores | `Ultrastar.db` | What a song scored |
| The songs | `songs` | The folder Ultrastar Deluxe itself loads from |

Only the program has to be there. Each of the five has an override behind
**Advanced** in the **USDX** group, for a portable installation spread over
several folders. A normal installation needs none of them. See
[Settings](../settings/index.md).

!!! note
    `config.ini`, `Ultrastar.db`, and Ultrastar Deluxe's own songs folder do
    not have to exist yet. Each one appears when it is first needed.

## Your song folder

**Directory** in the **Songs** group is your library. It is usually Ultrastar
Deluxe's own songs folder, and it can be any folder on any drive. Wingman looks
exactly one level deep: every direct subfolder holding a song text file counts
as one song. To scan more than one folder, put the extra paths into
**Additional directories** behind **Advanced**, one path per line.

Ultrastar Deluxe has to load a song from inside its own songs folder, or it
opens with your whole library next to it. So a song that lives somewhere else
is copied there for as long as it plays, and the copy goes when Ultrastar
Deluxe closes. A song whose folder name carries characters Ultrastar Deluxe
cannot read is copied the same way, under a plain name.

## The setup banner

Until both settings are right, **Home** carries the banner *Ultrastar Deluxe is
not set up yet, so no song can be started*. Click **Fix it** and Wingman lists
what is missing in plain words, with a button into the settings. Pressing
**Play** while Wingman is unset opens the same list instead of an error.

Guests see the banner as well, with a line asking them to talk to the host. The
paths themselves stay hidden from anybody who may not see the settings.

The banner disappears the moment the settings are right, on every open page.
Nobody has to reload.

## Start Ultrastar Deluxe on its own

Some things are Ultrastar Deluxe's to set, and which microphone is player one
is the one every host runs into. The **USDX** group opens with a **Run
Ultrastar Deluxe** row and a **Launch** button for exactly that. It starts
Ultrastar Deluxe with no song and leaves its player configuration alone. Press
**Launch** again while Ultrastar Deluxe is up: the row says *Running*, and
Wingman brings its window to the front.

Close Ultrastar Deluxe when you are done. While it stands in its own menus, a
song started from a phone is refused the way a running song is refused.

## Even out the volume

Songs are mastered at very different volumes, so one song can be much louder
than the next. Wingman measures how loud every song it downloads is, and writes
the result into the song's audio file as a ReplayGain tag. Ultrastar Deluxe
reads the tag and turns each song up or down, so all of them sound about as
loud.

Ultrastar Deluxe only does that while its own **ReplayGain** option is on, under
**Options** > **Sound**. While **Normalize loudness** in the **Downloads** group
is on, which is the default, Wingman switches the option on before every song
it starts. You don't have to touch Ultrastar Deluxe.

With **Normalize loudness** off, Wingman tags no download and leaves the option
as you set it. To change it yourself, start Ultrastar Deluxe on its own, open
**Options** > **Sound**, and set **ReplayGain**. A song without a tag plays at
its own volume either way.

## What Wingman writes, and what it reads

Before every song, Wingman writes the singers into Ultrastar Deluxe's
`config.ini`: how many people sing, their names, their colors, their pictures,
and full screen. While **Normalize loudness** is on, it also switches on the
**ReplayGain** option. When Ultrastar Deluxe closes, Wingman reads the scores out of
`Ultrastar.db` and files each one under the player who sang on that slot.
Wingman never writes to `Ultrastar.db`.

!!! warning
    Wingman rewrites `config.ini` before every song. Your own version is kept
    once, as `config.ini.wingman-backup` next to it.

Scanning and singing write nothing into a song folder. Both leave your library
as it is.

See [Ultrastar Deluxe problems](../help/ultrastar-deluxe.md) when a song will
not start.
