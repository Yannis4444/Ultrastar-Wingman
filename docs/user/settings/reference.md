# All settings

Every setting Wingman has, group by group, in the order **User** > **Settings**
shows them. A setting under an **Advanced** heading sits behind the **Advanced**
line inside its group. See [Settings](index.md) for how the page works.

## Karaoke

| Setting | What it does | Default |
|---|---|---|
| **Players** | How many people sing at once. Ultrastar Deluxe plays 1, 2, 3, 4, or 6 on one screen | 4 |
| **Slot 1** to **Slot n** | The microphone color of each slot, out of Ultrastar Deluxe's own sixteen | blue, red, green, yellow |
| **Fair wishes** | On **Wishlist (weighted)**, each further wish of the same person counts a little less, so a long wishlist does not drown out a short one. Off, every wish counts the same | on |
| **Rest skipped songs** | A song the reel on the host screen landed on, and the room spun past, comes up less often for the next half hour. It is never left out | on |

**Players** and the slots are one setting seen from two sides. The count says
how many slots the singer picker offers, and each slot names a color of its own.
Two slots cannot share a color. Give a slot a color another one already has and
the two swap. See [Sing a song](../party/sing.md).

**Fair wishes** and **Rest skipped songs** decide what the reel lands on. See
[Let the reel pick](../party/reel.md).

## Host

| Setting | What it does | Default |
|---|---|---|
| **Join URL** | The address the QR code on the host screen carries. Empty means Wingman picks your machine's address on the local network. The field names the address guests end up on either way | empty |

## Sound

| Setting | What it does | Default |
|---|---|---|
| **Master volume** | Everything the host screen plays is scaled by this one | 100 |
| **Music volume** | The background music between songs. Anybody who may control the music can also change this from the player | 100 |
| **Preview volume** | The song being picked, while the singers are chosen | 100 |
| **Effects volume** | Wingman's own sound effects on the host screen | 100 |
| **Song preview** | Play the song being picked on the host screen while the singers are chosen, from where its singing starts: once the reel lands on it, or at once for a song somebody chose. It stops when the song starts or the pick is given up, and the background music pauses for it | on |
| **Sound effects** | Short sounds on the host screen: a tick for every cover the reel passes and a click when it lands, and a whoosh for every new badge after a song. Nothing on the phones, and nothing while a song is sung. See [Sound effects](../host-screen/index.md#sound-effects) | on |

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
| **Normalize loudness** | Writes each download's loudness into its audio file, and switches on Ultrastar Deluxe's **ReplayGain** option before every song, so every song plays at about the same volume | on |
| **Video quality** | Which stream is downloaded | High (1080p) |

With **Normalize loudness** off, you set the option yourself, under
**Options** > **Sound** > **ReplayGain** in Ultrastar Deluxe. See
[Even out the volume](../start/ultrastar-deluxe.md#even-out-the-volume).

Under **Normalize loudness**, the **Songs already in the library** row is no
setting. Its **Even out** button evens out the songs that were there before. See
[The songs you already have](../start/ultrastar-deluxe.md#the-songs-you-already-have).

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
| **yt-dlp arguments** | Extra yt-dlp options for every download. Stored and never shown again | empty |

**yt-dlp arguments** takes yt-dlp's own options, typed the way they follow
`yt-dlp` on a command line. Spaces separate them. Put quotes around one that
holds a space, such as `"C:\My Files\cookies.txt"`. A backslash is an ordinary
character, so a Windows path is typed as it is. Wingman refuses a quote that is
never closed. Wingman's own options for the format, the file name, and the
progress display come after yours and win. An option that turns the video into
something else, such as `--extract-audio` or `--recode-video`, leaves Wingman no
video, and the download fails. Wingman refuses a `--username` without its
`--password`, because yt-dlp would stop the download to ask for the password
and wait for an answer forever. While the field is set, the
reason of a failed download says so, because a mistyped option often fails with
a message that names nothing you typed.

The field may hold a password, so it is never shown again. To change it, type
the whole line anew. In the console window and in the reason of a failed
download, every value you typed reads as `***`. yt-dlp's options include
`--exec`, which runs any program you name. Whoever may change settings can
therefore run programs on the karaoke PC through this field. See
[Download songs](../songs/download.md#age-restricted-videos) for the usual use.

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
