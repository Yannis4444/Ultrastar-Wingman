# Install and run

Wingman is one program on the karaoke PC. It serves the whole app to every
browser in the room, the host screen on the TV included. Install it with the
setup, or run the exe without installing anything.

## Pick a download

Every release has two setups. Both install the same Wingman.

| Download | What it installs |
|---|---|
| `UltrastarWingman-<version>-setup.exe` | Wingman alone, for the Ultrastar Deluxe you already have |
| `UltrastarWingman-<version>-with-usdx-setup.exe` | Wingman with Ultrastar Deluxe |

The second one puts Ultrastar Deluxe into a folder called `usdx` inside the
install folder, and Wingman treats that copy as its own. The **USDX** settings
hold no paths then, and your songs go into `usdx\songs`. See
[Bring your own Ultrastar Deluxe along](#bring-your-own-ultrastar-deluxe-along).

!!! warning
    Ultrastar Deluxe cannot start songs from a folder with an accented letter
    in its path. The setup installs under your Windows user name, so a name
    like `Jürgen` already does it. The setup with Ultrastar Deluxe warns you,
    and you pick a plain folder instead, such as `C:\Karaoke\Ultrastar Wingman`.

## Install Wingman

1. Download the setup you picked.
2. Double-click it. If Windows says **Windows protected your PC**, click
   **More info**, then **Run anyway**. The setup carries no signature, and
   Windows warns about every program it does not know yet.
3. Accept the license. The setup asks for a folder, and whether you want a
   desktop icon.
4. Leave **Launch Ultrastar Wingman** checked and click **Finish**.

The setup needs no administrator rights. It installs Wingman for your Windows
account alone, into `C:\Users\<you>\AppData\Local\Programs\Ultrastar Wingman`
unless you pick another folder. From then on, start Wingman from the Start menu
entry **Ultrastar Wingman**.

## Run the exe without installing

Put `UltrastarWingman.exe` wherever you like and double-click it. It is the
program the setup installs, and it keeps its data in the same folder, so
switching between the two loses nothing.

## When Wingman starts

A console window opens and stays open. That window is Wingman, and closing it
stops the program. Wingman then opens the host screen in your browser by
itself.

Wingman listens on port 8080. On the karaoke PC that address is
`http://localhost:8080`. The page your browser opened is the host screen, and
that browser now runs the party. See [The host screen](../host-screen/index.md).

!!! warning
    Closing the console window stops Wingman. A song that was running then
    scores nothing. Minimize the window instead.

Two of the console's startup lines are worth knowing.

- `data directory: …` names the folder Wingman keeps everything in.
- `Host UI: http://localhost:8080/host?hostToken=…` is the link that makes a
  browser the host. Copy it into a browser if none opened, or if the wrong one
  did.

## Where your data lives

Everything Wingman remembers sits in one folder. On Windows that is:

```text
C:\Users\<you>\AppData\Local\Ultrastar Wingman
```

The database inside it is `wingman.db`. It holds your accounts, players,
wishes, parties, and scores. Your songs are not in there. They stay in your own
song folder, which Wingman only reads. See
[Connect Ultrastar Deluxe](ultrastar-deluxe.md).

## Update Wingman

Finish the song, close Wingman, then run the setup of the version you want. It
finds the installed Wingman and replaces it in the same folder. If Wingman is
still open, the setup lists it and offers to close it. If you run the exe
instead, replace `UltrastarWingman.exe` with the newer one.

The setup with Ultrastar Deluxe replaces the game in `usdx` as well. Close
Ultrastar Deluxe too, or the setup closes it along with Wingman. The game's
`config.ini`, its scores, and the songs in `usdx\songs` stay.

The plain setup updates Wingman alone and leaves the game where it is. The
setup with Ultrastar Deluxe run over a plain install adds the game, and Wingman
uses that one now.

Wingman brings its own database up to date on every start, so your players,
parties, and scores carry over. Copy the data folder somewhere safe first. An
older Wingman cannot open a database a newer one has updated, so that copy is
your way back, and the setup warns before it installs an older version.

## Uninstall Wingman

Open **Settings** > **Apps** in Windows, pick **Ultrastar Wingman**, and click
**Uninstall**. Right-clicking the Start menu entry gets you there too. While
Wingman runs, the uninstaller waits for you to close it.

That removes the program, its Start menu entry, and the desktop icon. Your data
folder stays, and so does anything you added to the program folder yourself,
such as a `.env` file. To remove every trace, delete both folders by hand.

With Ultrastar Deluxe installed too, close it as well. The game goes, but what
it wrote stays in `usdx`: the songs in `usdx\songs`, `config.ini`, and the
scores in `Ultrastar.db`. Delete the `usdx` folder by hand once you no longer
need them.

## Change the port, the address, or the folder

Wingman reads these environment variables when it starts. Set one when the
default does not fit, and leave the others alone.

| Variable | What it does | Default |
|---|---|---|
| `WINGMAN_DATA_DIR` | The folder above | The Wingman folder in your app data |
| `WINGMAN_PORT` | The port to listen on | `8080` |
| `WINGMAN_HOST` | The address to listen on | `0.0.0.0`, meaning every address the PC has |
| `WINGMAN_OPEN_BROWSER` | Open the host screen at startup | `true` |
| `WINGMAN_FRONTEND_DIR` | The web app Wingman serves. Only needed if you built it yourself | The copy inside the exe, or `frontend/dist` when you run from source |
| `WINGMAN_USDX_DIR` | An Ultrastar Deluxe folder Wingman treats as its own. See below | A `usdx` folder next to the exe that holds `ultrastardx.exe`, otherwise none |

Wingman also reads a file called `.env` in the folder you start it from, so a
double-click can carry these too. The Start menu entry starts it in the program
folder. One name and value per line:

```text
WINGMAN_PORT=9000
WINGMAN_OPEN_BROWSER=false
```

Everything else is a setting inside the app, under **User** > **Settings**. See
[Settings](../settings/index.md).

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
UltrastarWingman.exe --usdx-dir "D:\Karaoke\Ultrastar Deluxe"
```

To make the exe ignore a `usdx` folder next to it, set `WINGMAN_USDX_DIR` to
nothing: a line `WINGMAN_USDX_DIR=` in `.env` does it. The **USDX** settings
group then works as described in
[Connect Ultrastar Deluxe](ultrastar-deluxe.md).

## Run from source

You need Python 3.12 or newer and Node.js. Open a terminal in the Wingman
folder and set it up once:

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -e backend
cd frontend
npm install
npm run build
cd ..
```

Start it with this line, every time:

```powershell
venv\Scripts\python.exe -m ultrastar_wingman
```

It serves the same `http://localhost:8080` as the exe, out of the same data
folder.
