# Share cards

*Design, 2026-10-22; settled and built 2026-10-23 on branch
`feat/host-controls-loudness-share-cards`. The user's decisions are in §1. Part 1 built what a
card says, how its text fits, the layouts and the canvas renderer (`frontend/src/shareCard/`,
§6); part 2 the first panel, its two entry points on `/scores`, the buttons and the user
documentation. The panel as §5 draws it (decision 11) was built 2026-10-24 on
`feat/design-feedback-round-3`, and so were the sing view (§8, with its read
`GET /stats/sings/{id}`) and the player card (§9). The achievement card (§10) is designed
and **not built yet**: until it is, this document leads and the
code is what changes. §7 records how what was open was settled. Once built, when this
document and the code disagree, the code is right and this document is updated, unless the
code falls short of §1.*

A singer gets **a picture of their scores** to send to friends: one score (the song's cover,
the number, the rating word, the place) or a whole party (the podium, a few numbers, a
chart). The picture is drawn in the browser, previewed in a panel with a few options, and
saved or shared from the phone.

The mockup the user approved is the canvas **Wingman share cards**,
<https://claude.ai/artifact/NmYYswb6HziUxM32ZdDojL> (private to the user). It has ten boards
in three rows: one score, one party, the share panel. The covers in it are CSS placeholders
and the avatars are initials. §4 gives its layouts in numbers, as built.

## 1. Decisions

Made by the user, 2026-10-22 on the mockup (1 to 7), then on the first build (8 to 10) and
on the second (11 to 14):

1. **The mockup stands as drawn.**
   - Two card kinds:
     - **one score**: *Dark* and *Cover* looks;
     - **one party**: *Dark* and *Mosaic* looks, with the ranking or the score strip under
       the podium.
   - Each in **square** (1080×1080) and **story** (1080×1920).
   - The panel offers format, look and the toggles below, with a live preview.
2. **No worst score on a card.** The party's numbers are Sings · Songs · Best · Average.
   This departs on purpose from `ScoreSummary`'s fixed five on every surface: a card leaves
   the room, and the lowest score with a name next to it is not something to send around.
3. **Other singers' pictures are a toggle.** When it is off, they are drawn as their
   initials. The sharer's own picture is always theirs.
4. **The party's name and date are a toggle**, on both card kinds.
5. **"Only me and my place"** is offered on the party card. Decided as a toggle; the redone
   panel draws it as the *You* slide (§5, §7.11).
6. **A chart can be the focus of a party card**, in addition to everything above. The user
   named the box plot (the spread rows) and left room for others. See §3.3 and §7.1.
7. **Sharing works over plain http.** The user shared a picture from the http site on their
   phone on 2026-10-22, so the feature does not need https.
   - The test page's own log recorded nothing, so *which* path worked was not captured. It
     was either the long-press menu on the picture or the download.
   - §7.8 is about confirming that per platform.
8. **The Wingman logo is drawn as it is**, in its own colours, and is a toggle, on by default (§4.1).
9. **The panel is redone**: the formats as two icons, the designs swiped through with dots (§5).
10. **A party card's head is never the singer count**, and Mosaic text sits on no opaque band (§3.1, §4.2).
11. **The panel is a bare modal with no heading**, the long-press hint above the picture, the
    formats beside the dots without a button border, and options that guide the eye instead
    of a list to read through — a logo button greyed or struck out when pressed being the
    user's own example (§5; how the options became one fixed row of icon toggles is §7.11).
12. **A score is shared from its sing**: a score row opens the sing view, and its Share
    button is the way in. A score group carries no *Share a score* (§8).
13. **A player's stats are a card**, for one party and for a whole record (§9).
14. **An earned achievement is a card**, with almost nothing to choose (§10).

Agreed by the three reviews (product, visual, technical) and not objected to. These can still
be vetoed:

- **The browser draws the card.** It uses a `<canvas>` and adds no new dependency. Covers
  and avatars come from Wingman's own origin, so the canvas stays exportable. Rendering on
  the server would need Pillow plus cairo (a native library that is hard to bundle with
  PyInstaller) and would buy nothing: a link to the LAN app is useless to friends who were
  not there.
- **No new permission.** Whoever may open a party's scores (`stats/api.py`
  `visible_session_ids`) may share a card of it; a screenshot of `/scores` gets around any
  share-only gate anyway.
  - A card never shows more than `/scores` shows to the same reader, and no less either:
    it is drawn from exactly the scores the surface it opens from showed — the page's for a
    party or a player, the sing view's read for a score (§7.6, §8).
  - `list_session_scores` does not apply `HiddenSongsDep`, so a song a tag hides can stand
    on a card as it stands on `/scores` — the accepted leak, not a new one.
- **The brand line is bottom left**, small: the logo and *Ultrastar Wingman*, no URL, no slogan (decision 8).
- **Only the score strip** of the existing charts goes *under* the podium. The others don't
  read at chat-thumbnail size in that space. As the card's focus (decision 6) the spread gets
  the whole card (§3.3).

## 2. What a card says

Everything below is already computed somewhere. `shareCard/content.ts` turns the app's own
types into a plain `CardContent`, and applies the toggles there.

### 2.1 One score

| What | Where it comes from |
|---|---|
| title, artist, cover | the song (`/songs/{id}/cover`); a song that left the library reads *Unknown song* with no artist and a `?` tile, as `songLabel` does |
| the score | the score row; bare integer, as everywhere else ("8662") |
| rating word | `stats.ts` `evaluationLabel` (*Superstar*, *Lead Singer*, …), the most shareable line the app has |
| the place | `placement` / `field_size` ("1st of 3"). It is NULL for scores from before migration 0026: draw nothing then, never "? of ?". Dropped when `field_size == 1`, because a solo sing is not a win |
| the others of the sing | the other scores of the sing view's read (§8), so a duet partner grouped elsewhere is never missed: "with Bob", "with Bob and Carol", "with Bob, Carol and 2 more", after the place on one line ("1st of 2 · with Bob") |
| singer | name and avatar |
| party · date | the party's name and the score's date with its year ("17 Oct 2026", in the reader's locale); a nameless party is its date alone, because `sessionLabel`'s fallback already says the date. Behind the toggle of decision 4 |
| *New Highscore* / *Personal best* | flags the caller passes in, only when the data on hand proves them (§7.4) |

### 2.2 One party

| What | Where it comes from |
|---|---|
| head | the party's name over "17 Oct 2026 · 5 singers", or unnamed its date over "5 singers"; with decision 4's toggle off, no head and no singer count at all: the numbers lead (§4.2, §7.9), while the file name and the `alt` still name the party by its name or date |
| Sings · Songs · Best · Average | `stats.ts` `scoreSummary` minus Worst (decision 2); a duet run is one sing. Best is gold with the holder ("Best · Chiara"). A count of one takes the singular label, "1 Song" (`stats.ts` `countWord`) |
| podium, ranking | `sessionLeaderboard(…, "best")`'s order, named on the card ("ranked by best score"); places are competition ranking, so two equal bests are both 1st |
| score strip | `ScoreStrip`'s content: every score as a grey dot, the best in gold, the median dashed, and "Median N" written above it — not the best, which the numbers above already print with its holder, the way `ScoreStrip` leaves it out under a score summary |
| spread rows | `groupScores(…, "player")` and `boxStats` per singer, in the ranking's order (§3.3) |
| covers for *Mosaic* | the distinct covers of the party's songs in the order they were sung, at most eighteen |
| *Only me and my place* | the *You* slide (§5): the sharer alone, their own Sings · Songs · Best · Average (Best without a holder), their picture large, "2nd of 5" and their best; drawable only for somebody who sang at the party. A party of one has no place, as a solo sing has none: never "1st of 1" |

## 3. The cards

The tokens are the app's: `--bg #021720`, `--input-bg #1c2832`, text white / `#ccc` /
`#888`, blue `#4b92cd`, pink `#9e3b95` for the podium numerals and the place, the score bar's
fill `--highlight-pink-dark #6d2d90` as `LastSong` draws it, gold `#faa636`. Gold means the
best score and nothing else, as on every other surface. The chart marks take `chartTheme`'s
dot grey, median, box fill and accent. The font is the system stack (`index.css` loads no
webfont), so a card looks slightly different on each device. That is accepted.

### 3.1 Looks

- **Dark** is the app's own surface, flat `--bg`.
- **Cover** (one score only): the cover blurred over the whole card under `--bg` at 70%, the
  content centred. A song without a cover — or whose cover did not load — falls back to Dark,
  and the panel says why.
- **Mosaic** (party only): a 3×3 grid of the party's covers (3×6 on a story, centred) under one
  uniform `--bg` scrim at **84%**, no band and no gradient, so the covers stay visible behind the
  text as behind the podium. A scrim alone let a cover's lettering through the grey labels, so on
  a Mosaic every text element and the logo get a **halo**: painted first with `shadowColor`
  `--bg` at 90%, `shadowBlur` 20 and no offset, twice, then plainly on top (`shadowBlur` holds on
  WebKit, `ctx.filter` does not), and the `#888` words take `#ccc`. Under four distinct loaded covers it is Dark.
  The podium stands alone on it: no rows, no strip, no spread.
- Minimal was proposed and dropped: it was Dark with things taken away.

### 3.2 Formats

- **Square** 1080×1080.
- **Story** 1080×1920. The top and bottom 270 px carry background only, because the story
  apps draw their own controls there.
- No 4:5 portrait (§7.5).

### 3.3 The chart as the focus (decision 6)

A party card's **Focus** is *Podium* (the default) or *Spread*, the panel's fourth slide (§5).

- **Spread** is `SpreadRows` drawn for the card: one row per singer in the ranking's order —
  the name and the quiet count ("Chiara ×5") at the left, the track on the shared 0–10k scale,
  their best at the right, gold for the party's best — a Tukey box under the raw dots from
  five scores on, plain dots below that, the gridlines once behind the rows and the axis once
  under them. It takes the podium's place under the same head and numbers; the ranking shrinks
  to one line, "1 Chiara 9124 · 2 Alice 8662 · 3 Ben 7934", and nothing stands under it.
- It needs two singers and four scores, and the Dark look: a box plot over a mosaic does not
  read. The *You* slide shows one singer, so it has no spread.
- **Not on a party card:** the evening timeline (its hues need a legend, which takes room a
  card does not have) and a chart focus for one score (that score on the song's all-time
  strip needs `stats.history`). The histogram is not a party's chart either: twenty bars do
  not read in the space under a podium. Given the whole card, they do, and it is the player
  card's focus (§9).

## 4. Layouts

At 1080 wide, side margins of 72, content width 936. `shareCard/layout.ts` is the source; the
numbers below are what it draws.

### 4.1 One score, square (Dark)

| y | Region |
|---|---|
| 72–288 | cover 216×216, square corners (covers are artwork). Beside it, centred on it: the title at 52 bold, line-height 1.3, at most two lines; the artist at 36 in `#ccc`, one line |
| 336–556 | the score, 220 bold, white. Gold only for *New Highscore* |
| 576 | the rating word, 44 bold, blue |
| 660 | a 24 px bar on `--input-bg` with the pink fill over 0–10000, radius 8 (the bar of `LastSong`) |
| 730–850 | the avatar 120 (radius 20%); the name 48 bold; the place and the others of the sing 36 in `#ccc`. Right: the trophy and *New Highscore* at 40 bold in gold, or `arrow-up` and *Personal best* at 40 bold in blue |
| 960–1008 | the logo 48, drawn as it is (a plain `drawImage`, never the grey `source-in` mark), and *Ultrastar Wingman* 28 in `#888`; party · date at 32 in `#888` at the right of the same line. With *Wingman logo* off the logo and the words go, the note stays, and nothing moves |

**Cover** centres everything: the cover up to 300 with a shadow, the title (52 → 44), the
artist, the score at 200, the rating word with the flag beside it on the same line, then the
singer row. It has no bar. The cover is the one thing that gives: with a two-line title it
shrinks (down to 180) so nothing else does.

**Story** (both looks) keeps the Cover order inside y 270–1650: the party · date eyebrow 32,
the cover up to 440 (down to 280), the title 64 → 52, the artist 40, the score 240, the
rating 44, the bar, the singer row, and the brand on the safe area's last line.

**How a card adapts:**
- *No cover:* the artist's initial on `--input-bg`, as `CoverImage` draws it.
- *Long title:* 52 → 44, then an ellipsis on the second line. Never three lines.
- *Long singer name:* one line, 48 → 36, then an ellipsis.
- *Solo sing:* no place.
- *Duet:* "with Bob" after the place.

### 4.2 One party, square (Dark)

| y | Region |
|---|---|
| 72–190 | the head 56 bold (→ 44, then an ellipsis), one line, over its sub line 32 in `#888` (§2.2). With *Party name and date* off the region goes and the rest closes up: the numbers, the podium 150 under their top and what is under it 24 below the podium stand as one block, centred between the margin and the brand's line (y 72–936), so no air is left above ranks 4–6. Spread's numbers start at 72, its ranking line and rows moving up with them |
| 222–331 | four numbers in columns 190 · 190 · 316 · 240 wide: the value 56 bold, the label 32 in `#888`; Best gold with its holder |
| 372–694 | the podium: 1st in the middle and raised, avatar 180; 2nd and 3rd avatar 140, 60 lower; the pink rank numeral 40 bold before the name 40 (→ 32); the score 44 bold (gold for the best). Two singers stand about the middle, 2nd at the left. Centred in the space when nothing is under it |
| 722–936 | **either** ranks 4–6 as 56 px rows (the pink numeral, a 48 avatar, the name 40 → 32, the score 40 at the right) plus "+N more" 32, **or** the score strip ("Median N" at 32, a 100 px band of dots r 10 ringed in `--bg`, the best gold with a gold ring r 19, the median dashed 3 px, the gridlines and the axis 3 px, ticks 0 / 5k / 10k at 32) |
| 960–1008 | the brand; "ranked by best score" at 32 on the right |

- **Which slide draws what under the podium** (§5): *Podium* draws ranks 4–6, *Strip* the
  score strip. **Story:** the same order in y 270–1650, centred; its *Podium* draws the
  rows, its *Strip* the rows **and** the strip (each where there is something to draw; the
  strip's band 150).
- **Mosaic:** the podium centred in the space left, nothing under it.
- **Spread** (§3.3): the head and the numbers, the ranking line at 36 (→ 32, then fewer
  entries) at 362, the rows from 440 down to the axis at the foot (a name column 260, the
  best 128 at the right, the track between); a row is at least 52 px, so a square shows
  eight singers, or seven and "+N more". The story's rows grow to 110.
- **How it adapts:**
  - *One singer:* no podium; their avatar large, their name, their best as the hero in gold.
  - *Two or three singers:* the podium only, with nothing under it on *Podium*.
  - *Ten singers:* the podium, three rows and "+4 more".
  - *Under four scores:* no strip, as everywhere (`CHART_MIN_SCORES`), and no spread.
  - *You:* the one-singer hero with the place ("2nd of 5", 44 bold pink) between the name
    and the best; their own strip under it.

### 4.3 Making it survive a chat

- A card is seen at about 360–400 CSS px wide, a third of its size.
- **Size floors:** 32 px for anything that must be read, 28 for the brand. (An avatar's
  initial is part of the picture it stands in for.)
- **Lines:** 3 px or none; JPEG recompression eats hairlines. Two marks of the spread are
  the exceptions: the ring around a raw dot inside a box is 2 px (a 3 px ring would eat a
  7 px dot), and the box's median is 4 px, so it reads through the dot cloud.
- **Coloured text:** 40 px bold or larger.
- **Background:** an opaque fill, always.
- **Blur:** draw the cover small (24 px) and scale it back up by doubling, each pass
  smoothing the last. `ctx.filter` is not reliable on WebKit.

`layout.test.ts` checks the first, the third and that no two regions of a card overlap or
leave its area, for every card kind, format, look and focus over the adaptations above.

## 5. The panel

A **bare** modal (`Modal`'s `bare` + `hideTitle`: `.modal-bare` on `.modal-backdrop-blur`,
the song modal's surface, ui-guidelines §5). It has no visible heading: the header is the
close alone, and *Share this score*, *Share this party*, *Share these stats* or *Share this
achievement* is the dialog's accessible name only. Top to bottom, one centred column:

1. **The long-press hint**, *Press and hold the picture to save or share it.*, a
   `.section-note` centred above the picture, drawn from the moment the panel opens on a
   touch screen outside a secure context (it is known then, so nothing moves under it).
2. **The carousel of designs**, one slide per design in a fixed order per card kind, every
   design of the kind always present: a score's *Dark* · *Cover*; a party's *Podium* ·
   *Strip* · *Mosaic* · *Spread* · *You*; a player's *Histogram* · *Strip* · *Songs* (§9), always on Dark; an
   achievement's one *Badge* (§10). A choice that used to be an option is a slide:
   *Under the podium* is *Podium* (ranks 4–6 under it) against *Strip* (the score strip
   under it), and *Only me and my place* is *You*. A design the card cannot draw is a dimmed
   slot, its name and `possible.ts`'s sentence in the picture's place.
3. **The dots row**: `chevron-left`, one dot per slide, `chevron-right`, then — 12px on,
   after a 1px × 24px `--input-border-color` rule — **the format pair**: `format-square` and
   `format-story` as two borderless 40×40 radios (the §4 pills' hidden radio in a `<label>`,
   no chip box, no fill), the chosen glyph in `--color`, the other in `--color-darker`, the
   ring on `input:focus-visible ~` the glyph; one `role="radiogroup"` named *Format*, each
   named *Square* / *Story*. The row is one centred group; an achievement's single slide
   draws no arrows, dots or rule, and the pair stands alone in the middle.
4. **The design's name**, 0.85em `--color-dark`, under the row.
5. **The options row**: the same three icon toggles, in the same order, on every slide of
   every card kind — *Other singers' pictures* (`image`), *Party name and date*
   (`calendar`), *Wingman logo* (the app's own `/logo.png` at 24px, the one toggle whose
   glyph is a picture: off, it goes grey and to half opacity under the bar) — each one
   ui-guidelines §4's `.icon-toggle`, 40px boxes 8px apart in one centred row. A toggle the slide in view cannot honour is dimmed in
   place (`aria-disabled`), never removed and never renamed: it keeps drawing the state the
   reader left it in, which the slides that honour it still use, and a press on it changes
   nothing and says why in the line below.
6. **The line**: one `.section-note`, centred, two lines tall whatever it holds,
   `aria-live="polite"`. At rest it reads *Press a symbol to take it off the card or put it
   back.*; once a toggle is pressed, focused, or hovered by a mouse (`pointerType` `mouse`
   alone, so a tap's emulated hover is not a second trigger) it reads that toggle's sentence
   for the state it is in now, or its reason where it is dimmed. It keeps the last toggle's
   sentence — a pointer leaving never puts the rest line back — and re-reads it for the slide
   that comes into view, so a toggle dimmed there says why without being touched again. On a
   touch screen, which has no hover, the first tap both changes the option and explains it,
   and the picture changes with it; a second tap undoes it. It is the one place a sentence
   about an option lives; the dimmed slot's reason stays in the slot, where the eye is.
7. **The buttons**, then the status and error lines, as below.

```
 390px, a party card (a score card: two dots, Dark · Cover)
                                              [x]
        Press and hold the picture to save or share it.
   +--------------------------------------+ +---
   |                                      | |
   |            the card's PNG            | |   the next design
   |                                      | |   peeks in
   +--------------------------------------+ +---
        <   *  o  o  o  o   >  |  [#] [|]
                     Podium
               [img]  [cal]  [logo]
     Press a symbol to take it off the card or put it back.
   [      Save image      ] [      ^ Share      ]
```

```
 the options row, logo pressed off
     +------+   +------+   +------+
     | img  |   | cal  |   |  \   |      on: --color glyph
     |      |   |      |   | logo |      off: --color-darkerer, struck
     +------+   +------+   +--\---+      dimmed: 40% under its own state
          The Wingman logo is left off.
```

The toggles' sentences, on · off: *Other singers' pictures are on the card.* · *Other singers
are drawn as their initials.*; *The party's name and date are on the card.* · *The party's
name and date are left off.* (on a player card: *The party line is on the card.* · *…is
left off.*); *The Wingman logo is on the card.* · *The Wingman logo is left off.* Dimmed:
*Nobody else is on this card.* (pictures, wherever the only face is the sharer's — their own
score, *You*, a party they sang alone, their own stats, an achievement), *The spread draws
names, not pictures.* (pictures on *Spread*, which draws no face at all) and *An achievement
belongs to no party.* (the date toggle on §10's card, whose earned date always stands).

The hover fill of an icon toggle is a pointer's alone (`@media (hover: hover)`, as the
chip's): a phone keeps `:hover` on whatever was tapped last, and a toggle left in the blue
fill read as a second "on".

`shareCard/possible.ts` says which designs a card can take and, for each it cannot, the
slot's sentence, and which toggles the slide honours and why not; `resolve…Options` turns
what was asked for into what is drawn.

**Buttons by context**, shown only where they work and never greyed out:

| Context | Buttons |
|---|---|
| secure (https, or `http://localhost` on the host PC) | **Share** if `navigator.canShare({files})`, **Copy image** if `ClipboardItem` exists, **Save image** |
| plain http on the LAN | **Save image**, and the hint *Press and hold the picture to save or share it* on touch screens |

On plain http, `navigator.share`, `canShare` and `navigator.clipboard` are `undefined` in
every browser; the specs mark them `[SecureContext]`.

**Traps the technical review found:**
- **Build the PNG `File` when the panel opens and on every option change, never inside the
  click.** Awaiting `toBlob` inside the click can use up the tap's user activation, and
  Safari's `share()` then throws `NotAllowedError`.
- **A redraw holds the buttons still.** The old picture stays up while the new one is drawn,
  but it is the card of the options before: Share and Copy image are disabled and Save image
  ignores a press until the new file is there, so a quick tap never sends the wrong card. All
  three look held while they wait, the word in `--color-darkerer` on `--input-bg` and the
  primary's fill gone, so a held button never reads as one that went nowhere. A redraw that
  fails takes the old picture and the buttons with it.
- **Share the file alone.** A `title` or `text` adds a stray `.txt` to the iOS share sheet.
- **Errors:** `AbortError` is the user cancelling, so nothing follows. `NotAllowedError` and
  `TypeError` fall back to Save.
- **The download goes to Files on iOS**, not Photos, and `blob:` downloads are reported broken
  since iOS 18.2. The long-press on the preview is the path to Photos there.
- **Canvas** (all handled in `draw.ts`):
  - a fixed output size and no `devicePixelRatio` (iOS caps canvas area);
  - `toBlob`, not `toDataURL`;
  - `await img.decode()` before every `drawImage`;
  - `document.fonts.ready` before measuring text;
  - after export, zero the canvas; the panel revokes its object URLs, because Safari keeps
    old canvas memory alive.

The panel remembers the last format, design and toggles per device (`shareCard/prefs.ts`:
`localStorage`, wrapped in try/catch, every value checked on its own). That is a per-viewer
convenience. A *Spread* or *You* slide is not remembered: the panel opens on the remembered
design unless the card cannot draw it, and on the first slide it can draw then. A player
card's design is remembered apart from a party's, all three of them.

**Save image** is an `<a download>` on the preview's own object URL, so it needs no URL of its
own; a share that falls back to Save clicks it. The panel revokes the preview's URL once a
redraw's new picture has loaded in its place (any sooner, the old one could flash as a broken
image), every URL of a slide that has dimmed since it was drawn, and every URL it holds
when it closes. It takes one card for as long as it is open, so there is no other score to
move to.

## 6. Where it lives in the code

- `frontend/src/shareCard/`, each part tested without a canvas:
  - `content.ts` — `scoreCard` / `partyCard` / `playerCard`: what goes on a card from the
    data, the toggles applied (a player's `scope` — the party's name · date, its date, or
    `ALL_PARTIES` — and the `line` the date toggle takes off, the twenty `histogram`
    buckets with the best's, the strip's dots, their best per song up to
    `PLAYER_SONGS_SHOWN`); `cardImageUrls` is every picture a card can draw, for the panel
    to load — of a party's singers only the six faces a card ever shows (`FACES_SHOWN`: the
    podium and ranks 4–6), of a player their face and the covers of the songs listed;
  - `fit.ts` — the text fitting, with the measurer passed in (`fakeMeasure` in
    `src/test/shareCard.ts` for the tests); every cut is on graphemes (`Intl.Segmenter`
    where the browser has it, code points otherwise), so a flag or a joined emoji is never
    split;
  - `layout.ts` — the layouts in numbers, as boxes the renderer paints (`layoutScoreCard`,
    `layoutPartyCard`, `layoutPlayerCard`; the player's histogram is plain `rect`s);
  - `possible.ts` — the carousel's designs in their fixed order (`SCORE_DESIGNS`,
    `PARTY_DESIGNS`, `PLAYER_DESIGNS`, and `ACHIEVEMENT_DESIGNS` once §10 is built;
    `partyDesignOptions` turning a party's slide into its look, focus, what stands under the
    podium and whether it is the sharer alone), which of them a card allows
    (`scoreCardDesigns`, `partyCardDesigns`, `playerCardDesigns`), which toggles each slide
    honours and why not (`SHARE_TOGGLES`, `scoreSlideToggles`, `partySlideToggles`,
    `playerSlideToggles`, `toggleSentence` — the card kind its fourth argument, for a
    player's *party line* —, `TOGGLES_REST`), `resolvePartyOptions` turning a slide into
    what is drawn and `settlePartyOptions` asking that again of the pictures that decoded
    (`draw.ts`), never swapping what stands under the podium for the other, and
    `resolvePlayerOptions` turning a design the card cannot take into `none`;
  - `draw.ts` — `renderCard(request, images) → Promise<Blob>`, the seam for the panel:
    `images` maps each URL the content names (and `LOGO_URL`) to an `HTMLImageElement` the
    caller loaded from Wingman's own origin; a missing or broken one draws as its letter.
    `paintCard` is the same onto a canvas the caller owns;
  - `images.ts` — `loadCardImages`: each URL loaded and decoded once per open panel, a
    failed one left out of the map, which is what `possible.ts`'s `loaded` reads;
  - `flags.ts` — `scoreFlags`: *New Highscore* (the score holds the song's record alone,
    `isNewHighscore` over the score by itself) and *Personal best* (the singer's own best on
    the song, alone, out of at least two tries of theirs), from the song's all-time scores;
  - `prefs.ts` — what the panel remembers per device: the format, `scoreLook`,
    `partyDesign` (`REMEMBERED_PARTY_DESIGNS`: *Podium*, *Strip*, *Mosaic*; an older build's
    `partyLook` of `mosaic` carries over, its `onlyMe` is dropped), `playerDesign` (all
    three) and the three toggles.
- The strip and the spread are drawn with Canvas 2D over `chartLayout.ts` (`scoreX`, `swarm`,
  `jitterOf`, `scoreTickLabel`) and `chartTheme`, the screens' own helpers; nothing of the SVG
  components is serialised (§7.2).
- `icons.tsx` has the `share` glyph and the two formats' `format-square` / `format-story`.
  `download` is taken (it means the achievements archive).
- `components/ShareCardPanel.tsx` — the panel of §5: the carousel of designs
  (`DesignCarousel`: the slide in view read off the scroll position once it has been still
  for `SETTLE_MS`, which is one path in every browser — Safari's without `scrollend`
  included — and an exact answer where an `IntersectionObserver` gives thresholds), the
  dots row with the format pair (`FormatPair`, passed in as the row's `trailing`), the
  options row (`ShareToggles`) and its line, the buttons. A party is two `partyCard`
  contents, the whole party for four slides and the sharer alone for *You*. It asks
  `GET /stats/songs/{id}/scores` for the flags only for a reader holding `stats.history`,
  and draws nothing until that read (or its failure) and `/auth/me` are in. It takes one
  card to draw and never a list to choose from: choosing the score is the sing view's (§8),
  which hands it the pressed score, the sing's session and every score of the sing
  (`ShareTarget`'s `singScores`). A player is `ShareTarget`'s third kind, one singer's
  scores as the surface showed them and the party they are of, or `null` for every party.
- The entry points, four: `pages/Scores.tsx`'s session bar (*Share this party*), the sing
  view's **Share** (§8), *Share stats* on an open player group and on `/user/stats` (§9), and
  the achievement modal's **Share** (§10). The score card takes the rest of its sing from
  the sing view's read, so a duet partner in another group is never missed.
- The user documentation: `docs/user/scores/party.md` (the screenshot `scores-share`), the
  stats card there and in `docs/user/scores/your-scores.md` (the screenshot `stats-share`),
  and the achievement card where its surface is documented.
- One backend read, §8's `GET /stats/sings/{sing_id}`; the flags of §7.4 come from reads that
  exist.
- The codebase map in `CLAUDE.md` in the same commit.

## 7. Settled by the planning round

Settled 2026-10-23 by the orchestrator, in the user's absence. Each can still be vetoed.

1. **The chart-focus card (decision 6).** A party card has a **Focus**: *Podium*, the
   default, or *Spread* — the `SpreadRows` box plot the user named, laid out in §3.3 and §4.2
   with every label at least 32 px. With Spread the ranking shrinks to one line and nothing
   stands under it. The timeline is not on a card (legend room), the histogram is the player
   card's alone (§9), and there is no chart focus for one score.
2. **How the charts reach the canvas:** Canvas 2D drawn directly over `chartLayout.ts` and
   `chartTheme`, never by serialising the SVG components. The strip under the podium and the
   spread focus share those helpers with the screens.
3. **Entry points:** exactly the four of §6. `LastSong` and the TV stay out for now (later).
4. **New Highscore / personal best:** drawn only when the data on hand proves it, with no new
   read. The panel passes the flags when it can work them out — a reader holding
   `stats.history`, from the song's all-time scores (`isNewHighscore`) — and otherwise the
   card simply has no flag.
5. **No 4:5 format:** square and story only.
6. **Hidden songs:** a card shows exactly what `/scores` shows the same reader, with no
   filtering of its own (the accepted leak of §1).
7. **Duets:** the score card shows "with <name>" under the singer when the sing has another
   score (same `sing_id`); the party card counts a duet run as one sing, as `scoreSummary`
   already does.
8. **The http path per platform:** a real iPhone and a real Android phone check is the
   user's. The panel builds both paths: Share where `canShare` says yes, Save image always,
   the long-press hint on touch screens over plain http.
9. **Party name and date off:** the party card has no head and no singer count, the four
   numbers leading (§4.2); the story's eyebrow on the score card goes with it.
10. **Achievements earned on that sing:** later, since `earned_at` has no `sing_id` to tie a
    badge to a sing.

Settled the same way when the panel was redone and §8–§10 were designed (decisions 11 to
14 asked for the what; these are the how, each vetoable):

11. **The options never change between slides.** Every option that used to be a toggle or a
    pill and changed what a slide could draw is a slide of its own: *Under the podium* is
    *Podium* · *Strip*, *Only me and my place* is *You* (decision 5 named a toggle). What
    stays a toggle — pictures, party and date, logo — is the same three icons in the same
    order on every card, dimmed where a slide cannot honour one. The alternatives: *Only me*
    as a fourth toggle (`user`), and *Under the podium* as one strip toggle dimmed off a
    square Dark podium.
12. **A dimmed design's reason stays in its slot**, not in the options' line.
13. **The player card's *Songs* design** is an addition beside the histogram the user named
    and the strip.
14. **The sing view's rows choose the score** the card is of, replacing the panel's chooser;
    the moderation pencil stays on the `/scores` row; the read admits the caller's own score
    so a sing from before migration 0008 opens from `/user/stats`.
15. **The achievement card** opens from `AchievementModal`, only for an achievement the
    reader's own player has earned, in one design with the holders line on it.

## 8. The sing view (decision 12)

One sing: what was sung, when, who sang and what they got. It is where a score is shared
from, and a place to look in its own right.

**Built** (2026-10-24): the read below, `components/SingView.tsx`, the rows of
`ScoreGroupList` on `/scores` and `/user/stats` opening it, and *Share a score* gone. Three
calls the design left open, each vetoable: the view fetches its own roster
(`players.view`) rather than taking the page's, because `/user/stats` holds none and a duet
partner's face belongs on the rows and the card; a sing from before migration 0008 (no
party) reads the date alone, the same line as a nameless party, never a sentence such as
*before parties were recorded*; and a refusal is `errorMessage`'s sentence, so the 403
says *Your role may not do this (stats.history). Ask the host for access.* The view also
refetches on a `scores.changed` naming its sing, and if a correction took the pressed
score away the best one is pressed instead.

**Where it opens.** A tap on any score row: on `/scores` the rows of an open group, whatever
the grouping, and the ungrouped rows, in every party and in *All parties*; on `/user/stats`
the rows of an open song group. A group's summary row still folds its group out; only a
row that *is* a score opens the view, on `/user/stats` too, where the song is one tap
further, on the view's title. The `stats.moderate`
pencil stays on the `/scores` row beside the button, never inside it, and never moves
into the view.

**What it is.** A bare modal (`bare` + `hideTitle`, the song modal's surface), named
*Sing of <title>*, the close alone in its header:

```
 390px
                                              [x]
                    +--------------+
                    |    cover     |   160px, max 45vw
                    +--------------+
                  Bohemian Rhapsody          <- a button into the song modal
                        Queen
              17 Oct 2026, 21:42 · Ben's birthday
   ---------------------------------------------------
    1  (A)  Alice                              8662
            Medium
   [2  (B)  Bob  You                           7934]  <- the opened score, pressed
            Medium
    3  (C)  Carol                              6120
   ---------------------------------------------------
                   [  ^  Share  ]
```

- **The hero**: the cover (`SongCover`, square, 160px, `max-width: 45vw`; the `?` tile of
  `MissingCover`, today private to `ScoreGroupList.tsx` and exported from it for the view,
  for a song that left the library), the title at 1.15em and the artist at
  0.85em `--color-darker`, the song modal's hero a size down. The title is a plain `<button>`
  that opens `SongDetails` over the view when `song_listed` says the reader may open that
  song, and plain text otherwise; a song that left the library reads *Unknown song* with no
  artist, as `songLabel` does.
- **When**: one centred 0.85em `--color-darker` line, the sing's start as date and time in
  the reader's locale with its year, then the party's name after a dot; a nameless party is
  the date alone, which the line already says.
- **Who sang**: every score of the sing between two hairlines, best first, in
  `RankedScoreList`'s row shape (rank, 40px `PlayerAvatar`, the name over the difficulty,
  the score at the right, tabular). The rank is the stored `placement` in the pink numeral
  of the top three, never a recount; a row without one (from before migration 0026) has an
  empty rank cell. Each row is a `<button aria-pressed>`, and the pressed one, the
  `--highlight-blue-dark` band under a `--highlight-blue-light` name, is the score the card
  will be of: the view opens with the tapped score pressed, and a tap on another row moves
  it, which is how somebody shares a duet partner's score. The reader's own row carries a
  quiet *You* after the name (0.8em `--color-darker`, a word, never a chip).
- **A sing with one score** is one row with no rank (a solo sing is not a win) and nothing
  else in its place.
- **Share**: one `.button-primary` with `share`, *Share*, centred 16px under the rows; the
  bare modal's primary is the page-level dark blue (ui-guidelines §4). It opens the share
  panel (§5) over the view on the pressed score's card; closing the panel comes back here.
  It is drawn once the rows are in.
- **While it loads**, the hero stands at once from the row that was tapped, `Loading` in
  the rows' place; a refusal is one `.error-notice` there, and Share is not drawn.

**The read.** `GET /stats/sings/{sing_id}`, in `stats/api.py`, `service.sing_detail`, and a
new read model in `stats/schema.py` named `SingDetail` (`SingRead` is taken: it is the
*Recently played* row):

| Field | |
|---|---|
| `sing_id`, `song_id` | the sing's own |
| `song: SongRead \| None` | `None` when the song left the library, as in `ScoreWithContext` |
| `song_listed: bool` | the song is in the library **and** no tag keeps it back from this caller (`HiddenSongsDep`); what the title's button reads. The song itself is not withheld: a score list shows it, the accepted leak of §1 |
| `session: SessionRead \| None` | the party as the session listing reads it (a hidden one included), for the when line and the score card's eyebrow; `None` for a sing from before migration 0008 |
| `started_at`, `ended_at` | the sing's, `ended_at` `None` if Wingman went down mid-song |
| `scores: list[ScoreWithContext]` | every score of the sing, best first (score descending, id ascending), `placement` and `field_size` as stored — `ScoreWithContext` because `RankedScoreList`, `ScoreEntryBody` and `scoreCard` take that type as it is |

Gated on `stats.view`, then readable when the caller holds `stats.history`, or the sing's
party is in `visible_session_ids`, or the caller's own player holds a score of this sing —
the `own_player_or_history_right` reasoning, which is what lets `/user/stats` open a sing
from before migration 0008 that is in no party. A reader without `stats.history` gets the
same 403 (`missing_permission("stats.history")`) for a sing that does not exist as for one
they may not open, so the route says nothing about which sings were ever recorded; with it,
an unknown sing is a 404. Tests in `tests/test_stats_api.py`; then the client is
regenerated.

**Files:** `backend/src/ultrastar_wingman/stats/{api,service,schema}.py`,
`backend/tests/test_stats_api.py`, `frontend/src/api/` (generated), a new
`components/SingView.tsx` + `.css` + `.test.tsx`, `components/RankedScoreList.tsx` (an
optional pressed row and a stored-rank cell), `components/ScoreGroupList.tsx` (rows open the
view; no `onShare`), `pages/Scores.tsx`, `pages/UserStats.tsx`,
`components/ShareCardPanel.tsx` (one card, no score chooser), `CLAUDE.md`'s map, and the
user pages of both surfaces.

## 9. The player card (decision 13)

One singer's scores as a picture: at one party, or their whole record.

**Built** (2026-10-24): `playerCard`, `PLAYER_DESIGNS` and `layoutPlayerCard` (§6), the panel's
third target, *Share stats* on an open player group and *Share my stats* on `/user/stats`.
Calls the design left open, each vetoable:

- **The control stands for every non-empty record**, as written below, though below four
  scores of one song every design is a dimmed slot: a single score opens a panel of three
  slots and no buttons. The alternative is to draw the control only where one design can
  be drawn (four scores, or two songs).
- **The panel opens on the first design the card can draw** when the remembered one is
  dimmed (§5 says the first slide; a party's Podium and a score's Dark always can be drawn,
  a player's Histogram cannot below four scores).
- **The story's song rows are 96 high**, not the square's 104, and the story's avatar is
  the one thing that gives (200 down to 120, `stack`'s flexible item): eight rows of 104
  under a 200 avatar, the name, the line and the numbers do not fit in y 270–1650. On
  *Histogram* and *Strip* the avatar stays 200.
- **The strip's dots** are r 12 with a gold ring of 22 and 28 px between swarm lanes
  (`PLAYER_STRIP_DOT`), and **the band grows with the cloud** (`stripBand`): 200 on a
  square and 280 on a story are its least, and it is as tall as the swarm needs for every
  dot to have a lane of its own, up to the square's focus region (about 450) and the
  story's 640. A fixed 200 piled a cloud of fifty scores onto its outer lanes, dots over
  dots; only a cloud past those heights still does, as the party card's strip does at 100.
- **A histogram bar is never under 8 px** where its bucket holds a score, and the bars
  have square corners on the baseline.
- **The scope line reads *All parties*** under *All my scores* as well, the head row of a
  reader without `stats.history`.
- **`/user/stats` reads the roster when the panel opens** (`players.view`), for the
  reader's own picture, and the panel waits for that answer; a reader without the right
  gets their initial.
- A design the card cannot take resolves to `none`: the head and the numbers alone, never
  drawn by the panel, which shows the dimmed slot instead.

**Where it opens.** *Share stats* on an open **player** group on `/scores` (grouped by
player, in any party or in *All parties*): one plain `.button` with `share`, right-aligned on
a line of its own 12px under the summary and its chart, one per group; a song group has
none. On `/user/stats`, one `.icon-button-bordered`
`share`, *Share my stats*, trailing the `PageHeader` (a page-level control, ui-guidelines
§6), drawn once the scores are in and not empty. Whoever may see the scores may share them,
somebody else's included (§1, *No new permission*).

**What it says.**

| What | Where it comes from |
|---|---|
| head | the singer's avatar and name; under it the party's name · date ("Ben's birthday · 17 Oct 2026", a nameless party its date), or *All parties* for a whole record or the *All parties* row. Behind the date toggle: off, the name stands alone |
| Sings · Songs · Best · Average | `scoreSummary` over exactly the scores the surface showed, minus Worst (decision 2); Best gold, no holder (the card is one person's) |
| the histogram | `stats.ts` `histogram`: twenty buckets over 0–10k, bars in `chartTheme.accent`, the bucket holding the best in gold |
| the strip | `ScoreStrip`'s content, as the party card's strip, "Median N" above it |
| the songs | their best score per song, best first, at most five on a square and eight on a story, each with its cover |

**Designs** (the carousel, in this order): *Histogram* (the head, the numbers, the
histogram as the focus), *Strip* (the strip as the focus) and *Songs* (the best songs as
rows), all on Dark: a chart over a cover wash does not read. *Histogram* and *Strip* need
four scores (`CHART_MIN_SCORES`), *Songs* two songs, each dimmed with its sentence below
that (*The histogram needs at least four scores.*, *The strip needs at least four scores.*,
*One song is no list of songs.*); the control is drawn for one score already, because the
head and the numbers always stand.

**Square** (1080, margins 72):

| y | Region |
|---|---|
| 72–192 | the avatar 120 (radius 20%); beside it, centred on it, the name 56 bold (→ 44, then an ellipsis) over the party line 32 in `#888` |
| 232–341 | the four numbers in the party card's columns (190 · 190 · 316 · 240): the value 56 bold, the label 32 in `#888`, Best gold |
| 392–936 | the focus. *Histogram*: twenty bars across 936 (6 px apart), at most 440 tall, on a 3 px baseline, ticks 0 / 5k / 10k at 32 under it. *Strip*: "Median N" at 32, then the party card's strip with its band at 200 (at least: it grows with the cloud, see *Built* above) and dots r 12, centred in the region. *Songs*: five 104 px rows, the cover 80 (square corners), the title 40 bold (→ 32, then an ellipsis) over the artist 32 in `#ccc`, the best 44 bold at the right, gold for the top one |
| 960–1008 | the brand; "ranked by best score" at 32 on the right on *Songs* |

**Story** (1080×1920): the same order in y 270–1650, the head centred (the avatar 200 over
the name 64 and the party line 36), the histogram up to 640 tall, the strip's band 280 (at
least, as on the square), eight song rows.

**Toggles:** pictures (dimmed while the singer is the sharer: *Nobody else is on this
card.*; for somebody else, off draws their initial), date (the party line), logo.

**Files:** `shareCard/content.ts` (`playerCard`), `layout.ts`, `possible.ts`, `draw.ts`,
their tests, `src/test/shareCard.ts`, `components/ShareCardPanel.tsx`,
`components/ScoreGroupList.tsx`, `pages/Scores.tsx`, `pages/UserStats.tsx`.

## 10. The achievement card (decision 14)

One earned achievement, as the modal shows it large.

**Where it opens.** `AchievementModal`, for an achievement the reader's own player has
earned: one `.button` with `share`, *Share*, centred 16px under the meta group, the modal's
one control. Not drawn for a masked achievement, one not earned yet, or while the feature
is off. The alternative the user may ask for instead is the collection — `UserAchievements`'
"7 of 35" with the earned badges as a grid — which is not built.

**What it says**, top to bottom: the badge, the name, the description, the sharer (avatar and
name), "Earned 12 Aug 2026", and `achievements.holdersLine` counted with the sharer
(*First to earn it*, *Earned by 3 players*; no line without a count). The picture is the
icon endpoint at `?size=full&v=<icon_version>` on Wingman's own origin, so the canvas stays
exportable (§1); without a picture the glyph plate in the achievement's colour, the glyph
painted from `ICON_PATHS` as `draw.ts` paints every glyph.

**Square:**

| y | Region |
|---|---|
| 72–472 | the badge 400×400, centred, radius 80 (a fifth of the side, `AchievementBadge`'s) |
| 512–580 | the name 64 bold (→ 52, then an ellipsis), one line |
| 600–704 | the description 40 in `#ccc`, at most two lines at line-height 1.3, then an ellipsis |
| 744–816 | the sharer: avatar 72 and the name 40 bold, centred as one row |
| 848–936 | "Earned 12 Aug 2026" 32 in `#888`, the holders line 32 in `#888` under it |
| 960–1008 | the brand |

**Story:** the same order in y 270–1650, the badge 560, the name 72, the description 44 in
up to three lines, the avatar 96.

**One design**, *Badge*, on Dark: the carousel is one slide, so the dots row is the format
pair alone. **Toggles:** pictures dimmed (*Nobody else is on this card.*), date dimmed (*An
achievement belongs to no party.*), the logo the one that works — "not much customization",
and the row still reads the same as on every other card.

**Files:** `shareCard/content.ts` (`achievementCard`), `layout.ts`, `possible.ts`, `draw.ts`
and their tests, `components/AchievementModal.tsx` + `.css`, `components/ShareCardPanel.tsx`,
`docs/user/` where the user page's achievements are described.
