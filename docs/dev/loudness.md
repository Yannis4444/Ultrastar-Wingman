# Loudness normalization

*Design, 2026-10-23. Branch `feat/host-controls-loudness-share-cards`. Part 1 of 3: the core.
Part 2 is the pass over the songs already in the library, part 3 the host screen playing with
the gain and the user documentation's own page. Where this document and the code disagree,
the code is right and this document is updated.*

Songs come from everywhere and are mastered at every volume. Ultrastar Deluxe can even them
out, but only for files that carry a ReplayGain tag, and it never writes one. Wingman now
writes one into every download, keeps the numbers on the song row for the host screen, and
switches Ultrastar Deluxe's option on.

## 1. Decisions

The user's: every download gets the tag ("I would say yes"), the
songs already in the library get it too (part 2 decides how), the host screen uses it for the
background music and the song previews (part 3), and the users are told how the option is
switched on.

Made here, open to a veto:

1. **ReplayGain 2.0, not 1.0.** EBU R128 integrated loudness over the whole file (ffmpeg's
   `ebur128` filter), reference **-18 LUFS**, so `gain = -18 - I` dB. ffmpeg's older
   `replaygain` filter is ReplayGain 1.0 and measures differently; nothing in USDX's parser
   prefers one or the other, and 2.0 is what every current tagger writes.
2. **The true peak, not the sample peak** (`ebur128=peak=true`, about twice as slow: a
   four-minute song takes about a second). USDX uses the peak only as a clipping guard, and the
   true peak is the conservative one: a decoded lossy file overshoots its samples.
3. **The setting is `downloads.normalize_loudness`, on by default**, in the **Downloads**
   group. It is also what switches Ultrastar Deluxe's option on (§4). That answers the user's
   "or should we just enable it by editing the USDX config file?" with yes, tied to Wingman's
   own switch.
4. **Silence gets no tag.** A file measured at ebur128's absolute gate (-70 LUFS) would get a
   gain of +52 dB.
5. **A format that keeps no tag is measured and left alone** (`unsupported`): a raw `.aac`, a
   `.wav`, and an `.m4a`, whose ffmpeg muxer writes arbitrary keys only with
   `-movflags use_metadata_tags`, which rewrites every other tag of the file as well. The
   numbers are still stored, so the host screen can use them. **Only the formats of §3's
   table that keep the tag are ever copied** (`WRITABLE_SUFFIXES`: `.mp3`, `.ogg`, `.opus`,
   `.flac`); every other suffix is `unsupported` before ffmpeg writes anything. Without that
   list a Matroska video named as the audio (`.mkv`, `.webm`) takes the tag, and is rewritten
   whole for it; an `.mp4` is copied whole only to be thrown away.
6. **The step runs after the library scan, in the download queue** (`downloads.service`), not
   inside the USDB source: every source gets it, and the row the numbers go on exists only
   then. It is a step without a percentage, like *adding to the library*.
7. **A read-only file is refused before the copy** (`failed`, *is read-only*): Windows would
   refuse the replace anyway, as "access denied", which read like a file in use.

## 2. What USDX reads

`src/media/UAudioDecoder_FFmpeg.pas`, `ParseReplayGain`, called from `Open` only while
`Ini.ReplayGain = 1`:

- The dictionary is the **audio stream's for an Ogg container** (`iformat.name = 'ogg'`, so
  Vorbis and Opus) and **the container's for everything else**.
- `av_dict_get(Metadata, 'REPLAYGAIN_TRACK_GAIN', nil, 0)`: flags 0, so the key matches in any
  case. Without a gain the peak is never read.
- Only for Ogg Opus without a ReplayGain gain: `R128_TRACK_GAIN`, a Q7.8 number against
  -23 LUFS, to which USDX adds 5 dB.

`src/base/UMusic.pas`, `SetReplayGain`: the gain is the **first word** of the tag (so
`-6.50 dB` and a bare `-6.5` both work), a leading `+` is stripped, `StrToFloat` with the
decimal separator forced to `.` (`UMain.pas`). With a peak above 0 the gain is lowered to
`-20·log10(peak)`, so nothing clips. The volume is then multiplied by `10^(gain/20)`. **There
is no pre-amp.** An unparsable tag is logged and plays unevened.

`src/base/UIni.pas`: `[Sound] ReplayGain=Off|On` (`IReplayGain`), default `Off`. In the game
it is **Options > Sound > ReplayGain** (`SING_OPTIONS_SOUND_MUSICAUTOGAIN`; German
*Normalisierung*).

## 3. The ffmpeg commands

Wingman ships `ffmpeg.exe` alone, no `ffprobe`, so all three are ffmpeg runs, each with
`-hide_banner -nostdin` and stdin closed (`media._run`'s rule).

**Measure**, bounded by `MEASURE_TIMEOUT_SECONDS` (300):

```text
ffmpeg -nostats -i FILE -map 0:a:0 -af ebur128=framelog=verbose:peak=true -f null -
```

`framelog=verbose` moves the ten-per-second frame lines below the log level; the summary is
logged whatever the level. Read off stderr after the last `Summary:`: `I: <n> LUFS` under
*Integrated loudness* and `Peak: <n> dBFS` under *True peak* (`-inf` for silence). The peak is
stored linear, `10^(dBFS/20)`, six decimals; the gain two.

**Read**, bounded by `TAG_TIMEOUT_SECONDS` (120):

```text
ffmpeg -nostats -i FILE -map_metadata 0:s:a:0 -map_metadata 0 -f ffmetadata -
```

At the default log level, for the input's `Duration: …, start: …` line the write checks
(below); the tags themselves come off stdout.

Both dictionaries into one, so one call reads what USDX reads whatever the container: an Ogg
file's comments are on the stream, an mp3's frames on the container. `ffmetadata` alone shows
only the container's, which made an Ogg file look untagged. A file without an audio stream is
an error here, which is what makes the read-back below prove the copy has one.

**Write**, to `<stem>.wingman-loudness<suffix>` beside the file:

```text
ffmpeg -nostats -i FILE -map 0 -c copy -map_metadata 0 [-id3v2_version 3]
       -metadata REPLAYGAIN_TRACK_GAIN="-6.50 dB" -metadata:s:a:0 REPLAYGAIN_TRACK_GAIN="-6.50 dB"
       -metadata REPLAYGAIN_TRACK_PEAK=0.988553 -metadata:s:a:0 REPLAYGAIN_TRACK_PEAK=0.988553
       -y TEMP
```

Both levels, because an Ogg file's existing stream value wins over a new container one, and
an mp3 writes only the container's; neither writes a key twice. ID3v2.3 for an mp3 alone (the
option is the mp3 muxer's, and every reader reads 2.3). Then the copy is read back: no gain,
or another gain, is `unsupported`. An exit code of 0 is not taken as proof that the copy lost
nothing, so the copy is also held to the original's dump (the copy run's own stderr): its
length within half a second or a hundredth of the file (`DURATION_TOLERANCE_*`), its start
within a millisecond (`START_TOLERANCE_SECONDS`); a copy ffmpeg gives no length or start for,
of a file it does, is refused. Then `os.replace`, and the copy is removed on every path.

The start check exists because of an mp3 **without an info frame** (no Xing, Info or LAME
header, `-write_xing 0`): ffmpeg's mp3 muxer always writes one into the copy, and with it the
encoder delay the decoder then skips. The packets are the same, but the decoded audio is not
(another MD5) and starts at 0.012 s instead of 0, some 12 ms earlier against the lyrics,
because USDX honors the stream's `start_time` (`UAudioDecoder_FFmpeg.pas`). Such a file is
`failed`. Wingman's own downloads always carry the frame (libmp3lame writes it), and for them
start, length and MD5 are the same before and after.

Proved with ffmpeg `2024-07-15-git-350146a1ea-full_build-www.gyan.dev` (the one on the
development machine's `PATH`, the one the live Wingman also uses) on generated files:

| Format | Comes back as | Where |
|---|---|---|
| mp3 (`libmp3lame`) | `TXXX` frames, read back under their description | container |
| Ogg Vorbis, Ogg Opus | Vorbis comments | stream |
| FLAC | Vorbis comments | container |
| m4a (AAC) | not written | — |
| raw `.aac`, `.wav` | not written | — |
| Matroska (`.mkv`) | would keep it, but is never copied (decision 5) | container |

The stream copy keeps the cover picture (an mp3's `APIC` stays an attached picture), the
other tags (a non-ASCII artist among them, through a path with brackets, spaces and umlauts),
and every sample: the decoded audio's MD5 is the same before and after for mp3, Ogg Vorbis,
Opus and FLAC. An existing pair written in lower case by another tagger is replaced, not
doubled. The real-ffmpeg tests in `tests/test_downloads_loudness.py` hold all of this. What was **not** checked is what becomes of the parts of a tag ffmpeg has
no metadata key for — an ID3v1 tag beside the ID3v2 one (ffmpeg writes none by default), a
`PRIV` or `GEOB` frame, synchronized lyrics. Irrelevant for a download, whose mp3 ffmpeg itself
just made; the first thing part 2 has to check before it rewrites a library.

## 4. Where it lives

- `backend/src/ultrastar_wingman/downloads/loudness.py`: `measure`, `read_tags`, `write_tags`
  (raise `LoudnessError`, `FileInUseError`, `UnsupportedFormatError`), `normalize(ffmpeg,
  file) -> Outcome` (never raises), `normalize_song(session, ffmpeg, song) -> Outcome` (stores
  and logs by the song's name). In `downloads/` because ffmpeg is the downloads' tool.
- `Outcome.status`: `tagged`, `already_tagged` (left alone), `unsupported`, `silent`,
  `missing`, `in_use`, `failed`. `Outcome.stored` is what goes on the row: the numbers for the
  first three, nothing for the rest.
- `songs.replay_gain_db` and `songs.replay_gain_peak` (migration 0037, no backfill). A rescan
  leaves them alone and clears them when the txt names an audio file of another **name** (a
  library moved to another drive keeps them). A download writes them, or clears them.
- `karaoke/usdx_config.write_player_config(..., replay_gain=True)` sets `[Sound]
  ReplayGain=On`, before every sing, while the setting is on; while it is off the key is the
  host's and is never written. `start_standalone` still writes no config at all.
- `music/schema.py`: `MusicTrackRead` and `MusicPreviewRead` carry `gain_db` and `peak`, off
  the row the music and the selection already hold. `SongRead` does not: the phones have no
  use for them.

## 5. The seams for parts 2 and 3

**Part 2, the library pass.** The songs to visit are the rows with an `audio_file` and
`replay_gain_db IS NULL`. For each, `normalize_song(session, ffmpeg, song)`, with one ffmpeg
resolved once (`media.ensure_ffmpeg`). `already_tagged` is cheap (one read, nothing written)
and fills the row from a tag USDB Syncer or UltraStar Manager wrote. `in_use` is worth a retry
later: on Windows it is Ultrastar Deluxe playing the file, or the host screen streaming it
(`PermissionError` from the replace, WinError 32 or 5). `unsupported` and `silent` are final.
Three `failed` outcomes are final too and would be retried forever: a read-only file, an mp3
without an info frame (§3's start check; `-write_xing 0` on the copy of a file that has none
would keep its samples, untried), and a VBR mp3 without one, whose `Duration:` ffmpeg
estimates from the first frame's bitrate while the copy's is exact, so the length check may
refuse a correct copy. None of them is a download.
To weigh: silently, on a rescan, or asked; the scan lock (`scanner.library_lock`) while a file
is replaced; and §3's last sentence.

**Part 3, the host.** `MusicTrackRead.gain_db` / `.peak` and the same on `MusicPreviewRead`.
To match USDX: `10^(gain_db/20)`, capped at `1/peak` when there is a peak, multiplied into the
element's volume — which a browser caps at 1, so a positive gain needs a Web Audio gain node.
Null is "not known", and plays as it is. The user page `docs/user/songs/loudness.md` that was
asked for is not written yet: a page outside the structure table of
[documentation.md](documentation.md#target-structure) needs the user's agreement, so part 1
documents the download and the switch in `start/ultrastar-deluxe.md` and
`songs/download.md`.
