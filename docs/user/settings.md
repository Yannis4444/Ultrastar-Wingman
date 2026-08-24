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

## USDX

Where Ultrastar Deluxe lives.

| Field | What it is |
|---|---|
| **Base path** (`usdx.base_path`) | The Ultrastar Deluxe installation folder. Everything below is derived from it. |
| **Executable** (`usdx.executable`) | Overrides the derived `<base path>\ultrastardx.exe`. |
| **Config file** (`usdx.config_file`) | Overrides the derived `<base path>\config.ini` — the file that holds players, colours and avatars. |
| **Avatars directory** (`usdx.avatars_dir`) | Overrides the derived `<base path>\avatars`, where Ultrastar Deluxe reads avatar pictures from. |
| **Ultrastar DB** (`usdx.ultrastar_db`) | Overrides the derived `<base path>\Ultrastar.db`. Wingman only reads it, to import the scores. |

For a normal installation, fill in the base path and leave the four overrides
empty. They exist for portable installations spread over several folders.

!!! note
    `config.ini` is created by Ultrastar Deluxe on demand and `Ultrastar.db` only
    exists after the first score, so neither has to be there yet.

## Songs

Where your songs are.

| Field | What it is |
|---|---|
| **Directory** (`songs.directory`) | The Ultrastar Deluxe songs folder Wingman scans. Downloads land here. |
| **Additional directories** (`songs.additional_directories`) | Further folders to scan, one path per line. |

Every direct subfolder of a scanned folder that holds a song text file counts as
one song. Scanning never writes anything into a song folder.

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
| **ffmpeg** (`downloads.ffmpeg`) | The ffmpeg program, used to pull the audio track out of the video. Leave it at the default `ffmpeg` and Wingman uses the one on your system, or downloads its own copy (Windows only) the first time it needs one. Fill in a full path to use exactly that program instead. |
| **yt-dlp path** (`downloads.ytdlp_path`) | The yt-dlp program. Leave it empty and Wingman downloads and updates its own copy. |

!!! warning
    Only fill in the yt-dlp path if you want to manage yt-dlp yourself. Wingman
    does not update a copy you point it at — and YouTube breaks old yt-dlp
    versions every few weeks.
