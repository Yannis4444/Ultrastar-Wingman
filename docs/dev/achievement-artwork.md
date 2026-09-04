# Achievement artwork — guidelines and prompt kit

How the badge pictures of the thirty-four built-in achievements are made: one
consistent set, generated with ChatGPT from the prompt kit below, and the same
kit is what makes a matching badge for a custom achievement later. The
finished files live in `backend/src/ultrastar_wingman/achievements/images/`,
one PNG per built-in whose picture has been made, named by its id
(`builtin-score-9000.png`) — ChatGPT's own download, full size, unchanged, so
the file in the package is also the master. §9 says which badges exist. §8 is
the UI work the pictures still need.

## 1. What the app does with a picture

These constraints come from `AchievementBadge.tsx` / `.css`, `images.py` and
the host screen, and every guideline below follows from one of them.

| Fact | Consequence for the artwork |
|---|---|
| The badge is a **rounded square** (`border-radius: 0.5em` on a 2.5em side, `object-fit: cover`) since 2026-09-04; it was a circle before, and the decision to square it was taken for this artwork (§8). | Design a **full-bleed square**: a dark grey plate edge to edge with square corners, the motif large on it, no drawn frame or medallion. The UI rounds the corners when it crops, exactly as it does for the square avatar pictures, so the radius is a CSS decision that can change later without regenerating a single image. |
| **40 px** in every list row, 26–74 px on the TV. | One bold silhouette per badge. No text, no numbers, no secondary objects, no fine lines. Anything that needs more than ~1/40 of the width to read is gone. |
| Unearned: `filter: grayscale(1); opacity: 0.45`. | The motif must read by **brightness** against its plate, not by hue. Light motif on a dark plate. |
| Earned glyph medallions are a solid plate in the tier colour with a cut-out glyph; the four tier colours are the tag colours: neutral `#ccc`, blue `#4b92cd`, pink `#9e3b95`, gold `#faa636`. | The tier has to stay visible in the picture, or the ladders (6 000 → 8 000 → 9 000 → 9 500) lose their colour story. |
| Row avatars, a tag's colour square and a playlist's cover are 8 px rounded squares (`--border-radius-small`); round was what told a badge from a tag. | With square badges the enamel-pin drawing itself is what tells a badge apart from a flat glyph square. §8 notes the tag square as something to look at again. |
| The app is dark-only: page `#021720`, tiles `#1b3347`, inputs `#1c2832`. | **Decision (2026-09-03): the plate is a monochrome dark grey, not a navy.** A neutral grey sits under all four tier colours without tinting them, keeps the picture's hue entirely on the motif, and is dark enough that the badge still reads as a dark object on the dark page. Some structure in the grey is fine, one fixed kind of it (§2). |
| Upload: PNG/JPEG/WebP, ≤ 5 MB, ≤ 50 MP. | ChatGPT's download is a 1254×1254 PNG of 1–1.3 MB — the soft falloff and the model's noise defeat PNG's compression — comfortably inside both caps. **Decision (2026-09-03): ship that file as it is**, no downscale, so a larger badge view later has the pixels; a smaller variant for the rows is the serving side's job (§8, item 6), not a second set of files made by hand. |
| A built-in is drawn with its **shipped picture** unless the host uploaded one (`achievements/pictures.py`, since 2026-09-04): `Reset` and removing an upload go back to it, `image_shipped` tells the editor so, and export carries uploads only. | The files in `images/` *are* the badges every fresh install shows. A stray or misnamed file there ships in every wheel and installer, and `test_every_built_in_ships_a_picture_in_both_sizes` refuses one. |
| `GET /achievements/{id}/icon?size=small` serves `images/small/<id>.png`; every badge the app draws asks for it. | Each badge is two files: the original and a 256 px variant made from it (§5, step 5). An upload has no variant and is served whole at either size. |

## 2. Design guidelines

**Style: flat vector enamel pin.** Solid colour fields, two-step cel shading,
uniform dark outlines, no gradients, no texture, no 3D. Chosen because it is
the style an image model reproduces most reliably across runs, it survives
40 px, it survives greyscale, and it is flat like the rest of the app.
(Alternatives considered: embossed metal coin — reads as one blob at 40 px and
its monochrome relief loses detail in greyscale; painterly — drifts every run.)

**Geometry, identical on every badge:**

```
┌──────────────────────────┐  canvas 1024×1024, full bleed, square corners
│ ░░░░░░░░░░░░░░░░░░░░░░░░ │  plate: the whole canvas, monochrome grey,
│ ░░░░··················░░ │         lighter behind the motif (#3a3e43),
│ ░░░·                  ·░ │         darkening softly to the edges (#1e2124)
│ ░░░·      MOTIF       ·░ │  motif: one object, centred and dominant,
│ ░░░·      ~84 %       ·░ │         ~84 % of the canvas width,
│ ░░░·                  ·░ │         the same 8 % margin all round
│ ░░░░··················░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░ │  no frame, no medallion, no border:
└──────────────────────────┘  the plate runs to the edge
```

**The plate** is one dark grey with one kind of structure: a soft radial
falloff, lightest (`#3a3e43`) directly behind the motif and darkest
(`#1e2124`) in the corners, smooth, with no visible banding and no hue. That
is the whole "variation": it gives the picture depth and puts a natural
spotlight on the motif, and it is a structure an image model reproduces
identically every run, where a pattern or a texture would not. The grey is
neutral on purpose: it carries none of the four tier hues, so the motif is the
only coloured thing in the picture — its tier tones and its one accent, and
nothing else.

**The background element.** On the plate, behind the motif, each badge has
*one* large grey element that fits its motif — sound waves behind the
microphone, rings behind the tuning fork, a horizon and haze behind the rocket.
It is what gives a badge its own character at TV size while every list row
still reads as "grey plate, one coloured object". The rules that keep it from
becoming a scene:

- **Tonal only.** Two flat greys, `#3f4349` (light) and `#2a2e33` (dark), laid
  over the falloff. Never a hue, never lighter than `#454a50`, never as light
  as the motif's shadow tone.
- **One shape family, large forms.** No feature smaller than a tenth of the
  canvas, no repeated small elements (no dots, stars, confetti, dashes).
- **Behind, not touching.** It never crosses or touches the motif's outline;
  the motif sits on top with clear plate around it.
- **The downscale is the test.** At 40 px the element must all but vanish
  into the plate. If it still reads at 40 px, it is too strong.

**Action.** A badge should have some life in it, and it gets it from two
sources and no others:

- **Pose.** A 10–20° tilt, a three-quarter view, an object already moving —
  a rocket climbing, a mug raised, a hat tipped. The silhouette carries most
  of the energy.
- **One action cue that is part of the silhouette.** Exhaust under the
  rocket, steam off the mug, sand streaming in the hourglass, foam spilling
  over a rim, two thick vibration arcs beside a tuning fork, one bold strum
  swoosh across the guitar. One shape, thick, in the motif's tones or the
  accent, at most a quarter of the motif.

Not action: speed lines, particles, sparkles, drops, several motion strokes.
They vanish at 40 px, vary most between runs, and turn an enamel pin into a
comic panel. Not every motif needs a cue — the trophy and the crown live on
pose alone.

The motif fills the square. The 8 % margin is not a frame: it is what keeps
the corner rounding the UI applies (§8) off the motif — a rounded corner of
radius *r* removes about 0.29 *r* from the diagonal, 2.3 px of a 3.2 px margin
at 40 px with the planned ~20 % radius — and what keeps the picture from
looking cramped in its 40 px slot. A different radius later costs no
regeneration. Wide motifs — the dumbbell, the guitar, the airplane — may use
the full width; tall ones the full height.

**Colour: the tier decides the hue, one accent is allowed.** The motif is
drawn in one tier palette of three tones (base, highlight, shadow), which
covers at least four fifths of it; the plate is grey and the outlines a
near-black grey. This is the strongest consistency lever there is: two badges
of the same tier differ in silhouette, not in colour scheme, and the ladder
colours still read as they do on the glyph medallions. The motif is the only
carrier of the tier, so the base tone has to dominate it (shading rule below).

**The accent** is one small second colour on the motif — the plaque on the
trophy, the core of the flame, the star inside the wreath — at most a fifth of
the motif, one area or a matched pair (both mic bands, both cheeks). It comes
from a fixed palette of four, so a rerun of the same badge lands on the same
colour and no picture invents a fifth hue. Each motif entry names its accent
and where it goes; an accent is never used on a tier it is close to (no teal
on blue, no cream on neutral).

| Accent | Hex | Reads as |
|---|---|---|
| red | `#d9534f` | a band, a plaque, a nose cone, a pickguard |
| teal | `#3fb8a8` | a beam, a stream, a switch band |
| cream | `#f3ead6` | the hot core, the ball at the end of a stem |
| pink | `#c85bbd` | gems, a hat band, cheeks — the app's pink, lightened | The pink tier is lightened from the app's
`#9e3b95` because that value is too dark against the plate, especially drained
to greyscale.

| Tier | Motif base | Highlight (upper-left faces) | Shadow (lower-right faces) |
|---|---|---|---|
| neutral | `#d6dde3` | `#ffffff` | `#8c98a4` |
| blue | `#4b92cd` | `#9cc9ef` | `#2b5f8e` |
| gold | `#faa636` | `#ffd88a` | `#b8701a` |
| pink | `#c85bbd` | `#e99ae0` | `#7a2c73` |

Constant on every badge: plate grey `#3a3e43` behind the motif falling off to
`#1e2124` at the corners, outlines `#131517`. The neutral tier is silver on
grey — the least contrast of the four, still about 8:1 at `#d6dde3` on
`#3a3e43`, and rightly the modest one: it is the tier of the first badges a
singer earns.

**Shading rule:** the base tone dominates; highlight and shadow together cover
less than a third of the motif. Light from the top left. This keeps the
silhouette bright against the plate, which is what the greyscale state needs.

**Motif rule:** one object, centred, front or three-quarter view, a shape that
is recognisable as a black-and-white cut-out. Avoid faces and hands — they are
what image models vary most between runs. Where the app glyph is a face or a
hand, §4 proposes an object instead and flags the deviation.

**Plate decision (taken):** the tier colour is on the motif over a grey plate,
*not* on the plate as the glyph medallions do. A tier-coloured plate with a
dark silhouette is what the glyph medallion already is, so the picture would
add little; and a bright motif on a dark plate is the combination that
survives the greyscale state. The cost: in a mixed list, a picture badge (grey
plate, coloured drawing) and a glyph badge (coloured plate) look like two
families. That mixed list is exactly what the catalogue is again until the
seventeen pictures of entries 18 to 34 exist (§9) — and after that it is only
custom achievements, which get the prompt kit. §8 asks whether the glyph badge
should invert to the same dark-plate look when it goes square.

## 3. The master prompt

Paste this whole block. Replace the two `{…}` slots from §4.

This block is **canonical**. The user docs carry a copy for hosts making their
own badge — `docs/user/achievements/manage/picture.md`, in American spelling
and without em-dashes per `documentation.md`, with the reference trophy as
`docs/user/assets/achievements/badge-reference.png` — and the two change
together: a prompt tweak that lands here and not there is a set that drifts.

```
Create a square 1024×1024 achievement badge illustration in a flat vector enamel-pin style. Follow every instruction literally.

LAYOUT (exact): The whole canvas is a square plate, edge to edge, with sharp square corners — no rounded corners, no frame, no border, no medallion, no circle, no background around it. The plate is a monochrome dark grey with one soft radial falloff: #3a3e43 at the centre behind the motif, darkening smoothly to #1e2124 in the four corners, no banding, no hue. On the plate, exactly one motif, centred and dominant, filling about 84 % of the canvas width or height, whichever it is bigger in, with the same empty plate margin of about 8 % on all sides. Behind the motif, one large background element (see BACKGROUND). Nothing else on the canvas.

STYLE (exact): Flat vector illustration, like a hard enamel pin. Clean geometric shapes, smooth curves, crisp edges. Cel shading with exactly three tones on the motif: a base tone that covers most of it, one lighter highlight tone on surfaces facing up-left, one darker shadow tone on surfaces facing down-right. Every shape of the motif is separated by a uniform outline of #131517, about 1 % of the canvas width thick. Light comes from the top left. The motif is flat colour fields only; the only gradient in the picture is the plate's radial falloff. The motif has life: it is posed with a slight tilt or already in motion, as the MOTIF line says, and carries at most one action cue that is part of its own shape.

COLOURS (exact, no hue anywhere except the tier tones and the one accent): {TIER LINE}
The three tier tones cover at least four fifths of the motif. ACCENT: {ACCENT LINE} — the only other colour in the picture, on the motif only, at most a fifth of it.
Plate grey #3a3e43 falling off to #1e2124. Outlines #131517. Background element greys #3f4349 and #2a2e33.

MOTIF: {MOTIF LINE} Draw it as one bold silhouette that would still be recognisable as a black-and-white cut-out at 40 pixels.

BACKGROUND: {BACKGROUND LINE} It is drawn only in the two flat background greys #3f4349 and #2a2e33, with no outline, laid over the plate's falloff. Large simple forms only, nothing smaller than a tenth of the canvas, nothing repeated. It stays entirely behind the motif and never touches or crosses the motif's outline. It must be so subtle that it almost disappears when the picture is shrunk to 40 pixels.

FORBIDDEN: no text, letters, numbers, logos or signature; no scenery, no second object; no sparkles, stars, glows, rays, drop shadows or reflections; no speed lines, particles, drops or multiple motion strokes; no gradients on the motif; no textures, noise, grain, paper or brush strokes; no colour on the background element; no 3D rendering or photorealism; no transparency; no faces or hands unless the MOTIF line names one.
```

Tier lines:

```
NEUTRAL: motif base #d6dde3, highlight #ffffff, shadow #8c98a4.
BLUE:    motif base #4b92cd, highlight #9cc9ef, shadow #2b5f8e.
GOLD:    motif base #faa636, highlight #ffd88a, shadow #b8701a.
PINK:    motif base #c85bbd, highlight #e99ae0, shadow #7a2c73.
```

Accent lines (the `{ACCENT LINE}` slot is one of these plus the place named in
the motif entry, e.g. `red #d9534f, on the plaque of the base`):

```
red #d9534f · teal #3fb8a8 · cream #f3ead6 · pink #c85bbd
```

Follow-up line for the production round (after the calibration image is
approved, attach it to every request):

```
Match the attached badge exactly — same layout, motif size and margin, plate greys and falloff, background subtlety, outline weight, shading style and colour tones. Change only the motif, its accent and its background element as stated, and, where stated, the tier colours.
```

## 4. The thirty-four motif entries

Every entry has the same three lines, each pasted into its slot of the master
prompt: **MOTIF** (*a single* object, its pose, its one action cue), **ACCENT**
(one of the four, and where), **BACKGROUND** (the one grey element). "Glyph" is
what the app draws today; ⚠ marks a motif that deviates from it, with the
reason, so each can be vetoed back to the glyph.

Entries 1 to 17 are the badges of 2026-09-03, all of which exist. Entries 18 to
34 are the second batch of built-ins (2026-09-04) and none of their pictures
have been made yet — §9 is the list. What each achievement asks for is
`achievements/builtin.py`'s and is not repeated here: an entry is the artwork,
and a definition copied into a second place is a definition that drifts.

The numbers are these entries' own and they stay put. They were `builtin.py`'s
order when they were written and are not any more — that file moved its hidden
achievements to the end on 2026-09-04 — but §9, every note in this guide and
the prompt runs outside it name a badge by its number, so renumbering would
cost more than the coincidence was worth.

Accents over the set: red ×14, teal ×9, cream ×6, pink ×5 — red is the
workhorse, the others keep neighbouring badges apart.

**1 · First Time on the Mic** — neutral — `builtin-first-song` — glyph `smile` ⚠
*A face drifts between runs; the name is about the mic.*
```
MOTIF: a single handheld stage microphone with a round mesh head and a tapered handle, tilted 15 degrees to the right as if just lifted, with two thick sound arcs leaving the head to the upper right.
ACCENT: teal #3fb8a8, on the ring band where the head meets the handle.
BACKGROUND: three wide concentric sound-wave arcs centred on the microphone head, spreading to the upper right.
```

**2 · Warmed Up** — neutral — `builtin-score-6000` — glyph `thumbs-up` ⚠
*Hands drift. Alternative: keep the thumbs-up, tilted, with the cue as one bold motion arc.*
```
MOTIF: a single mug seen from the side with the handle on the right, tilted 10 degrees as if raised, with two thick curls of steam rising from it.
ACCENT: red #d9534f, on a wide band around the middle of the mug.
BACKGROUND: two large soft wavy heat lines rising behind the mug.
```

**3 · In Tune** — blue — `builtin-score-8000` — glyph `bolt` ⚠
*Literal for "in tune". Alternative: a lightning bolt, tilted, no cue needed.*
```
MOTIF: a single tuning fork tilted 15 degrees to the right, its two prongs parallel, with one thick vibration arc beside the outer edge of each prong.
ACCENT: cream #f3ead6, on the ball at the end of the stem.
BACKGROUND: three wide concentric rings centred on the fork's prongs.
```

**4 · Golden Voice** — gold — `builtin-score-9000` — glyph `trophy`
```
MOTIF: a single trophy cup with two curved handles, a short stem and a flat base, seen from slightly below so it looms, standing upright; no action cue.
ACCENT: red #d9534f, on the plaque on the front of the base.
BACKGROUND: three wide stage-light beams fanning up from behind the base.
```

**5 · Untouchable** — gold — `builtin-score-9500` — glyph `crown`
```
MOTIF: a single five-point crown with a plain band and a round ball on each point, tilted 12 degrees to the right and floating; no action cue.
ACCENT: pink #c85bbd, on the gems set into the band.
BACKGROUND: one large soft halo ring behind the crown.
```

**6 · A Good Evening** — neutral — `builtin-evening-50k` — glyph `beer`
```
MOTIF: a single beer mug seen from the side with the handle on the right, tilted 15 degrees as if raised in a toast, with a thick foam head spilling over the rim on one side.
ACCENT: red #d9534f, on a wide band around the middle of the mug.
BACKGROUND: four large round bubbles rising behind the mug, the biggest low.
```

**7 · Big Night** — blue — `builtin-evening-100k` — glyph `flame`
```
MOTIF: a single flame with three tongues, the middle one tallest, all leaning to the right as if whipped by a draught, on a small flat base.
ACCENT: cream #f3ead6, on the hot core at the bottom of the flame.
BACKGROUND: two large soft wavy heat lines rising behind the flame.
```

**8 · Marathon** — gold — `builtin-evening-250k` — glyph `rocket`
```
MOTIF: a single rocket climbing up and to the right at 45 degrees, with two fins and one round window, driven by a thick exhaust flame.
ACCENT: red #d9534f, on the nose cone.
BACKGROUND: one broad diagonal exhaust trail behind the rocket and one wide horizon curve across the lower part.
```

**9 · Regular** — neutral — `builtin-songs-10` — glyph `music`
```
MOTIF: a single pair of beamed eighth notes, two note heads joined by one thick beam, tilted 15 degrees with the right note higher as if bouncing.
ACCENT: teal #3fb8a8, on the beam.
BACKGROUND: two wide staff lines curving gently across the plate.
```

**10 · Resident** — blue — `builtin-songs-50` — glyph `guitar`
```
MOTIF: a single electric guitar lying diagonally with its body bottom-left and its headstock top-right, with one bold strum swoosh curving across the strings.
ACCENT: red #d9534f, on the pickguard.
BACKGROUND: one wide curved sound-wave band sweeping behind the guitar.
```

**11 · Living Legend** — gold — `builtin-songs-100` — glyph `graduation-cap` ⚠
*The one two-part motif; a wreath alone is an empty ring at 40 px. Alternative: the graduation cap, tilted, tassel swinging.*
```
MOTIF: a single laurel wreath open at the top, enclosing one five-point star that is tipped 15 degrees as if it has just landed there.
ACCENT: red #d9534f, on the star.
BACKGROUND: three wide stage-light beams fanning up from behind the wreath.
```

**12 · Five in a Night** — neutral — `builtin-evening-songs-5` — glyph `hourglass`
```
MOTIF: a single hourglass with flat top and bottom plates, tilted 12 degrees, with a thick stream of sand running from the upper bulb into the lower one.
ACCENT: teal #3fb8a8, on the sand.
BACKGROUND: one large soft ring behind the hourglass, like a clock face without marks.
```

**13 · Iron Lungs** — blue — `builtin-evening-songs-10` — glyph `dumbbell`
```
MOTIF: a single dumbbell with a short bar and two thick round plates stacked at each end, the outer one smaller, tilted 15 degrees as if mid-lift; no action cue.
ACCENT: red #d9534f, on the grip in the middle of the bar.
BACKGROUND: two large chevrons pointing up, stacked, behind the dumbbell.
```

**14 · Hat-trick** — gold — `builtin-evening-hat-trick` — glyph `drum` ⚠
*Literal for "hat-trick". Alternative: a drum, tilted, one bold strike arc.*
```
MOTIF: a single top hat with a tall flat crown and a wide brim, tipped 20 degrees to the right as if raised in a bow; no action cue.
ACCENT: pink #c85bbd, on the hat band.
BACKGROUND: three wide concentric arcs behind the hat, open at the bottom.
```

**15 · Better Together** — neutral — `builtin-first-duet` — glyph `users` ⚠
*Two people means two faces. Alternative: two overlapping hearts, tilted.*
```
MOTIF: a single symbol of two handheld stage microphones crossed in an X with their heads at the top, each head giving off one thick sound arc outward.
ACCENT: teal #3fb8a8, on the ring band of both microphones.
BACKGROUND: two large overlapping rings behind the crossing point.
```

**16 · Well Traveled** — blue — `builtin-artists-10` — glyph `plane`
*Hidden until it is earned since 2026-09-04, so this is a plane most people
meet only once it is theirs.*
```
MOTIF: a single small passenger airplane seen from the side, climbing up and to the right at 20 degrees, with one wing and a tail fin; no contrail, the climb is the action.
ACCENT: red #d9534f, on the tail fin.
BACKGROUND: one wide globe arc across the lower part of the plate.
```

**17 · Brave Soul** — neutral — `builtin-brave-soul` — glyph `ghost`
*Hidden until it is earned, as it has been since it shipped. The one face;
kept because a ghost is two ovals.*
```
MOTIF: a single friendly cartoon ghost with two oval eyes and no mouth, tilted 15 degrees with both stubby arms up and its wavy hem trailing to the left as if fleeing.
ACCENT: pink #c85bbd, on two round cheeks.
BACKGROUND: one large soft wavy trail behind the ghost, following its hem.
```

**18 · First Place** — neutral — `builtin-wins-1` — glyph `star`
```
MOTIF: a single first-place rosette, a round pleated ribbon medal with two ribbon tails hanging down and to the right, tilted 12 degrees, the tails curling as if just pinned on.
ACCENT: teal #3fb8a8, on the round button at the centre of the rosette.
BACKGROUND: three wide concentric rings centred on the rosette.
```

**19 · On a Roll** — blue — `builtin-wins-10` — glyph `flag`
```
MOTIF: a single winners' podium of three blocks seen from the front, the tallest in the middle, tilted 10 degrees to the right, with one bold flag on a short pole planted on the tallest block.
ACCENT: red #d9534f, on the flag.
BACKGROUND: three wide stage-light beams fanning up from behind the podium.
```

**20 · Undisputed** — gold — `builtin-wins-50` — glyph `shield`
```
MOTIF: a single championship belt seen from the front, a wide strap with one large oval centre plate, curved as if hanging over a shoulder and tilted 15 degrees; no action cue.
ACCENT: pink #c85bbd, on the oval centre plate.
BACKGROUND: two large chevrons pointing up, stacked, behind the belt.
```

**21 · Back to the 70s** — blue — `builtin-decade-1970s` — glyph `disc`
*One of four decade badges, all blue: they cost the same, so they read as a
family rather than as a ladder. Keep the four objects from four different
decades of hardware, or the set turns into one shape four times.*
```
MOTIF: a single mirror ball hanging from a short straight cord, tilted 10 degrees, its surface a grid of large flat facets, with two thick light arcs leaving it to the upper right.
ACCENT: red #d9534f, on the cap where the cord meets the ball.
BACKGROUND: three wide concentric rings centred on the ball.
```

**22 · Back to the 80s** — blue — `builtin-decade-1980s` — glyph `tv`
```
MOTIF: a single boombox seen from the front, two large round speakers and one wide cassette door, tilted 15 degrees as if carried on a shoulder, with one thick sound arc leaving the right speaker.
ACCENT: cream #f3ead6, on the cassette window.
BACKGROUND: one wide curved sound-wave band sweeping behind the boombox.
```

**23 · Back to the 90s** — blue — `builtin-decade-1990s` — glyph `bell` ⚠
*The glyph is a stand-in: nothing in the icon set is a disc player, and a bell
says nothing about the decade. Alternative: keep the bell, tilted, with one
motion arc.*
```
MOTIF: a single portable CD player seen from above at a three-quarter angle, a round flat case with a raised lid and a disc visible through it, tilted 15 degrees, with one thick spin arc across the disc.
ACCENT: red #d9534f, on the round play button on the front edge.
BACKGROUND: three wide concentric rings centred on the disc.
```

**24 · Back to the 2000s** — blue — `builtin-decade-2000s` — glyph `headphones`
```
MOTIF: a single flip phone open in an L shape, a tall screen half and a keypad half, tilted 15 degrees, with two thick signal arcs leaving the top corner to the upper right.
ACCENT: cream #f3ead6, on the screen.
BACKGROUND: three wide concentric arcs behind the phone, open at the bottom.
```

**25 · Time Traveler** — pink — `builtin-time-traveler` — glyph `clock`
*Hidden until it is earned, so this picture is one most people meet only once
it is theirs — and the four decade badges beside it are the hint. Pink arrives
with this batch; its accents stay teal or cream, red being too close to it.*
```
MOTIF: a single flux capacitor, a squared upright case with a round window through which three short thick tubes meet at the centre in a Y, tilted 12 degrees, with one thick energy arc across the meeting point.
ACCENT: teal #3fb8a8, on the energy arc at the centre.
BACKGROUND: three wide concentric rings centred on the case.
```

**26 · Mixtape** — pink — `builtin-mixtape` — glyph `layers`
*Hidden until it is earned. The cassette is the sibling of 22's boombox on
purpose, one being what the other plays.*
```
MOTIF: a single compact cassette seen from the front, two large round hubs and a wide flat label band across the top, tilted 15 degrees, with one thick tape loop spooling out of the lower edge.
ACCENT: cream #f3ead6, on the label band.
BACKGROUND: two wide staff lines curving gently across the plate.
```

**27 · Rickrolled** — gold — `builtin-full-commitment` — glyph `gift` ⚠
*Hidden until it is earned, and the one deliberate break with "avoid faces and
hands": §2's rule says "unless the MOTIF line names one", and here the figure
**is** the joke. It must not name the real singer — a model refuses a likeness
— so the line asks for no facial features and no hands, and the figure is drawn
as a solid **tier-tone** cut-out and never a black silhouette, or it vanishes
on the dark plate and fails the greyscale check. Fallback if it drifts: coat
and quiff in profile, no head detail.*
```
MOTIF: a single figure of a 1980s pop singer shown as a solid flat cut-out with no facial features and no visible hands, a long open trench coat and a tall swept-back quiff, leaning 15 degrees into a stand microphone, the coat tail swinging behind.
ACCENT: teal #3fb8a8, on the head of the stand microphone.
BACKGROUND: three wide concentric sound-wave arcs centred on the microphone head.
```

**28 · Rap God** — gold — `builtin-rap-god` — glyph `mic`
*A third microphone in the set (1 and 15 are the others), and the only one on a
stand: keep the heavy round base, which is what tells it from those two at
40 px.*
```
MOTIF: a single stand microphone with a round mesh head and a heavy round base, tilted 20 degrees as if leaned into, with two thick sound arcs leaving the head to the upper right.
ACCENT: red #d9534f, on the band around the microphone head.
BACKGROUND: one wide curved sound-wave band sweeping behind the stand.
```

**29 · Killer Queen** — gold — `builtin-queen-10` — glyph `crown`
```
MOTIF: a single vintage microphone head on a short stem with a wide flat foot, seen from the front and tilted 15 degrees, with one thick sound arc leaving the head to the right.
ACCENT: pink #c85bbd, on the stem's collar band.
BACKGROUND: three wide stage-light beams fanning up from behind the microphone.
```

**30 · Super Trouper** — blue — `builtin-abba-5` — glyph `sun`
```
MOTIF: a single follow-spot lamp on a short yoke mount, a wide cylindrical body pointing up and to the right at 30 degrees, with one thick beam leaving the lens.
ACCENT: cream #f3ead6, on the lens at the front of the beam.
BACKGROUND: three wide beams fanning up and to the right behind the lamp.
```

**31 · The Fab Four** — neutral — `builtin-beatles-4` — glyph `anchor` ⚠
*The submarine is the nod; the anchor is only the nearest thing the icon set
has. Alternative: an anchor, tilted, with one wave curve behind it.*
```
MOTIF: a single submarine seen from the side, a rounded hull with one round porthole and a short conning tower with a periscope, tilted 15 degrees nose-up, with one thick bubble trail leaving the tail.
ACCENT: red #d9534f, on the conning tower.
BACKGROUND: one wide wave curve across the lower part of the plate.
```

**32 · Christmas Number One** — gold — `builtin-christmas` — glyph `snowflake`
```
MOTIF: a single large bauble hanging from a short curved hook, a round body with a wide flat cap, tilted 12 degrees as if just knocked, with one thick swing arc beside it.
ACCENT: teal #3fb8a8, on a wide band around the middle of the bauble.
BACKGROUND: one large soft halo ring behind the bauble.
```

**33 · Roll the Credits** — blue — `builtin-soundtrack` — glyph `film`
```
MOTIF: a single film clapperboard seen from the front, a wide flat slate with the hinged bar open at the top, tilted 15 degrees, with one thick motion arc above the bar as if it is closing.
ACCENT: red #d9534f, on the hinge block at the end of the bar.
BACKGROUND: two large chevrons pointing up, stacked, behind the clapperboard.
```

**34 · Groundhog Day** — pink — `builtin-groundhog-day` — glyph `refresh`
*Hidden until it is earned since 2026-09-04. The repeat arrow is the whole
idea, so it is the one action cue and it has to survive 40 px: thick, and clear
of the label.*
```
MOTIF: a single vinyl record seen face on with a wide flat centre label, tilted 12 degrees, with one thick curved repeat arrow sweeping around its upper edge.
ACCENT: teal #3fb8a8, on the centre label.
BACKGROUND: three wide concentric rings centred on the record.
```

Optional extra: one **blank plate** (MOTIF, ACCENT and BACKGROUND lines: *none
— leave the plate empty*), generated once. It is the reference for the plate's
grey and falloff during QA, and the fallback picture if a badge ever needs one.

## 5. Workflow

1. **Approve this document** (the decisions in §7).
2. **Calibration round** — one ChatGPT conversation, kept for the whole job.
   Generate *Golden Voice* (gold, trophy) from the master prompt. Iterate on
   that one image until it passes the QA list in §6. Typical corrections:
   "remove the sparkles, everything else identical", "make the motif smaller so
   the margin is even, everything else identical". Then generate one blue (*In Tune*) and one
   neutral (*First Time on the Mic*) the same way to confirm the tier lines.
   If the wording of the master prompt changes here, update §3.
3. **Production round** — for each remaining badge: attach the approved trophy
   image, paste the master prompt with the tier and motif line, add the
   follow-up line from §3. The reference image is what actually holds the
   style; the text alone will not.
4. **QA** every result against §6. Regenerate, never retouch — a retouched
   badge is the one that later looks different.
5. **File it** — check the plate runs to all four edges (if the model drew a
   border or a margin of another colour, the image is a reject, not a crop
   job) and that the corners sit near `#1e2124`. Download ChatGPT's file
   (*not* a copy pasted through another program, which re-encodes it) and
   save it unchanged as
   `backend/src/ultrastar_wingman/achievements/images/<id>.png`. The original
   is the master, and the app resizes nothing: the venv has no image library
   and the app gets none for this (`code-style.md`). The 256 px variant the
   rows and the TV are served (`?size=small`) is made once, by hand, with what
   Windows has built in — from the repo root, for one id or for all of them:

   ```powershell
   Add-Type -AssemblyName System.Drawing
   $dir = "$PWD\backend\src\ultrastar_wingman\achievements\images"
   Get-ChildItem "$dir\*.png" | ForEach-Object {
     $src = [System.Drawing.Image]::FromFile($_.FullName)
     $bmp = New-Object System.Drawing.Bitmap 256, 256
     $g = [System.Drawing.Graphics]::FromImage($bmp)
     $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
     $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
     $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
     $g.DrawImage($src, 0, 0, 256, 256)
     $bmp.Save("$dir\small\$($_.Name)", [System.Drawing.Imaging.ImageFormat]::Png)
     $g.Dispose(); $bmp.Dispose(); $src.Dispose()
   }
   ```

   Both files are named by the id and nothing else may be in either directory:
   `test_every_built_in_ships_a_picture_in_both_sizes` pins the two listings to
   `BUILT_INS` minus its `PICTURES_PENDING` set, so a stray or misnamed file is
   a failing test rather than a bigger installer — and so is a picture that
   lands while its id is still named in that set. **Take the id out of
   `PICTURES_PENDING` in the same commit as its two PNGs**, and out of §9's
   pending list with it.
6. **Load** — on a scratch instance: export the catalogue from
   `/user/achievements`, put each file into its folder as `icon.png`, import
   the archive. Check the list at 40 px, the user page, and the host screen
   (both states: earned and drained). Then the same import on the live data.

## 6. QA checklist per image

- [ ] Downscaled to 40 px and 64 px: the object is recognisable at a glance.
- [ ] Converted to greyscale at 45 % opacity on `#021720`: still recognisable.
- [ ] The plate runs to all four edges, square corners, no drawn frame, border
      or circle. Colour picker: about `#3a3e43` beside the motif, about
      `#1e2124` in the corners, no hue (R, G and B within a few steps of each
      other), no banding, no pattern — compared with the blank plate.
- [ ] The motif keeps the ~8 % margin on every side — nothing touches an edge
      or sits in a corner the UI will round off.
- [ ] Motif size matches the reference: about 84 % of the width or height.
- [ ] Only the tier's three tones plus the named accent on the motif; the
      accent is where the entry puts it and covers at most a fifth.
- [ ] The background element is the one the entry names, in the two greys only,
      behind the motif and not touching it — and at 40 px it has all but
      disappeared.
- [ ] The pose and the single action cue are as the entry says; no speed lines,
      particles or extra strokes crept in.
- [ ] No text, sparkles, glow, shadow, gradient, texture or second object.
- [ ] Outline weight and shading placement match the reference side by side.

## 7. Decisions

**Taken (2026-09-03):**

- **Squares, not circles.** The UI follows (§8).
- **No drawn frame or medallion.** The motif fills the square, dominant and
  well placed, over the plate.
- **A monochrome grey plate** with the soft radial falloff of §2, and behind
  each motif **one tonal background element that fits it** — two greys, large
  forms, all but gone at 40 px.
- **One accent colour per badge**, from the fixed palette of four, on at most
  a fifth of the motif. The tier colour still covers the rest.
- **Action through pose and one silhouette cue** — a tilt or a motion, plus
  exhaust, steam, a stream, a swoosh. No speed lines, particles or sparkles.
- **The prompt kit stays out of the user docs** for now. It is a dev document.
- **The pictures live in the backend:**
  `backend/src/ultrastar_wingman/achievements/images/<id>.png`, inside the
  existing achievements package, so hatchling ships them in the wheel without
  configuration (the wheel takes every file under `src/ultrastar_wingman`);
  the installer will need one more `datas` line in
  `installer/UltrastarWingman.spec`, which lists its data directories by hand
  (§8, item 6). There is no separate masters folder: the packaged file is
  ChatGPT's original and therefore the master.

**Still open:**

1. **The motif deviations** in §4 — take each or fall back to the glyph; each
   entry names its glyph alternative. Six in the first batch (1, 2, 3, 11, 14,
   15), all taken and drawn, and three in the second (23, 27, 31), where the
   glyph is only the nearest thing the icon set has. 27 is the one that also
   deviates from a *rule* — the ban on faces — and its entry says why and how.
2. **The accent assignments and background elements** in §4 — proposed per
   badge, easiest to judge on the calibration images. Settled for 1 to 17 by
   the badges themselves; open again for 18 to 34.
3. **Shipped defaults — when.** Putting the files into the backend package
   means they *are* shipped, but nothing reads them yet: today a picture is
   per-instance data, loaded through the editor or an import, and a `Reset`
   drops it. The feature that makes the packaged files the built-ins' default
   pictures is §8, item 6. Until it exists, the packaged files are the source
   the import archive is built from, and nothing more.

## 8. UI changes this needed — done 2026-09-04 (`feat/square-badges`)

Kept as the record of what the pictures asked of the app and how each point
was settled. Every item below is built; the *how* is in
[achievements.md](achievements.md) ("Icons") and `achievements/pictures.py`.
Item 2 was settled by looking at `Tags.css`: a tag's square is `--input-bg`
under a coloured glyph, so a glyph badge keeps its **coloured plate** — that
is what tells the two apart once round is gone — and item 3 needed nothing
more. Item 6 became `pictures.py` (the fallback, `image_shipped`, the `size`
parameter with committed 256 px variants, export carrying uploads only) plus
the installer's `datas` line, and the user docs gained
`achievements/manage/picture.md`, the prompt kit for a host's own badge.

1. **`AchievementBadge.css`: round → rounded square.** `border-radius: 50%`
   becomes a percentage rounded square (about 20 %, which is the 8 px of
   `--border-radius-small` at the 40 px row size and still scales to the TV,
   which a fixed 8 px would not). Its comment, which argues *for* round,
   gets rewritten. The pictures are full-bleed squares, so `object-fit: cover`
   and the greyscale drain need no change.
2. **The glyph medallion goes square too** — same element, so it does by
   itself; the question is whether it stays a tier-coloured plate with a
   cut-out glyph, or inverts to a dark plate with a tier-coloured glyph to sit
   beside the pictures as one family (§7, item 1). The `lock` of a masked badge
   and the off state (`--input-bg` under `--color-darkerer`) follow whatever
   is chosen.
3. **Telling a badge from a tag.** Round was the one thing that told a badge
   from a tag's colour square and an avatar in a row. Look at the rows that
   mix them — a song's details, the user page — and decide whether the badge
   needs anything else (the pictures themselves may be enough; a glyph badge
   next to a glyph tag may not be).
4. **The host screen** (`HostAchievements.css`) sizes the badge through
   `--badge` and animates it thrown in and landing. Check the landing looks
   right for a square, and that the `prefers-reduced-motion` branch still
   holds.
5. **Documentation.** `docs/dev/achievements.md` ("The badge is a
   medallion…"), `docs/dev/ui-guidelines.md` where it says round is the
   badge's shape, the user docs' achievements page, and the screenshots that
   show a badge — re-captured through `docs/screenshots` after the change.
6. **Shipped default pictures** (§7, open item 3). The packaged files under
   `achievements/images/` become what a built-in shows unless the host
   uploaded something else: `builtin.py` names the file per built-in, the
   icon endpoint falls back to the packaged file when the row has no upload
   (so `has_image` is true for a built-in from the start), `Reset` returns to
   the packaged picture instead of to none, and the export writes the packaged
   file into the archive so an import elsewhere carries it. The frozen build
   needs the directory in the installer's `datas`. The packaged files are the
   full-size originals (1–1.3 MB each), and the user page draws every one of
   them in 40 px rows — so this feature also decides how a row gets a small one:
   a size parameter on the icon endpoint with a downscaled variant made once
   and cached in the data directory, or the browser scaling the original and
   paying the bytes on first load. A large badge view (tapping a badge) is
   what the full size is kept for. After this, the glyph
   medallion is the look of custom achievements only.

## 9. Status

The calibration badge, *Golden Voice*, came out of the master prompt as
written on the first attempt (2026-09-03) and is the reference image for every
other badge. The one instruction it ignored is "seen from slightly below" —
the cup is straight on — and that was accepted rather than chased: straight on
reads better at 40 px, and every later badge copies this one.

| # | Badge | File in `achievements/images/` | State |
|---|---|---|---|
| 4 | Golden Voice | `builtin-score-9000.png` | done — the reference |
| 3 | In Tune | `builtin-score-8000.png` | done — first try against the reference; the blue tier is locked |
| 1 | First Time on the Mic | `builtin-first-song.png` | done — the neutral tier is locked. Two liberties accepted: the mesh head is a fine grid (it reads as a textured ball at 40 px), and the tilt is nearer 35° than 15°; the motif's own sound arcs did not appear, the background arcs stand in for them |
| 2 | Warmed Up | `builtin-score-6000.png` | done. As on the mic, the steam came out as the grey background element rather than as silver curls of the motif — the model merges the cue into the background when both are the same shape, and that reads fine |
| 5 | Untouchable | `builtin-score-9500.png` | done — as specified, five pink gems, halo ring |
| 6 | A Good Evening | `builtin-evening-50k.png` | done — as specified; tankard, foam spilling, four bubbles |
| 7 | Big Night | `builtin-evening-100k.png` | done — blue flame, cream core, heat lines; the "small flat base" was dropped by the model and is better gone |
| 8 | Marathon | `builtin-evening-250k.png` | done — red nose, gold exhaust, trail and horizon; the trail runs beside the rocket rather than behind it, which is the stronger diagonal anyway |
| 9 | Regular | `builtin-songs-10.png` | done — as specified; teal beam, two staff bands |
| 10 | Resident | `builtin-songs-50.png` | done — red pickguard, sound-wave band; the strum swoosh did not appear and the strings are thin (harmless: they vanish at 40 px); the hardware came out in the highlight white, which is still a tier tone |
| 11 | Living Legend | `builtin-songs-100.png` | done, second attempt. The first copied the reference too literally and stood the wreath on the trophy's pedestal with its red plaque — a second object and a second red, and a twin of Golden Voice in the list. One correction ("remove the base and the plaque, the wreath stands on its own, the star is the only red, everything else identical") fixed it. Lesson for the guide: when the reference badge and the new motif share a part, say so and forbid it |
| 12 | Five in a Night | `builtin-evening-songs-5.png` | done — as specified; teal sand and stream, flat glass, ring behind |
| 13 | Iron Lungs | `builtin-evening-songs-10.png` | done — red grip, chevrons behind. The model stacked two plates per end instead of one weight; kept on purpose (it reads as a dumbbell more, and two big plates are not a striped blur at 40 px), and entry 13 now says so |
| 14 | Hat-trick | `builtin-evening-hat-trick.png` | done — as specified; gold hat tipped, pink band, three arcs |
| 15 | Better Together | `builtin-first-duet.png` | done — two matching mics crossed at the middle, teal bands, grid heads like badge 1 (siblings on purpose), one grey arc per head over the two rings |
| 16 | Well Traveled | `builtin-artists-10.png` | done — red tail fin, globe arc. The contrail was dropped by hand (it looked wrong; entry 16 now says no contrail). Two liberties kept: a row of small dark windows (they collapse to a dashed line at 40 px, harmlessly) and continents on the globe arc, grey and low-contrast |
| 17 | Brave Soul | `builtin-brave-soul.png` | done — as specified; fleeing tilt, arms up, two pink cheeks, grey trail behind the hem |
| 18 | First Place | `builtin-wins-1.png` | **pending** |
| 19 | On a Roll | `builtin-wins-10.png` | **pending** |
| 20 | Undisputed | `builtin-wins-50.png` | **pending** |
| 21 | Back to the 70s | `builtin-decade-1970s.png` | **pending** |
| 22 | Back to the 80s | `builtin-decade-1980s.png` | **pending** |
| 23 | Back to the 90s | `builtin-decade-1990s.png` | **pending** |
| 24 | Back to the 2000s | `builtin-decade-2000s.png` | **pending** |
| 25 | Time Traveler | `builtin-time-traveler.png` | **pending** |
| 26 | Mixtape | `builtin-mixtape.png` | **pending** |
| 27 | Rickrolled | `builtin-full-commitment.png` | **pending** — the face rule; read entry 27 before generating |
| 28 | Rap God | `builtin-rap-god.png` | **pending** |
| 29 | Killer Queen | `builtin-queen-10.png` | **pending** |
| 30 | Super Trouper | `builtin-abba-5.png` | **pending** |
| 31 | The Fab Four | `builtin-beatles-4.png` | **pending** |
| 32 | Christmas Number One | `builtin-christmas.png` | **pending** |
| 33 | Roll the Credits | `builtin-soundtrack.png` | **pending** |
| 34 | Groundhog Day | `builtin-groundhog-day.png` | **pending** |
| — | blank plate | | not made; nothing has needed it |

The first seventeen are complete (2026-09-03): seventeen files, about 25 MB,
one ChatGPT session, two corrections in total (the wreath's pedestal, the
airplane's contrail). Every deviation kept is in the table above and, where it
changes what a rerun should produce, in the entry itself (13, 16).

The seventeen of 2026-09-04 (18 to 34) ship **no file at all** for now, and a
built-in with no picture is drawn with its glyph on a coloured plate — the
`pictures.shipped_picture` fallback asks the disk, not `builtin.py`, so nothing
breaks and nothing has to be stubbed. Two consequences while that lasts: the
catalogue is the mixed list §2 describes, and the pending ids are named in
`PICTURES_PENDING` in `backend/tests/test_achievements_api.py` — take an id out
of that set, and off this table's pending list, in the same commit as its two
PNGs. Make them from §5, starting from the *Golden Voice* reference so the
second seventeen match the first.
