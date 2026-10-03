# All settings

Every setting Wingman has, group by group, in the order **User** > **Settings**
shows them. A setting under an **Advanced** heading sits behind the **Advanced**
line inside its group. See [Settings](index.md) for how the page works.

## Karaoke

| Setting | What it does | Default |
|---|---|---|
| **Players** | How many people sing at once. Ultrastar Deluxe plays 1, 2, 3, 4, or 6 on one screen | 4 |
| **Slot 1** to **Slot n** | The microphone color of each slot, out of Ultrastar Deluxe's own sixteen | blue, red, green, yellow |

Both are one setting seen from two sides. The count says how many slots the
singer picker offers, and each slot names a color of its own. Two slots cannot
share a color. Give a slot a color another one already has and the two swap. See
[Sing a song](../party/sing.md).

## Host

| Setting | What it does | Default |
|---|---|---|
| **Join URL** | The address the QR code on the host screen carries. Empty means Wingman picks your machine's address on the local network. The field names the address guests end up on either way | empty |

## Sound

| Setting | What it does | Default |
|---|---|---|
| **Master volume** | Everything the host screen plays is scaled by this one | 100 |
| **Music volume** | The background music between songs. Anybody who may control the music can also change this from the player | 100 |
| **Preview volume** | The song the reel lands on | 100 |
| **Effects volume** | Wingman's own sound effects. Nothing plays any yet | 100 |
| **Reel preview** | Play the song the reel on the host screen lands on, from where its singing starts, until Play is pressed or the pick is given up. The background music pauses for it | on |

The volumes are percentages, and the master multiplies the others. None of them
touches Ultrastar Deluxe, which mixes a song being sung itself. See
[Play background music](../party/music.md).

## Songs

| Setting | What it does | Default |
|---|---|---|
| **Directory** | The folder Wingman scans for songs. Downloads land here | empty |

### Advanced

| Setting | What it does | Default |
|---|---|---|
| **Additional directories** | Further folders to scan, one path per line | empty |

## USDX

A Wingman that comes with its own Ultrastar Deluxe shows none of these. It
works every path out of that Ultrastar Deluxe's folder, and the group holds a
line saying so instead. See
[Install and run](../start/install.md#bring-your-own-ultrastar-deluxe-along).

| Setting | What it does | Default |
|---|---|---|
| **Base path** | The Ultrastar Deluxe installation folder. The five settings below are worked out from it | empty |

### Advanced

| Setting | What it does | Default |
|---|---|---|
| **Executable** | Overrides `<base path>\ultrastardx.exe` | empty |
| **Config file** | Overrides `<base path>\config.ini`, which holds the singers, their colors, and their pictures | empty |
| **Avatars directory** | Overrides `<base path>\avatars`, where Ultrastar Deluxe reads pictures from | empty |
| **Songs directory** | Overrides `<base path>\songs`, the folder Ultrastar Deluxe itself loads from | empty |
| **Ultrastar DB** | Overrides `<base path>\Ultrastar.db`. Wingman only reads it, for the scores | empty |

## USDB

| Setting | What it does | Default |
|---|---|---|
| **Username** | The usdb.animux.de account songs are searched and downloaded with | empty |
| **Password** | The password of that account. Stored and never shown again | empty |

### Advanced

| Setting | What it does | Default |
|---|---|---|
| **Base URL** | The address of the USDB instance Wingman searches and downloads from | `https://usdb.animux.de` |

## Downloads

| Setting | What it does | Default |
|---|---|---|
| **Parallel** | How many songs download at the same time. Applied on restart | 2 |
| **Video quality** | Which stream is downloaded | High (1080p) |

**Video quality** offers four presets and one free field. *Best available* takes
whatever YouTube has, at any size. *High (1080p)*, *Medium (720p)*, and *Small
(480p)* cap the picture at that height. *Custom* takes a yt-dlp format string
you write yourself. The format string a preset stands for is spelled out under
the choices. See [Download songs](../songs/download.md).

### Advanced

| Setting | What it does | Default |
|---|---|---|
| **ffmpeg** | The ffmpeg program, which pulls the audio out of the video. The default uses the one on your system, or a copy Wingman downloads on Windows | `ffmpeg` |
| **yt-dlp path** | The yt-dlp program. Empty means Wingman downloads and updates its own copy | empty |

## Auth

| Setting | What it does | Default |
|---|---|---|
| **OIDC enabled** | Offers a sign-in button for a login provider next to the local accounts | off |
| **OIDC issuer** | The provider's issuer URL. Everything else is read from its discovery document | empty |
| **OIDC client ID** | The client id Wingman is registered as at the provider | empty |
| **OIDC client secret** | The client secret. Empty for a public client. Stored and never shown again | empty |
| **OIDC display name** | The name on the sign-in button | `SSO` |

### Advanced

| Setting | What it does | Default |
|---|---|---|
| **OIDC scopes** | The scopes asked for at login, separated by spaces. `openid` is required | `openid profile` |

See [Single sign-on](../people/single-sign-on.md) for what to register at the
provider.
