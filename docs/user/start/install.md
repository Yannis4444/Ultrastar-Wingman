# Install and run

Wingman is one program on the karaoke PC. It serves the whole app to every
browser in the room, the host screen on the TV included. Install it with a
setup, or run the exe without installing anything.

## Pick a download

Every release carries the same Wingman three ways.

| Download | What it is |
|---|---|
| `UltrastarWingman-<version>-setup.exe` | The setup of Wingman alone, for the Ultrastar Deluxe you already have. Wingman starts a song with the `-Song` argument, which only [the Ultrastar Deluxe build on GitHub](https://github.com/Yannis4444/USDX) knows. A stock Ultrastar Deluxe opens its menu and plays nothing, so take the setup with Ultrastar Deluxe instead |
| `UltrastarWingman-<version>-with-usdx-setup.exe` | The setup of Wingman with Ultrastar Deluxe, in a `usdx` folder inside the install folder. See [Bring your own Ultrastar Deluxe along](#bring-your-own-ultrastar-deluxe-along) |
| `UltrastarWingman.exe` | The program itself, in one file. Put it wherever you like and double-click it. It keeps its data in the same folder as an installed Wingman, so switching between the two loses nothing |

!!! warning
    Ultrastar Deluxe cannot start songs from a path with letters beyond A to Z,
    such as ä, é, or ß. That matters to the setup with Ultrastar Deluxe alone:
    it installs under your Windows user name, so `Jürgen` already does it. The
    setup warns you. Pick a plain folder, like `C:\Karaoke\Ultrastar Wingman`.

## Install Wingman

1. Download the setup you picked.
2. Double-click it. If Windows says **Windows protected your PC**, click
   **More info**, then **Run anyway**. The setup carries no signature, and
   Windows warns about every program it does not know yet.
3. Accept the license, pick a folder, and say whether you want a desktop icon.
4. Leave **Launch Ultrastar Wingman** checked and click **Finish**.

The setup needs no administrator rights. It installs Wingman for your Windows
account alone, into `C:\Users\<you>\AppData\Local\Programs\Ultrastar Wingman`
unless you pick another folder, as `UltrastarWingman.exe` beside the `_internal`
folder it needs. Start Wingman from the Start menu entry **Ultrastar
Wingman**. The setup with Ultrastar Deluxe also makes its songs folder,
`usdx\songs` in there, and the entry **Ultrastar Wingman songs** that opens it.

## When Wingman starts

A console window opens, and Wingman opens the host screen in your browser. That
browser now runs the party. See [The host screen](../host-screen/index.md).

!!! warning
    The console window is Wingman. Closing it stops the program, and a song
    that was running then scores nothing. Minimize the window instead.

| Console line | What it is |
|---|---|
| `Data folder: …` | The data folder, where Wingman keeps everything. On Windows that is `C:\Users\<you>\AppData\Local\Ultrastar Wingman` |
| `Host UI: http://localhost:8080/host?hostToken=…` | The link that makes a browser the host. Copy it into a browser if none opened, or if the wrong one did. Select it with the mouse and press ++enter++ to copy it |
| `Wingman is running at http://localhost:8080 (press Ctrl+C to stop)` | Wingman is ready, on port 8080, at that address on the karaoke PC. The lines after it follow the evening. See [Read the console](../help/index.md#read-the-console) |

The database in the data folder, `wingman.db`, holds your accounts, players,
wishes, parties, and scores. Your songs stay in your own song folder. Wingman
writes there when you download, edit, or delete a song. See
[Connect Ultrastar Deluxe](ultrastar-deluxe.md).

## Update Wingman

Finish the song, close Wingman, then run the setup of the version you want. It
replaces the installed Wingman in the same folder, offers to close one that is
still open, and asks nothing else: the license, the folder, and the desktop
icon stay. If an update stops halfway, run the setup again to repair it. With
the exe, replace `UltrastarWingman.exe` with the newer one.

| You run | Over | What happens to Ultrastar Deluxe |
|---|---|---|
| The setup with Ultrastar Deluxe | A Wingman with Ultrastar Deluxe | It replaces Ultrastar Deluxe in `usdx` too. Close it as well, or the setup closes it along with Wingman. Its `config.ini`, its scores, and the songs in `usdx\songs` stay |
| The setup with Ultrastar Deluxe | A plain Wingman | It adds Ultrastar Deluxe, and Wingman uses that one from now on instead of the one in its settings |
| The plain setup | Either | It updates Wingman alone and leaves Ultrastar Deluxe where it is |

Wingman brings its own database up to date on every start, so your players,
parties, and scores carry over. Copy the data folder somewhere safe first. An
older Wingman cannot open a database a newer one has updated, so that copy is
your way back, and the setup warns before it installs an older version.

## Uninstall Wingman

Open **Settings** > **Apps** in Windows, pick **Ultrastar Wingman**, and click
**Uninstall**. Right-clicking the Start menu entry gets you there too. While
Wingman or its Ultrastar Deluxe runs, the uninstaller asks you to close it.

That removes the program, its Start menu entries, and the desktop icon. An
Ultrastar Deluxe the setup brought goes too, but what it wrote stays in `usdx`:
the songs in `usdx\songs`, `config.ini`, and the scores in `Ultrastar.db`. Your
data folder stays, and so does anything you added to the program folder, such
as a `.env` file. Deleting the program folder by hand takes the songs in
`usdx\songs` with it, so move them out first. Deleting the data folder takes
your players, parties, and scores.

## Change the port, the address, or the folder

Wingman reads these environment variables when it starts. Set one when the
default does not fit, and leave the others alone.

| Variable | What it does | Default |
|---|---|---|
| `WINGMAN_DATA_DIR` | The data folder | The Wingman folder in your app data |
| `WINGMAN_PORT` | The port to listen on | `8080` |
| `WINGMAN_HOST` | The address to listen on | `0.0.0.0`, meaning every address the PC has |
| `WINGMAN_OPEN_BROWSER` | Open the host screen at startup | `true` |
| `WINGMAN_FRONTEND_DIR` | The web app Wingman serves. Only needed if you built it yourself | The copy that comes with Wingman, or `frontend/dist` when you run from source |
| `WINGMAN_USDX_DIR` | An Ultrastar Deluxe folder Wingman treats as its own. See below | A `usdx` folder next to the exe that holds `ultrastardx.exe`, otherwise none |

Wingman also reads a file called `.env` in the folder you start it from, so a
double-click can carry these too. The Start menu entry starts it in the program
folder. One name and value per line:

```text
WINGMAN_PORT=9000
WINGMAN_OPEN_BROWSER=false
```

Everything else is a [setting](../settings/index.md) in **User** > **Settings**.

## Bring your own Ultrastar Deluxe along

Wingman can treat one Ultrastar Deluxe folder as its own, and the setup with
Ultrastar Deluxe installs exactly that. Wingman then works out every Ultrastar
Deluxe path from that folder, and the **USDX** settings group shows no paths.
When Wingman starts with the **Directory** setting in the **Songs** group
empty, it sets it to that folder's `songs` subfolder, and creates the subfolder
if it is missing. A directory you type in stays as it is.

Wingman finds the folder in one of three ways. The first one that applies wins.

1. The command line argument `--usdx-dir`, followed by the folder.
2. The `WINGMAN_USDX_DIR` variable from the table above.
3. A folder called `usdx` next to `UltrastarWingman.exe`, if it holds
   `ultrastardx.exe`. This is the one the setup with Ultrastar Deluxe
   installs. Wingman run from source never looks for it.

```powershell
.\UltrastarWingman.exe --usdx-dir "D:\Karaoke\Ultrastar Deluxe"
```

To make the exe ignore a `usdx` folder next to it, set `WINGMAN_USDX_DIR` to
nothing: a line `WINGMAN_USDX_DIR=` in `.env` does it. The **USDX** settings
group then works as in [Connect Ultrastar Deluxe](ultrastar-deluxe.md).

## Run from source

You need Python 3.12 or newer and Node.js. Open a terminal in the Wingman
folder and set it up once:

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -e backend
npm install --prefix frontend
npm run build --prefix frontend
```

Start it with this line, every time:

```powershell
venv\Scripts\python.exe -m ultrastar_wingman
```

It serves the same `http://localhost:8080` and data folder as the exe.
