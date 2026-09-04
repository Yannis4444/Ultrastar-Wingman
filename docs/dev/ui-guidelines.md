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
   `.modal` (non-bare), `.scores-chart`, `.score-group-panel`, the USDB login card, the login
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
   its Filter row glyph and, for the two marks, the Songs chip too; the heart and mic
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
   `.visually-hidden`, `.icon`, the global `:focus-visible` ring. Extend with a modifier class;
   never write a second bespoke 40×40 icon-button rule.
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
clamp. Bottom-nav destinations (`Songs`, `Scores`) show **no page heading** — the tab names
them, so their `h1` is `visually-hidden`; `Home` and `User` keep theirs.

## 3. Icons

`frontend/src/components/icons.tsx` is the only icon source. `Icon({ name, className })` renders
exactly one `<path d>` in a 24×24 viewBox with `fill: currentColor`; size comes from the
parent's `font-size` (`.icon` is 1em). `gradient` swaps that fill for a two-stop diagonal
gradient the caller colours with `stop-color` (`.playlist-spin` only). Read `ICON_PATHS` before
adding — `dice` is the five, `dice-1`…`dice-4` and `dice-6` the other faces. Never `heart` for a
wish (favorites own it), never `star` (the winner accent owns it), never a bare `check` as a
control glyph. `clock` is "Recent". **`tag` is the tags feature**: the song modal's summary
strip, the Tags admin entry and its `ManageMenu` row, the tags empty state, the fallback for an
icon-less tag — so the song details list's **Genre** row takes `music` instead.

Glyphs with a fixed meaning; the two playlist families lead, kept apart at a glance. What a tag
may wear is the picker's list below, never this table.

| Glyph | Means | Drawing note |
|---|---|---|
| `playlist-plus` / `playlist-check` · `list-plus` / `list` / `list-check` | wish off / wish on, `playlist-plus` also heading the wishlist · add to playlist / picker row not in it / already in it, `list` also the "Playlists" link | solid bars · bulleted rows |
| `filter` / `comment` / `drag-handle` / `copy` / `send` / `user-plus` | the Songs Filter chip and its panel · comments: the song modal's summary strip, the sub-view, the empty state · reordering — the grip on a row and, on the Achievements admin, the header control that opens the mode · "Save a copy" of a playlist · submit in the comment composer · add a member, add a person to a tag | solid funnel, a wide bar tapering into a short stem · one rounded speech bubble, tail at the bottom left · six dots in two columns of three · two offset rounded squares, the front one solid · a paper plane, one triangle with the fold cut out · the `user` bust with a plus at its shoulder |
| `lock` / `bookmark` / `bookmark-off` / `eye` / `eye-off` / `layers` | kept back: a tag row nobody assigns here (no `assign`), an achievement that is hidden until it is earned — the masked badge and the mark on its admin row are one glyph — and a built-in achievement's conditions, which are Wingman's own · follow / unfollow a playlist, `bookmark-off` also labelling the collapsed *Hidden* group · a player who is shown / one who is hidden in the people admin, and a party in or out of the session picker's list — the pair reads the state, never the action · the session picker's row for every session at once | padlock, solid body under a counter-wound shackle so the nonzero fill leaves the hole · ribbon with a notched foot · the same ribbon behind a diagonal bar · an almond outline around a pupil disc, the almond counter-wound so the white of the eye stays open · the same almond behind a diagonal bar · three stacked lozenges, the top one solid and the two beneath it thin bars |
| `archive` / `flame` / `moon` / `snowflake` / `gift` / `cake` / `child` | a tag for put-away songs, and the Achievements admin's *Import and export* heading — that section is about archive files · for party songs · for slow songs and ballads · tags for christmas: the winter half · presents · a tag for birthdays · for songs for kids | a lid bar over a box body, one notch in the lid · one teardrop tongue, notched at the foot · a crescent as one contour, the rim the long way round and back along the cutting circle — a cut-out cannot do it, the cutting disc has to reach past the rim · three crossed bars, a short fork at each of the six tips · a box under a lid bar, one ribbon band down the middle of the box and a two-petal bow on the lid · a slab on a plate, three candles · a round head over a body, arms out and legs apart, never `user` |
| `guitar` / `crown` / `film` / `gamepad` / `flag` / `skull` / `sun` / `umbrella` | a tag for rock · for the classics everybody knows · for movies and musicals · for game music · for a language or country, which the song details list's **Language** row takes too · for hard to sing · tags for summer · for rainy songs | two bouts with a waist between them, sound hole cut out of the upper one, neck to the top right · three points over a solid band · an upright strip with a column of sprocket holes down each edge, `video` staying the camera · a lozenge, d-pad cross and two buttons cut out · a triangular pennant on a staff · a cranium over a jaw, the eye sockets and a nose cut out · a disc under eight detached tapered rays, nine subpaths, nothing cut out · a scalloped half-disc canopy over a stem that hooks left at the foot |
| `beer` / `car` / `plane` / `bolt` / `bell` / `ghost` / `ring` / `graduation-cap` | tags for drinking songs · for road songs · for holidays · for the loud fast ones · for new year · for halloween · for weddings · for school and graduation | a tankard under a three-lobe foam cap, the handle loop counter-wound · a cabin stepped onto a body over two wheel discs, the windows counter-wound · one outline — fuselage, swept wings, tailplane — nose to the top right · a single zigzag contour · a dome on a flared rim over a clapper disc · a dome over a three-lobe hem, the two eyes counter-wound · two concentric circles, the inner one counter-wound, a gem lozenge on top · a rhombus board on a trapezoid cap, a tassel cord down the right |
| `headphones` / `drum` / `piano` / `rocket` / `anchor` / `tree` / `paw` / `smile` | tags for songs to play rather than sing · for the drum-driven ones · for songs at the keys · for the night's openers · for sea shanties · for folk · for animal songs · for the funny ones | a headband arc, its inner edge counter-wound, and two capsule earcups · a cylinder between two overhanging rim bars, one three-V zigzag band counter-wound out of the shell · a keybed bar over five keys, the four black ones counter-wound out of it · a pointed body between two fins over a flame, the porthole counter-wound · a ring over a shank crossed by a stock, above one curved fluke bar, the ring's hole counter-wound · three stacked triangles on a short trunk · a pad disc under four toe discs, five subpaths, nothing cut out · a disc with two eyes and a crescent mouth counter-wound out of it |
| `hash` / `music` / `arrow-up` / `average` / `arrow-down` · `trophy` | a score summary's five numbers, in that order — sings, songs, best, average, worst · the best score as a thing to open: the §5 summary strip's gold button, never a number inside a score summary | two upright bars crossed by two horizontal ones · one contour, a note head under a flagged stem · one solid contour, a shaft behind a triangular head, and the same mirrored · a ring struck corner to corner by a bar · a cup between two handles over a stem and a foot bar. The reorder pair on a playlist or achievement row is `arrow-up` / `arrow-down` doing a job, not a second meaning. None of them is pickable — a number is not a thing a song is about — `music` excepted: it is in the picker already, meaning genre, and wears this second meaning only inside a summary; `trophy` stays out with `clock`, `globe`, `star` and `tag` |
| `upload` / `download` | the Achievements admin's two archive buttons: one in, one out | `download` mirrored — the same shaft, arrowhead and tray bar, the arrow coming up out of the bar instead of down into it. Neither is pickable: an archive is not a thing a tag or an achievement is about |
| `thumbs-up` / `hourglass` / `balloon` / `dumbbell` / `tv` | tags for the crowd-pleasers · for the long ones · for carnival · for the gym set · for series and anime — labelling the Host settings group is a job, not a meaning | a fist block with the thumb up over a separate cuff bar · two triangles meeting at the waist between two cap bars · a teardrop bulb over a short zigzag string · a bar between two pairs of stacked plates · a rounded case, the screen counter-wound, on a stand bar |

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

- **Buttons:** `.button` (flat, `--input-bg`), `.button-primary` (`--highlight-blue-dark`),
  `.button-danger`; exactly one primary per view, and confirm dialogs put Cancel first, then
  primary/danger, both `flex: 1 1 0`. `.icon-button` = 40×40, transparent, `--color-dark` glyph,
  hover `--highlight-blue-dark` fill; `.icon-button-bordered` beside an input on the page
  background, `.icon-button-danger` for destructive. Always `aria-label`, `title` on
  toolbar-level buttons.
- **The editor action row** (`components/EditorActions.tsx`) ends a full-page editor: one
  sticky row on `--bg` under a hairline `border-top`, carrying the view's one primary Save,
  one quiet 0.85em line, and the editor's other action — a danger Delete, a plain Reset — at
  the far end of that same line. It sits **inside** the `<form>` (Save is its submit) and
  sticks at `var(--bottom-nav-height)`, so it rides on the nav, counts the safe-area inset
  once, and settles into the flow at the true end of the form — nothing is ever hidden
  behind it. That term is **one token** (`index.css`), and `BottomNav.css` sets the nav's
  `height` from it rather than growing into its own content — the caption's `line-height`
  pinned so the 24px glyph and the 16px word are exactly the 40px the token leaves them.
  It has to be declared, not measured: `line-height: normal` comes out of the font's own
  metrics, so the same 12px caption is 16px tall in Segoe UI and 14px in Roboto, Arial or
  SF, and a nav that measured itself left this row floating 1–2px above it on every phone
  while looking flush on Windows. Everything that reckons with the nav — `#root`'s bottom
  padding, this row, the scroll-margin under it — reads that one token. The page's focusables
  carry a matching `scroll-margin-bottom` the way `Settings.css` carries `scroll-margin-top`,
  and it has to clear **the nav plus the row plus a control's own height**: the browser
  honours the margin exactly and scrolls the focused element's own box, which for a radio pill
  is the `visually-hidden` input at the top edge of its label. The quiet line is why a
  permanently visible disabled Save does not read as a broken app: it says why Save will not
  go — and, because Save can now be pressed from anywhere in the form, that a press went
  nowhere and where the `role="alert"` sentence for it is — with *Saved* in
  `--highlight-blue-light` when one landed. That accent slot takes any write's
  acknowledgement, not only a save's: `savedLabel` is what a reset says in it instead
  (*"Reset — the shipped achievement is back."*), because a reset settles the form with
  nothing pending and *Saved* is not what happened.
- **Text inputs, loud and quiet:** `.text-input` (16px radius, `--input-bg`, ≥40px) is for the
  page's one main control (the Songs search); `.text-input-quiet` (36px, hairline, transparent)
  is everything else — settings fields, selects, filters, forms. At most one loud input per
  page. Quiet `<select>`s carry grouping/sorting (Scores), the reel's pool (Random song) and a
  member's access level.
- **Song controls** (`components/SongControls.css`), in the song modal and the Home stage: two
  48px `.song-control` flanks (favorite / wish; glyph `--color-darkerer` off, accent on, no
  fill) around a 72px unfilled `.song-control-lead` (blue play, pink stop on the stage), grid
  `1fr auto 1fr`. No filled play button.
- **Segmented / pill choices** (the tag editor's colour pills): a `.visually-hidden` radio in a
  `<label>` plus a visible `<span>`; checked = `--highlight-blue-dark` fill,
  `--highlight-blue-light` border/text; focus via `input:focus-visible ~ span`. For 2–4
  exclusive options that must all stay visible. The **tri-state control** (`.tri-state`) is that
  pattern at three options — **Any / Yes / No**, in that order: a `<fieldset>` with a
  `visually-hidden` legend naming the criterion, per option a `.tri-state-option` label around
  the hidden radio and a `.tri-state-text` span (40px min-height, `padding: 0 10px`, 0.85em, 4px
  gaps, the group `flex: 0 0 auto`, ~150px). *Any* is checked by default, a `hide_by_default`
  tag opens on *No*. Its row is glyph (1.15em, tag colour) · name (`flex: 1 1 auto; min-width:
  0`, ellipsis, never wraps) · control. A **valued facet** keeps that row and puts a quiet
  `<select>` where the tri-state group sits — `flex: 0 0 auto`, the same ~150px, so a 390px row
  still leaves ~130px of name — named by the criterion like that legend, its glyph drawn in the
  neutral tag colour, having none to configure. **`CheckOption`** is for the few places where a
  handful of options all fit on screen — download-panel filters, video-quality presets; dense
  matrices of them (permissions, tag flags, settings toggles) keep native checkboxes.
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
  two buttons carry it as a fill (the only gradient buttons in the app), the playlist header's
  icon-only link on the glyph. On SPIN the die tumbles through its faces.
- **`Loading`** (`components/Loading.tsx`) is the only loading indicator — every `Suspense`
  fallback and `isPending` branch uses it. `SongSpinner` is the reel, not a loader.

## 5. Modals

`components/Modal.tsx` props: `title` (accessible name), `onClose`, `fullscreen`, `hideTitle`,
`bare`, `headerAction` — **one** control beside the close, and the only thing a panel header
carries besides its heading and that close. It is for a control that changes what the whole
panel holds (the party picker's *show all*), never for a row's own action.

- **Bare modal** (`bare` + `hideTitle`) — the song modal (`SongDetails`) and its sub-views.
  Structure: hero (`.song-hero`: cover, title 1.15em, artist 0.85em `--color-darker`) → optional
  preview `<audio>` → the song controls row → option rows (`.song-option`, 44px, hairline
  `border-top`: icon, label in `--color-darker`, optional accent value, chevron) → the summary
  strip. A collapsed row points `chevron-right`; one expanding inline swaps to `chevron-down`
  with `aria-expanded` — never rotate the glyph.
- **The summary strip** (`.song-summary`) closes the modal: a centred flat row of at most three
  buttons, each an `IconStat`-shaped glyph over its number, each opening the sub-view it counts
  — `trophy` (gold) with the best score, `tag` with the tags this reader sees on the song,
  `comment` with the comments. `trophy` needs a score to exist; the other two stand at zero,
  because tagging a song and being the first to say something are exactly what they lead to, and
  `tag` goes only when the reader may neither see nor set a single tag. The strip counts, the
  rows above it hold content and actions: **Details** and **Add to playlist** stay rows, neither
  having a number to show.
- **Sub-views** replace the modal body, the header's close acting as back: Best scores, Add to
  playlist, Tags, Comments, Edit details, Player selection, and Add songs (same mechanism, from
  the playlist page). Row order: Details, Add to playlist, Edit details. Inside
  Tags, an assignable tag is a toggle row (`aria-pressed`), any other — one nobody assigns here
  — a `lock` row. **Add to playlist** gives `playlists.manage` holders one `aria-pressed` row
  per playlist they may edit (state from the listing's `contains` flag, not a fetch per row) and
  a "New playlist…" row (`plus`). **Edit details** (`pencil`) is the last row and the one place
  a song is changed at all — everything the party's helpers do to it, in one errand rather than
  a row each. It carries the details as labelled quiet inputs in their own order — title,
  artist, Language, Genre, Year, Edition — one primary Save, `.song-details-notice` for what the
  backend refused, and at the foot, held off the form's rhythm, a `.button-danger` **Delete
  song** (`songs.delete`) through a `ConfirmModal` that names the song and says the files go
  with it. Nothing on the way there is red (§1.6). The row appears for `songs.edit` or
  `songs.delete`; a reader holding only the second finds the fields disabled over the line
  saying why and the button live, an editor nobody may edit being the rarer half of a pair the
  permission matrix allows and not worth a second row.
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
  which stays the parent's `font-size` (§3); the name at 1.15em; the description at 0.85em in
  `--color-darker`; then the one line the row already carries — "Earned 12 Aug 2026", or the
  progress bar over its "7 / 10". A **masked** one shows the `lock` badge over the stand-in
  name and sentence and no bar at all: a modal is a bigger place to say the same nothing,
  never a way around the masking. One with **no picture** shows its glyph plate at that same
  size — a glyph badge across half the screen is still the badge. What opens it is a
  `<button>` named after the achievement, the badge itself being `aria-hidden`, at §1.10's
  touch floor — in the list and on the summary strip alike, where the press that opens the
  modal must not also toggle the `<details>` it sits in. It closes like any modal: the
  backdrop, Escape, its own close.
- **Panel modal** (default): `--tile-bg`, `--border-radius`, sticky header with `h2` + close.
  Confirmations, pickers, admin dialogs, the download queue, and the two panels **Filter**
  (footer Reset `.button` then Done `.button-primary`, both `flex: 1 1 0`) and **New playlist**
  (name, optional description, one "Global" checkbox). The **"Add songs from…" picker** is one
  too: a grid of source cards (`repeat(auto-fit, minmax(140px, 1fr))`, `--tile-bg`, icon ~48px,
  name, one-line description) — the sanctioned tile use, and the cards must read as buttons.
- **Fullscreen** is player selection only. A backdrop click closes any modal; Escape and the Tab
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
  reel frame; `PlayerAvatar` is `--border-radius-small` (people, not covers), the 96px identity
  avatar round. Sizes: 40px in rows, 200px (`max-width: 60vw`) in the modal hero, 160px on Home,
  `min(42vh, 30vw)` on the host; the fallback is the initial letter on `--input-bg`.
- **Home** is `HomeStage` (identity tile that becomes the current song while one plays — cover,
  title/artist, song controls; **no** time, progress or singer list on phones) → setup banner →
  wishlist → the Random song entry. Nothing shifts when the stage switches.
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
  reel reads — no choice made in the panel, tag or facet, reaches it. The **Filter panel**
  lists Favorites (`heart`), Sung (`mic`), then the facets shown in the filter in *Built-in*
  order, then every visible tag. A mark, a tag and a boolean facet end in the tri-state
  control of §4, a valued facet in the select: *Any* plus the distinct values of the songs the
  reader may see, sorted, *Decade* bucketed from the year and labelled "1980s". A song without
  the value matches *Any* alone: no "No year" option, a gap in the metadata is not a decade. A
  facet off *Any* counts towards "Filter · N" like a tag.
- **Playlists** (`/songs/playlists`): flat `h2` groups — *Your playlists*, *Shared with you*,
  *Global* — then a collapsed `<details>` *Hidden* for unfollowed shared lists, rendered only
  when it has rows; global lists never hide. A row is a 40px cover mosaic (2×2 of the first
  covers; one cover fills the box, none falls back to the `list` glyph square), the name with a
  passive `globe` mark when global, a meta line "12 songs · 48 min · by alice" (the owner named
  outside *Your playlists*) and a chevron. The header `+` opens the New playlist panel and
  navigates into what it creates. No edit or delete control on a row — management lives behind
  the detail page's gear. One `EmptyState` for the page, not one per group: three of them
  stacked on a fresh install would say the same thing three times.
- **Playlist** (`/songs/playlists/:id`): `PageHeader` with the name, `back` to the list,
  trailing the gradient dice and, for `can_manage`, a `gear` into the manage page. Then a
  summary line (description; "12 songs · 48 min · Global · shared by alice · your access") and
  an action row of at most three `.icon-button-bordered`s: **Add songs** (`list-plus`,
  `can_edit`), **Edit** (`pencil`, `can_edit`), **Follow/Unfollow** (`bookmark` /
  `bookmark-off`, members only). Edit mode makes each song row a reorder row — `drag-handle` for
  the pointer, `arrow-up` / `arrow-down` for the keyboard (both write the same order), `close`
  to remove — and moves nothing else. "Save a copy" (`copy`), for `playlists.manage` holders, is
  a text row at the foot, not a fourth icon; song rows are `SongListItem`s. **Manage**
  (`/songs/playlists/:id/manage`) is a §6 sub-page gated on `can_manage`: Name and Description
  as quiet inputs, one "Global — everyone can see it" checkbox, the Members people-rows under a
  quiet "Add people" search, one primary Save, and Delete (`.button-danger` + `ConfirmModal`) at
  the foot.
- **Random song** (`/spinner`, and the playlist reel): what the reel may land on is one quiet
  `<select>` labelled *Pick from* — All songs, Favorites, Wishlist, Wishlist (weighted) — over
  the pool caption, never a bank of pills competing with the reel and the SPIN below it. An
  option the reader has nothing in is `disabled`, and the caption still says what the chosen
  pool holds. A fixed pool — a playlist's reel — drops the select and keeps the caption. Only
  *All songs* is filtered by the `hide_by_default` tags: a favorite, a wish and a playlist are
  the reader's own choice, and hiding what they asked for would be a bug.
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
  whole catalogue as **one list** — the party's own achievements and the seventeen Wingman
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
  flight the arrows are `disabled` and the grip starts no drag — two orders sent from one
  list can land in either sequence, and the loser is what the catalogue keeps. The grip is
  not dimmed for it, being `aria-hidden` scenery rather than a control, so the disabled
  arrows are what the reader sees. **The focus goes back to the arrow that was pressed**
  once the answer lands — the row's own node moves and both its arrows are disabled for the
  length of the request, and neither a moved nor a disabled control keeps the focus — or to
  the row's other arrow where the move used that one up (it now leads or ends the list), so
  arranging by keyboard is a run of presses rather than a walk back to the list after each
  one. A refused order puts it back too, on the arrow that was pressed. The order is **one order over the whole catalogue**: a row
  moves anywhere in the list, a party's own achievement above a shipped one included, and what
  is sent is the list exactly as drawn — one sequence over one column, which is the order
  every badge surface lists in and the order the export picker offers.
  A refused order puts the rows back where the server still has them — not where
  they stood before the move, which for a drag is the move that was refused — and says so;
  one that no longer fits the catalogue says somebody else changed it and asks for the
  catalogue again. Resetting a built-in therefore
  leaves its place alone: the order is the host's, not the achievement's. The
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
  **Reset achievement** (`refresh` — the app's reset glyph; never `.button-danger`, a reset
  restores) whose `ConfirmModal` is `danger` (§5: a replace), names what comes back and says
  the badges are worked out again; the line saying what a built-in is ends the form above the
  row, where the reader meets it on the way down.
- **Scores** opens on the session bar: the session's name and a `chevron-right` in one wide flat
  button, the rename `pencil` (`stats.manage`) beside it. The button opens a panel modal, never
  a `<select>` — a party is more than its name: one row per session, `aria-pressed` on the
  current one, the name (or its date when unnamed) over a meta line "12 Aug 2026 · 5 singers ·
  23 scores", and at the head one row for everything at once (`layers`) — *All parties* with
  `stats.history`, *All my scores* for a reader who only sees the parties they sang in, over the
  same line for the lot ("3 parties · 60 scores"). The rows are `PickerRow`'s shape — its
  stylesheet, not the component: a party is not something a song is *on*, so no membership mark —
  and the pressed one wears the `--highlight-blue-dark` band under a `--highlight-blue-light`
  name. A party row has no lead, so the head row's `layers` sits in the line of its name rather
  than in a 40px square that would set one title 52px off all the others. The list
  holds exactly the sessions that reader may open, so it never names a party to say no to it.
  A party can also be kept out of that list. `stats.hide` puts one `aria-pressed`
  `.icon-button` in the panel's header beside the close — the only control a panel header
  carries besides its heading and its close (§5) — switching the list into **show all**:
  `eye-off` on it while the hidden parties are out, `eye` while they are in, the state the
  glyph reads in the people admin. In that mode the list holds every party the reader may
  open, hidden ones included, each row carrying the same pair beside its button and never
  inside it, and a hidden one wears `eye-off` and draws its name in `--color-darker`. The
  hiding reaches this list and nothing else: the party keeps every score it has, in a
  singer's record, in a song's best scores and in every total. Tonight's party is never
  hideable — the evening being sung is what this page is for — and neither is the head row,
  whose "3 parties · 60 scores" counts the hidden ones too, because opening it opens them.
  Two chart cards, both `.scores-chart` (§1.2), every mark hand-drawn SVG. The whole-session
  card comes first: every score on one staggered strip (`ScoreStrip` — near-ties step aside
  instead of hiding, the best is gold and named, the median a dashed line), with §4's
  hidden-radio pills standing where its title would — **All scores ⇄ The evening** — swapping
  in the timeline (`EveningTimeline`: score over wall-clock time, `chartTheme.categorical`'s
  five CVD-safe hues on the session's five best singers, grey beyond, never a sixth hue).
  Every-party-at-once keeps the strip alone under a plain title: a heap of parties is no
  evening. Under the two selects, the spread card (`SpreadRows`) follows the grouping alone:
  a player with ≥ 5 scores gets a Tukey box (whiskers end on real scores, outliers flagged on
  both sides) with every raw score as a 2px neutral-grey dot on top, fewer stagger as plain
  marks; a song row is a swarm wearing singer initials until 8 scores, then dots — never a
  box; ungrouped there is no spread card, the strip already is that view. Rows lie down at
  full card width — nothing scrolls sideways, a song keeps its artist — the card draws the
  first eight groups of the list in the same order and owns up to the rest ("… n more in the
  list below"), and every mark answers hover or tap with `ChartTip` — a mouse hovers per mark; a
  finger tap resolves on the chart surface to the nearest mark within ~28px (a fingertip covers
  ~40px, a mark 6px — nobody pixel-hunts), toggles off on a repeat, and dismisses beside the
  marks; `.chart-plot` carries `touch-action: manipulation` so two quick taps are two taps, not
  a double-tap zoom. *Chronological* joins
  the sort select for every grouping but *group by player*, where an order in time says nothing:
  choosing it and then grouping by player falls back to *best score* — and it only orders the
  rows and the list, never swaps a chart.
- **Score summaries** are one shape wherever a set of scores is added up, drawn in one place
  (`ScoreSummary`): Sings (`hash`) · Songs (`music`) · Best (`arrow-up`) · Average
  (`average`) · Worst (`arrow-down`), in that order — what was sung before how well it went,
  and the three score numbers reading down from the best — as `IconStat`s printing the word
  under every number (`showLabel`), because a row of five glyphs is exactly where an icon
  stops being self-evident (§1.5). Sings counts distinct sings, so one duet run is one of
  them, not two; Songs is left out where every score is the same song. Best and Worst name the
  singer who holds them ("Best · alice") unless every score in the summary belongs to the
  reader: §1.5's rule against repeating a datum gives way here, a ranking below naming rank 1
  again, one shape beating one line saved. One chart may follow, under one threshold: **fewer
  than four scores draws none at all** — two dots have no spread and a handful of bars across
  twenty buckets is noise — and the list, wherever there is one, is drawn either way. *Which*
  chart stays the surface's own: the histogram where the reader is after a distribution (the
  user page, an open score group), the dated `ScoreStrip` where they are after the scores
  themselves (the song modal's Best scores, over its ranking). `SessionSummaryRow` is not one
  of these and does not become one — it says what a party *was*, not how scores fell.
- **Score rows** are flat `<details>` groups: rank numeral (pink top 3), cover or avatar, two
  lines of text, score, chevron. The two lines are a list row's: title over artist for a song,
  name over "N scores" for a singer. An open row is one tile (`.score-group-panel`) — the score
  summary over a hairline, then the scores as ordinary list rows, `border-box` at the tile's
  width, their hover band lifting off `--tile-bg`. A one-score group drops the summary;
  ungrouped, a row *is* a score and never unfolds. A score row carries, for `stats.moderate`,
  **one** control: a `pencil` opening the panel both corrections live in — the line naming the
  score, the `PickerRow` players that put it on the singer who actually sang it, and at the
  foot a `.button-danger` Delete through its own `ConfirmModal`, the Manage page's idiom. Two
  40px buttons per row is chrome where the numbers belong, and deleting is the rarer of the
  two. Both confirmations stand over the panel rather than instead of it, so cancelling comes
  back to the players; its title and the pencil's label cover the pair, a panel that also
  deletes not being "Who sang this?" alone. The number and the song are never editable — a
  wrongly picked singer is the mistake this fixes.
- **User** (`/user`) is the identity tile, the singer's own record, then *Manage*. The record
  opens with the score summary above, its Best and Worst unnamed — every score on this page is
  the reader's own — and no favorites count: favorites are a filter, not an achievement. Under
  it the histogram, and under that *All my scores*, which belongs to those stats and not to the
  errands below: a flat full-width row held to them by a hairline `border-top`, 0.85em label in
  `--highlight-blue-light` with a `chevron-right` — never `.home-entry`, whose 48px glyph row is
  `ManageMenu`'s idiom.
- **People** (`/user/accounts`, `PeopleAdmin`) gives each of its two `h2`s one `.section-note`:
  *Accounts* says a forgotten password is no disaster — delete the account, register the name
  again, the player keeps every score — *Guests* that a guest is taken over by whoever registers
  that name. A row's trailing controls run eye, role, delete. The `eye` / `eye-off`
  `.icon-button` (`aria-pressed`, `players.manage`) puts a player out of sight for the evening:
  hidden means gone from player selection and from nothing else — scores, stats and past
  sessions still name them — and the row draws its name in `--color-darker` while it lasts.
  Logging in unhides.
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
- **Host** (`/host`) is a TV across the room: everything scales with `clamp()` and `vh`, flat on
  `--bg`, the white QR card the only tile. Controls reveal on pointer movement through the
  page's single `useIdle` mechanism — never add a second idle timer. Verify at 1280×720 and up,
  and re-check it after touching any shared component (`CurrentlyPlaying`, `LastSong`,
  `SongCover`, `SessionLeaderboard`). `LastSong` takes the same score summary as the phones,
  in the naming column beside the cover and under the artist line, wrapping there instead of
  standing as a column of its own; the cover keeps its size, and the marker strip and the
  score bars follow underneath. **The markers keep a minimum gap** of about 2.5em of their own
  font size — one glyph, its pointer, and air — and the average is what yields: inside that
  gap it is not drawn, being the number the two ends already imply, and when worst and best
  themselves fall inside it the three collapse into one mark wearing `average`. Nothing is
  lost by it, the strip being decoration for numbers the summary prints in full above it.
  **New achievements take the whole screen.** While `HostAchievements` is `playing` the rail is
  not rendered at all — no QR card, no standing, no wishes — the stage runs the full width of
  the page, and the results wait underneath as they already do. `playing` only: the `waiting`
  beat, held for badges that may never come, leaves the rail where it is. Everything grows a
  step for those seconds — the singer's avatar to `clamp(96px, 16vh, 240px)` under a name in
  the same proportion, and the whole `--badge` ladder up one rung, the row of four taking
  today's one-badge `clamp(34px, 6.4vh, 74px)` and the rows of one to three keeping the lead
  they hold over it today, `--column` and the gaps widening with them. The page keeps its one
  `useIdle` mechanism, and every animation keeps its reduced-motion branch (§1.9).

## 8. Checklist before finishing UI work

1. No new `--tile-bg` outside the whitelist; no per-row badge beyond an opt-in mark (§1.3).
2. Icon-only controls use `.icon-button*`; new icons are one path, listed in §3 with a note.
3. New routes: `App.tsx` **and** `COVERS`; sub-pages: `PageHeader`, `back`, capability gate.
4. Every animation has a reduced-motion branch; every control has a name and a focus ring.
5. Nothing scrolls sideways at 360px; the host page still reads at 1280×720.
6. Tests referencing changed labels/roles are updated, not deleted.
7. `docs/user/` reflects moved buttons, renamed tabs and new controls.
