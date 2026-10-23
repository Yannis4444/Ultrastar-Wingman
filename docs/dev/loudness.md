# Loudness normalization

*Design, 2026-10-23. Branch `feat/host-controls-loudness-share-cards`. Part 1 of 3: the core; part 2 is built (§5).
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
   gain of +52 dB. The row keeps a gain of 0 and no peak (part 2's decision): it plays as it
   is, and the pass over the library does not measure it again.
5. **A format that keeps no tag is measured and left alone** (`unsupported`): a raw `.aac`
   and a `.wav`. The numbers are still stored, so the host screen can use them. **Only the
   formats of §3's table are ever tagged** (`WRITABLE_SUFFIXES`: `.mp3`, `.ogg`, `.opus`,
   `.flac`, `.m4a`); every other suffix is `unsupported` before anything is copied, so a
   Matroska video or an `.mp4` named as the audio is never touched. A file whose content is
   not what its suffix says (an Ogg file named `.mp3`) is `unsupported` too: mutagen is told
   the format by the name, and trying again changes nothing. So is a file mutagen cannot load
   at all, whatever it raises — on a damaged file its parsers raise an `IndexError` as
   readily as a `MutagenError`; anything mutagen raises while *writing* is `failed`.
6. **The step runs after the library scan, in the download queue** (`downloads.service`), not
   inside the USDB source: every source gets it, and the row the numbers go on exists only
   then. It is a step without a percentage, like *adding to the library*.
7. **A read-only file is refused before the copy** (`failed`, *is read-only*): Windows would
   refuse the replace anyway, as "access denied", which read like a file in use.
8. **The tags are written with mutagen, never with an ffmpeg stream copy** (§3 says why). It
   was already a dependency: the scanner reads every song's length with it.
9. **An mp3 keeps its ID3v2 version**: a 2.3 tag stays 2.3 and a 2.4 tag 2.4, because mutagen
   writes a frame it does not know back only into the version it read it from. A file
   without an ID3v2 tag gets a 2.3 one, the version every reader reads; an ID3v2.2 tag, which
   mutagen cannot write, becomes 2.3.
10. **An `.m4a` is tagged** with iTunes freeform atoms, since ffmpeg proved to read them back
    under the bare key into the container's dictionary, where USDX looks.

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

## 3. Measuring, reading and writing

Wingman ships `ffmpeg.exe` alone, no `ffprobe`, so the measurement and the read are ffmpeg
runs, each with `-hide_banner -nostdin` and stdin closed (`media._run`'s rule). The write is
mutagen's.

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

The tags come off stdout; stderr is only read when the run fails.

Both dictionaries into one, so one call reads what USDX reads whatever the container: an Ogg
file's comments are on the stream, an mp3's frames on the container. `ffmetadata` alone shows
only the container's, which made an Ogg file look untagged. A file without an audio stream is
an error here.

**Write**, with mutagen. Why not ffmpeg: the first version of this step wrote the tags with
an ffmpeg stream copy (`-map 0 -c copy -map_metadata 0 -metadata …`), and that is not safe
for a library. An mp3 **without an info frame** (no Xing, Info or LAME header, what
`-write_xing 0` makes and some encoders write) gets one in ffmpeg's copy, its mp3 muxer always
writing it, and with it the encoder delay the decoder then skips. The packets are the same,
but the decoded audio is not (another MD5) and starts at 0.012 s instead of 0, some 12 ms
earlier against the lyrics, because USDX honors the stream's `start_time`
(`UAudioDecoder_FFmpeg.pas`, line 334). The copy also dropped an mp3's ID3v1 and APEv2 tags,
and the only defence it had was to compare the copy's length and start with the file's and
refuse a difference — which would have refused every such mp3 of a library, and a VBR mp3
without the frame whose length ffmpeg only estimates. mutagen rewrites the tag and no audio
frame, so none of that is there to check.

The file is copied (`shutil.copy2`) to `<stem>.wingman-loudness<suffix>` beside it, the same
folder so `os.replace` is a rename. The copy is tagged, ffmpeg reads the gain back out of the
copy with the read above — no gain, or another gain, is `unsupported` — and `os.replace` puts
it in place: a `PermissionError` there is `in_use`. The copy is removed on every path. Each
format goes through mutagen's own class for it, picked by the suffix (`.ogg` and `.opus` by the
content between Vorbis and Opus, since an `.ogg` may hold Opus):

| Suffix | Written as | How |
|---|---|---|
| `.mp3` | ID3v2 `TXXX` frames, description `REPLAYGAIN_TRACK_GAIN` / `REPLAYGAIN_TRACK_PEAK`, Latin-1 | `MP3(load_v1=False, translate=False)`, saved in the version it was read in (decision 9) with `v23_sep=None`; a file without a tag gets one (`add_tags`) |
| `.ogg`, `.opus` | Vorbis comments | `OggVorbis` or `OggOpus` |
| `.flac` | Vorbis comments, the block added when there is none | `FLAC` |
| `.m4a` | freeform atoms `----:com.apple.iTunes:REPLAYGAIN_TRACK_GAIN` / `_PEAK`, UTF-8 | `MP4` |

The values are what they were: the gain as `-6.50 dB`, the peak with six decimals.

**Replaced, never doubled.** mutagen keys a `TXXX` frame by its exact description and a
freeform atom by its exact name, while ffmpeg's dictionary ignores case: every one whose name
matches either key in any case is deleted before the new pair is added (for an `.m4a` under
any mean, since ffmpeg files a freeform atom under its name alone; mutagen deletes a Vorbis
comment in any case already). Both keys always go, so a gain written without a peak leaves no
old peak to cap it. Other ReplayGain keys (an album gain) stay.

**An mp3's ID3v1 tag, kept by its bytes.** mutagen's `save(v1=…)` has no way to leave one
alone, measured on a file with a v1 tag behind an APEv2 one: `0` removes it, `1` ("update, not
add") writes it anew out of the ID3v2 frames — its title and album replaced by the v2's, the
title cut to thirty characters, its artist, year and comment erased and its genre set to none
— and `2` adds one even where there is none. Loading with `load_v1=True` instead copies the
v1's fields into the v2 tag as `COMM`, `TCON`, `TDRC` and `TPE1` frames, and `1` still
replaces the v1's title and album and erases its comment. So the file is loaded without them and saved with `REMOVE`, and the
bytes that took off the end (at most 128) are appended again from the original. Then every byte
after the ID3v2 tag is held to the original's — the audio frames, an APEv2 tag, the ID3v1 tag —
and a difference is `failed` (*would change more than its ID3v2 tag*). That comparison, which
reads the file once more, is what replaced the copy's length and start check.

Proved with ffmpeg `2024-07-15-git-350146a1ea-full_build-www.gyan.dev` (the one on the
development machine's `PATH`, the one the live Wingman also uses) and mutagen 1.48.1, on
five-second files ffmpeg generated, each tagged with `-6.50 dB` and `0.988553`:

| File | Comes back as | Where | Decoded MD5 and `start:` |
|---|---|---|---|
| mp3 (`libmp3lame`, ffmpeg's ID3v2.4 tag) | `TXXX` frames under their description | container | same, `start: 0.023021` |
| mp3 with an ID3v2.3 tag | the same, still 2.3 | container | same |
| mp3 **without an info frame** (`-write_xing 0`) | the same | container | same, `start: 0.000000` before and after |
| mp3 without any tag (`-id3v2_version 0`) | the same, in a new 2.3 tag | container | same |
| mp3 with ID3v1 and APEv2 | the same; the last 128 bytes and the APEv2 tag identical | container | same |
| mp3 with an ID3v2.4 tag ending in a footer | the same, the footer gone | container | same, `start: 0.023021` |
| Ogg Vorbis, Ogg Opus, Opus in an `.ogg` | Vorbis comments | stream | same |
| FLAC | Vorbis comments | container | same |
| m4a (AAC) | freeform atoms, under the bare key | container | same |
| raw `.aac`, `.wav` | not written | — | — |

A cover picture stays an attached picture (mp3 and FLAC), the other tags stay (a non-ASCII
artist among them, through a path with brackets, spaces and umlauts), an existing pair in lower
case is replaced, a file another program holds open is `in_use` and intact, and no copy is ever
left behind. ffmpeg shows nothing of an mp3's APEv2 tag at all: an APEv2
`REPLAYGAIN_TRACK_GAIN` of `loud` read as no gain, and the file was tagged. The real-ffmpeg
tests in `tests/test_downloads_loudness.py` hold all of this; the unit tests hold the ID3v2
version, an unknown frame, a 2.3 frame with several values, an ID3v2.2 tag and an ID3v1 tag
without an ID3v2 one, on the silent fixtures in `tests/fixtures/loudness/`.

**An ID3v2.4 footer is folded into the tag.** mutagen counts the ten-byte footer (`3DI`, header
flag `0x10`) out of the tag's size and writes the new tag without one, so the old footer stayed
behind between the new tag and the first frame: junk ffmpeg skipped together with the info
frame after it, so the decoded audio changed and started at 0 instead of 0.023 s. The
comparison above was blind to it, both sides being read from mutagen's size. So the copy's
footer is zeroed, its flag cleared and the declared size made ten bytes longer before mutagen
loads it (`_absorb_id3v2_footer`): the zeros are padding to mutagen, the tag it rewrites ends
where the original's ended, and the comparison holds again. A tag with an extended header or
unsynchronisation was tagged with the decoded MD5, the `start:` and every byte after the tag
unchanged, and its title kept; mutagen writes the new tag without either.

What was **not** checked: frame flags, and the frames mutagen knows and so writes back through
its own parser rather than byte for byte — `PRIV`, `GEOB` and `SYLT` among them — against a file
another tagger wrote. Only a frame mutagen does not know is copied as it was. A frame of a kind
mutagen knows but cannot parse — a text frame with an unknown encoding byte, or invalid UTF-8 —
is dropped without a word, on load and so on save.

## 4. Where it lives

- `backend/src/ultrastar_wingman/downloads/loudness.py`: `measure`, `read_tags`, `write_tags`
  (raise `LoudnessError`, `FileInUseError`, `UnsupportedFormatError`; `write_tags` takes the
  ffmpeg as the reader of its copy, the writers per format are `_tag_mp3`, `_tag_ogg`,
  `_tag_flac` and `_tag_m4a`), `normalize(ffmpeg, file, *, write_window=None) -> Outcome` (never raises; the window is entered around the write, which a cancellation never cuts short),
  `normalize_song(session, ffmpeg, song) -> Outcome` (stores and logs by the song's name). In
  `downloads/` because ffmpeg is the downloads' tool. The mutagen classes are imported by name,
  which is also what puts them into the frozen exe (the spec lists nothing for them).
- `Outcome.status`: `tagged`, `already_tagged` (left alone), `unsupported`, `silent`,
  `missing`, `in_use`, `failed`. `Outcome.stored` is what goes on the row (`keep`): the numbers
  for the first three, `SILENT_GAIN` (0 dB, no peak) for `silent`, nothing for the rest.
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

**Part 2, the library pass (built).** `downloads/loudness_pass.py`, behind `GET`, `POST` and
`DELETE /downloads/loudness` (`settings.manage`) and the `loudness.changed` event; the row is
*Songs already in the library* under **Normalize loudness** on the Settings page
(`LoudnessPassRow`). Open to the user's veto:

- **Opt-in** (the orchestrator's ruling): nothing runs on a rescan or at startup; the host
  presses **Even out** and watches it run, because it rewrites the host's own files. It runs
  whatever the **Normalize loudness** switch says, which tags the downloads. Ultrastar
  Deluxe only hears the tags while its own **ReplayGain** option is on, and that switch is
  also what turns the option on before every song: with it off, the option stays as the
  host set it, and the pass tags files that may play untouched.
- **Visited:** the rows with an `audio_file` and `replay_gain_db IS NULL`, in the song list's
  order (`lower(artist)`, `lower(title)`, `id`), one at a time, with `normalize(...,
  write_window=...)` and `loudness.keep` — not `normalize_song`, which would log a first
  `in_use` as a warning. One ffmpeg per pass, looked for only when there is a song to visit;
  none ends the pass `failed` with its sentence in `error`.
- **Remembered:** what `keep` stores, silence included as `SILENT_GAIN` (0 dB, no peak: the
  file plays as it is, as USDX plays it), so a second pass visits only what is left. A
  `failed` file (read-only, damaged), a `missing` one and a final `in_use` keep nothing and
  are tried again by the next pass.
- **Waiting** while `karaoke.current_sing()` or `karaoke.usdx_is_open()`, checked before each
  song and again in the write window, once a second.
- **The write window** holds `scanner.library_lock()` and re-reads the row: a song deleted,
  moved to another audio file or filled by a download meanwhile is skipped, under no outcome.
  Storing the outcome takes the lock and looks again, so a rescan landing between the write
  and the row never ends up with this file's numbers on another file's row. The look is not
  a lock on the room: a sing started during the write (the copy and its read-back) finds the
  file whole, because the copy replaces it in one `os.replace`, which Windows refuses for a
  file Ultrastar Deluxe holds open (`in_use`).
- **Stopping** cancels the task: a measurement is given up, a write is finished first
  (`loudness._to_the_end`, which a download's shutdown now gets too); the row of a song
  written that way is filled by the next pass, from the tag.
- **`in_use`** is tried once more at the end of the pass, and counted only then.
- **The event carries no song:** every socket gets it, and a song a tag hides from guests
  must not ride along. `GET /downloads/loudness` adds the song in hand.

**Part 3, the host.** `MusicTrackRead.gain_db` / `.peak` and the same on `MusicPreviewRead`.
To match USDX: `10^(gain_db/20)`, capped at `1/peak` when there is a peak, multiplied into the
element's volume — which a browser caps at 1, so a positive gain needs a Web Audio gain node.
Null is "not known", and plays as it is. The user page `docs/user/songs/loudness.md` that was
asked for is not written yet: a page outside the structure table of
[documentation.md](documentation.md#target-structure) needs the user's agreement, so part 1
documents the download and the switch in `start/ultrastar-deluxe.md` and
`songs/download.md`.
