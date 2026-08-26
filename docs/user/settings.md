# Settings

**User → Settings** holds everything the host configures. Only an administrator
can open it by default; a role that may look but not change sees the values greyed
out.

A change is saved when you leave the field or press Enter, and every open browser
gets the new value immediately. A changed field grows a **Reset to …** button that
puts the default back.

Two fields are all Wingman really needs: the USDX base path and the songs
directory. The rest has sensible defaults.

The settings are grouped by area, and each field carries its own one-line
explanation. Below, every field is listed with the name it has in the app and the
key it is stored under.

## Karaoke

How many people sing at once, and in which colours.

| Field | What it is |
|---|---|
| **Players** | How many singing slots the player selection offers. Ultrastar Deluxe plays 1, 2, 3, 4 or 6 players on one screen, so those are the choices. |
| **Slot 1 … Slot n** | The colour of each slot, picked from Ultrastar Deluxe's own sixteen. Every slot needs a colour of its own — picking one another slot already has swaps the two. |

Both live in one setting (`karaoke.player_colors`): the colour names in order,
separated by commas, e.g. `blue,red,green,yellow`. How many there are is how many
players sing. Wingman writes exactly this into Ultrastar Deluxe's `config.ini`
before every song, together with the names and avatars of whoever is on the slots.

!!! tip
    Set this to the number of microphones you have. Slots left empty at the end
    of a selection are dropped before the song starts, so one slot too many
    costs nothing — but a slot left empty *between* two singers is kept, so the
    singers after it keep their colours and their microphone. Since Ultrastar
    Deluxe itself only plays 1, 2, 3, 4 or 6 players, five singers reach it as
    six, the sixth one empty.

## Host

What the host screen — the TV — tells the guests.

| Field | What it is |
|---|---|
| **Join URL** (`host.join_url`) | The address guests open on their phones, and therefore what the QR code on the host screen encodes. Empty means Wingman picks your PC's address on the local network itself, which is right on most machines. |

Fill it in when the QR code carries an address the guests cannot reach — a VPN, a
Hyper-V switch or a second network card can make the automatic pick land on the
wrong one. `http://192.168.1.20:8080`, `192.168.1.20:8080` and plain
`192.168.1.20` are all fine: Wingman adds the `http://` for you, and it adds the
port it is listening on when you leave it off. Write the scheme yourself
(`https://party.example`) and Wingman changes nothing — that is the way to point
the QR code at a reverse proxy on its own port. An address no phone could open (a
scheme that is not `http` or `https`, a missing host, a port that is not a number)
is refused with the reason under the field, and the QR code keeps the address that
worked.

The line under the field always names the address the QR code is carrying right
now, whether that is your value or Wingman's guess. Saving a new one changes the
TV immediately — nobody has to walk over and reload it.

## USDX

Where Ultrastar Deluxe lives.

| Field | What it is |
|---|---|
| **Base path** (`usdx.base_path`) | The Ultrastar Deluxe installation folder. Everything below is derived from it. |
| **Executable** (`usdx.executable`) | Overrides the derived `<base path>\ultrastardx.exe`. |
| **Config file** (`usdx.config_file`) | Overrides the derived `<base path>\config.ini` — the file that holds players, colours and avatars. |
| **Avatars directory** (`usdx.avatars_dir`) | Overrides the derived `<base path>\avatars`, where Ultrastar Deluxe reads avatar pictures from. |
| **Ultrastar DB** (`usdx.ultrastar_db`) | Overrides the derived `<base path>\Ultrastar.db`. Wingman only reads it, to import the scores. |
| **Songs directory** (`usdx.songs_dir`) | Overrides the derived `<base path>\songs` — the folder Ultrastar Deluxe itself loads songs from. |

For a normal installation, fill in the base path and leave the five overrides
empty. They exist for portable installations spread over several folders.

**Songs directory** is not the same field as the songs directory under
[Songs](#songs). That one says where *Wingman* looks for songs and may be
anywhere, on any drive; this one is where *Ultrastar Deluxe* looks. Wingman
starts every song from inside Ultrastar Deluxe's own songs folder — copying the
song there first when it lives somewhere else, or when its folder name has
characters Ultrastar Deluxe cannot pass on the command line. Started from
anywhere else, Ultrastar Deluxe loads its whole library alongside the song and
opens on the first song of the list instead of the one that was picked.

The section starts with a **Run Ultrastar Deluxe** row and its **Launch**
button. Some things are not Wingman's to set — which microphone is player one,
above all — and can only be changed inside Ultrastar Deluxe itself. Launch
starts it with no song and without touching its player configuration; pressing
it again while it is up says *Running* instead of starting a second one. While
Ultrastar Deluxe stands in its own menus, a song from a phone is refused the
same way a running song is refused — whoever may stop a song can still replace
it.

!!! note
    `config.ini` is created by Ultrastar Deluxe on demand, `Ultrastar.db` only
    exists after the first score, and Ultrastar Deluxe's own songs folder
    appears at the latest when the first song is put into it, so none of the
    three has to be there yet.

## Songs

Where your songs are.

| Field | What it is |
|---|---|
| **Directory** (`songs.directory`) | The folder Wingman scans for songs. Downloads land here. |
| **Additional directories** (`songs.additional_directories`) | Further folders to scan, one path per line. |

Every direct subfolder of a scanned folder that holds a song text file counts as
one song. Scanning never writes anything into a song folder.

This is your library, and it may be anywhere — it is usually Ultrastar Deluxe's
own songs folder, but it does not have to be. Where Ultrastar Deluxe itself looks
is [USDX → Songs directory](#usdx); a song that lives outside that folder is
copied into it for as long as it plays.

## USDB

The song database Wingman downloads from. See
[Download songs](downloading-songs.md).

| Field | What it is |
|---|---|
| **Username** (`usdb.username`) | The account used to search and download from usdb.animux.de. |
| **Password** (`usdb.password`) | The password of that account. It is stored but never shown again — the box only says whether one is set, and **Clear** removes it. |
| **Base URL** (`usdb.base_url`) | The address of USDB. Default `https://usdb.animux.de`. |

## Auth

Single sign-on through an OpenID Connect provider (Keycloak and friends). Local
accounts work without any of this. The full walkthrough — what to register at the
provider, and what a singer sees — is in
[Accounts and permissions](accounts-and-permissions.md#log-in-with-single-sign-on-keycloak-and-friends).

| Field | What it is |
|---|---|
| **OIDC enabled** (`auth.oidc_enabled`) | Show a **Sign in with …** button under the login form. Needs the issuer and the client id below. |
| **OIDC issuer** (`auth.oidc_issuer`) | The provider's issuer URL, e.g. `https://keycloak.example/realms/party`. |
| **OIDC client ID** (`auth.oidc_client_id`) | The client id Wingman is registered as at the provider. |
| **OIDC client secret** (`auth.oidc_client_secret`) | The client secret. Empty for a public client. Stored but never shown again — the box only says whether one is set. |
| **OIDC display name** (`auth.oidc_display_name`) | The name on the button. Default *SSO*. |
| **OIDC scopes** (`auth.oidc_scopes`) | Space-separated scopes, default `openid profile`. `openid` is required. |

## Downloads

| Field | What it is |
|---|---|
| **Parallel** (`downloads.parallel`) | How many songs download at the same time. Default 2, applied after a restart. |
| **Video quality** (`downloads.video_format`) | How good the downloaded video is. Pick a preset — *Best available*, *High (1080p)* (the default), *Medium (720p)*, *Small (480p)* — or *Custom* and write a yt-dlp format string yourself. The effective format string is always spelled out under the presets. |
| **ffmpeg** (`downloads.ffmpeg`) | The ffmpeg program, used to pull the audio track out of the video. Leave it at the default `ffmpeg` and Wingman uses the one on your system, or downloads its own copy (Windows only) the first time it needs one. Fill in a full path to use exactly that program instead. |
| **yt-dlp path** (`downloads.ytdlp_path`) | The yt-dlp program. Leave it empty and Wingman downloads and updates its own copy. |

!!! warning
    Only fill in the yt-dlp path if you want to manage yt-dlp yourself. Wingman
    does not update a copy you point it at — and YouTube breaks old yt-dlp
    versions every few weeks.

!!! note
    The presets ask for mp4 video plus m4a audio capped at their resolution
    (`bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]`
    for 1080p), *Best available* asks for `bestvideo*+bestaudio/best`. There is
    no audio-only choice: Ultrastar Deluxe plays the video file, and the mp3
    next to it is extracted from that same file.
