# Sound effects

*Built 2026-11-08 on `feat/groups-reel-sfx`; cut down at the user's request on 2026-11-09 (§1.4,
§2), the badge sounds unheard. Where this document and the code disagree, the code is right and
this document is updated.*

The user asked for "some sound effects? For the spinner (only on the host screen), for the
achievements (like a whooshing sound when shown)", and for a setting to switch them off.
The host screen now makes two short sounds of its own, both synthesised in the browser — the
badges' whoosh and thud. The reel's sounds were built and then taken out (§1.4).

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
4. **The reel is silent.** The first cut ticked for every cover crossing the window's line
   (read off the reel's computed transform every animation frame, at most one tick a frame
   and one per 30 ms) and knocked when the covers stopped. On 2026-11-09 the user had the
   landing taken out first, because the song preview rises at the reveal half a second later,
   then the ticks too: "too much", for now. Both are in git (`b066024` and its parent) should
   the reel get a sound again; `SongReel` has no `sounds` prop any more. The same day the badge
   sounds got "a bit more epic — still the same style": a wider, louder whoosh and a lower,
   longer thud with an impact under it. Neither has been heard by the user yet.
5. **A badge lands with a thud** under its whoosh, at the throw's 68 % keyframe where it
   squashes. Under reduced motion nothing flies, so the thud alone marks a badge appearing.

## 2. The recipes

Numbers as in `sfx.ts`. The envelope peaks are what the gain node climbs to; the output peaks
of the first cut were measured in headless Chrome at master 100 and effects 100, through a tap
on the destination. The 2026-11-09 numbers are **reckoned from those, not re-measured**: the
whoosh scales with its peak; the thud's impact is low-passed noise at a quarter of full scale,
of which a 300 Hz low-pass keeps a small part.

| Effect | Recipe | Length | Envelope peak | Output peak |
|---|---|---|---|---|
| `whoosh` | noise through a band-pass sweeping 2800 → 300 Hz, Q 1; swells in 80 ms, falls away (the first cut: 2200 → 420 Hz, Q 0.9, peak 0.37) | 0.45 s | 0.5 | ≈ 0.25, reckoned from the first cut's 0.2 |
| `thud` | a sine falling 150 → 45 Hz over 0.3 s (the body) under noise through a 300 Hz low-pass for 70 ms (the impact) (the first cut: a sine 120 → 55 Hz, 0.16 s, peak 0.11) | 0.3 s | 0.2 + 0.25 | up to ≈ 0.3, reckoned |

The reel's two sounds of the first cut are gone (§1.4): a tick of noise through a band-pass at
2600 Hz, Q 3, 25 ms, peak 0.3, measured at 0.06–0.12 by where in the noise it started, and a
landing of a sine falling 170 → 70 Hz under a clack of band-passed noise, 0.22 s, measured at
≈ 0.25.

The noise is one second of white noise per context, made once and read from a random
offset. Envelopes end at 0.0001, because an exponential ramp cannot reach 0. A voice lets its
nodes go when its last source ends; `stop()` cuts it early.

A song at its evened-out loudness (ReplayGain, -18 LUFS, [loudness.md](loudness.md)) does
not peak near full scale: a loud modern master is turned down by 8 to 10 dB. Five real mp3s
measured with ffmpeg's `ebur128` (integrated loudness and sample peak, then `replayGainFactor`'s
rule) peaked at 0.34 to 0.61 once evened out — the quietest of them, a -8.6 LUFS master, at
0.34 (-9.4 dBFS). The loudest effect, the thud with its impact, is reckoned at up to 0.3
(-10.5 dBFS), about 1 dB under that (the first cut's loudest, the landing, was measured at 0.25,
2.7 dB under), and every effect is far shorter than a bar of music: at equal sliders none of
them is louder than the song. The margin is thinner since 2026-11-09 and rests on a reckoning,
so the badge sounds are the ones to measure first should the TV say otherwise.

## 3. The moments

| Moment | Where | What plays |
|---|---|---|
| The reel spins, lands, is cut short or is loaded settled | — | nothing, since 2026-11-09 (§1.4); the song preview rises at the reveal |
| A badge's throw starts | `HostAchievements`, on `animationstart` of `host-achievement-throw` | `whoosh` now, `thud` 0.435 s later |
| A badge appears under reduced motion | the same, `host-achievement-appear` on the badge | `thud` |

**The whoosh follows the badge's own animation.** `animationstart` fires after each badge's
stagger delay, so the sound cannot drift from the picture. The sounds of a run are stopped
when the run ends early: the next song starting, or the feature switched off.

Nothing plays during a sing: the badges are never on the stage then.

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

- No sound on any phone, on either reel, or anywhere but the host screen.
- No melody, no chime, no fanfare. A sound that reads as a toy is wrong.
- No per-effect volume or per-effect switch. One switch and one volume cover both.
- No sound for the results screen, the countdown or a card landing on the player selector.
