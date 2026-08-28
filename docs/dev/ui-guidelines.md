# UI Guidelines

How the Wingman UI looks and why. Read sections 1–3 before touching any
frontend file; the rest when the area applies. The old app
(`D:\git\ultrastar-wingman`) is ground truth for the **look** only — when in
doubt, check how its CSS treated the equivalent surface. Never copy its code.

Precedence: an explicit request from the user beats this document. If a
request conflicts with a rule here, implement the request and say so in the
report — do not "fix" it back in review. The only rules a request does not
override are the accessibility and dependency floors in §1.8–1.10.

## 1. Hard rules

1. **Flat by default.** Content sits on the page background (`--bg`) with
   hairline separators (`1px solid var(--input-border-color)`) and spacing. No
   cards, shadows or inner backgrounds for ordinary content. If a section
   "needs a box", it needs a separator and 16px of margin instead.
2. **`--tile-bg` is whitelisted, not general.** Allowed: the Home stage
   (`.home-stage`), the User identity card (`.user-identity`), modal panels
   (`.modal`, non-bare), the Scores boxplot card (`.scores-chart`), an opened
   score group (`.score-group-panel`), the USDB login card and the login form,
   and the "add songs from…" source cards.
   Nothing else. Extending the whitelist is a user decision.
3. **No per-row badges for near-universal attributes.** No "MP3", "video",
   "duet", "downloaded", role chips per account row. Such facts belong in the
   details modal. Allowed per row: the passive marks of rule 4 and one numeric
   (or `—`) value column.
4. **List rows carry passive marks, never toggles.** After the title:
   `.song-mark-favorite` (pink `heart`) when favorited, `.song-mark-wished`
   (blue) when wished — `font-size: 0.8em`, `flex: 0 0 auto`. State is set in
   the song modal, not in the row.
5. **Icons over words.** Structure with `Icon` + layout; add a text label only
   where the icon is ambiguous. Never repeat a datum the surrounding view
   already shows (duration is in the preview player; artist is in the hero).
6. **`--highlight-red-light` is fill/border only.** As a glyph color on `--bg`
   it is ~2.3:1. Failure foregrounds are `color: var(--color)` on
   `background-color: var(--highlight-red-dark)`.
7. **Reuse the shared classes** in `index.css`: `.button` /
   `.button-primary` / `.button-danger`, `.text-input` / `.text-input-quiet`,
   `.icon-button` / `.icon-button-bordered` / `.icon-button-danger`,
   `.error-notice`, `.visually-hidden`, `.icon`, the global `:focus-visible`
   ring. Extend with a modifier class; never write a second bespoke 40×40
   icon-button rule.
8. **No new dependencies** for UI (no icon library, no loader library, no CSS
   framework).
9. **Every animation has a `prefers-reduced-motion: reduce` branch.**
10. **Touch floors:** icon-only controls ≥ 40×40, list rows ≥ 44px tall. A
    labelled text field is neither (the quiet input is 36px).
11. **Nothing scrolls the page sideways** at 360px width
    (`documentElement.scrollWidth == clientWidth`). Long text truncates or
    clamps; long unbreakable strings get `overflow-wrap: anywhere`.
12. **A row's hover state is for pointers.** Every hover that paints a row —
    the `--highlight-blue-dark` band, a lit label — sits inside
    `@media (hover: hover)`. A touch screen reports `hover: none` and fakes a
    hover on tap, which then stays on the row long after the finger has
    scrolled away. Focus rings, `:active` and control hovers are untouched.

## 2. Tokens, spacing, typography

Tokens live in `frontend/src/index.css` (dark-only, same values as the old
app). Do not introduce new tokens; compose with `color-mix(in srgb, …)` if a
value is missing.

| Token | Use |
|---|---|
| `--bg` | page background; sticky toolbars repaint it |
| `--footer-bg` | bottom nav only |
| `--tile-bg` | whitelisted surfaces (rule 1.2) |
| `--input-bg` | inputs, buttons, chips, avatar/cover fallback, progress track |
| `--color` / `--color-dark` / `--color-darker` / `--color-darkerer` | primary text · secondary text and idle icon glyphs · meta/artist lines · disabled and off-state |
| `--highlight-blue-light` / `-dark` | active/selected accent, focus ring, stat icons, wished mark · hover/active fill, primary button |
| `--highlight-pink-light` / `-dark` | favorite heart, podium numerals, host accents · score-bar fill |
| `--highlight-red-light` / `-dark` | fill/border only · danger fill under white text |
| `--highlight-gold-light` | scores, trophies, "New Highscore", star fill |
| `--border-radius` (16px) / `--border-radius-small` (8px) | tiles, modals, buttons, inputs, chips · icon buttons, avatars, hover bands |
| `--input-border-color` | **all** hairline separators and input borders |

Spacing: page gutter 16px; section rhythm 16px; inner gaps 4/8/12/16px
(tight icon cluster / default / row content with cover / page blocks). Row
separators: `border-bottom` + `:last-child { border-bottom: none }`, or
`border-top` on `li + li` — never both. Hover bands that bleed past the
gutter: list margin `0 8px`, row padding `10px 8px` (pointer-only, rule 1.12).

Typography: `h1` 1.5em centered (`margin: 32px 16px 16px`); sub-pages use
`PageHeader`, which left-aligns it. `h2` 1em, `margin: 16px 16px 0`. Captions
0.85em in `--color-darker`; fine print 0.8em. Updating or column-aligned
numbers: `font-variant-numeric: tabular-nums`. Single-line text: `overflow:
hidden; white-space: nowrap; text-overflow: ellipsis` with `min-width: 0` on
the flex parent; titles that may wrap use a 2-line clamp.

Bottom-nav destinations (`Songs`, `Scores`) have **no visible page heading** —
the tab already names them; keep the `h1` as `visually-hidden`. `Home` and
`User` keep their visible headings.

## 3. Icons

`frontend/src/components/icons.tsx` is the only icon source. `Icon({ name,
className })` renders exactly one `<path d>` in a 24×24 viewBox with
`fill: currentColor`; size comes from the parent's `font-size` (`.icon` is
1em). `gradient` swaps that fill for a per-instance two-stop diagonal
gradient whose stops the caller colours with `stop-color` (`.playlist-spin`
is the only user). Check `ICON_PATHS` before adding — the set already covers search,
refresh, play, stop, heart, plus, check, close, chevrons, arrows, download,
clock, alert, trash, pencil, shield, users, gear, star, trophy, mic, globe,
tag, calendar, disc, user, database, video, music, info, list/playlist
families, chart, average, hash, image, power, dice (`dice` is the five; `dice-1`…`dice-6`
are the other faces), tv, github.

Two glyph families keep wishes and playlists apart at a glance:

| Concept | Glyph |
|---|---|
| wish off / wish on / wishlist heading | `playlist-plus` / `playlist-check` / `playlist-plus` (solid bars) |
| add to playlist / picker row not in it / already in it / "Playlists" link | `list-plus` / `list` / `list-check` / `list` (bulleted rows) |

Never `heart` for a wish (favorites own it), never `star` (the winner accent
owns it), never a bare `check` as a control glyph. `clock` is "Recent".

Adding an icon: append one `d` string to `ICON_PATHS` (several subpaths in the
one string are fine; solid shapes — no `fill-rule`, no `stroke`, no `<g>`).
Never inline an `<svg>` in a component (the one existing exception,
`BottomNav`, stays). Tests identify glyphs with `iconNames()` from
`src/test/icons.ts`.

## 4. Buttons and controls

- **Text buttons:** `.button` (flat, `--input-bg`), `.button-primary`
  (`--highlight-blue-dark`), `.button-danger`. Exactly one primary per view.
  Confirm dialogs: Cancel first, then primary/danger, both `flex: 1 1 0`.
- **Text inputs, loud and quiet:** `.text-input` (16px radius, `--input-bg`,
  ≥40px) is the loud input — for the one page-level control the reader came
  for (the Songs search). `.text-input-quiet` (36px, hairline, transparent) is
  for everything secondary: settings fields, selects, filters, forms. Rule of
  thumb: at most one loud input per page.
- **Icon buttons:** `.icon-button` = 40×40, transparent, `--color-dark` glyph,
  hover `--highlight-blue-dark` fill. `.icon-button-bordered` when it sits next
  to an input on the page background; `.icon-button-danger` for destructive.
  Always `aria-label`; add `title` for toolbar-level buttons.
- **Song controls** (`components/SongControls.css`): the shared row used by
  the song modal and the Home stage — two 48px `.song-control` flanks
  (favorite / wish, glyph `--color-darkerer` off, accent on, no fill) around a
  72px unfilled `.song-control-lead` (blue play in the modal, pink stop on the
  stage). Layout is a `1fr auto 1fr` grid. Do not reintroduce a filled play
  button.
- **Segmented / pill choices** (`.spinner-scope`, chips): a `.visually-hidden`
  native radio inside a `<label>` plus a visible `<span>`; checked =
  `--highlight-blue-dark` fill, `--highlight-blue-light` border/text; focus via
  `input:focus-visible + span`. For 2–4 mutually exclusive options that must
  all be visible — the spinner scope is the reference implementation.
- **The gradient dice** (`.home-random`, `.spinner-spin`, `.playlist-spin`):
  the blue→pink sweep with the `dice` glyph marks the way into the slot
  machine and the SPIN action itself, nothing else. Two buttons carry it as a
  fill — the only gradient buttons in the app — and the playlist header's
  icon-only link carries it on the glyph, where a filled 40px tile would read
  as a second header. On SPIN the die tumbles and rolls through its faces
  while the reel runs.
- **`CheckOption`** (the old app's animated round check) only where a handful
  of options all fit on screen — today the download-panel filters and the
  video-quality presets. Dense matrices
  (permissions, settings toggles) keep native checkboxes with
  `accent-color: var(--highlight-blue-light)`.
- **Quiet `<select>`s** for grouping/sorting controls that should not dominate
  (Scores).
- **`Loading`** (`components/Loading.tsx`) is the only loading indicator —
  every `Suspense` fallback and `isPending` branch uses it. `SongSpinner` is
  the slot-machine reel, not a loader.

## 5. Modals

`components/Modal.tsx` props: `title` (accessible name), `onClose`,
`fullscreen`, `hideTitle`, `bare`.

- **Bare modal** (`bare` + `hideTitle`) — the song modal (`SongDetails`) and
  its sub-views. Structure: hero (`.song-hero`: 200px cover, title 1.15em,
  artist 0.85em `--color-darker`) → optional preview `<audio>` → the song
  controls row → option rows (`.song-option`, 44px, hairline `border-top`:
  icon, label in `--color-darker`, optional accent value, chevron). Every
  collapsed option row points `chevron-right`; a row that expands inline swaps
  to `chevron-down` while `aria-expanded` — never rotate the glyph. Sub-views
  (Best scores, Add to playlist, Player selection) replace the modal body;
  the header's close acts as back.
- **Panel modal** (default): `--tile-bg`, `--border-radius`, sticky header with
  `h2` + close. Confirmations, pickers, admin dialogs, the download queue.
- **Fullscreen** — player selection only.
- Backdrop click and Escape close; the focus trap stays.
- **Confirmations always use `ConfirmModal`** (`window.confirm` is banned):
  title, one-sentence consequence, `confirmLabel`, `danger` for
  stop/delete/replace.
- **"Add songs from…" picker:** panel modal with a grid of source cards
  (`repeat(auto-fit, minmax(140px, 1fr))`, `--tile-bg`, icon ~48px, name,
  one-line description). The sanctioned tile use; cards must read as buttons.

## 6. Sub-pages and navigation

Full-page sub-views are **routes**, not modals. Shape: `<PageHeader
title="…" back="/parent">` (trailing page-level controls as `children`, never
a second row), content, and — when capability-gated — `auth.loaded &&
auth.can(...)` with a `<p className="settings-notice">` fallback saying who may
do it. Back is a `<Link>` to a fixed path (`backLink.ts` resolves a
state-provided target), not `history.back()`.

Every new route: register in `App.tsx` **and** add it to `COVERS` in
`BottomNav.tsx` so the owning tab stays lit. `/host*` renders no bottom nav.

## 7. Page conventions

- **Song list rows** (`SongListItem`): 40×40 square cover, title + passive
  marks, artist line in `--color-darker`; the row opens the song modal.
- **Album covers are square** everywhere except the spinner reel frame;
  `PlayerAvatar` is `--border-radius-small` (people, not covers) and the 96px
  identity avatar is round. Sizes: 40px in rows, 200px (`max-width: 60vw`) in
  the modal hero, 160px on the Home stage, `min(42vh, 30vw)` on the host.
  Fallback is the initial letter on `--input-bg`.
- **Home** is `HomeStage` (identity tile that becomes the current song while
  one plays — cover, title/artist, song controls; **no** time, progress or
  singer list on phones) → setup banner → wishlist → the Random song entry.
  Nothing may shift when the stage switches state.
- **Scores** rows are flat `<details>` groups: rank numeral (pink top 3),
  cover or avatar, two lines of text, score, chevron. The two lines are a list
  row's, never a spread crammed into one: title over artist under a song, name
  over "N scores" under a singer. Everything an open row shows is one tile
  (`.score-group-panel`): the group's summary — `hash` / `arrow-up` /
  `arrow-down` / `average` as labelled `IconStat`s plus the histogram — over a
  hairline, then the scores themselves as ordinary list rows (songs: title over
  artist; singers: avatar and name). A group of one score has no summary, so
  the tile opens on its single row. Ungrouped a row *is* one score and does not
  unfold at all: it is a plain row that opens the song. Rows inside the tile
  are `border-box` and take its width; their hover band is a lift off
  `--tile-bg` (`--highlight-blue-dark` is that same colour).
- **Settings** groups are `<details class="settings-group" open>` with a
  section icon; fields are flat `.setting-field` rows with quiet inputs and a
  0.85em description; complex settings get their own sub-page, not an inline
  block. A group's `advanced=True` settings follow its ordinary ones in a
  nested `<details class="settings-advanced">` labelled *Advanced*, closed by
  default — never a section of its own, and never a group's only content.
- **Host** (`/host`) is a TV across the room: everything scales with
  `clamp()` and `vh`, flat on `--bg`, the white QR card is the only tile.
  Controls reveal on pointer movement through the page's single `useIdle`
  mechanism — never add a second idle timer. Verify at 1280×720 and larger;
  re-check the host page after touching any shared component
  (`CurrentlyPlaying`, `LastSong`, `SongCover`, `SessionLeaderboard`).

## 8. Checklist before finishing UI work

1. No new `--tile-bg` outside the whitelist; no new per-row badge.
2. Icon-only controls use `.icon-button*`; new icons are single-path entries.
3. New routes are in `App.tsx` **and** `COVERS`; sub-pages have `PageHeader`
   with `back` and a capability fallback.
4. Every animation has a reduced-motion branch; every interactive element has
   an accessible name and reaches the focus ring.
5. Nothing scrolls sideways at 360px; the host page still reads at 1280×720.
6. Tests referencing changed labels/roles are updated, not deleted.
7. `docs/user/` reflects moved buttons, renamed tabs and new controls.
