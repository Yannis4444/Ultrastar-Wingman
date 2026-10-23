# Share cards

*Design, 2026-10-22; settled and built 2026-10-23 on branch
`feat/host-controls-loudness-share-cards`. The user's decisions are in §1. Part 1 built what a
card says, how its text fits, the layouts and the canvas renderer (`frontend/src/shareCard/`,
§6); part 2 the panel, the two entry points on `/scores`, the buttons and the user
documentation. §7 records how the planning round settled what was open. When this document
and the code disagree, the code is right and this document is updated.*

A singer gets **a picture of their scores** to send to friends: one score (the song's cover,
the number, the rating word, the place) or a whole party (the podium, a few numbers, a
chart). The picture is drawn in the browser, previewed in a panel with a few options, and
saved or shared from the phone.

The mockup the user approved is the canvas **Wingman share cards**,
<https://claude.ai/artifact/NmYYswb6HziUxM32ZdDojL> (private to the user). It has ten boards
in three rows: one score, one party, the share panel. The covers in it are CSS placeholders
and the avatars are initials. §4 gives its layouts in numbers, as built.

## 1. Decisions

Made by the user, 2026-10-22, on the mockup:

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
5. **"Only me and my place"** is a toggle on the party card, as drawn in the panel.
6. **A chart can be the focus of a party card**, in addition to everything above. The user
   named the box plot (the spread rows) and left room for others. See §3.3 and §7.1.
7. **Sharing works over plain http.** The user shared a picture from the http site on their
   phone on 2026-10-22, so the feature does not need https.
   - The test page's own log recorded nothing, so *which* path worked was not captured. It
     was either the long-press menu on the picture or the download.
   - §7.8 is about confirming that per platform.

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
    it is drawn from exactly the scores that page showed (§7.6).
  - `list_session_scores` does not apply `HiddenSongsDep`, so a song a tag hides can stand
    on a card as it stands on `/scores` — the accepted leak, not a new one.
- **The Wingman mark is always on a card**, bottom left, small and grey. No toggle, no URL,
  no slogan.
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
| the others of the sing | the scores sharing its `sing_id` among those the page showed: "with Bob", "with Bob and Carol", "with Bob, Carol and 2 more", after the place on one line ("1st of 2 · with Bob") |
| singer | name and avatar |
| party · date | the party's name and the score's date with its year ("17 Oct 2026", in the reader's locale); a nameless party is its date alone, because `sessionLabel`'s fallback already says the date. Behind the toggle of decision 4 |
| *New Highscore* / *Personal best* | flags the caller passes in, only when the data on hand proves them (§7.4) |

### 2.2 One party

| What | Where it comes from |
|---|---|
| head | the party's name, or its date when it has none, over "17 Oct 2026 · 5 singers"; with decision 4's toggle off, "5 singers" alone (§7.9) |
| Sings · Songs · Best · Average | `stats.ts` `scoreSummary` minus Worst (decision 2); a duet run is one sing. Best is gold with the holder ("Best · Chiara") |
| podium, ranking | `sessionLeaderboard(…, "best")`'s order, named on the card ("ranked by best score"); places are competition ranking, so two equal bests are both 1st |
| score strip | `ScoreStrip`'s content: every score as a grey dot, the best in gold, the median dashed, and "Median N" written above it — not the best, which the numbers above already print with its holder, the way `ScoreStrip` leaves it out under a score summary |
| spread rows | `groupScores(…, "player")` and `boxStats` per singer, in the ranking's order (§3.3) |
| covers for *Mosaic* | the distinct covers of the party's songs in the order they were sung, at most eighteen |
| *Only me and my place* | the sharer alone: their own Sings · Songs · Best · Average (Best without a holder), their picture large, "2nd of 5" and their best; offered only to somebody who sang at the party. A party of one has no place, as a solo sing has none: never "1st of 1" |

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
- **Mosaic** (party only): a 3×3 grid of the party's covers (3×6 on a story, centred) under
  `--bg` at **80%**: the covers are sharp, lettering and all, and at 70% they fought the grey
  labels over them. With fewer than four distinct covers that loaded it falls back to Dark.
  The podium stands alone on it: no rows, no strip, no spread.
- Minimal was proposed and dropped: it was Dark with things taken away.

### 3.2 Formats

- **Square** 1080×1080.
- **Story** 1080×1920. The top and bottom 270 px carry background only, because the story
  apps draw their own controls there.
- No 4:5 portrait (§7.5).

### 3.3 The chart as the focus (decision 6)

A party card's **Focus** is *Podium* (the default) or *Spread*.

- **Spread** is `SpreadRows` drawn for the card: one row per singer in the ranking's order —
  the name and the quiet count ("Chiara ×5") at the left, the track on the shared 0–10k scale,
  their best at the right, gold for the party's best — a Tukey box under the raw dots from
  five scores on, plain dots below that, the gridlines once behind the rows and the axis once
  under them. It takes the podium's place under the same head and numbers; the ranking shrinks
  to one line, "1 Chiara 9124 · 2 Alice 8662 · 3 Ben 7934", and *Under the podium* does not
  apply.
- It needs two singers and four scores, and the Dark look: a box plot over a mosaic does not
  read. *Only me* shows one singer, so it has no spread.
- **Later, not in this cut:** the evening timeline (its hues need a legend, which takes room
  a card does not have), the histogram (twenty bars do not read at thumbnail size), and a
  chart focus for one score (that score on the song's all-time strip needs `stats.history`).

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
| 960–1008 | the logo 48 and *Ultrastar Wingman* 28 in `#888`; party · date at 32 in `#888` at the right of the same line |

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
| 72–190 | the head 56 bold (→ 44, then an ellipsis), one line; "date · N singers" 32 in `#888` |
| 222–331 | four numbers in columns 190 · 190 · 316 · 240 wide: the value 56 bold, the label 32 in `#888`; Best gold with its holder |
| 372–694 | the podium: 1st in the middle and raised, avatar 180; 2nd and 3rd avatar 140, 60 lower; the pink rank numeral 40 bold before the name 40 (→ 32); the score 44 bold (gold for the best). Two singers stand about the middle, 2nd at the left. Centred in the space when nothing is under it |
| 722–936 | **either** ranks 4–6 as 56 px rows (the pink numeral, a 48 avatar, the name 40 → 32, the score 40 at the right) plus "+N more" 32, **or** the score strip ("Median N" at 32, a 100 px band of dots r 10 ringed in `--bg`, the best gold with a gold ring r 19, the median dashed 3 px, the gridlines and the axis 3 px, ticks 0 / 5k / 10k at 32) |
| 960–1008 | the brand; "ranked by best score" at 32 on the right |

- **Story:** the same order in y 270–1650, centred, with room for the rows **and** the
  strip (each drawn where there is something to draw; the strip's band 150).
- **Mosaic:** the podium centred in the space left, nothing under it.
- **Spread** (§3.3): the head and the numbers, the ranking line at 36 (→ 32, then fewer
  entries) at 362, the rows from 440 down to the axis at the foot (a name column 260, the
  best 128 at the right, the track between); a row is at least 52 px, so a square shows
  eight singers, or seven and "+N more". The story's rows grow to 110.
- **How it adapts:**
  - *One singer:* no podium; their avatar large, their name, their best as the hero in gold.
  - *Two or three singers:* the podium only; *Ranking* is not offered under it.
  - *Ten singers:* the podium, three rows and "+4 more".
  - *Under four scores:* no strip, as everywhere (`CHART_MIN_SCORES`), and no spread.
  - *Only me and my place:* the one-singer hero with the place ("2nd of 5", 44 bold pink)
    between the name and the best; their own strip under it.

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

A panel modal (`docs/dev/ui-guidelines.md` §5) titled *Share this score* or *Share this
party*:

- the preview, as a real `<img>` of the PNG;
- **Format** and **Look** as pills;
- for the party card, **Focus** (*Podium* · *Spread*) and, on a square Dark podium card,
  **Under the podium** (*Ranking* · *Score strip*);
- the toggles of §1: other singers' pictures, party name and date, only me and my place;
- the buttons at the foot.

`shareCard/possible.ts` says which of those a card can take and, for each it cannot, the
sentence the panel prints under the disabled pill; `resolve…Options` turns what was asked
for into what is drawn.

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
  ignores a press until the new file is there, so a quick tap never sends the wrong card. A
  redraw that fails takes the old picture and the buttons with it.
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

The panel remembers the last format, look and toggles per device (`shareCard/prefs.ts`:
`localStorage`, wrapped in try/catch, every value checked on its own). That is a per-viewer
convenience. *Focus* and *Under the podium* start at *Podium* and *Ranking* each time.

**Save image** is an `<a download>` on the preview's own object URL, so it needs no URL of its
own; a share that falls back to Save clicks it. The panel revokes the preview's URL once a
redraw's new picture has loaded in its place (any sooner, the old one could flash as a broken
image), and every URL it holds when it closes or moves to another score.

## 6. Where it lives in the code

- `frontend/src/shareCard/`, each part tested without a canvas:
  - `content.ts` — `scoreCard` / `partyCard`: what goes on a card from the data, the toggles
    applied; `cardImageUrls` is every picture a card can draw, for the panel to load — of a
    party's singers only the six faces a card ever shows (`FACES_SHOWN`: the podium and
    ranks 4–6);
  - `fit.ts` — the text fitting, with the measurer passed in (`fakeMeasure` in
    `src/test/shareCard.ts` for the tests); every cut is on graphemes (`Intl.Segmenter`
    where the browser has it, code points otherwise), so a flag or a joined emoji is never
    split;
  - `layout.ts` — the layouts in numbers, as boxes the renderer paints;
  - `possible.ts` — which looks, focus and under-the-podium choices a card allows, and why
    not;
  - `draw.ts` — `renderCard(request, images) → Promise<Blob>`, the seam for the panel:
    `images` maps each URL the content names (and `LOGO_URL`) to an `HTMLImageElement` the
    caller loaded from Wingman's own origin; a missing or broken one draws as its letter.
    `paintCard` is the same onto a canvas the caller owns;
  - `images.ts` — `loadCardImages`: each URL loaded and decoded once per open panel, a
    failed one left out of the map, which is what `possible.ts`'s `loaded` reads;
  - `flags.ts` — `scoreFlags`: *New Highscore* (the score holds the song's record alone,
    `isNewHighscore` over the score by itself) and *Personal best* (the singer's own best on
    the song, alone, out of at least two tries of theirs), from the song's all-time scores;
  - `prefs.ts` — what the panel remembers per device.
- The strip and the spread are drawn with Canvas 2D over `chartLayout.ts` (`scoreX`, `swarm`,
  `jitterOf`, `scoreTickLabel`) and `chartTheme`, the screens' own helpers; nothing of the SVG
  components is serialised (§7.2).
- `icons.tsx` has the `share` glyph. `download` is taken (it means the achievements archive).
- `components/ShareCardPanel.tsx` — the panel: the chooser of a group's scores, the preview,
  the pills and the toggles, the buttons. It asks `GET /stats/songs/{id}/scores` for the
  flags only for a reader holding `stats.history`, and draws nothing until that read (or its
  failure) and `/auth/me` are in.
- The entry points: `pages/Scores.tsx`'s session bar (*Share this party*) and
  `ScoreGroupList`'s `onShare` (*Share a score*), which only `/scores` passes. The score card
  finds the rest of a sing among every score the page showed, not only the group's: grouped
  by player, a duet partner sits in another group.
- The user documentation is a section of `docs/user/scores/party.md` with the screenshot
  `scores-share`.
- No backend change: the flags of §7.4 come from reads that exist.
- The codebase map in `CLAUDE.md` in the same commit.

## 7. Settled by the planning round

Settled 2026-10-23 by the orchestrator, in the user's absence. Each can still be vetoed.

1. **The chart-focus card (decision 6).** A party card has a **Focus**: *Podium*, the
   default, or *Spread* — the `SpreadRows` box plot the user named, laid out in §3.3 and §4.2
   with every label at least 32 px. With Spread the ranking shrinks to one line and *Under the
   podium* does not apply. The timeline and the histogram are not in this cut (legend room;
   readability at thumbnail size), and there is no chart focus for one score.
2. **How the charts reach the canvas:** Canvas 2D drawn directly over `chartLayout.ts` and
   `chartTheme`, never by serialising the SVG components. The strip under the podium and the
   spread focus share those helpers with the screens.
3. **Entry points:** exactly the two `docs/dev/ui-guidelines.md` §7 prescribes — the party
   bar's `share` icon-button and an open score group's *Share a score*. `LastSong` and the TV
   stay out for now (later).
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
9. **Party name and date off:** the party card's head is the singer count alone ("5
   singers"); the story's eyebrow on the score card goes with it.
10. **Achievements earned on that sing:** later, since `earned_at` has no `sing_id` to tie a
    badge to a sing.
