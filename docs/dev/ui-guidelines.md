# UI Guidelines

How the Wingman UI looks and why. Read §1–3 before touching any frontend file; the rest when the
area applies. The old app (`D:\git\ultrastar-wingman`) is ground truth for the **look** only:
read its CSS, never copy its code. An explicit request from the user beats this document —
implement it and say so in the report rather than "fixing" it back in review. The only rules a
request does not override are the accessibility and dependency floors in §1.8–1.10.

## 1. Hard rules

1. **Flat by default.** Content sits on the page background (`--bg`) with hairline separators
   (`1px solid var(--input-border-color)`) and spacing — no cards, shadows or inner backgrounds
   for ordinary content. A section that "needs a box" gets a separator and 16px of margin.
2. **`--tile-bg` is whitelisted, not general.** Allowed: `.home-stage`, `.user-identity`,
   `.modal` (non-bare), `.score-group-panel`, the USDB login card, the login
   form, the "add songs from…" source cards. Nothing else; extending it is a user decision.
3. **No per-row badges for near-universal attributes.** No "MP3", "downloaded" or role chips
   per row, and never a valued facet — a genre, a language, an edition, a decade belongs in
   the details modal, where it is one line and not a mark. Allowed per row: the marks of rule
   4 and one numeric (or `—`) value column. Opt-in marks are the exception: a tag most songs
   would wear leaves `show_in_list` off, and so do *Duet* and *Video*.
4. **List rows carry passive marks, never toggles.** After the title, in DOM order:
   `.song-mark-sung` (`mic`), `.song-mark-favorite` (`heart`), `.song-mark-duet` (`users`),
   `.song-mark-video` (`video`) — each in its built-in's configured colour, and only while
   that built-in is shown in the song list — then one `.song-mark-tag` per visible
   `show_in_list` tag in the tag's colour. Each is `font-size: 0.8em; flex: 0 0 auto`; state
   is set in the song modal, or by the file for the two facets. A built-in's colour paints
   its Filter chip glyph (off *No*) and, for the marks, the Songs chip too; the heart and mic
   **toggles** (Home stage, song modal) keep their accent colours — they are controls, not
   tags. `.song-mark-wished` (blue `check`) is the wishlist tile's alone; rows never draw it.
5. **Icons over words.** Structure with `Icon` + layout; add a text label only where the icon is
   ambiguous. Never repeat a datum the surrounding view already shows (duration is in the
   preview player; artist is in the hero).
6. **`--highlight-red-light` is fill/border only** — as a glyph colour on `--bg` it is ~2.3:1.
   Failure text is `color: var(--color)` on `background-color: var(--highlight-red-dark)`.
7. **Reuse the shared classes** in `index.css`: `.button` / `.button-primary` /
   `.button-danger`, `.text-input[-quiet]`, `.icon-button[-bordered|-danger]`, `.error-notice`,
   `.section-note` (the 0.85em `--color-darker` line that explains an `h2` to the reader),
   `.delete-row` (the one `.button-danger` that ends a list or a form, centered 24px under
   it — the score panel's *Delete score*, the song editor's *Delete song*),
   `.chip[-on]` (§4), `.visually-hidden`, `.icon`, the global `:focus-visible` ring. Extend
   with a modifier class; never write a second bespoke 40×40 icon-button rule.
8. **No new dependencies** for UI (no icon library, no loader library, no CSS framework).
9. **Every animation has a `prefers-reduced-motion: reduce` branch.**
10. **Touch floors:** icon-only controls ≥ 40×40, list rows ≥ 44px tall. A labelled text field
    is neither (the quiet input is 36px).
11. **Nothing scrolls the page sideways** at 360px (`documentElement.scrollWidth ==
    clientWidth`). Long text truncates or clamps; unbreakable strings get `overflow-wrap:
    anywhere`.
12. **A row's hover state is for pointers.** Every hover that paints a row — the
    `--highlight-blue-dark` band, a lit label — sits inside `@media (hover: hover)`, because
    touch fakes a hover on tap that outlives the finger. Focus rings, `:active` and control
    hovers are untouched.
13. **Words follow the documentation guidelines.** Every string the app shows (labels,
    explaining lines, empty states, error sentences, setting names and descriptions, and
    confirm dialogs) obeys [documentation.md](documentation.md): American English, short
    sentences, no em-dashes, the terminology table. Section 11 there lists the three UI-only
    exceptions, and the labels that break the rules today.

## 2. Tokens, spacing, typography

Tokens live in `frontend/src/index.css` (dark-only, same values as the old app). Do not
introduce new tokens; compose with `color-mix(in srgb, …)` if a value is missing.

| Token | Use |
|---|---|
| `--bg` / `--footer-bg` | page background, repainted by sticky toolbars · bottom nav only |
| `--tile-bg` / `--input-bg` | whitelisted surfaces (rule 1.2) · inputs, buttons, chips, avatar/cover fallback, progress track |
| `--color` / `--color-dark` / `--color-darker` / `--color-darkerer` | primary text · secondary text and idle icon glyphs · meta/artist lines · disabled and off-state |
| `--highlight-blue-light` / `-dark` | active/selected accent, focus ring, stat icons, wished mark · hover/active fill, primary button |
| `--highlight-pink-light` / `-dark` | favorite heart, podium numerals, host accents · score-bar fill |
| `--highlight-red-light` / `-dark` · `--highlight-gold-light` | fill/border only · danger fill under white text · scores, trophies, "New Highscore", star fill |
| `--border-radius` (16px) / `--border-radius-small` (8px) | tiles, modals, buttons, inputs, chips · icon buttons, avatars, hover bands |
| `--input-border-color` | **all** hairline separators and input borders |

Spacing: page gutter 16px; section rhythm 16px; inner gaps 4/8/12/16px (icon cluster / default /
cover row / page blocks). Row separators: `border-bottom` + `:last-child { border-bottom: none
}` or `border-top` on `li + li` — never both. Hover bands bleed past the gutter: list `margin: 0
8px`, row padding `10px 8px` (rule 1.12). Typography: `h1` 1.5em centered (`margin: 32px 16px
16px`), left-aligned by `PageHeader` on sub-pages; `h2` 1em, `margin: 16px 16px 0`. Captions
0.85em in `--color-darker`; fine print 0.8em. Aligned or updating numbers:
`font-variant-numeric: tabular-nums`. Single-line text: `overflow: hidden; white-space: nowrap;
text-overflow: ellipsis` with `min-width: 0` on the flex parent; wrapping titles use a 2-line
clamp. **A box that clips — an ellipsis line, a line clamp — keeps `line-height` at 1.3 or
more:** the box is exactly its lines tall, so at 1 or 1.1 the descenders of y and g on the
last line are cut off (the host's music line, `LastSong`, `HostAchievements`); a
tight leading is for headings that overflow visibly, never for one under `overflow: hidden`. Bottom-nav destinations (`Songs`, `Scores`) show **no page heading** — the tab names
them, so their `h1` is `visually-hidden`; `Home` and `User` keep theirs.

## 3. Icons

`frontend/src/components/icons.tsx` is the only icon source. `Icon({ name, className })` renders
exactly one `<path d>` in a 24×24 viewBox with `fill: currentColor`; size comes from the
parent's `font-size` (`.icon` is 1em). `gradient` swaps that fill for a two-stop diagonal
gradient the caller colours with `stop-color` (`.playlist-spin` only). Read `ICON_PATHS` before
adding — `dice` is the five, `dice-1`…`dice-4` and `dice-6` the other faces. Never `heart` for a
wish (favorites own it), never `star` (the winner accent owns it), never a bare `check` as a
control glyph. `clock` is "Recent". **`tag` is the tags feature**: the song modal's action
bar, the Tags admin entry and its `ManageMenu` row, the tags empty state, the fallback for an
icon-less tag — so the song modal's fact line takes `music` for the genre instead.

Glyphs with a fixed meaning; the two playlist families lead, kept apart at a glance. What a tag
may wear is the picker's list below, never this table.

| Glyph | Means | Drawing note |
|---|---|---|
| `playlist-plus` / `playlist-check` · `list-plus` / `list` / `list-check` | wish off / wish on, `playlist-plus` also heading the wishlist · add to playlist / picker row not in it / already in it, `list` also the "Playlists" link | solid bars · bulleted rows |
| `filter` / `comment` / `drag-handle` / `copy` / `send` / `user-plus` | the Songs Filter chip and its panel · comments: the song modal's action bar, the sub-view, the empty state · reordering — the grip on a row and, on the Achievements admin, the header control that opens the mode · "Save a copy" of a playlist · submit in the comment composer · add a member, add a person to a tag | solid funnel, a wide bar tapering into a short stem · one rounded speech bubble, tail at the bottom left · six dots in two columns of three · two offset rounded squares, the front one solid · a paper plane, one triangle with the fold cut out · the `user` bust with a plus at its shoulder |
| `lock` / `bookmark` / `bookmark-off` / `eye` / `eye-off` / `layers` | kept back: a tag row nobody assigns here (no `assign`), an achievement that is hidden until it is earned — the masked badge and the mark on its admin row are one glyph — and a built-in achievement's conditions, which are Wingman's own · follow / unfollow a playlist, `bookmark-off` also labelling the collapsed *Hidden* group · a player who is shown / one who is hidden in the people admin, and a party in or out of the session picker's list — the pair reads the state, never the action — with `eye-off` alone also standing in for a Filter chip's glyph on *No* · the session picker's row for every session at once | padlock, solid body under a counter-wound shackle so the nonzero fill leaves the hole · ribbon with a notched foot · the same ribbon behind a diagonal bar · an almond outline around a pupil disc, the almond counter-wound so the white of the eye stays open · the same almond behind a diagonal bar · three stacked lozenges, the top one solid and the two beneath it thin bars |
| `archive` / `flame` / `moon` / `snowflake` / `gift` / `cake` / `child` | a tag for put-away songs, and the Achievements admin's *Import and export* heading — that section is about archive files · for party songs · for slow songs and ballads · tags for christmas: the winter half · presents · a tag for birthdays · for songs for kids | a lid bar over a box body, one notch in the lid · one teardrop tongue, notched at the foot · a crescent as one contour, the rim the long way round and back along the cutting circle — a cut-out cannot do it, the cutting disc has to reach past the rim · three crossed bars, a short fork at each of the six tips · a box under a lid bar, one ribbon band down the middle of the box and a two-petal bow on the lid · a slab on a plate, three candles · a round head over a body, arms out and legs apart, never `user` |
| `guitar` / `crown` / `film` / `gamepad` / `flag` / `skull` / `sun` / `umbrella` | a tag for rock · for the classics everybody knows · for movies and musicals · for game music · for a language or country, which the song modal's fact line takes for the language too · for hard to sing · tags for summer · for rainy songs | two bouts with a waist between them, sound hole cut out of the upper one, neck to the top right · three points over a solid band · an upright strip with a column of sprocket holes down each edge, `video` staying the camera · a lozenge, d-pad cross and two buttons cut out · a triangular pennant on a staff · a cranium over a jaw, the eye sockets and a nose cut out · a disc under eight detached tapered rays, nine subpaths, nothing cut out · a scalloped half-disc canopy over a stem that hooks left at the foot |
| `beer` / `car` / `plane` / `bolt` / `bell` / `ghost` / `ring` / `graduation-cap` | tags for drinking songs · for road songs · for holidays · for the loud fast ones · for new year · for halloween · for weddings · for school and graduation | a tankard under a three-lobe foam cap, the handle loop counter-wound · a cabin stepped onto a body over two wheel discs, the windows counter-wound · one outline — fuselage, swept wings, tailplane — nose to the top right · a single zigzag contour · a dome on a flared rim over a clapper disc · a dome over a three-lobe hem, the two eyes counter-wound · two concentric circles, the inner one counter-wound, a gem lozenge on top · a rhombus board on a trapezoid cap, a tassel cord down the right |
| `headphones` / `drum` / `piano` / `rocket` / `anchor` / `tree` / `paw` / `smile` | tags for songs to play rather than sing · for the drum-driven ones · for songs at the keys · for the night's openers · for sea shanties · for folk · for animal songs · for the funny ones | a headband arc, its inner edge counter-wound, and two capsule earcups · a cylinder between two overhanging rim bars, one three-V zigzag band counter-wound out of the shell · a keybed bar over five keys, the four black ones counter-wound out of it · a pointed body between two fins over a flame, the porthole counter-wound · a ring over a shank crossed by a stock, above one curved fluke bar, the ring's hole counter-wound · three stacked triangles on a short trunk · a pad disc under four toe discs, five subpaths, nothing cut out · a disc with two eyes and a crescent mouth counter-wound out of it |
| `hash` / `music` / `arrow-up` / `average` / `arrow-down` · `trophy` | sings, songs, best, average, worst, in that order: the host results' score summary (`ScoreSummary`) wears all but `music`, a song's history being one song, and its marker strip the last three; a party's figures on `/scores` (`SessionSummaryRow`) wear `hash` and `music`; the phones' score overview prints words, never these · the best score as a thing to open: the §5 action bar's button, never a number inside a score summary | two upright bars crossed by two horizontal ones · one contour, a note head under a flagged stem · one solid contour, a shaft behind a triangular head, and the same mirrored · a ring struck corner to corner by a bar · a cup between two handles over a stem and a foot bar. The reorder pair on a playlist or achievement row is `arrow-up` / `arrow-down` doing a job, not a second meaning. None of them is pickable — a number is not a thing a song is about — `music` excepted: it is in the picker already, meaning genre, and wears this second meaning only inside a summary; `trophy` stays out with `clock`, `globe`, `star` and `tag` |
| `pause` / `skip` / `volume` | the background music's transport on the player and in the host screen's overlay, and `volume` labelling the **Sound** settings group and the `music` permission group | two upright bars at `play`'s own height · `play` again with the bar it runs into · a speaker cone under two arcs. None of the three is pickable: pausing is not a thing a song is about, and `volume` is doing a job in the two places it labels, the way `tv` labels the Host group |
| `fullscreen` / `fullscreen-exit` | the host screen's full-screen control: enter, and while in full screen leave | four corner brackets at the edges of the square, corners pointing out · the same four with their corners pointing in towards the middle. Neither is pickable |
| `upload` / `download` | the Achievements admin's two archive buttons: one in, one out | `download` mirrored — the same shaft, arrowhead and tray bar, the arrow coming up out of the bar instead of down into it. Neither is pickable: an archive is not a thing a tag or an achievement is about |
| `trash` · `share` / `external-link` / `shuffle` | removing for everybody: an account or a player in the people admin, a comment, a song off the wishlist (the wishlist tile, the landed song on the Random song page in either mode), `close` staying the reader's own take-back · a picture to send: the party bar's button, *Share stats* (the glyph alone), `/user/stats`' *Share my stats*, the sing view's and the achievement modal's **Share**, the share panel's **Share** · a link that leaves Wingman: the song modal's *Open in a streaming service* button and every service behind it, and its USDB fine print · *Shuffle again* beside the Songs sort while it is *Random* | `trash` as drawn · three discs, one at the left middle and two at the right top and bottom, joined by two bars, never `upload`'s arrow out of a tray, which is the archive · a square outline open at its upper-right corner, an arrow leaving through the gap to the top right · two arrows running left to right, crossing once, heads at the right. None is pickable, and the dice never stand in for `shuffle`: they are the reel's |
| `log-out` | *Log out* on the user tile, the glyph alone | a door frame open to the right, one two-unit band with `external-link`'s rounded outside and square inside, and an arrow leaving through the opening, its shaft starting inside the frame and its solid triangular head out past it. Never `power`, which opens Ultrastar Deluxe. Not pickable |
| `card` | the player selector device: the *Player selector* entry of the manage menu, the admin page's device rows, and the `devices` permission group | a card lying on its side, 20 by 12 with a corner radius of 2, its chip counter-wound out of the upper left. Wider and rounder than `tv`'s case, and the chip sits off centre where a bank card carries one. Not pickable: a card is not a thing a song is about |
| `format-square` / `format-story` · `image` / `calendar` | the share panel's two formats, 1080×1080 and 1080×1920 · *Change your picture* on the user tile, and the panel's *Other singers' pictures* toggle / the year and decade facets, and the panel's *Party name and date* toggle — jobs there, not meanings (share-cards §5) | a rounded square outline 16 by 16, two units thick, its inside counter-wound · an upright outline 10 by 18 (the story's 9:16) with the same stroke and corner radius, so the pair reads as the two shapes of one picture. Neither format is pickable · `image` and `calendar` as drawn, `calendar` pickable for what a song is about |
| `brand-spotify` / `brand-applemusic` / `brand-youtubemusic` / `brand-tidal` / `brand-deezer` | the five services in *Open in a streaming service*, each before its name, never alone | from Simple Icons (CC0, no attribution): the 24×24 `d` string as published, checked under the nonzero rule `Icon` draws with — a hole that closes is re-wound, never given a `fill-rule`. Monochrome in the row's `--color-dark`, never the service's colour, which no token carries (§2); with `github` the only brand marks. None is pickable |
| `thumbs-up` / `hourglass` / `balloon` / `dumbbell` / `tv` | tags for the crowd-pleasers · for the long ones · for carnival · for the gym set · for series and anime — labelling the Host settings group and the Random song page's *Host screen* pill (§7) are jobs, not meanings | a fist block with the thumb up over a separate cuff bar · two triangles meeting at the waist between two cap bars · a teardrop bulb over a short zigzag string · a bar between two pairs of stacked plates · a rounded case, the screen counter-wound, on a stand bar |

The **icon picker** (tag editor) offers `PICKER_ICON_NAMES`, an allowlist in `icons.tsx` — the
glyphs that say something about a *song*, in this order: `users`, `alert`, `archive`,
`calendar`, `disc`, `user`, `video`, `music`, then every tag glyph of the rows above from
`flame` to `tv` in table order. A glyph whose job here means something else stays out (`clock`,
`globe`, `star`, `trophy`, `tag`), as do the dice, the control glyphs — `eye`, `eye-off` and
`layers` included — and the per-person marks `heart` / `mic`; `music` stays, meaning genre in
both places, and so do the other five facet glyphs; `tv` is in too — labelling a settings group
is a job, not a meaning. A tag may wear a glyph the picker does not offer: it draws like any
other and its editor keeps it chosen and choosable.
Adding an icon: append one `d` string to `ICON_PATHS` (several subpaths fine, cut-outs
counter-wound like `lock`'s; solid — no `fill-rule`, `stroke` or `<g>`) and name it in
`PICKER_ICON_NAMES` to make it pickable. Never inline an `<svg>` (`BottomNav` is the one
exception). Tests identify glyphs with `iconNames()` from `src/test/icons.ts`.

## 4. Buttons and controls

- **Buttons:** `.button` (flat, `--input-bg`), `.button-primary` (`--highlight-blue-dark`,
  and inside a panel modal — `.modal:not(.modal-bare)`, on `--tile-bg` —
  `color-mix(in srgb, var(--highlight-blue-light) 40%, var(--highlight-blue-dark))`, 7.3:1
  under white, because the dark blue is the tile within a shade and read as outlined only;
  the page-level ones, the login form's included, keep the dark blue), `.button-danger`;
  at most one primary per view (a bare modal whose one errand is a share, the sing view's
  and the achievement modal's, has none), and confirm dialogs put Cancel first, then
  primary/danger, both `flex: 1 1 0`. `.icon-button` = 40×40, transparent, `--color-dark` glyph,
  hover `--highlight-blue-dark` fill; `.icon-button-bordered` beside an input on the page
  background, `.icon-button-danger` for destructive, `.icon-button-text` the same box widened
  to a word or two after its glyph, for a control that must not outweigh the icon buttons
  beside it (the host corner's *Open Ultrastar Deluxe*, §7). Always `aria-label`, `title` on
  toolbar-level buttons.
- **The editor action row** (`components/EditorActions.tsx`) ends a full-page editor: one
  sticky row on `--bg` under a hairline `border-top`, carrying the view's one primary Save,
  one quiet 0.85em line, and the editor's other action — a danger Delete, a plain Reset — at
  the far end of that same line. It sits **inside** the `<form>` (Save is its submit) and
  sticks at `var(--bottom-nav-height)`, so it rides on the nav, counts the safe-area inset
  once, and settles into the flow at the true end of the form — nothing is ever hidden
  behind it. That term is **one token** (`index.css`), and `BottomNav.css` sets the nav's
  `height` from it, the caption's `line-height` declared, never measured (`normal` comes out
  of the font's metrics and differs per phone). Everything that reckons with the nav —
  `#root`'s bottom padding, this row, the scroll-margin under it — reads that one token. The
  page's focusables carry a `scroll-margin-bottom` clearing **the nav plus the row plus a
  control's own height** (a radio pill's focused box is its hidden input at the label's top
  edge). The quiet line says why Save will not go, that a press went nowhere and where the
  `role="alert"` sentence for it is, and *Saved* in `--highlight-blue-light` when one
  landed; that slot takes any write's acknowledgement (`savedLabel`, *"Reset — the shipped
  achievement is back."* for a reset).
- **Text inputs, loud and quiet:** `.text-input` (16px radius, `--input-bg`, ≥40px) is for the
  page's one main control (the Songs search); `.text-input-quiet` (36px, hairline, transparent)
  is everything else — settings fields, selects, filters, forms. At most one loud input per
  page. Quiet `<select>`s carry grouping/sorting (Scores), the song list's order (Songs), the
  reel's pool (Random song) and a member's access level.
- **Song controls** (`components/SongControls.css`), in the song modal and the Home stage: two
  48px `.song-control` flanks (favorite / wish; glyph `--color-darkerer` off, accent on, no
  fill) around a 72px unfilled `.song-control-lead` (blue play in the modal, pink stop on the
  stage over a sing), grid `1fr auto 1fr`. No filled play button. The stage's row for the
  *background* song has no lead: between the same two flanks sit the music's own 48px
  `.song-control-transport` glyphs (play/pause, skip) and the volume slider, as a flex row.
  **In the modal alone** each of the three carries a caption under its glyph, *Favorite*,
  *Sing*, *Wishlist*: the bottom nav's caption (12px on a declared 16px line), in
  `--color-darker` whatever the state (the glyph says the state), inside the button and
  `aria-hidden`, the `aria-label`s keeping the verb and the word — *Add to favorites* /
  *Remove from favorites*, *Sing*, *Add to wishlist* / *Remove from wishlist*. The cells end
  on one line (`align-items: end`), so the three captions share a baseline. The caption and
  its rules live in `SongDetails.tsx` / `.css`; `SongControls.css` stays the two rows' shared
  geometry, and the Home stage's fixed 200px tile never draws one.
- **The one slider** is `.range-input` (`index.css`): the background music's volume on the
  player, the master volume in the host screen's overlay (§7, its width
  `clamp(120px, 14vw, 240px)`) and the four **Sound** volumes. `accent-color: var(--highlight-blue-light)` paints
  the track and the thumb — the token the permission checkboxes already use — so there is no
  per-browser pseudo-element stack to keep in step; the box is 40px for §1.10 even though the
  track inside it is 4px, because a finger aims at the control and not at the line. A volume
  row prints its number (`.setting-volume-value`, tabular): a bare track says nothing a reader
  could repeat.
- **Segmented / pill choices** (the tag editor's colour pills): a `.visually-hidden` radio in a
  `<label>` plus a visible `<span>`; checked = `--highlight-blue-dark` fill,
  `--highlight-blue-light` border/text; focus via `input:focus-visible ~ span`. For 2–4
  exclusive options that must all stay visible. **`CheckOption`** is for the few places where a
  handful of options all fit on screen — download-panel filters, video-quality presets; dense
  matrices of them (permissions, tag flags, settings toggles) keep native checkboxes.
- **The filter chip** is the Filter panel's one control, a criterion per chip in a wrapping
  cloud (`flex-wrap`, 8px gaps). It is the Songs chip row's box, lifted into `index.css` as
  `.chip` / `.chip-on` so both draw one rule: 40px, `--input-bg`, hairline, `--border-radius`,
  `padding: 0 14px`, 0.9em, 6px gap, `max-width: 100%` with the name ellipsed; inside it the
  glyph (1.15em, tag colour, neutral for a valued facet) · the name. Unlike other control
  hovers (§1.12) its hover fill sits in `@media (hover: hover)`: it is the pressed fill. A
  mark, a tag and a boolean facet are a `<button>` that cycles **Any → Yes → No → Any** from
  wherever it stands (a tap, Enter or Space), so a `hide_by_default` tag, which opens on *No*,
  comes back on its first tap. *Any* is the resting chip, *Yes* the pressed one (`.chip-on`),
  *No* the chip without its fill (hairline kept), the name struck through in `--color-darker`
  and the glyph swapped for `eye-off` in `--color-dark`, so the default a hidden tag opens on
  reads as hidden at a glance and the chip keeps its width through the cycle — one that grew
  could wrap from under the finger. The state is a `visually-hidden` *Any* / *Yes* / *No* in
  the button's name, never `aria-pressed`, whose true and false cannot say *No*. One
  `.section-note` heads the panel: *Tap once for only these songs, twice to leave them out.*
  A **valued facet** is the same box holding its glyph, a span with the facet's name — or the
  chosen value — and a trailing `chevron-down`, under a bare `<select>` laid over the whole
  box (`position: absolute; inset: 0; opacity: 0`, `aria-label` the facet's name), so a tap
  anywhere opens the native list and the chip is as wide as its text, never its longest
  option. The list's first option is the facet's name and means *Any*; a chosen value presses
  the chip. One value per facet. The ring goes on the chip (`.chip:has(:focus-visible)`); the
  colour transitions have a reduced-motion branch.
- **Tag chrome:** four colours — neutral `--color-dark`, blue `--highlight-blue-light`, pink
  `--highlight-pink-light`, gold `--highlight-gold-light`; never red (§1.6). The colour paints
  the tag's glyph wherever it appears. A tag or playlist row leads with a 40px square
  (`--input-bg`, `--border-radius-small`, glyph 1.25em): `--color-darker` for a playlist, the
  tag's colour for a tag.
- **Matrices, grids and people rows.** A permission matrix copies `RolePermissions`:
  `.perm-head` and `.perm-row` share the columns `minmax(0, 1fr) repeat(var(--perm-roles, 3),
  44px)`, `.perm-head` is sticky, `.perm-cell` holds a native checkbox (`accent-color:
  var(--highlight-blue-light)`), admin sits in `.perm-hint`, not a column. The icon picker is
  40×40 `.icon-button`s in `repeat(auto-fill, minmax(40px, 1fr))`, `aria-pressed` on the chosen
  one, first cell "no icon" (`close`); its glyphs sit idle in `--color-dark` and the chosen cell
  repeats the 40px tag square above — `--input-bg` fill under the tag's colour, the "no icon"
  cell keeping `--color-dark`. A people row is a 40px `PlayerAvatar`, the username and one
  trailing control (quiet `<select>` for access, `.icon-button-danger` `close` to remove): 48px
  min-height, hairline separators, list `margin: 0 8px`, 8px padding. Search by username.
- **The gradient dice** (`.home-random`, `.spinner-spin`, `.playlist-spin`): the blue→pink sweep
  with the `dice` glyph marks the way into the slot machine and the SPIN action, nothing else —
  the Home entry (`.home-random`) and `SpinButton` (`.spinner-spin`, `components/SpinButton.tsx`,
  `useDieRoll` inside it) carry it as a fill — the latter on the Random song page and the
  playlist reel, reading *Spin*, *Show it* or *Spin again* (§7) — and they are the only
  gradient buttons in the app; the playlist header's icon-only link carries it on the glyph.
  On SPIN, and on the phone for as long as the TV's reel runs, the die tumbles through its
  faces.
- **The icon toggle** (`.icon-button.icon-toggle`, a new modifier `index.css` gains with the
  share panel, keeping the icon button's box and fill and adding only the states; its hover
  fill is a pointer's alone, in `@media (hover: hover)` as the chip's, because a phone keeps
  `:hover` on the toggle it tapped and the blue fill read as a second "on") is a `<button aria-pressed>`
  whose glyph is the thing it puts on or leaves off: on, the glyph in `--color`; off, the glyph in
  `--color-darkerer` under one 2px bar in `currentColor` from its lower left to its upper
  right, the way `eye-off`'s runs (a `::after`, so no toggle needs an `-off` twin in
  `ICON_PATHS`); a toggle that cannot
  act here keeps its state's drawing at 40% opacity under `aria-disabled` — the glyph and
  the bar, never the button, whose focus ring would fade with it — and stays focusable. Its name is the option's (`aria-label` and `title`), never the action. The share
  panel's options row (share-cards §5) is its first user; `eye` / `eye-off` stay glyphs,
  reading a state that is not an option.
- **`Loading`** (`components/Loading.tsx`) is the only loading indicator — every `Suspense`
  fallback and `isPending` branch uses it. `SongSpinner` is the reel, not a loader.

## 5. Modals

`components/Modal.tsx` props: `title` (accessible name), `onClose`, `fullscreen`, `hideTitle`,
`bare`, `headerAction` — **one** control beside the close, and the only thing a panel header
carries besides its heading and that close. It is for a control that changes what the whole
panel holds (the party picker's *show all*), never for a row's own action.

- **Bare modal** (`bare` + `hideTitle`: `.modal-bare` on `.modal-backdrop-blur`) — the song
  modal (`SongDetails`), its sub-views, the achievement modal (`AchievementModal`, its own
  bullet below), the sing view and the share panel (share-cards §8, §5): whatever shows a
  picture rather than a form.
  The song modal (what a song row and the Home stage's cover open), by weight, in **two bands of controls**
  and no list of labelled rows: the hero (`.song-hero`: cover, title 1.15em, artist 0.85em `--color-darker`)
  and its fact line → optional preview `<audio>` → the song controls row (§4), Sing its one primary → the
  action bar → the fine print. Sub-view rows are `.song-option` (44px, hairline `border-top`, icon, label, chevron).
- **The fact line** (`.song-facts`), 8px under the artist, is the details as data: a centred
  `flex-wrap` line, 12px apart, each fact a glyph (1em, `--color-darker`) beside its value (0.85em
  `--color-dark`) and a `visually-hidden` name: `flag` language, `music` genre, `calendar` year,
  `disc` edition. A value longer than 11em (about 150px) is cut short with an ellipsis (§1.11),
  its whole self in the fact's `title`, so one long genre or edition cannot take a line of its
  own; a long genre and a long edition together still fit two lines at 360px. No value, no fact (never "unknown"), no duration (§1.5). For `songs.edit` or
  `songs.delete` it ends in a 40px `pencil` `.icon-button`, *Edit details*; with neither it is not
  drawn. An 8px negative margin keeps the pencil from making its line 40px tall, and the line's
  rows are 8px apart (`row-gap`), so on a line of two its box lands in the gap and never on the
  facts above or below it. The **fine print** ends the modal 16px under the action bar: one centred 0.8em
  `--color-darker` line, creator and source, "Made by DrFrank · usdb:24435", a missing half
  dropped with its dot, `overflow-wrap: anywhere`. For a song whose id is `usdb:N` the whole
  line is one plain `<a>` to `https://usdb.animux.de/index.php?link=detail&id=N`
  (`target="_blank" rel="noopener noreferrer"`), the line's own colour with an underline on
  hover, ending in an `external-link` at 1em — the streaming rows' mark for a link that
  leaves — and a 40px tall box for the finger; the address is a constant beside
  `SONG_SOURCES` in `songSources.ts`, never the backend's `usdb.base_url`. Any other source is
  the plain line.
- **The action bar** (`.song-actions`): one centred flat row under a hairline `border-top`,
  `margin: 0 16px`, wrapping, `align-items: center`, and **monochrome**: every glyph and every
  number in `--color-dark`, the `.icon-button`'s own idle glyph, so the counts match the
  errands and nothing in the bar outweighs the three controls above it (`--color` would, and
  so would a gold trophy or blue glyphs). First the counts, each a 64×56 button,
  glyph (1.4em) over number (0.85em), opening what it counts — `trophy` with the best
  score, `tag` with the tags this reader sees, `comment` with the comments — then, 16px on, the
  errands as 40px `.icon-button`s: `list-plus` *Add to playlist* (`playlists.manage`, with an
  account), `external-link` *Open in a streaming service* (everybody). Each has `aria-label`
  and `title`, a count's with its number ("Comments, 3"). `trophy` needs a score (and
  `stats.history`); `tag` and `comment` stand at zero, the first tag or comment being what they
  lead to, and `tag` goes only when the reader may neither see nor set a single tag.
- **Sub-views** replace the modal body, the header's close acting as back: Best scores, Add to
  playlist, Open in a streaming service, Tags, Comments, Edit details, Player selection, and Add
  songs (same mechanism, from the playlist page), each opened by the button that names it.
  **Open in a streaming service**'s sub-view is one `.song-option` per service, Spotify,
  Apple Music, YouTube Music, Tidal, Deezer, its `brand-*` mark (§3; a pasted path is no dependency, §1.8) before the name and a trailing
  `external-link` where a chevron would promise a view inside: each a plain `<a>` to the service's search
  for title and artist, `target="_blank" rel="noopener noreferrer"`, with no note over them. Inside
  Tags, an assignable tag is a toggle row (`aria-pressed`), any other — one nobody assigns here
  — a `lock` row. **Add to playlist** gives `playlists.manage` holders one `aria-pressed` row
  per playlist they may edit (state from the listing's `contains` flag, not a fetch per row) and
  a "New playlist…" row (`plus`). **Edit details** (the fact line's `pencil`) is the one place
  a song is changed at all — everything the party's helpers do to it, in one errand rather than
  a row each. It carries the details as labelled quiet inputs in their own order — title,
  artist, Language, Genre, Year, Edition — one primary Save, `.song-details-notice` for what the
  backend refused, and at the foot, held off the form's rhythm, a `.button-danger` **Delete
  song** (`songs.delete`) through a `ConfirmModal` that names the song and says the files go
  with it. Nothing on the way there is red (§1.6). The pencil appears for `songs.edit` or
  `songs.delete`; a reader holding only the second finds the fields disabled over the line
  saying why and the button live, an editor nobody may edit being the rarer half of a pair the
  permission matrix allows and not worth a second button.
- **Comment rows**, oldest first: 40px `PlayerAvatar` · username with a relative time (0.85em
  `--color-darker`) on one line · the body underneath, `overflow-wrap: anywhere` · a trailing
  `.icon-button-danger` `trash` for the author and `comments.moderate`, through `ConfirmModal`
  (`danger`). The composer at the foot: a quiet `<textarea>` (2 rows) and a 40px `send`
  `.icon-button`, disabled while empty. Reading needs only `songs.view`; a reader without
  `comments.write` gets one line naming who may write in the composer's place.
- **One achievement, large** — what a badge on the user page opens — is bare too: a picture
  wants the page behind it darkened and blurred, not a tile drawn around it. In order: the
  badge at the song hero's cover size (200px, `max-width: 60vw`), asking the icon endpoint for
  `?size=full` through a prop naming the picture's **resolution** — never its size on screen,
  which stays the parent's `font-size` (§3); the name at 1.15em; the description at 0.9em in
  `--color-dark`; then, 16px under it and set apart as facts by that gap and the step down (no
  hairline), the meta group, 4px between lines, each 0.8em `--color-darker`, tabular: how many
  players hold it — *Earned by 3 players*, *Earned by 1 player*, *Nobody has earned this yet*,
  a line only the modal carries (§1.3) — then the row's own line, "Earned 12 Aug 2026", or the
  progress bar over its "7 / 10" (8px under). A **masked** one shows the `lock` badge over the stand-in
  name and sentence and no bar and no holders line at all: a modal is a bigger place to say the same nothing,
  never a way around the masking. One with **no picture** shows its glyph plate at that same
  size — a glyph badge across half the screen is still the badge. What opens it is a
  `<button>` named after the achievement, the badge itself being `aria-hidden`, at §1.10's
  touch floor — in the list and on the summary strip alike, where the press that opens the
  modal must not also toggle the `<details>` it sits in. For an achievement the reader's own
  player has earned it ends in one `.button` *Share* (`share`), 16px under the meta group, its
  one control (share-cards §10). It closes like any modal: the backdrop, Escape, its own close.
- **Panel modal** (default): `--tile-bg`, `--border-radius`, sticky header with `h2` + close.
  Confirmations, pickers, admin dialogs, the download queue, and the two panels **Filter**
  (footer Reset `.button` then Done `.button-primary`, both `flex: 1 1 0`) and **New playlist**
  (name, optional description, one "Global" checkbox). The **"Add songs from…" picker** is one
  too: a grid of source cards (`repeat(auto-fit, minmax(140px, 1fr))`, `--tile-bg`, icon ~48px,
  name, one-line description) — the sanctioned tile use, and the cards must read as buttons.
- **Fullscreen** is the player selection and nothing else: a head, the slots, and a foot of
  `.button`s with one primary, over `useSelectionLock`. A spin on the host screen holds the
  same lock without a modal — the Random song page is its view (§7) — and Play (or the song
  modal's Sing there) hands it to this one. A fullscreen modal that holds no lock is a §6 route. A backdrop click closes any modal; Escape and the Tab
  trap belong to the topmost one alone (`Modal` keeps a stack), and closing restores the
  opener's focus. **Confirmations always use `ConfirmModal`** (`window.confirm` is banned):
  title, one-sentence consequence, `confirmLabel`, `danger` for stop/delete/replace.

## 6. Sub-pages and navigation

Full-page sub-views are **routes**, not modals: `<PageHeader title="…" back="/parent">`
(page-level controls as `children`, never a second row), content, and — when capability-gated —
`auth.loaded && auth.can(...)` with a `<p className="settings-notice">` fallback saying who may
do it. Back is a `<Link>` to a fixed path (`backLink.ts` resolves a state-provided target), not
`history.back()`. Every new route is registered in `App.tsx` **and** in `COVERS`
(`BottomNav.tsx`) so the owning tab stays lit; `/host*` renders no bottom nav.

**A page opened starts at the top of itself.** `App.tsx`'s `ScrollToTop` does it once for
the whole app on every PUSH navigation, so no page scrolls itself on entry. POP is left
alone — the offset a reader had in a list is exactly what going back should restore — and so
is REPLACE, one page standing in for another (an editor swapping `/new` for the id it just
saved) where a jump to the top would throw away the place they were working in.

## 7. Page conventions

- **Song list rows** (`SongListItem`): 40×40 cover, title + passive marks, artist in
  `--color-darker`; the row opens the song modal. **Album covers are square** except the spinner
  reel frame; `PlayerAvatar` is `--border-radius-small` (people, not covers), the 88px identity
  avatar included. Sizes: 40px in rows, 200px (`max-width: 60vw`) in the modal hero, 88px on Home,
  `min(42vh, 30vw)` on the host; the fallback is the initial letter on `--input-bg`.
- **Home** is `HomeStage`, the player: one tile, three modes, **one control row**, and
  **one height** — 200px: 16 of padding, an 88px head, 8, and the 72px the sing's lead needs;
  the music mode's 48px row and the idle brand block centre in that second track. A song being
  sung, the background song between them, and the brand while neither. Every text row carries
  a *declared* px `line-height` — `normal` comes out of the font's metrics (§4), so a head
  that measured itself would be one height on Windows and another on every phone. The art is
  88px: the cover, or `SongReel`'s own `LogoTile` without its black plate when idle, centred
  over the brand name. The text column is centred beside the art and reserves nothing: a
  one-line title sits with its artist under it, a two-line one (clamped) fills the head. Home exposes exactly one heading throughout: the eyebrow *Now playing* over a
  sing, a visually hidden *Background music* for the background song (the row says what it
  is), the brand line when idle. Over a sing the row is the song modal's heart / pink Stop /
  wish; for the background song the same two marks flank the music's own transport —
  play/pause, skip, the volume slider — and there is **no blue Sing**: singing the background
  song is tapping its cover into the song modal, the one sing path. The gear sits top-right in
  every mode, out of every row, because a host who switched the music off needs a way back
  in. **No progress or time for a sing** on phones, as before; the background song gets both,
  because nothing else in the room shows them. A reader without `music.view` is told the hint
  alone, never *Nothing is playing*: they cannot know. Then the setup banner → wishlist → the
  Random song entry.
- **Songs** puts the page's one loud input in its sticky toolbar: the `search` glyph, the field,
  and a trailing `close` `.icon-button` that clears it, drawn only while something is typed and
  suppressing the WebKit search field's own cancel button so there is never a second X. Under it
  the chip row All · Favorites · Recent · Sung · **Filter** · the playlists link. All keeps its
  label, owning no glyph; every other chip is its glyph alone until pressed. Filter reads
  "Filter · N" pressed, N being the criteria off *Any*. The chips are presets over
  that state: Favorites and Sung set exactly their own criterion to *Yes*, All returns to the
  defaults, Filter lights for anything else. Recent is its own exclusive mode (a time-ordered
  list, not a criterion); the criteria still apply inside it. A `hide_by_default` tag keeps its
  songs out of the list and the reel while its criterion sits on *No*; that default is all the
  reel reads — no choice made in the panel, tag or facet, reaches it. The **Filter panel** is
  its one hint line over two clouds of the filter chips of §4, each a `role="group"` named
  *Built-in* / *Tags* and the second under a hairline and 16px, with no visible heading: the
  glyphs say which is which. The first holds Favorites (`heart`), Sung (`mic`), then the facets
  shown in the filter in *Built-in* order; the second every visible tag, in the listing's
  order. Twenty tags are a few lines of chips, never twenty rows, so the panel has no search
  and no fold; past the screen the modal body scrolls under its sticky header. A valued
  facet's list is its name for *Any*, then the distinct values of the songs the reader may
  see, sorted, *Decade* bucketed from the year and labelled "1980s". A song without the value
  matches *Any* alone: no "No year" option, a gap in the metadata is not a decade. A facet off
  *Any* counts towards "Filter · N" like a tag. The list behind follows every change at once,
  Done only closes; Reset puts every chip back on its default, a `hide_by_default` tag on *No*.
  **The order** is one quiet `<select>` in the count row under the chips, no word beside it
  (`aria-label="Sort"`): the count (0.85em `--color-darker`), the select (`min-width: 0`),
  *Shuffle again* while *Random*, rescan, and add at the far end, 8px apart — never in the
  sticky toolbar. Options, in the USDB page's words: *Artist A to Z* (default), *Title A to Z*,
  *Year, newest first*, *Year, oldest first* (no year last either way), *Recently added* (first
  found by the library, read to the second), *Random*; ties fall to artist, then title.
  *Random* holds its shuffle through refetches, wishes and filters, and a `shuffle`
  `.icon-button` (*Shuffle again*) stands beside it. Not drawn in Recent mode. Kept per device
  (`localStorage` in try/catch); a kept *Random* shuffles anew on entry.
- **Playlists** (`/songs/playlists`): flat `h2` groups — *Your playlists*, *Shared with you*,
  *Global* — then a collapsed `<details>` *Hidden* for unfollowed shared lists, rendered only
  when it has rows; global lists never hide. A row is a 40px cover mosaic (2×2 of the first
  covers; one cover fills the box, none falls back to the `list` glyph square), the name with a
  passive `globe` mark when global, a meta line "12 songs · 48 min · by alice" (the owner named
  outside *Your playlists*) and a chevron. The header `+` opens the New playlist panel and
  navigates into what it creates. No edit or delete control on a row — management lives behind
  the detail page's gear. One `EmptyState` for the page, not one per group.
- **Playlist** (`/songs/playlists/:id`): `PageHeader` with the name, `back` to the list,
  trailing the gradient dice and, for `can_manage`, a `gear` into the manage page. Then a
  summary line (description; "12 songs · 48 min · Global · shared by alice · your access") and
  an action row of at most three `.icon-button-bordered`s: **Add songs** (`list-plus`,
  `can_edit`), **Edit** (`pencil`, `can_edit`), **Follow/Unfollow** (`bookmark` /
  `bookmark-off`, members only). Edit mode makes each song row a reorder row — `drag-handle` for
  the pointer, `arrow-up` / `arrow-down` for the keyboard (both write the same order), `close`
  to remove — and moves nothing else. **The focus goes back to the arrow that was pressed**
  once the answer lands, or to the row's other arrow where the move used that one up, and a
  refused order puts it back the same way: the achievements admin's rule below, out of the
  same `useReorderFocus` hook and written out there once.
  "Save a copy" (`copy`), for `playlists.manage` holders, is
  a text row at the foot, not a fourth icon; song rows are `SongListItem`s. **Manage**
  (`/songs/playlists/:id/manage`) is a §6 sub-page gated on `can_manage`: Name and Description
  as quiet inputs, one "Global — everyone can see it" checkbox, the Members people-rows under a
  quiet "Add people" search, one primary Save, and Delete (`.button-danger` + `ConfirmModal`) at
  the foot.
- **Random song** (`/spinner`, and the playlist reel): what the reel may land on is one quiet
  `<select>` labelled *Pick from* — All songs, Favorites, Wishlist, Wishlist (weighted) — over
  the pool caption, never a bank of pills. An empty option is `disabled`; a playlist's reel
  drops the select and keeps the caption. Only *All songs* is filtered by the
  `hide_by_default` tags: a favorite, a wish and a playlist are the reader's own choice.
  **Where the reel runs** is the column's first row: §4's pills, *This screen* · *Host
  screen* (`tv` before the word), centred, drawn for `karaoke.sing` and absent otherwise,
  which is *This screen*. Kept per device (`spinTarget.ts`); a kept *Host screen* opens
  nothing on entry — the first SPIN takes the room's selection, never the page. Both modes
  are **one layout**: the pills, *Pick from* and the pool caption, the
  reel window, the result, and **one action row** — SPIN (`flex: 1`, the one primary) and, 8px
  beside it for `karaoke.sing`, *Play* (`.button` at SPIN's height, `play` in
  `--highlight-blue-light` before the word), off until a song has landed. **The landed song
  opens the song modal in both modes**, so it can be favorited or wished for: the settled
  cover (`SongReel`'s `onOpen`) and the words, the `.spinner-winner` button (title over
  artist) in the result's middle cell — one action, the window and the words its two
  doors, as on Home's stage. **This screen** is the reel on the phone; Play opens the player
  selection over the landed song, the song modal's Sing by another door. SPIN reads *Spin*,
  and **Show it while the reel runs**: a press lands the reel at once on the winner already
  drawn (`SongReel`'s `settled` turning true mid-spin, so `onSettled` fires and the die stops
  with it). For the first `SHOW_IT_DELAY_MS` (500 ms) of the spin it is **held** — lit
  (`spinning`, busy, not off), `aria-disabled` and ignoring the press, never `disabled`, which
  would throw a keyboard's focus off the button the moment it spun — so the second tap of a
  double tap on SPIN is one spin and not a spin and a landing, while a deliberate press, which
  comes once the covers are seen to move, lands it; after that it is live, never
  busy-disabled. *Pick from* and the pills stay off
  until it has landed, and under reduced motion, landing in the press that spun it, *Show it*
  is never painted.
  **Host screen** is the room's one selection (`useSelectionLock`
  inside `hooks/useHostSpin.ts`, the page's own hook): the window stands on the reel's empty
  `LogoTile` — the reel is the TV's alone — until the TV lands (`spun_at + REVEAL_MS`, or
  `spin.revealed`), then the cover settled at once; the result slot says *Spinning on the
  host screen…* (`role="status"`) meanwhile. The window takes `onOpen` and the words become
  the `.spinner-winner` button **only from the landing on**, never over the logo tile. While
  this phone holds the spin, the song modal it opens is handed `onSing` (an optional
  `SongDetails` prop, `null` drawing Sing `disabled`): its Sing closes the modal and does what
  Play does — `/pick`, then the hand-over — never a second selection, which this phone's own
  lock would answer with a take-over of itself. It is live while Play is and the held song is
  the modal's, so a respin from the room (the selector's start) turns it off rather than
  singing another song; once the page holds nothing the modal is the ordinary one. SPIN reads
  *Spin* (opens the selection with `spin` and `playerSlots.ts`' remembered slots, the die
  tumbling and SPIN busy until the answer lands), *Show it* while the TV spins, *Spin again*
  after; Play is `/pick`, then the player selection adopts the selection, and once that closes
  — sung or given up — the page holds nothing: the words stay (still the button), SPIN reads
  *Spin*, Play is off. A pool changed under a held one waits for the next press. The
  other states are one 0.85em `--color-dark` sentence in the result slot, SPIN reading *Spin*
  (a press tries again): somebody else picking (*Somebody is picking singers for <title>.*,
  Play's place a `.button` *Take over* through a danger `ConfirmModal`), an empty pool
  (`emptyPoolLine`; on *Spin again* the landed song stays and the sentence is the notice
  below), the selection taken or expired (*Somebody else took over the selection.*). Any other
  refusal is one `.error-notice` over the action row, the state under it unchanged. **One
  way out, and no close or Cancel**: the pills back on *This screen* give the room back (the
  lock's `keepalive` DELETE) and the TV returns to its stage; leaving the page or the tab
  does the same.
  ```
   390px  This screen, landed             Host screen, the TV spinning
     [This screen][tv Host screen]       [This screen][tv Host screen]
       Pick from [All songs     v]         Pick from [All songs     v]
              1,234 songs                         1,234 songs
          +----------------+                  +----------------+
          |   the cover    |                  |  the logo tile |
          +----------------+                  +----------------+
            Bohemian Rhapsody          Spinning on the host screen...
                 Queen      [trash]     (the trash: wishlist pools only)
     [ (die)    SPIN    ] [> Play]       [ (die)  SHOW IT  ] [> Play]
     (SHOW IT while its reel runs)       (landed: cover and words open the modal)
  ```
  **A wish comes off beside the song**: the result is a `40px 1fr 40px` grid, the song (the
  `.spinner-winner` button, in both modes) the middle cell and the
  take-off its sibling, never inside it. On the two wishlist pools, once the reel has landed on
  a song still wished for (on the TV's, `spin.scope` and revealed), `wishlist.manage` puts the
  wishlist tile's `trash` `.icon-button-bordered` in the right cell (*Take <title> off the
  wishlist for everybody*, no confirmation). Pressed, it goes, the result stays and the caption
  follows the smaller pool. Never on a playlist's reel. Files: `SongSpinner.tsx` + `.css` +
  `.test.tsx`, `hooks/useHostSpin.ts`, `SongDetails.tsx` (+ test, the `onSing` prop),
  `SpinButton.tsx` untouched.
- **Tags admin** (`/user/tags`, a `ManageMenu` entry gated on `tags.manage`): rows of the 40px
  coloured glyph square, the name, a meta line "N songs · hidden by default · shown in list" and
  a chevron; the header `+` opens `/user/tags/new`. Under them an `h2` *Built-in* over eight
  fixed rows in the same shape, after the rows `+` and Delete govern: the per-person marks
  *Favorites* (`heart`) and *Sung* (`mic`), meta "per person · shown in list"; the boolean
  facets *Duet* (`users`) and *Video* (`video`), meta "from the file · shown in list · in
  filter"; the valued facets *Genre* (`music`), *Language* (`flag`), *Edition* (`disc`) and
  *Decade* (`calendar`), meta "from the file · in filter". The kind leads so no line is empty
  and what is off is dropped; never a song count — a mark's differs per reader, a facet's is
  one number per value. A valued facet's square is neutral: no colour to set. *Recent* is a
  mode, not a tag, and has no row. The **tag editor** (`/user/tags/:id`) runs in one order: Name
  (quiet input), Icon (the picker grid), Color (radio pills), the checkboxes "Show in song
  list" and "Hide songs by default", each with a one-line explanation of its effect on other
  people, the permission matrix (rows *See tag* / *See songs* / *Tag songs* × columns Guest /
  User / Trusted, admin always on), then "Specific people" — people-rows with the same three
  checkboxes. Save is the page's one primary and, with the danger Delete an existing tag has —
  whose `ConfirmModal` says how many songs lose it — rides in the sticky action row of §4. A **built-in** opens that editor on a reserved id
  (`/user/tags/favorites`, `/user/tags/duet`, …) — one row idiom, one editor, and a 32-hex tag
  id cannot collide with a word. A mark keeps Color and "Show in song list" (`heart` pink,
  `mic` blue, both shown in the list by default); a boolean facet those two plus "Show in
  filter" (neutral, off the rows, in the filter); a valued facet "Show in filter" alone, on by
  default too. Every checkbox keeps its explaining line, Save is the usual one, and one line
  says why the rest is gone: no name, icon, hiding, permissions, people or Delete.
- **Achievements admin** (`/user/achievements`, a `ManageMenu` entry gated on
  `achievements.manage`): the three private settings at the head — no glyph on any of them,
  the Settings page's own idiom being one icon per group and none per field — then the
  whole catalogue as **one list** — the party's own achievements and the thirty-five Wingman
  ships in one sequence — as rows of the `AchievementBadge` square, the name over the
  achievement's own description and a chevron, and an `h2` *Import and export* at the foot,
  carrying `archive` the way a Settings group's header carries a glyph, its two buttons
  leading with `upload` and `download` — the pair is what says which way each goes. There is
  no *Included* heading and no second list, so `gift` is a tag's glyph again: what tells a
  shipped achievement apart is the word on its own row.
  A row says the name and the description and then only what is unusual: `lock` on the title
  line for one that is hidden until it is earned (the glyph its masked badge wears, so one
  achievement wears one glyph everywhere), a quiet 0.8em *Included* after it for one Wingman
  ships — a word, never a chip — and, for a switched-off one, the whole row in
  `--color-darkerer` with the badge on its own off plate and a `visually-hidden` word,
  because a state is never a colour alone. Never a count of conditions: what an achievement
  asks for is read in the editor, not compared between rows. A row with no description draws
  no second line at all. The header carries `+` into `/user/achievements/new` and, before
  it, an `aria-pressed` `drag-handle` into **reorder mode**: the playlist's idiom on this
  page's own rows — a grip in front of each row for the pointer and an `arrow-up` /
  `arrow-down` pair behind it for the keyboard, both beside the link and never inside it,
  one `.section-note` saying what the order is for, and one `PUT /achievements/order` per
  gesture carrying the whole catalogue. **One gesture at a time:** while that request is in
  flight the arrows are `disabled` and the grip (`aria-hidden` scenery, never dimmed) starts
  no drag — two orders from one list can land in either sequence. **The focus goes back to
  the arrow that was pressed** once the answer lands, or to the row's other arrow where the
  move used that one up (the row moved and its arrows were disabled meanwhile, and neither
  keeps the focus), so arranging by keyboard is a run of presses — the playlist's edit mode
  shares the `useReorderFocus` hook; a refused order puts the focus back the same way. The
  order is **one order over the whole catalogue**, sent exactly as drawn, a party's own
  achievement above a shipped one included: the order every badge surface lists in and the
  export picker offers. A refused order puts the rows back where the server still has them
  and says so; one that no longer fits the catalogue says somebody else changed it and asks
  for it again. Resetting a built-in leaves its place alone: the order is the host's. The
  **achievement editor** (`/user/achievements/:achievementId`) runs in the tag editor's
  order: Name and Description (quiet inputs), Icon — the picker grid *or* the uploaded
  picture, never both, and an upload needs a saved achievement — Color (radio pills),
  *Hidden until earned* and *Enabled* each with its explaining line, then Conditions as one
  flat `ConditionBuilder` block apiece, every block headed by the plain sentence it means, and
  §4's sticky action row — Save gated on `conditionProblem` (the row's line saying which of the
  reasons is keeping it shut) with the danger Delete beside it. Inside a condition,
  *Songs matching* reads as the list it is: the *All of them / Any of them* select is the
  list's header, on the block's own gutter above the list's hairline, and each rule under it
  is a group — *Rule 2* with the way off it on a head line of its own, the field, the test and
  the value beneath, the lot indented behind a hairline rail, 8px inside a rule and 16px
  between them, so no rule ever reads as the next one's. A **built-in** keeps all
  of that except its conditions: they are Wingman's own, so the builder is drawn **locked** —
  heading, sentence, a `lock` glyph where the remove button stands, no control at all — with
  one quiet `.section-note` line saying why: a form must say "you may not" before the press,
  never as a refusal after it. In the action row Delete gives way to a plain `.button`
  **Reset achievement** (`refresh`; never `.button-danger`, a reset restores) whose
  `ConfirmModal` is `danger` (§5: a replace) and names what comes back; the line saying what
  a built-in is ends the form above the row.
- **Scores** opens on the session bar: the session's name and a `chevron-right` in one wide flat
  button, the rename `pencil` (`stats.manage`) beside it, and last, for a single party with
  scores, one `.icon-button-bordered` `share` (*Share this party*): on the bar, never in the
  picker panel's header, whose one `headerAction` (§5) is the show-all eye. The head row has
  none, a card being one evening, and the rename form has none. The name's button opens a panel modal, never
  a `<select>` — a party is more than its name: one row per session, `aria-pressed` on the
  current one, the name (or its date when unnamed) over a meta line "12 Aug 2026 · 5 singers ·
  23 scores", and at the head one row for everything at once (`layers`) — *All parties* with
  `stats.history`, *All my scores* for a reader who only sees the parties they sang in, over the
  same line for the lot ("3 parties · 60 scores"). The rows are `PickerRow`'s stylesheet, not
  the component (no membership mark), the pressed one the `--highlight-blue-dark` band under a
  `--highlight-blue-light` name; a party row has no lead, so the head row's `layers` sits in
  the line of its name. The list holds exactly the sessions that reader may open. `stats.hide`
  puts one `aria-pressed` `.icon-button` in the panel's header beside the close (§5),
  switching the list into **show all**: `eye-off` on it while the hidden parties are out,
  `eye` while they are in. In that mode every party the reader may open is listed, each row
  carrying the same pair beside its button, a hidden one wearing `eye-off` over a name in
  `--color-darker`. The hiding reaches this list and nothing else — the party keeps every
  score in every record and total. Tonight's party is never hideable, and neither is the head
  row, whose "3 parties · 60 scores" counts the hidden ones too.
  Under the summary come the two selects, then **one chart area** (`.scores-chart`), flat on
  `--bg` in the page gutter with a hairline under it where the ranking starts — no tile, every
  mark hand-drawn SVG, every axis at the foot, every tick label 11px, raw scores
  `chartTheme.dot` grey, gold for the party's best mark alone, blue for a box alone. §4's
  hidden-radio pills stand where its title would — **All scores · The evening · Spread** — the
  checked one in `--highlight-blue-light` text on `--highlight-blue-dark` with a
  `--highlight-blue-light` border, because on `--bg` the fill alone does not show. *The
  evening* is offered for a single party only (a heap of parties is no evening), *Spread*
  while the grouping is on and makes at least two groups; with one view left the switcher
  gives way to a plain quiet title. The choice sticks across parties, and a chosen view that
  is not on offer draws the strip and comes back with its view. *All scores* (`ScoreStrip`)
  is every score on one staggered strip — near-ties step aside instead of hiding, the band as
  high as they stack and no higher (40px at least), the median a dashed line — under one HTML
  line, *Median 6712 · Best 8662 Bender*: quiet words, `--color-dark` numbers, the best in
  gold, the name where the singers are not all the reader. *The evening* is the timeline
  (`EveningTimeline`: score over wall-clock time, `chartTheme.categorical`'s five CVD-safe
  hues on the session's five best singers, grey beyond, never a sixth hue). *Spread*
  (`SpreadRows`) is one 32px row per group: the name at the left (a player 88px with a quiet
  `×9`, a song 104px, its title ellipsed), the track, the group's best in bold gold at the
  right; the gridlines are drawn once behind every row and the 0–10k labels once under them.
  A player with ≥ 5 scores gets a Tukey box (whiskers end on real scores, outliers flagged on
  both sides) with every raw score as a small grey dot on top, fewer are plain dots; a song
  row is a swarm wearing singer initials until 8 scores, then dots — never a box; a row grows
  only where near-ties have to stack. Nothing scrolls sideways; the spread draws the first
  eight groups of the list in the same order and owns up to the rest ("… n more in the list
  below"), and every mark answers hover or tap with `ChartTip` — a mouse per mark, gone when
  it leaves, a finger tap resolving to the nearest mark within ~28px, off on a repeat and
  dismissed beside the marks. Because a chart may have no "beside" (the histogram's twenty
  columns tile its plot), an open tip also closes on a press anywhere outside the chart and
  on Escape, and opening one closes any other: the page holds one tip at a time
  (`hooks/useChartTip.ts`, for every chart at once). `.chart-plot` carries
  `touch-action: manipulation` so two quick taps are not a zoom.
  *Chronological* joins the sort select for every grouping but *group by player* (which falls
  back to *best score*), and only orders the rows and the list, never swaps a chart.
- **Score overviews** are one shape wherever a phone adds a set of scores up — an open score
  group on `/scores` and `/user/stats` (whose own head stays the strip), the record on
  `/user`, the song modal's Best scores — drawn by `ScoreOverview` (replacing `ScoreSummary`
  there): **a head line, then the numbers on the chart.** The head line says what was sung,
  *12 sings · 9 songs* (0.85em, numbers `--color-dark` and tabular, words `--color-darker`,
  `countWord`): distinct sings, so a duet run is one, and no Songs where every score is one
  song. Its far end is the surface's one `action` slot, the line 40px tall when it holds one:
  *Share stats* on an open player group, the `share` glyph alone as an `.icon-button`. The peaks are **named** (the holder with Best and
  Worst) where the scores are several singers' — a song group on `/scores`, the song modal —
  never under one singer's: a player group, `/user`, `/user/stats`. From **four scores**
  (`CHART_MIN_SCORES`) the histogram follows and Best · Average · Worst are **marks on it**:
  a label band, 16px (30px named), over `ScoreHistogram`'s 96px, and one 1px line per mark
  from the band's foot to the axis at score ÷ `MAX_SCORE` of the plot's width (the bars'
  mapping, so Best falls in its bucket) — Worst solid `chartTheme.dot`, Average dashed `3 3`
  in `chartTheme.axis`, Best solid `chartTheme.gold`, painted in that order. A label is 11px
  (`CHART_LABEL_SIZE`), *Best 8662*: the word `--color-darker`, the number tabular
  `--color-dark`, Best's gold, a holder on a second line in `--color-darker`; HTML over the
  band, outside the plot's `role="img"` so it is read (DOM order Best, Average, Worst), and
  `pointer-events: none` so a tap reaches the bucket. Each is a slot `min(96px, plot ÷ 3)`
  wide, ellipsed, centred on its line where it can be: `stats.ts` `spreadMarkLabels` (pure,
  tested, beside `scoreMarkers`) pushes overlapping slots apart and clamps them inside the
  plot, **never dropping one** — the host's `scoreMarkers` may drop the average, its marks
  decorating numbers printed beside them; these labels are the numbers' only print. That is
  the collision rule at any count: the lines keep their true x, the slots the lines' order,
  so the nth label is the nth line and its word pairs them; close peaks (50 scores between
  7900 and 8300) set the three labels side by side over three lines a few pixels apart. The
  bars stay `chartTheme.accent`, the best's bucket gold (the player card's rule), 0 and
  10000 at 11px; a bucket answers `ChartTip` as before, the best's adding *Best 8662* and,
  where named, its holder. **Under four scores there is no chart** — two dots have no spread
  and a few bars across twenty buckets are noise — and the numbers are one line under the
  head line in `ScoreStrip`'s idiom, *Best 8662 · Average 7210 · Worst 6100*, the same
  colours, a holder after its number where named, wrapping between entries, never inside
  one; `chart={false}` keeps that line at any count for the song modal, whose picture is the
  dated `ScoreStrip` under it (`showBest={false}`). Every score the same number is one *Best*
  in both forms. A one-score group draws no overview. Nothing moves: no reduced-motion
  branch. At 360px a tile's plot is 304px (the list's 8px, the tile's 8px margin and
  12px padding a side; measured): three 96px slots.
  ```
   390px  /scores, by player, Alice open    /scores, by song, open (named)
   +-------------------------------------+  +-------------------------------------+
   | 12 sings · 9 songs            share |  | 7 sings                             |
   |   Worst 2100 Average 6100 Best 8800 |  |   Worst 2100 Average 6100 Best 8800 |
   |        |        ===:==          |     |  |   bob                     alice     |
   |        |     ======:=====    ##     |  |        |     ======:=====    ##     |
   |  ------+-----------+----------+---  |  |  ------+-----------+----------+---  |
   |  0                           10000  |  |  0                           10000  |
   |-------------------------------------|  |-------------------------------------|
   | (cover) Bohemian Rhapsody      8800 |  | (A) Alice                      8800 |
   ```
  `|` a solid mark, `:` the dashed average, `#` the gold bucket Best's line runs through.
  The share cards (`scoreSummary`'s numbers) and `SessionSummaryRow` (what a party *was*)
  stay as they are; `ScoreSummary` is the host results' alone (`LastSong`, below). Files:
  `components/ScoreOverview.tsx` + `.css` + `.test.tsx`, `ScoreHistogram.tsx` (+ test: the
  gold bucket, the lines, 11px ticks), `stats.ts` (+ test), `ScoreGroupList`, `User`,
  `SongDetails`, `CLAUDE.md`'s map, and the figures of `docs/user`'s `scores/party.md`,
  `scores/your-scores.md` and `songs/song.md` with the `user` screenshot, the one manifest
  row that shows an overview.
- **Score rows** are flat `<details>` groups: rank numeral (pink top 3), cover or avatar, two
  lines of text, score, chevron. The two lines are a list row's: title over artist for a song,
  name over "N scores" for a singer. An open row is one tile (`.score-group-panel`) — the score
  overview over a hairline, then the scores as ordinary list rows, `border-box` at the tile's
  width, their hover band lifting off `--tile-bg`. A one-score group drops the overview;
  ungrouped, a row *is* a score and never unfolds. A score row carries, for `stats.moderate`,
  **one** control: a `pencil` opening the panel both corrections live in — the line naming the
  score, the `PickerRow` players that put it on the singer who actually sang it, and at the
  foot a `.button-danger` Delete through its own `ConfirmModal`, the Manage page's idiom, never
  two 40px buttons per row. Both confirmations stand over the panel, so cancelling comes back
  to the players; its title and the pencil's label cover the pair. The number and the song
  are never editable — a wrongly picked singer is the mistake this fixes. **A row that is a score opens the sing view**
  (share-cards §8) — on `/scores` and on `/user/stats` alike, the pencil its sibling — which is
  where a score is shared from. Inside an open group the row is a `.score-entry-button`, its
  hover band lifted off `--tile-bg`; ungrouped it is a `.score-group-row-button`, the group
  summary's shape on the page with the page's `--highlight-blue-dark` band. An open **player**
  group's *Share stats* (share-cards §9), the `share` glyph alone in a transparent 40px
  `.icon-button` (`aria-label` and `title` *Share stats*), the score rows' pencil's weight,
  is the overview's `action`, never a line of its own: one per group a player design can draw (four scores, or
  two songs: `possible.ts` `playerStatsShareable`), none on a song group. `/user/stats` has it
  as a trailing `share` `.icon-button-bordered` in its `PageHeader`, *Share my stats*;
  `/user` has none, *All my scores* being the way there.
- **Share cards** ([share-cards.md](share-cards.md) is the design, §5 the panel) open from the
  party bar, the sing view, *Share stats* and the achievement modal into one **bare** panel with
  no heading. The designs are a carousel, one slide each in a fixed order, a
  `scroll-snap-type: x mandatory` row, `overscroll-behavior-x: contain`, slides 84% of the panel's
  width, centred, 8px apart, so a neighbour peeks in at each edge. A story slide is as wide as its
  box, `min(84%, 50vh × 9 ÷ 16)`, never wider: half the screen tall at 9:16 is narrower than 84%,
  and a picture centred in a wider slide kept the neighbour out of sight. In each slide a box
  `min(width ÷ the card's ratio, 50vh)` tall, one height for every slide of a format, holds the real
  `<img>` of its PNG (`object-fit: contain`, an `alt`), or `Loading` until drawn; only the slide in
  view and its neighbours are drawn, each cached per option set, the old picture kept through a
  redraw. A design the card cannot draw keeps its place as a **dimmed slot**: the box on `--input-bg`,
  the design's name and `possible.ts`'s sentence centred in 0.85em `--color-dark`. Under it a 40px
  row: `chevron-left` / `chevron-right` `.icon-button`s (*Previous design* / *Next design*, disabled
  at the ends) around one 8px dot per slide, `aria-hidden` decoration and never a control
  (`--highlight-blue-light` in view, `--color-darkerer` else, a dimmed slot's a hairline ring),
  then the borderless format pair (share-cards §5), the design's name under the row in 0.85em
  `--color-dark`. A card of one design (the achievement's *Badge*) draws no arrows, dots or
  rule, and the pair stands alone in the middle of the row. Arrows and ←/→ on the carousel (`tabindex="0"`,
  `aria-roledescription` *carousel*, slides named "Mosaic, 3 of 5") scroll smoothly, and jump under
  reduced motion. The slide in view **is** the choice the buttons send and the panel remembers
  (*Spread* and *You* excepted); a dimmed slot has no picture, so there they hold still as through a redraw
  (share-cards §5), each drawn as held: the word in `--color-darkerer` on `--input-bg`, the
  primary's fill given up as `SpinButton`'s is. Then the options row of §4's icon toggles and its
  one line, the same two on every slide (share-cards §5). The foot is §5's `flex: 1 1 0` row of
  what works in this browser, never a greyed button: **Share** (`share`, the primary) where
  `navigator.canShare({files})` says yes, **Copy image** where `ClipboardItem` exists, **Save
  image**, primary where Share is absent; on plain http a touch screen also reads *Press and hold
  the picture to save or share it.* as a `.section-note` **above** the carousel.
- **User** (`/user`) is the identity tile, the singer's own record, then *Manage*. The tile is
  Home's head and nothing else, 88px at 16 of padding: the avatar (`PlayerAvatar` at the
  stage's art size) beside a column centred against it of declared px rows — the name as the
  page's `h1` (1.3em on 28px, left, ellipsed), the role word (`auth.role` capitalised, 0.85em
  on 20px, `--color-darker`; the host's is *Admin* too) and one 40px control, 28 + 20 + 40
  adding up to the picture's 88. For an account that is *Log out* as the `log-out` glyph
  alone, a transparent `.icon-button` (`aria-label` and `title` *Log out*) pulled 10px left so
  the glyph's box stands on the name's left edge: the way out is there when it is wanted and
  never the loudest thing on the singer's own tile. The host keeps the words, one `.button` on
  an 18px line, *Log in as a user*: no glyph says "as a user" on a tile that reads *Host
  screen*, and it goes once pressed and opens the login form under the tile. The avatar is the upload — a `<label>` over a hidden file input named
  *Change your picture*, `image` in its lower-right corner on `--highlight-blue-dark` — and a
  refusal is one `.error-notice` under the head, inside the tile. The host draws `shield` in
  the avatar's square on `--input-bg` over *Host screen*; logged out there is no tile, the `h1`
  *You* over the login form; nothing is drawn before `/auth/me` answers. Uncapped on a wide
  screen, unlike the stage: it starts at the gutter like every section under it. The record
  is the score overview of every score the reader has, on the page gutter, unnamed and with
  no action, and no favorites count: favorites are a filter, not an achievement. Under it *All
  my scores*, which belongs to those stats and not to the errands below: a flat full-width row
  held to them by a hairline `border-top`, 0.85em label in
  `--highlight-blue-light` with a `chevron-right` — never `.home-entry`, whose 48px glyph row is
  `ManageMenu`'s idiom.
- **People** (`/user/accounts`, `PeopleAdmin`) gives each of its two `h2`s one `.section-note`:
  *Accounts* says a forgotten password is no disaster — delete the account, register the name
  again, the player keeps every score — *Guests* that a guest is taken over by whoever registers
  that name. A row's trailing controls run eye, role, delete. The `eye` / `eye-off`
  `.icon-button` (`aria-pressed`, `players.manage`) puts a player out of sight for the evening:
  hidden means gone from player selection and from nothing else — scores, stats and past
  sessions still name them — and the row draws its name in `--color-darker` while it lasts.
  Logging in unhides. An account single sign-on answers for (`auth_provider` `oidc`) carries
  one quiet line under its name, `.people-provider` (0.8em, `--color-darker`, truncated like
  the name, no glyph and no badge): *Signs in with* and the login button's `display_name`, or
  *single sign-on* while that is unknown — the config is asked for only once such an account
  is listed.
- **Settings** groups are `<details class="settings-group" open>` with a section icon, the
  `summary` `position: sticky; top: 0` on `--bg` so the section being scrolled stays named (the
  nested *Advanced* summary is not sticky). Fields are flat `.setting-field` rows of two lines:
  label, *Saved* and the reset `.icon-button-bordered` on the first, the quiet input alone on
  the second, which makes every input on the page one width. A `bool` is the exception — its
  checkbox ends the label's line and there is no second. Every field keeps its 0.85em
  description; complex settings get their own sub-page, not an inline block. A group's
  `advanced=True` settings follow its ordinary ones in a nested
  `<details class="settings-advanced">` labelled *Advanced*, closed by default — never a section
  of its own, never a group's only content.
- **Host** (`/host`) is a TV across the room: everything but the overlay's 40px controls scales with `clamp()` and `vh`, flat on
  `--bg`, the white QR card its one tile and the selection cards its one other surface. It is
  also the **one screen that makes sound**: `MusicSink` is mounted in `App.tsx` rather than
  here (the host walks from `/host/manage` into `/settings` and `/user/*`, and a sink under a
  page would stop the music mid-song) and plays only for `auth.isHost`. **The music line**
  (`.host-music-line`, the page's own, fixed at the foot of the whole screen and centred on it) names
  the background song outside the takeovers: content while `playing`, never fading with the chrome
  (while `paused` it is chrome, below). *Turn on sound* is not in the
  overlay for the same reason — `.host-controls` is invisible the moment the mouse stops, which
  on a TV is always — and not in `.host-rail` either, which is down while the room picks
  singers: `.host-sound-on` is a large primary fixed at the bottom centre of the screen
  (`bottom: 8vh`, over everything, above the music line), pulsing outside reduced motion,
  because a browser that plays nothing until somebody clicks is a fault the whole room has to
  see from the sofa.
  **The chrome is two groups**, revealed on pointer movement and faded together by the page's single `useIdle` — never a second idle timer: the screen's at the top left (`.host-controls`), the music's at the foot (`.host-music`, its two cells `.host-reveal`, held up and let go of as the top left is).
  The full-screen button is one of them, in `.host-controls` so a takeover never takes it down,
  and stays there in full screen as the way out: a host with a mouse alone has no Esc. Keyboard focus
  holds the overlay up (`:has(:focus-visible)`), a click's focus does not: a control a click focused
  lets go of it right after the click — the leaderboard's order pills included — and anything still
  holding one lets go when the chrome fades, because any later key, Esc out of full screen among
  them, would turn that focus visible. The overlay runs, wrapping (`flex-wrap`) rather than leaving
  the screen: gear, full screen, one slot that is **Stop** while a sing runs and **Open Ultrastar
  Deluxe** otherwise (the launch is refused while a song plays); **the legend is the corner's last
  line**, 12px under that row, only a `.host-error` ever following it. No line says the
  browser holds host rights: drawn only where it is true, it would say nothing. *Open
  Ultrastar Deluxe* (`settings.manage`) is **a word button of the gear's weight**:
  `.icon-button` widened by the new `.icon-button-text` (`index.css`: `width: auto`,
  `padding: 0 12px 0 10px`, `gap: 8px`, the word at 1em after `power` at 1.25em) —
  transparent, 40px, glyph and word `--color-dark`, `--color` on `--highlight-blue-dark` under
  a pointer, `--color-darkerer` while the launch is on the wire. The words stay (a power glyph alone on a TV reads as switching it off,
  §1.5), and **its caption is its own**: `.host-usdx` is a column, the button over *For
  settings like microphones* in `.host-caption`'s 14px `--color-darker`, centred, on a
  declared 16px line pulled 2px up into the button's box, so the caption's capitals stand
  14.5px under the word's baseline and the pair reads as one block — the button's own 40px
  leaves 13.5px under the baseline, which with a 4px gap and a `normal` line was 22.5. The
  capitals stay clear of the hover fill, and the button's focus ring is drawn inside its box
  (`outline-offset: -2px`, the list rows' inset ring), because the global ring's 2 to 4px
  outside it is where the capitals are. The caption takes no pointer (`pointer-events: none`),
  so the overlap never shortens the 40px
  target; `aria-describedby` on the button, never in the row's line; the row aligns at the top,
  so the gear and full screen stand level with the button (`Host.tsx`, `.css`, `.test.tsx`):
  ```
   [gear] [full screen]  power Open Ultrastar Deluxe      <- no fill, no border, all three
                         For settings like microphones       glyphs and the word --color-dark
   Space Play or pause   N Skip   ↑ ↓ Volume   F Full screen
  ```
  Its window coming to the front is the acknowledgement; a
  refusal is one more `.host-error` in `explainUsdxProblem`'s words. **The music group**
  (`music.control`) is one 40px row at the music line's `bottom`, columns `minmax(var(--host-music-side),
  1fr) minmax(0, auto) minmax(var(--host-music-side), 1fr)` (the volume cell's width), 24px gaps, so the
  line in the middle stays centred and ellipses first: the left cell ends in play/pause and skip, the
  right starts with `volume`, the master `.range-input` (§4) and its tabular number, all the gear's
  40px `.icon-button`s. The transport stands while the music is its own (`music.hasTransport`:
  `playing`, `paused`, `waiting`, `empty`, never `blocked`); while `paused` the line names the paused
  track with the chrome, in `--color-darkerer`, beside the play it resumes. The volume always stands:
  during a sing and with the music off it is the row alone, centred. In a takeover, whose foot is the
  cards' and the badges', the group without the line moves to the top right the rail has left,
  `.host-controls` keeping to the other half. The page reserves `max(40px, var(--host-music-line-height))`
  at its foot whenever either is drawn; under 1101px both take their place in the flow. A key whose control is not drawn is ignored.
  **Keyboard shortcuts**, on `/host` alone: `Space` or `K` play/pause, `N` skip,
  `ArrowUp` / `ArrowDown` master volume by 5 (one write per pause), `F` full screen where its
  button is drawn; each `preventDefault`s, none takes Esc. A press with Ctrl, Alt or Meta, from
  a control or an editable element, or while any modal is open (`modalStack.ts`'s
  `openModals`) is ignored, and a shortcut moves no focus (`useIdle` wakes on `keydown`). Each
  control names its key in its `title` (*Pause (Space)*) and `aria-keyshortcuts`, and **the
  legend** says them while the chrome is up, takeovers too: one 14px `--color-darker` line, each key a `<kbd>` (13px
  `--color-dark` on `--input-bg`, the hairline, `0 6px` padding, half `--border-radius-small`)
  before its word, 16px between entries — `Space` Play or pause, `N` Skip, `↑` `↓` Volume, `F`
  Full screen — listing only keys whose control is drawn. Verify at 1280×720 and up,
  and re-check it after touching any shared component (`CurrentlyPlaying`, `LastSong`,
  `SongCover`, `SessionLeaderboard`). `LastSong` keeps `ScoreSummary` — the numbers as
  `IconStat`s with their words, named, no Songs; read across a room, the phones' overview
  would be too small — in the naming column beside the cover and under the artist line, wrapping there instead of
  standing as a column of its own; the cover keeps its size, and the marker strip and the
  score bars follow underneath. **The markers keep a minimum gap** of about 2.5em of their own
  font size — one glyph, its pointer, and air — and the average is what yields: inside that
  gap it is not drawn, being the number the two ends already imply, and when worst and best
  themselves fall inside it the three collapse into one mark wearing `average`. Nothing is
  lost by it, the strip being decoration for numbers the summary prints in full above it.
  **New achievements take the whole screen.** While `HostAchievements` is `playing` the rail is
  not rendered at all — no QR card, no standing, no wishes — the stage runs the full width of
  the page, and the results wait underneath as they already do. `playing` only: the `waiting`
  beat, held for badges that may never come, leaves the rail where it is. **The beat between
  two singers shows the brand**, without its scan line — the code it names is in the rail that
  is down — because a TV with nothing at all on it for most of a second reads as a fault, not
  as a pause. Everything grows a
  step for those seconds — the singer's avatar to `clamp(96px, 16vh, 240px)` under a name in
  the same proportion, and the whole `--badge` ladder up one rung, the row of four taking
  today's one-badge `clamp(34px, 6.4vh, 74px)` and the rows of one to three keeping the lead
  they hold over it today, `--column` and the gaps widening with them. Under each description, the
  modal's holders line (§5), counting the singer so one holder reads *First to earn it*, set apart by a gap of `calc(var(--badge) * 0.28)` (no hairline on a TV), in `--color-darker` at `max(16px, calc(var(--badge) * 0.38))`.
  **Picking singers is the second takeover**: while
  `HostSelection` reports `selecting` the rail is down the same way, and the block keeps
  reporting it underneath the badges that outrank it, so the code does not come back for the
  seconds in between. The song stands at the top as **one centred column** (a long title must
  never move the reel) — the cover, or the reel in its place, at
  `min(28vh, 24vw)`, two lines always reserved for the title (`-webkit-line-clamp: 2` on
  `line-height` 1.3), the artist, and one line that reads
  *Spinning…*, *Picking singers* or *Starting in N…*: the countdown takes the line's place,
  never a line of its own (the head's height is budgeted to it) — over **one card per slot** along
  the foot (capped at 26vh wide, the rest of that budget), in the host's order
  and sharing the width: an outline in the slot's own hex over that same colour 18% into
  `--bg`, taken or not, the avatar above the name. A card nobody owns lying on a slot is the
  full card under a placeholder a step lighter (32%), saying *Unknown card*; a slot nobody is
  on is a **short box** along the foot of the row (`clamp(40px, 6.5vh, 76px)`), its colour and
  the word *empty*, that grows into the card the moment somebody takes it, so the free slots
  are told apart at a glance (`player-selector.md` §7). Both words are in
  `--color-dark` (`--color-darker` is 2.7:1 on the darkened yellow, §1.6's reasoning). The cards are the one
  sanctioned departure from §1.1. A spin a **phone** started draws no row at all and centres
  the head in the stage (the slots are the picker's, the next screen); the selector's spin
  keeps the cards, and counts down once the reel has landed. The song plays the way the
  reel's does (`MusicSink`'s preview) for every selection that has one, spun or opened with
  a song, and a spin moving on to its singers keeps it playing, never from the top. The page keeps its one
  `useIdle` mechanism, and every animation keeps its reduced-motion branch (§1.9).

## 8. Checklist before finishing UI work

1. No new `--tile-bg` outside the whitelist; no per-row badge beyond an opt-in mark (§1.3).
2. Icon-only controls use `.icon-button*`; new icons are one path, listed in §3 with a note.
3. New routes: `App.tsx` **and** `COVERS`; sub-pages: `PageHeader`, `back`, capability gate.
4. Every animation has a reduced-motion branch; every control has a name and a focus ring.
5. Nothing scrolls sideways at 360px; the host page still reads at 1280×720.
6. Tests referencing changed labels/roles are updated, not deleted.
7. `docs/user/` reflects moved buttons, renamed tabs and new controls.
