# Get started

Wingman runs on the PC that runs Ultrastar Deluxe. Everybody else just opens it
in a browser.

## What you need

- Ultrastar Deluxe, installed and started at least once.
- A folder with songs — usually the one Ultrastar Deluxe already uses, but any
  folder does.
- `UltrastarWingman.exe`, or the Wingman source folder if you prefer to run it
  from there.

## Run Wingman

### With the exe

Double-click `UltrastarWingman.exe`. There is nothing to install and nothing to
configure on the command line.

A console window opens and stays open — it is the log. Two lines in it matter:

- the data folder, where Wingman keeps its database, and
- `Host UI: http://localhost:8080/host?hostToken=…`, the one-time link that makes
  a browser the host.

Wingman opens that link in your browser by itself. Everything lives on one
address, port 8080.

!!! warning
    Keep the console window open. Closing it stops Wingman, and with it any song
    that is playing.

### From source

Open a terminal in the Wingman folder and do it in three steps:

```powershell
venv\Scripts\python.exe -m pip install -e backend
cd frontend; npm install; npm run build; cd ..
venv\Scripts\python.exe -m ultrastar_wingman
```

The last line is what you repeat every time. It serves the same
`http://localhost:8080` as the exe.

## First launch

The browser Wingman opened shows the **host screen** with the badge *Host session
active*. That browser now has full access: it may change every setting and stop a
running song.

Did the browser not open, or open the wrong one? Copy the `Host UI:` line from the
console into a browser.

!!! warning
    The host link works exactly once. If the page says the link does not work any
    more, restart Wingman and use the new line from the console.

## Connect Ultrastar Deluxe

Go to **User → Settings** and fill in two things:

1. **USDX → Base path** — the folder Ultrastar Deluxe is installed in. Wingman
   finds the program, its `config.ini`, the avatars folder, the score database
   and Ultrastar Deluxe's own songs folder inside it.
2. **Songs → Directory** — the folder that holds your songs. Every direct
   subfolder with a song text file in it is one song.

Both fields are saved as you leave them. Open **Songs** and press the rescan
button (the circling arrows next to the song count); the song list fills up.

!!! note
    Have more song folders? Put the extra paths into **Songs → Additional
    directories**, one per line. A song from there is copied into the Ultrastar
    Deluxe songs folder while it plays, and the copy is removed afterwards.

See [Settings](../settings/index.md) for every field, and
[Fix a problem](../help/index.md) if the song list stays empty.

## Let the guests in

The host screen shows a QR code, with the same address printed under it in plain
text for anyone whose camera will not cooperate. Wingman works the address out
itself: it is your PC's address on the local network, not `localhost`, so the
guests reach Wingman and not their own phone.

```text
http://192.168.1.20:8080
```

Guests have to be on the same Wi-Fi. The first guest who cannot connect is almost
always the firewall — see [Fix a problem](../help/index.md).

!!! note "The QR code shows the wrong address"
    A VPN, a virtual machine adapter or a second network card can make Wingman
    pick the wrong one of your PC's addresses. Put the right one into
    **User → Settings → Host → Join URL** — `192.168.1.20` is enough, Wingman
    fills in the `http://` and its own port — and the QR code changes on the TV
    straight away, without a reload. Leave the
    field empty to go back to letting Wingman pick. The line under the field
    always tells you which address the QR code is carrying right now.

## Optional: your own account

Wingman works without any account. Create one on the **User** tab if you want
favorites, your own playlists, or rights for other people. The very first
account created is the administrator. See
[People](../people/index.md).
