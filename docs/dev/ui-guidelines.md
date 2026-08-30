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
3. **No per-row badges for near-universal attributes.** No "MP3", "video", "duet", "downloaded"
   or role chips per row — those belong in the details modal. Allowed per row: the marks of rule
   4 and one numeric (or `—`) value column. Tag marks are the opt-in exception: a tag most songs
   would wear leaves `show_in_list` off.
4. **List rows carry passive marks, never toggles.** After the title, in DOM order:
   `.song-mark-sung` (`mic`), `.song-mark-favorite` (`heart`) — each in its built-in's
   configured colour (blue and pink by default), and only while that built-in is shown in the
   song list — then one `.song-mark-tag` per visible `show_in_list` tag in the tag's colour.
   Each is `font-size: 0.8em; flex: 0 0 auto`; state is set in the song modal. That colour
   paints the built-in's Filter row and Songs chip glyph too; the heart and mic **toggles**
   (Home stage, song modal) keep their accent colours — they are controls, not tags.
   `.song-mark-wished` (blue `check`) is the wishlist tile's alone; rows never draw it.
5. **Icons over words.** Structure with `Icon` + layout; add a text label only where the icon is
   ambiguous. Never repeat a datum the surrounding view already shows (duration is in the
   preview player; artist is in the hero).
6. **`--highlight-red-light` is fill/border only** — as a glyph colour on `--bg` it is ~2.3:1.
   Failure text is `color: var(--color)` on `background-color: var(--highlight-red-dark)`.
7. **Reuse the shared classes** in `index.css`: `.button` / `.button-primary` /
   `.button-danger`, `.text-input[-quiet]`, `.icon-button[-bordered|-danger]`, `.error-notice`,
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

## 2. Tokens, spacing, typography

Tokens live in `frontend/src/index.css` (dark-only). Do not introduce new tokens; compose with
`color-mix(in srgb, …)` if a value is missing.

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
control glyph. `clock` is "Recent". **`tag` is the tags feature**: the modal's Tags row, the
Tags admin entry and its `ManageMenu` row, the tags empty state, the fallback for an icon-less
tag — so the song details list's **Genre** row takes `music` instead.

Glyphs with a fixed meaning; rows 1–2 are families kept apart at a glance. What a tag may wear
is the picker's list below, never this table.

| Glyph | Means | Drawing note |
|---|---|---|
| `playlist-plus` / `playlist-check` | wish off / wish on; `playlist-plus` also heads the wishlist | solid bars |
| `list-plus` / `list` / `list-check` | add to playlist / picker row not in it / already in it; `list` is also the "Playlists" link | bulleted rows |
| `filter` / `comment` / `drag-handle` / `copy` | the Songs Filter chip and its panel · comments: modal row, sub-view, empty state · the reorder grip in playlist edit mode · "Save a copy" of a playlist | solid funnel, a wide bar tapering into a short stem · one rounded speech bubble, tail at the bottom left · six dots in two columns of three · two offset rounded squares, the front one solid |
| `send` / `user-plus` | submit in the comment composer · add a member, add a person to a tag | a paper plane, one triangle with the fold cut out · the `user` bust with a plus at its shoulder |
| `lock` / `bookmark` / `bookmark-off` | a tag row nobody assigns here (no `assign`, or automatic) · follow / unfollow a playlist, `bookmark-off` also labelling the collapsed *Hidden* group | padlock, solid body under a counter-wound shackle so the nonzero fill leaves the hole · ribbon with a notched foot · the same ribbon behind a diagonal bar |
| `archive` / `flame` / `moon` | a tag for put-away songs · for party songs · for slow songs and ballads | a lid bar over a box body, one notch in the lid · one teardrop tongue, notched at the foot · a crescent, a disc cut out of a disc |
| `snowflake` / `gift` / `cake` / `child` | tags for christmas: the winter half · presents · a tag for birthdays · for songs for kids | three crossed bars, a short fork at each of the six tips · a box under a lid bar, one ribbon band down the middle · a slab on a plate, three candles · a round head over a body, arms out and legs apart, never `user` |
| `guitar` / `crown` / `film` / `gamepad` / `flag` / `skull` | a tag for rock · for the classics everybody knows · for movies and musicals · for game music · for a language or country · for hard to sing | a rounded body, sound hole cut out, neck to the top right · three points over a solid band · a strip with two rows of sprocket holes, `video` staying the camera · a lozenge, d-pad cross and two buttons cut out · a triangular pennant on a staff · a cranium over a jaw, the eye sockets cut out |

The **icon picker** (tag editor) offers `PICKER_ICON_NAMES`, an allowlist in `icons.tsx` — the
glyphs that say something about a *song*: `users`, `alert`, `archive`, `calendar`, `disc`,
`user`, `video`, `music`, `flame`, `moon`, `snowflake`, `gift`, `cake`, `child`, `guitar`,
`crown`, `film`, `gamepad`, `flag`, `skull`. A glyph whose job here means something else stays
out (`clock`, `globe`, `star`, `trophy`, `tag`), as do the dice, the control glyphs and the row
marks `heart` / `mic`; `music` stays, meaning genre in both places. A tag may wear a glyph the
picker does not offer: it draws like any other and its editor keeps it chosen and choosable.
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
- **Text inputs, loud and quiet:** `.text-input` (16px radius, `--input-bg`, ≥40px) is for the
  page's one main control (the Songs search); `.text-input-quiet` (36px, hairline, transparent)
  is everything else — settings fields, selects, filters, forms. At most one loud input per
  page. Quiet `<select>`s carry grouping/sorting (Scores) and a member's access level.
- **Song controls** (`components/SongControls.css`), in the song modal and the Home stage: two
  48px `.song-control` flanks (favorite / wish; glyph `--color-darkerer` off, accent on, no
  fill) around a 72px unfilled `.song-control-lead` (blue play, pink stop on the stage), grid
  `1fr auto 1fr`. No filled play button.
- **Segmented / pill choices** (`.spinner-scope`, chips): a `.visually-hidden` native radio in a
  `<label>` plus a visible `<span>`; checked = `--highlight-blue-dark` fill,
  `--highlight-blue-light` border/text; focus via `input:focus-visible ~ span`. For 2–4
  exclusive options that must all stay visible. The **tri-state control** (`.tri-state`) is that
  pattern at three options — **Any / Yes / No**, in that order: a `<fieldset>` with a
  `visually-hidden` legend naming the criterion, per option a `.tri-state-option` label around
  the hidden radio and a `.tri-state-text` span (40px min-height, `padding: 0 10px`, 0.85em, 4px
  gaps, the group `flex: 0 0 auto`, ~150px). *Any* is checked by default, a `hide_by_default`
  tag opens on *No*. Its row is glyph (1.15em, tag colour) · name (`flex: 1 1 auto; min-width:
  0`, ellipsis, never wraps) · control. **`CheckOption`** is for the few places where a handful
  of options all fit on screen — download-panel filters, video-quality presets; dense matrices
  of them (permissions, tag flags, settings toggles) keep native checkboxes.
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
  two buttons carry it as a fill, the playlist header's icon-only link on the glyph. On SPIN the
  die tumbles through its faces.
- **`Loading`** (`components/Loading.tsx`) is the only loading indicator — every `Suspense`
  fallback and `isPending` branch uses it. `SongSpinner` is the reel, not a loader.

## 5. Modals

`components/Modal.tsx` props: `title` (accessible name), `onClose`, `fullscreen`, `hideTitle`,
`bare`.

- **Bare modal** (`bare` + `hideTitle`) — the song modal (`SongDetails`) and its sub-views.
  Structure: hero (`.song-hero`: cover, title 1.15em, artist 0.85em `--color-darker`) → optional
  preview `<audio>` → the song controls row → option rows (`.song-option`, 44px, hairline
  `border-top`: icon, label in `--color-darker`, optional accent value, chevron). A collapsed
  row points `chevron-right`; one expanding inline swaps to `chevron-down` with `aria-expanded`
  — never rotate the glyph.
- **Sub-views** replace the modal body, the header's close acting as back: Best scores, Add to
  playlist, Tags, Comments, Player selection, and Add songs (same mechanism, from the playlist
  page). Row order: Details, Best scores, Add to playlist, Tags, Comments. The Tags row's value
  is the song's tag glyphs (a count past three), the row absent when no tag is visible to the
  reader; Comments shows the count. Inside Tags, an assignable tag is a toggle row
  (`aria-pressed`), any other — unassignable or automatic — a `lock` row. **Add to playlist**
  gives `playlists.manage` holders one `aria-pressed` row per playlist they may edit (state from
  the listing's `contains` flag, not a fetch per row) and a "New playlist…" row (`plus`).
- **Comment rows**, oldest first: 40px `PlayerAvatar` · username with a relative time (0.85em
  `--color-darker`) on one line · the body underneath, `overflow-wrap: anywhere` · a trailing
  `.icon-button-danger` `trash` for the author and `comments.moderate`, through `ConfirmModal`
  (`danger`). The composer at the foot: a quiet `<textarea>` (2 rows) and a 40px `send`
  `.icon-button`, disabled while empty. Reading needs only `songs.view`; a reader without
  `comments.write` gets one line naming who may write in the composer's place.
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

## 7. Page conventions

- **Song list rows** (`SongListItem`): 40×40 cover, title + passive marks, artist in
  `--color-darker`; the row opens the song modal. **Album covers are square** except the spinner
  reel frame; `PlayerAvatar` is `--border-radius-small` (people, not covers), the 96px identity
  avatar round. Sizes: 40px in rows, 200px (`max-width: 60vw`) in the modal hero, 160px on Home,
  `min(42vh, 30vw)` on the host; the fallback is the initial letter on `--input-bg`.
- **Home** is `HomeStage` (identity tile that becomes the current song while one plays — cover,
  title/artist, song controls; **no** time, progress or singer list on phones) → setup banner →
  wishlist → the Random song entry. Nothing shifts when the stage switches.
- **Songs** carries the chip row All · Favorites · Recent · Sung · **Filter** · the playlists
  link. All keeps its label, owning no glyph; every other chip is its glyph alone until pressed.
  Filter reads "Filter · N" pressed, N being the criteria off *Any*. The chips are presets over
  that state: Favorites and Sung set exactly their own criterion to *Yes*, All returns to the
  defaults, Filter lights for anything else. Recent is its own exclusive mode (a time-ordered
  list, not a criterion); the criteria still apply inside it. A `hide_by_default` tag keeps its
  songs out of the list and the reel while its criterion sits on *No*. The **Filter panel**
  lists Favorites (`heart`), Sung (`mic`) and every visible tag, each row ending in the
  tri-state control of §4.
- **Playlists** (`/songs/playlists`): flat `h2` groups — *Your playlists*, *Shared with you*,
  *Global* — then a collapsed `<details>` *Hidden* for unfollowed shared lists, rendered only
  when it has rows; global lists never hide. A row is a 40px cover mosaic (2×2 of the first
  covers; one cover fills the box, none falls back to the `list` glyph square), the name with a
  passive `globe` mark when global, a meta line "12 songs · 48 min · by alice" (the owner named
  outside *Your playlists*) and a chevron. The header `+` opens the New playlist panel and
  navigates into what it creates. No edit or delete control on a row — management lives behind
  the detail page's gear — and each group carries its own `EmptyState`.
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
- **Tags admin** (`/user/tags`, a `ManageMenu` entry gated on `tags.manage`): rows of the 40px
  coloured glyph square, the name, a meta line "N songs · automatic: language = English · hidden
  by default · shown in list" and a chevron; the header `+` opens `/user/tags/new`. Under them
  an `h2` *Built-in* over the fixed pair *Favorites* (`heart`) and *Sung* (`mic`) in the same
  row shape, placed after the rows `+` and Delete govern; their meta line is "per person · shown
  in list", never a song count, which differs per reader. *Recent* is a mode, not a tag, and has
  no row. The **tag editor** (`/user/tags/:id`) runs in one order: Name (quiet input), Icon (the
  picker grid), Colour (radio pills), the checkboxes "Show in song list" and "Hide songs by
  default", each with a one-line explanation of its effect on other people, *Automatic*, the
  permission matrix (rows *See tag* / *See songs* / *Tag songs* × columns Guest / User /
  Trusted, admin always on), then "Specific people" — people-rows with the same three
  checkboxes. Save is the page's one primary; an existing tag ends with a danger Delete whose
  `ConfirmModal` says how many songs lose it. A **built-in** opens that editor on a reserved id
  (`/user/tags/favorites`, `/user/tags/sung`) — one row idiom, one editor, and a 32-hex tag id
  cannot collide with either word; being a per-person fact it keeps only Colour and "Show in
  song list" (`heart` pink, `mic` blue, both shown in the list by default), the usual Save and
  one line saying why: no name, icon, hiding, rule, permissions, people or Delete.
- **Automatic** sits between the flags and the matrix — how a tag reaches a song, before who may
  put it there: a quiet `<select>` (*Not automatic*, *Duet*, *Has video*, *Language is…*, *Genre
  is…*, *Edition is…*) plus, for the last three, a quiet text input whose `<datalist>` suggests
  the library's values. A rule hands the tag to the scanner alone: *Tag songs* in the matrix and
  the people-rows' assign checkbox stay but go `disabled` under one explaining line — dropping
  them would read as a lost permission. The Filter panel treats the tag like any other.
- **Scores** rows are flat `<details>` groups: rank numeral (pink top 3), cover or avatar, two
  lines of text, score, chevron. The two lines are a list row's: title over artist for a song,
  name over "N scores" for a singer. An open row is one tile (`.score-group-panel`) — the
  summary (`hash` / `arrow-up` / `arrow-down` / `average` as labelled `IconStat`s plus the
  histogram) over a hairline, then the scores as ordinary list rows, `border-box` at the tile's
  width, their hover band lifting off `--tile-bg`. A one-score group drops the summary;
  ungrouped, a row *is* a score and never unfolds.
- **Settings** groups are `<details class="settings-group" open>` with a section icon; fields
  are flat `.setting-field` rows with quiet inputs and a 0.85em description; complex settings
  get their own sub-page, not an inline block. A group's `advanced=True` settings follow its
  ordinary ones in a nested `<details class="settings-advanced">` labelled *Advanced*, closed by
  default — never a section of its own, never a group's only content.
- **Host** (`/host`) is a TV across the room: everything scales with `clamp()` and `vh`, flat on
  `--bg`, the white QR card the only tile. Controls reveal on pointer movement through the
  page's single `useIdle` mechanism — never add a second idle timer. Verify at 1280×720 and up,
  and re-check it after touching any shared component (`CurrentlyPlaying`, `LastSong`,
  `SongCover`, `SessionLeaderboard`).

## 8. Checklist before finishing UI work

1. No new `--tile-bg` outside the whitelist; no per-row badge beyond an opt-in tag mark (§1.3).
2. Icon-only controls use `.icon-button*`; new icons are one path, listed in §3 with a note.
3. New routes: `App.tsx` **and** `COVERS`; sub-pages: `PageHeader`, `back`, capability gate.
4. Every animation has a reduced-motion branch; every control has a name and a focus ring.
5. Nothing scrolls sideways at 360px; the host page still reads at 1280×720.
6. Tests referencing changed labels/roles are updated, not deleted.
7. `docs/user/` reflects moved buttons, renamed tabs and new controls.
