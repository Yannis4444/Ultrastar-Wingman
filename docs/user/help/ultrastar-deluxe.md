# Ultrastar Deluxe problems

Wingman starts every song in Ultrastar Deluxe and reads the scores back out of
it. When that goes wrong, it is almost always one of the six below. Setting it
up in the first place is
[Connect Ultrastar Deluxe](../start/ultrastar-deluxe.md).

## Nobody can start a song

**Home** carries a banner while no song can be started: *Ultrastar Deluxe is
not set up yet, so no song can be started*. Click **Fix it** and Wingman lists
what is missing, in plain words, with a button into the settings. Pressing
**Play** opens the same list.

Everything in this table has to be true. The first row is for the setup that
comes with Ultrastar Deluxe. The next two rows are for a Wingman pointed at
your own installation.

| What has to be true | If it is not |
|---|---|
| With the setup that comes with Ultrastar Deluxe: `usdx\ultrastardx.exe` is still in the install folder | The list says the Ultrastar Deluxe that comes with this installation is missing: it was moved or deleted. Once Wingman restarts, the **USDX** group shows its paths again instead. Run that setup again to put it back. |
| **Base path** in the **USDX** group is filled in | Fill it in. It is the folder that holds `ultrastardx.exe`. |
| `ultrastardx.exe` is really in that folder | The base path is wrong, or the program has another name. Set **Executable** in the same group, behind **Advanced**. |
| **Directory** in the **Songs** group is filled in | Fill it in. Wingman has to know where the songs are. |
| That folder exists | The path is misspelled, or the drive it sits on is not connected. |
| Windows starts the program | The paths are right and the start failed anyway. Start Ultrastar Deluxe by hand once, then try again. |

Press **Play** again afterwards. The banner goes away by itself on every open
page, with no reload.

A plain notice that the song could not be started, with no list behind it,
means the failure was none of these. Read the console window.

## Ultrastar Deluxe opens the whole song list

The song starts, and Ultrastar Deluxe comes up with your whole library instead
of the song that was picked. Wingman starts every song from inside Ultrastar
Deluxe's own songs folder, which is what keeps the rest of the library out.
Three things get in the way.

- **Wingman is pointed at the wrong folder.** It works that folder out from
  **Base path**. An installation that keeps its songs elsewhere needs **Songs
  directory** in the **USDX** group, behind **Advanced**. That field is
  Ultrastar Deluxe's own folder, not the one Wingman scans.
- **Ultrastar Deluxe has a song folder of its own on top.** Its `config.ini`
  can carry a `SongDir1` line pointing outside its songs folder. That folder is
  loaded every time. Wingman never touches that part of the file, so take the
  line out yourself while Ultrastar Deluxe is closed.
- **The path carries unusual characters.** A song folder called `Björk - Jóga`
  is copied to a plain name automatically. The folders above it are not. Move
  Ultrastar Deluxe if a folder above it has letters beyond A to Z in its name,
  such as ä, é, or ß.

## Ultrastar Deluxe opens its menu and plays nothing

The song starts, and Ultrastar Deluxe comes up in its own menu with no song
playing. Wingman starts every song with the `-Song` argument, and that
Ultrastar Deluxe does not know it. Only
[the Ultrastar Deluxe build on GitHub](https://github.com/Yannis4444/USDX)
does. Take the setup that comes with Ultrastar Deluxe, which brings that build.
See [Install and run](../start/install.md).

## Another song is playing, and none is

Starting a song says another one is playing while the TV shows nothing. That
means an Ultrastar Deluxe that Wingman started is still open. Wingman counts
that as busy, whatever it has on screen.

- The last song finished and Ultrastar Deluxe is sitting on its own result
  screen or back in its menu. Close it.
- **Launch** in the **USDX** settings started it for its own menus. Close it.

Whoever may stop a song is offered **Replace** instead. That closes Ultrastar
Deluxe and starts the new song.

## The scores did not arrive

Wingman reads the scores when Ultrastar Deluxe closes, and not before. Three
things end with nothing on the **Scores** tab.

- **Ultrastar Deluxe is still open.** Close it and the scores land.
- **The song was stopped.** Ultrastar Deluxe writes a score only for a song
  sung to the end.
- **The name does not match.** Wingman writes the singers into Ultrastar
  Deluxe's `config.ini` before the song. It then files each score under the
  name it wrote there. A name typed inside Ultrastar Deluxe instead matches
  nobody. That score keeps the name and belongs to no player, so it ranks
  nobody and earns nothing.

Pick the singers in Wingman and the third one never happens. See
[Sing a song](../party/sing.md).

## Wingman changed my config.ini

It does, before every song. It writes how many people sing, their names, their
colors, their pictures, and full screen. Nothing else in the file is touched.

Your own version is kept next to it as `config.ini.wingman-backup`. Wingman
writes that backup once and never over an existing one. To go back to it, close
Ultrastar Deluxe and Wingman, then rename the backup over the original.

!!! note
    `config.ini`, `Ultrastar.db`, and Ultrastar Deluxe's own songs folder do
    not have to exist before you start. Each one appears when it is first
    needed.
