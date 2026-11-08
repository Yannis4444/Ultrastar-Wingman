# Sound effects

*Built 2026-11-08 on `feat/groups-reel-sfx`. Where this document and the code disagree, the
code is right and this document is updated.*

The user asked for "some sound effects? For the spinner (only on the host screen), for the
achievements (like a whooshing sound when shown)", and for a setting to switch them off.
The host screen now makes four short sounds of its own, all synthesised in the browser.

## 1. Decisions

Made for this batch, open to a veto:

1. **No audio files.** Every effect is a recipe in `frontend/src/sfx.ts` — white noise or a
   sine, a filter, an envelope — scheduled on the page's one `AudioContext`
   (`musicGraph.ts`). Nothing is downloaded or committed, and a tweak is a number.
2. **The host screen alone, and its lease-holding tab alone.** The level comes from
   `MusicSink`, which sets the effects bus to master × effects on the tab holding the music
   sink's lease and to 0 everywhere else. A phone never mounts the sink, and a second host
   tab never ticks a beat behind the TV.
3. **The switch is `sound.effects`, on by default**, in the **Sound** group beside
   `sound.reel_preview`, labelled *Sound effects* (`settings.ts` `KEY_LABELS`; the key alone
   would read *Effects*). It rides the music state like the volumes: `MusicRead.sound_effects`,
   refreshed through `MUSIC_KEYS`, broadcast as `music.changed`.
4. **The landing sounds when the covers stop** (`transitionend`, at `SPIN_MS`), not at the
   reveal half a second later (`REVEAL_MS`), which is when the song preview starts to rise.
5. **A badge lands with a soft thud** under its whoosh, at the throw's 68 % keyframe where it
   squashes. Under reduced motion nothing flies, so the thud alone marks a badge appearing.

## 2. The recipes

Numbers as in `sfx.ts`. The envelope peaks are what the gain node climbs to; the output peaks
were measured in headless Chrome at master 100 and effects 100, through a tap on the
destination.

| Effect | Recipe | Length | Envelope peak | Output peak |
|---|---|---|---|---|
| `tick` | noise through a band-pass at 2600 Hz, Q 3; 1 ms attack, exponential fall | 25 ms | 0.3 | 0.06–0.12, by where in the noise it starts |
| `land` | a sine falling 170 → 70 Hz in 0.12 s (the knock) under noise through a band-pass at 1400 Hz, Q 2 (the clack) | 0.22 s | 0.22 + 0.4 | ≈ 0.25 |
| `whoosh` | noise through a band-pass sweeping 2200 → 420 Hz, Q 0.9; swells in 70 ms, falls away | 0.45 s | 0.37 | ≈ 0.2 |
| `thud` | a sine falling 120 → 55 Hz | 0.16 s | 0.11 | ≈ 0.1 |

The noise is one second of white noise per context, made once and read from a random
offset. Envelopes end at 0.0001, because an exponential ramp cannot reach 0. A voice lets its
nodes go when its last source ends; `stop()` cuts it early.

A song at its evened-out loudness (ReplayGain, -18 LUFS, [loudness.md](loudness.md)) does
not peak near full scale: a loud modern master is turned down by 8 to 10 dB. Five real mp3s
measured with ffmpeg's `ebur128` (integrated loudness and sample peak, then `replayGainFactor`'s
rule) peaked at 0.34 to 0.61 once evened out — the quietest of them, a -8.6 LUFS master, at
0.34 (-9.4 dBFS). The loudest effect, the landing, peaks at 0.25 (-12 dBFS), 2.7 dB under
that, and every effect is far shorter than a bar of music: at equal sliders none of them is
louder than the song.

## 3. The moments

| Moment | Where | What plays |
|---|---|---|
| A cover of the reel crosses the window's line | `SongReel` (`sounds`), on the host's `HostSelection` | `tick`, at most one per animation frame and one per 30 ms |
| The reel's covers stop | the same, on `transitionend` | `land`, once per spin |
| A spin cut short by a press in the room | the same, on `land()` | `land`, unless it already sounded; the ticks stop first, so the reel jumping to its end is not one more tick |
| A spin under reduced motion | the same, landing at once | `land` alone, no ticks |
| A reel the host loads already settled | — | nothing |
| A badge's throw starts | `HostAchievements`, on `animationstart` of `host-achievement-throw` | `whoosh` now, `thud` 0.435 s later |
| A badge appears under reduced motion | the same, `host-achievement-appear` on the badge | `thud` |

**The ticks follow the real transform.** While a reel spins, `SongReel` reads the computed
`transform` of the reel every animation frame (`sfx.translateYOf`) and works out which cover
stands at the line (`sfx.coverAtLine`, which changes as an edge crosses the middle). A change
is one `pass`. No second clock models the easing, so the ticks slow down exactly as the
covers do. A tab the browser hides runs no frames and makes no ticks.

**The whoosh follows the badge's own animation.** `animationstart` fires after each badge's
stagger delay, so the sound cannot drift from the picture. The sounds of a run are stopped
when the run ends early: the next song starting, or the feature switched off.

The phone's reel passes no `sounds`, so nothing watches its transform. Nothing plays during a
sing: the reel and the badges are never on the stage then.

## 4. Levels and the switch

`musicGraph.ts` holds one bus `GainNode` into the destination. `setEffectsLevel` is called by
`MusicSink` with `effectiveVolume(master, effects)` while the tab holds the lease and the state
says `sound_effects`, and with 0 otherwise. Every change is a step, never a glide: Chrome does
not run the automation of a node nothing plays through, so a glide set while the bus idled
began only under the next effect, which then sounded at a twentieth of its level (measured
in the browser check of this batch, after the switch had been off for a song). Switching off
is a step to 0, so a whoosh already scheduled is silent at once.

`sfx.playEffect` plays nothing and makes no node when the level is 0, when there is no context,
or when the context is not `running`. It never creates a context and never resumes one. The
sink's unlock does both: any press on the host page. An effect that finds the graph asleep is
simply skipped, never a prompt and never an error.

The consequence, accepted: with the background music and the song preview both off, nothing
ever asks for the press, because *Turn on sound* appears only after a refused play. A TV that
nobody has clicked since the host link opened it stays silent until somebody does — the full
screen button counts. The sink claims its lease whatever the music's switch says, so the
effects work with the music off once that press has happened.

## 5. Not done, on purpose

- No sound on any phone, on the Random song page's own reel, or anywhere but the host screen.
- No melody, no chime, no fanfare. A sound that reads as a toy is wrong.
- No per-effect volume or per-effect switch. One switch and one volume cover all four.
- No sound for the results screen, the countdown or a card landing on the player selector.
