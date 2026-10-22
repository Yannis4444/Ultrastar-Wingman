# Share cards

*Design, 2026-10-22. Not built yet. The user's decisions are in §1; §§2–6 are the plan as far
as it was settled before implementation, and §7 lists what a planning round still has to
decide. When this document and the code disagree after the round, the code is right and this
document is updated.*

A singer gets **a picture of their scores** to send to friends: one score (the song's cover,
the number, the rating word, the place) or a whole party (the podium, a few numbers, a
chart). The picture is drawn in the browser, previewed in a panel with a few options, and
saved or shared from the phone.

The mockup the user approved is the canvas **Wingman share cards**,
<https://claude.ai/artifact/NmYYswb6HziUxM32ZdDojL> (private to the user). It has ten boards
in three rows: one score, one party, the share panel. The covers in it are CSS placeholders
and the avatars are initials. §4 gives its layouts in numbers, so the round can build from
this document alone.

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
  - A card never shows more than `/scores` shows to the same reader.
  - `list_session_scores` does not apply `HiddenSongsDep`, so the card must drop the songs a
    tag hides from that reader itself (§7.6).
- **The Wingman mark is always on a card**, bottom left, small and grey. No toggle, no URL,
  no slogan.
- **Only the score strip** of the existing charts goes *under* the podium. The others don't
  read at chat-thumbnail size in that space. As the card's focus (decision 6) they get the
  whole card, which changes that.

## 2. What a card can say

Everything below is already computed somewhere, except the two flags in §2.3.

### 2.1 One score

| What | Where it comes from |
|---|---|
| title, artist, cover | the song (`/songs/{id}/cover`); a song that left the library reads *Unknown song*, as `songLabel` does |
| the score | the score row; bare integer, as everywhere else ("8662") |
| rating word | `stats.ts` `evaluationLabel` (*Superstar*, *Lead Singer*, …), the most shareable line the app has |
| the place | `placement` / `field_size` ("1st of 3"). It is NULL for scores from before migration 0026: draw nothing then, never "? of ?". Drop it when `field_size == 1`, because a solo sing is not a win |
| singer | name and avatar |
| party · date | `sessionLabel` and the date with its year ("17 Oct 2026"); behind the toggle of decision 4 |
| *New Highscore* | see §2.3 |

### 2.2 One party

| What | Where it comes from |
|---|---|
| name, date, singer count | `sessionLabel`, the session row; name and date behind decision 4's toggle |
| Sings · Songs · Best · Average | `stats.ts` `scoreSummary` minus Worst (decision 2). Best is gold with the holder ("Best · Chiara") |
| podium, ranking | the leaderboard's order, named on the card ("ranked by best score") |
| score strip | `ScoreStrip`'s content: every score as a grey dot, the best in gold, the median dashed, "Median · Best" written above it |
| covers for *Mosaic* | the distinct covers of the party's sings |

### 2.3 Not computed for every reader yet

- **New Highscore** (the song's best score ever) needs the song's whole history.
  `/stats/songs/{id}/scores` is `stats.history`, so a guest's phone cannot work it out.
- **Personal best** needs the same for someone else's score
  (`own_player_or_history_right`).
- Either show the flags only to readers who can compute them, or add one small read that
  answers the booleans for a score the reader can already see. The TV already announces a
  new high score to the room, so a yes/no leaks nothing. This is for the round to decide
  (§7.4).

## 3. The cards

The tokens are the app's: `--bg #021720`, `--input-bg #1c2832`, text white / `#ccc` /
`#888`, blue `#4b92cd`, pink `#9e3b95`, gold `#faa636`. Gold means the best score and
nothing else, as on every other surface. The font is the system stack (`index.css` loads no
webfont), so a card looks slightly different on each device. That is accepted.

### 3.1 Looks

- **Dark** is the app's own surface, flat `--bg`.
- **Cover** (one score only): the cover blurred over the whole card under `--bg` at 70%, the
  content centred. A song without a cover falls back to Dark, and the panel says why.
- **Mosaic** (party only): a 3×3 grid of the party's covers under the same scrim. With fewer
  than four distinct covers it falls back to Dark.
- Minimal was proposed and dropped: it was Dark with things taken away.

### 3.2 Formats

- **Square** 1080×1080.
- **Story** 1080×1920. The top and bottom 270 px carry background only, because the story
  apps draw their own controls there.
- A 4:5 portrait (1080×1350, Instagram's feed format) was suggested by a reviewer and not
  decided (§7.5).

### 3.3 The chart as the focus (decision 6)

A third layout of the party card. The chart takes the place of the podium as the hero, under
the same head and numbers. The ranking shrinks to a line ("1 Chiara 9124 · 2 Alice 8662 ·
3 Ben 7934") or goes.

- **Candidates:**
  - the **spread** rows (`SpreadRows`: one row per singer, a Tukey box over the raw dots from
    five scores on, the best gold), which the user named;
  - the **evening timeline** (`EveningTimeline`, score over the clock, one hue per singer);
  - the **histogram** (`ScoreHistogram`);
  - the strip at full size.
- None of this was drawn in the mockup. The round designs it (§7.1).

## 4. Layouts

These are the mockup's numbers at 1080 wide, with side margins of 72 and a content width of
936. They are where the round starts from, not a contract.

### 4.1 One score, square (Dark)

| y | Region |
|---|---|
| 72–288 | cover 216×216, square corners (covers are artwork). Beside it: the title at 52 bold, line-height 1.3, at most two lines; the artist at 36 in `#ccc`, one line |
| 336–556 | the score, 220 bold, white. Gold only for *New Highscore* |
| ~576 | the rating word, 44 bold, blue |
| ~660 | a 24 px bar on `--input-bg` with a pink fill over 0–10000, radius 8 (the bar of `LastSong`) |
| ~730–850 | the avatar 120 (radius 20%); the name 48 bold; the place 36 in `#ccc`. Right: the trophy and *New Highscore* 32 in gold |
| 960–1008 | the logo 48 and *Ultrastar Wingman* 28 in `#888`; party · date at the right of the same line |

**Cover** centres everything: the cover 300 with a shadow, title, artist, the score at 200,
the rating word, then the singer row. It has no bar.

**Story** keeps the Cover order inside y 270–1650: party · date eyebrow 30, cover 440, title
64, score 240, rating 44, bar, singer row, brand.

**How a card adapts:**
- *No cover:* the artist's initial on `--input-bg`, as `CoverImage` draws it.
- *Long title:* 52 → 44, then an ellipsis on the second line. Never three lines.
- *Long singer name:* one line, 48 → 36, then an ellipsis.
- *Solo sing:* no place.
- *Duet:* §7.7.

### 4.2 One party, square (Dark)

| y | Region |
|---|---|
| 72–190 | name 56 bold, one line; "date · N singers" 32 in `#888` |
| ~230–330 | four numbers in columns: the value 56 bold, the label 26 in `#888`; Best gold with its holder |
| ~380–680 | the podium: 1st in the middle and raised, avatar 180; 2nd and 3rd avatar 140; pink rank numeral before the name 36; the score 44 (gold for the best) |
| ~730–940 | **either** ranks 4–6 as 52 px rows plus "+N more", **or** the score strip (dots r 10, the best's ring 22 in gold, the median dashed 3 px, ticks 0 / 5000 / 10000 at 28, "Median · Best" at 32 above it) |
| 960–1008 | the brand; "ranked by best score" at the right |

- **Story:** the same order in y 270–1650, with room for the rows **and** the strip.
- **Mosaic:** the podium centred in the space left, no rows.
- **How it adapts:**
  - *One singer:* no podium; their avatar large, their best as the hero.
  - *Two or three singers:* podium only.
  - *Ten singers:* the podium, three rows and "+4 more".
  - *Under four scores:* no strip, as everywhere (`CHART_MIN_SCORES`).

### 4.3 Making it survive a chat

- A card is seen at about 360–400 CSS px wide, a third of its size.
- **Size floors:** 32 px for anything that must be read, 28 for the brand.
- **Lines:** 3 px or none; JPEG recompression eats hairlines.
- **Coloured text:** 40 px bold or larger.
- **Background:** an opaque fill, always.
- **Blur:** draw the cover small (about 24 px) and scale it back up. `ctx.filter` is not
  reliable on WebKit.

## 5. The panel

A panel modal (`docs/dev/ui-guidelines.md` §5) titled *Share this score* or *Share this
party*:

- the preview, as a real `<img>` of the PNG;
- **Format** and **Look** as pills;
- for the party card, **Under the podium** (Ranking / Score strip), or the focus of §3.3;
- the toggles of §1: other singers' pictures, party name and date, only me and my place;
- the buttons at the foot.

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
- **Share the file alone.** A `title` or `text` adds a stray `.txt` to the iOS share sheet.
- **Errors:** `AbortError` is the user cancelling, so nothing follows. `NotAllowedError` and
  `TypeError` fall back to Save.
- **The download goes to Files on iOS**, not Photos, and `blob:` downloads are reported broken
  since iOS 18.2. The long-press on the preview is the path to Photos there.
- **Canvas:**
  - a fixed output size and no `devicePixelRatio` (iOS caps canvas area);
  - `toBlob`, not `toDataURL`;
  - `await img.decode()` before every `drawImage`;
  - `document.fonts.ready` before measuring text;
  - after export, zero the canvas and revoke the object URLs, because Safari keeps old canvas
    memory alive.

The panel may remember the last format, look and toggles per device (`localStorage`, wrapped
in try/catch). That is a per-viewer convenience.

## 6. Where it lives in the code (expected)

- `frontend/src/shareCard.ts`, or a small folder: the pure parts — what goes on a card from
  the data, the text fitting and the layout numbers — each tested without a canvas.
- One component for the drawing and one for the panel.
- `icons.tsx` gains a `share` glyph. `download` is taken (it means the achievements archive).
- The backend changes only if §2.3 is answered with a new read.
- A user documentation page and its screenshot (`docs/dev/documentation.md`,
  `docs/dev/screenshots.md`).
- The codebase map in `CLAUDE.md` in the same commit.

## 7. Open for the planning round

The round should settle these with the user before building. The first three matter most.

1. **The chart-focus card (decision 6).**
   - Which charts qualify: the spread is the user's named one; the timeline needs a legend
     for its hues, which takes room; the histogram is the easiest to read for someone who
     doesn't know the app.
   - How each is laid out at 3× scale with the 32 px floor.
   - Whether the focus is a third option beside "Ranking / Score strip" or a separate look.
   - Whether it also exists for one score (that score on the song's all-time strip, which
     needs `stats.history`, see §2.3).
   - Draw it on the mockup canvas first.
2. **How the charts reach the canvas.** Two routes:
   - extract pure, hook-free drawings of the SVG charts, serialize them with
     `renderToStaticMarkup`, load the SVG as an `Image` and `drawImage` it (explicit `xmlns`,
     numeric size, `font-family` as an attribute — page CSS and webfonts do not reach an SVG
     drawn as an image);
   - draw them directly with Canvas 2D over `chartLayout.ts` (`scoreX`, the swarm) and
     `chartTheme`.

   The first shares more code with the screens; the second has fewer surprises. `SpreadRows`
   and `EveningTimeline` mix HTML and SVG, so either route is real work for them.
3. **Entry points.**
   - The product review proposed:
     - a share action at the foot of an opened score group on `/scores` (the
       `ScoreActions` idiom, never one icon per row);
     - one share button beside the party picker for the party card.
   - Not on `/user/stats`, which spans every party.
   - The moment people most likely share is **right after singing**: the phone's last-song
     tile (`LastSong`) is a candidate the review did not weigh.
   - The TV's results screen with a QR code was dropped: a guest's link stops working once
     the party is over, and the rail already carries the one QR code.
4. **New Highscore / personal best for every reader** (§2.3): show it only to those who can
   compute it, or add a small read.
5. **A 4:5 format** beside square and story.
6. **Hidden songs on a party card:** filter on the client against `useTags`, or make
   `list_session_scores` take `HiddenSongsDep` (which changes `/scores` too).
7. **Duets:** one sing is several scores sharing a `sing_id`. Should the score card show
   both singers ("with Bob")?
8. **Confirm the http path per platform** on a real iPhone and a real Android phone:
   - the long-press menu on the preview (*Save to Photos* / *Download image* / *Share
     image*);
   - Save image;
   - a `blob:` against a `data:` preview URL.

   The user's success on 2026-10-22 did not record which of them worked.
9. **The party-name toggle on the party card** (decision 4). With the name and date off,
   the head needs something else: the singer count alone, or nothing.
10. **Achievements earned on that sing** on the score card. Later: `earned_at` has no
    `sing_id` to tie a badge to a sing.
