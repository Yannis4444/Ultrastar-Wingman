# Documentation Guidelines

Binding rules for everything Wingman publishes in words: the documentation site under
`docs/user/`, and the text the app itself shows. Read this file before you write a page.
A page that breaks a rule here is not done.

Two audiences, two places. Never mix them.

- **The site** (`docs/user/`) is for the people who run and attend karaoke parties, plus a
  small integration section for people building around Wingman.
- **`docs/dev/`** (this folder) is how we work on the code. It never ships to the site.

Build the site from `docs/`, and only from there. From the repository root:

```powershell
venv\Scripts\python.exe -m pip install -r docs\requirements.txt
cd docs
..\venv\Scripts\python.exe -m zensical build --strict --clean
```

The working directory matters. Built from anywhere else, the Wingman icon shortcodes resolve
to nothing and `--strict` still reports success. See section 13.

`docs/zensical.toml` sets `docs_dir = "user"`. Zensical builds every Markdown file under
`docs_dir` and has no exclude option. Scoping the directory is the only way to keep
`docs/dev/` off the site. Keep it that way.

Wrong docs are worse than no docs. Whoever changes behavior updates the page in the same
branch. A feature without its page is not finished.

## 1. Audiences and where things live

| Audience | Knows | Wants | Where |
|---|---|---|---|
| Guest at a party | Nothing about Wingman | To wish for a song and sing | `docs/user/`, phone pages |
| Host | Their own PC, Ultrastar Deluxe | To run the evening | `docs/user/`, setup and host pages |
| Administrator | The host's job, plus tags, roles, achievements | To set the party up for other people | `docs/user/`, management pages |
| Integrator | HTTP, JSON, a scripting language | To build a bot, an overlay, an importer | `docs/user/integrate/` |
| Us | The code | To change it safely | `docs/dev/`, never on the site |

Write for the first three by default. Assume a phone, a browser, and no computing
vocabulary. Never assume the reader knows what a session, a capability, or a source adapter
is. If a backend word leaks into a user page, rewrite it in party language.

The integration section is the one place where HTTP, JSON, and SQLite are fair words. Its
index page says so in its first two sentences. It documents what people can build on. It
never documents how Wingman is built.

## 2. Information architecture

`docs/user/` stays the build root. Sections are folders inside it. Every section has an
`index.md`, which the navigation shows as the section's own landing page
(`navigation.indexes`). Navigation labels are tasks or plain nouns, in sentence case, never
component names.

The navigation has two levels above the pages. **Tabs** across the top name what the reader
is doing: Overview, Sing, Host, Manage, Integrate. A tab holds whole sections, and the
sidebar shows only the sections of the open tab, so a guest never scrolls past the settings
reference. A section is a **chapter** in the sidebar: its label links to its index page and
carries the app's glyph for it, set as `icon: wingman/<name>` in the front matter of that
index page (section 13 has the config). Pages inside a chapter carry no icon. The Tab
column of the table below says where each section sits. A section belongs to exactly one
tab, so a page that serves both a singer and an administrator is written for the reader of
its tab and links to the other.

Section index pages are short. They say what the section covers, who it is for, and link to
its pages in reading order. A section index is allowed to hold real content when the section
is small.

### Target structure

| Tab | Folder | File | Nav label | Audience | Purpose | Type |
|---|---|---|---|---|---|---|
| Overview | (root) | `index.md` | Overview | Everyone | What Wingman is, how an evening runs, which tab is yours | Explanation |
| Sing | `party/` | `index.md` | At the party | Everyone | The Home page and how an evening runs | Index |
| Sing | `party/` | `wishlist.md` | Wish for a song | Everyone | Add a wish, read the list, take one back | How-to |
| Sing | `party/` | `sing.md` | Sing a song | Everyone | Pick singers and colors, start it, what happens then | How-to |
| Sing | `party/` | `reel.md` | Let the reel pick | Everyone | The random reel and what it picks from | How-to |
| Sing | `party/` | `music.md` | Play background music | Host | The music between songs: turning it on, the pool, the controls, the volumes | How-to |
| Sing | `songs/` | `index.md` | The song list | Everyone | The list, the marks, search, the chips | Index |
| Sing | `songs/` | `filter.md` | Filter the list | Everyone | The Filter panel, facets, tags | How-to |
| Sing | `songs/` | `song.md` | Open a song | Everyone | The song view: details, best scores, comments | How-to |
| Sing | `songs/` | `playlists.md` | Playlists | Everyone | Make one, fill it, manage it, share it, follow one, spin it | How-to |
| Sing | `songs/` | `download.md` | Download songs | Host | The USDB account, search, download, the queue | How-to |
| Sing | `songs/` | `fix-or-delete.md` | Fix or delete a song | Administrator | The details editor, deleting a song folder | How-to |
| Sing | `scores/` | `index.md` | Scores | Everyone | Where scores come from, which parties you see | Index |
| Sing | `scores/` | `party.md` | A party's scores | Everyone | The Scores page, its charts, its groupings, naming a party, correcting a score | How-to |
| Sing | `scores/` | `your-scores.md` | Your own scores | Singer | The record on the user page, the Your scores page, and All my scores | How-to |
| Sing | `achievements/` | `index.md` | Achievements | Everyone | What a badge is, your badges, the TV moment | Index |
| Host | `start/` | `index.md` | Get started | Host | What you need, in the order to do it | Index |
| Host | `start/` | `install.md` | Install and run | Host | The setup, the portable exe, update and uninstall, running from source, first launch | How-to |
| Host | `start/` | `ultrastar-deluxe.md` | Connect Ultrastar Deluxe | Host | Point Wingman at the installation | How-to |
| Host | `start/` | `join.md` | Let guests in | Host | The QR code, the address, what a guest may do | How-to |
| Host | `host-screen/` | `index.md` | The host screen | Host | What stands on the TV, and how to put it there | Index |
| Host | `host-screen/` | `manage.md` | Manage from the TV | Host | The Manage page behind the host screen | How-to |
| Host | `selector/` | `index.md` | Player selector | Host | What the device is, and how an evening runs with it | Index |
| Host | `selector/` | `build.md` | Build the device | Host | Parts, the wiring table, the layouts, the hardware that gives trouble | How-to |
| Host | `selector/` | `setup.md` | Set up the device | Host | Flashing, Wi-Fi and server, the connection test, mapping readers and buttons | How-to |
| Host | `selector/` | `cards.md` | Cards and players | Administrator | Assigning cards, several per person, unknown cards | How-to |
| Host | `help/` | `index.md` | Fix a problem | Everyone | Symptom, cause, fix | Index |
| Host | `help/` | `ultrastar-deluxe.md` | Ultrastar Deluxe problems | Host | The setup and launch failures | How-to |
| Manage | `people/` | `index.md` | People | Everyone | Accounts, guests, players, and logging in | Index |
| Manage | `people/` | `players.md` | Players and avatars | Host | Guests, pictures, taking somebody out of the picker | How-to |
| Manage | `people/` | `roles.md` | Roles and permissions | Administrator | What a role is, the four of them, and where the exact rights live | Reference |
| Manage | `people/` | `single-sign-on.md` | Single sign-on | Administrator | Logging in through an identity provider | How-to |
| Manage | `settings/` | `index.md` | Settings | Host | How settings work, who may change them | Index |
| Manage | `settings/` | `reference.md` | All settings | Host | Every setting, one table per group | Reference |
| Manage | `tags/` | `index.md` | Tags | Administrator | What a tag is, who sees it, and how to make one | Index |
| Manage | `tags/` | `built-in.md` | Built-in marks and facets | Administrator | The eight built-ins and their options | Reference |
| Manage | `achievements/manage/` | `index.md` | Achievements | Administrator | Settings, order, hiding, switching off, archives | Index |
| Manage | `achievements/manage/` | `create.md` | Make an achievement | Administrator | The editor and its conditions, with the worked example | How-to |
| Manage | `achievements/manage/` | `picture.md` | Make a badge picture | Administrator | The prompt kit and the reference badge for a picture that matches the included set | How-to |
| Integrate | `integrate/` | `index.md` | Integrate | Integrator | Who this section is for, and what it promises | Index |
| Integrate | `integrate/` | `rest-api.md` | The REST API | Integrator | Base path, the OpenAPI schema, reading the API | Reference |
| Integrate | `integrate/` | `authentication.md` | Authenticate a script | Integrator | Sessions, the host token, capabilities | How-to |
| Integrate | `integrate/` | `events.md` | Live events | Integrator | The WebSocket endpoint and its events | Reference |
| Integrate | `integrate/` | `devices.md` | Player selector devices | Integrator | The device token, the report endpoint, and the serial console | Reference |
| Integrate | `integrate/` | `files.md` | Files and configuration | Integrator | Data directory, database, song files, environment | Reference |

A page with less than about 25 lines of real content folds into its section index. Say so in
the bundle report instead of shipping a stub. Do not add a page outside this table without
the user's agreement.

### Every surface has a page

Each route in `frontend/src/App.tsx` is described somewhere in the table above. Check the
list before you claim a section is done:

| Route | Page that describes it |
|---|---|
| `/` | `party/index.md`, and `party/sing.md` for the stage while a song plays |
| `/spinner` | `party/reel.md` |
| `/songs` | `songs/index.md`, plus `songs/filter.md` and `songs/song.md` |
| `/songs/playlists`, `/songs/playlists/:id` | `songs/playlists.md` |
| `/songs/playlists/:id/manage` | `songs/playlists.md` |
| `/songs/playlists/:id/spinner` | `party/reel.md`, linked from `songs/playlists.md` |
| `/usdb` | `songs/download.md` |
| `/scores` | `scores/party.md` |
| `/user` | `people/index.md` signed out, `scores/your-scores.md` and `achievements/index.md` signed in, and `selector/cards.md` for the **My cards** block |
| `/user/stats` | `scores/your-scores.md` |
| `/user/accounts` | `people/players.md` |
| `/user/permissions` | `people/roles.md` |
| `/user/tags`, `/user/tags/new`, `/user/tags/:id` | `tags/index.md`, and `tags/built-in.md` for a built-in |
| `/user/achievements`, `/user/achievements/new`, `/user/achievements/:id` | `achievements/manage/index.md` and `achievements/manage/create.md` |
| `/user/devices` | `selector/setup.md`, and `selector/cards.md` for the cards on it |
| `/user/devices/new` | `selector/setup.md` |
| `/user/devices/:id` | `selector/setup.md`, and `selector/cards.md` for the cards on it |
| `/settings` | `settings/index.md` and `settings/reference.md` |
| `/host` | `host-screen/index.md`, and `selector/index.md` for the stage while the cards pick |
| `/host/manage` | `host-screen/manage.md` |

Three things happen across several pages. Each has one owner, and the other pages link to it:

- A song from wish to score: `party/sing.md` owns the whole run. It starts at the wishlist
  and ends at the results on the TV.
- Getting songs onto the machine: `songs/download.md` owns the search, the download, and the
  queue.
- Pointing Wingman at Ultrastar Deluxe: `start/ultrastar-deluxe.md` owns the setup, and
  `help/ultrastar-deluxe.md` owns what to do when it fails.

### Old page to new page

| Old page | Goes to |
|---|---|
| `index.md` | `index.md` (shorter: the tab table moves to the section indexes) |
| `getting-started.md` | `start/index.md`, `start/install.md`, `start/ultrastar-deluxe.md`, `start/join.md` |
| `downloading-songs.md` | `songs/download.md` |
| `singing.md` | `songs/index.md`, `songs/filter.md`, `songs/song.md`, `songs/fix-or-delete.md`, `party/sing.md` |
| `wishlist-and-playlists.md` | `party/wishlist.md`, `songs/playlists.md` (favorites become part of `songs/index.md` and `songs/song.md`) |
| `tags.md` | `tags/index.md`, `tags/built-in.md` |
| `achievements.md` | `achievements/index.md`, `achievements/manage/create.md`, `achievements/manage/index.md` |
| `the-spinner.md` | `party/reel.md` |
| `accounts-and-permissions.md` | `people/index.md`, `people/players.md`, `people/roles.md`, `people/single-sign-on.md` |
| `statistics.md` | `scores/index.md`, `scores/party.md`, `scores/your-scores.md` |
| `settings.md` | `settings/index.md`, `settings/reference.md` |
| `troubleshooting.md` | `help/index.md`, `help/ultrastar-deluxe.md` |
| (new) | `host-screen/index.md`, `host-screen/manage.md`, everything under `selector/` and `integrate/` |

Keep the old text where it is still true and still short. Rewriting a correct paragraph into
a different correct paragraph wastes review time.

## 3. Page types and skeletons

Four types, after Diataxis. One type per page. A page that teaches and lists at the same time
is two pages.

**How-to.** Most user pages. Title names the task with a verb: "Download songs", "Fix or
delete a song". Skeleton:

1. `# Title` in sentence case.
2. One or two sentences: what this does and when you want it. No history, no promises.
3. A screenshot, if the surface is new to the reader (see section 6).
4. Numbered steps. One action per step. The condition first: "If the song has no video, pick
   another version." Bold every label exactly as the app spells it.
5. What you see when it worked.
6. The exceptions, as short `##` sections or a note.

**Reference.** Settings, roles, built-in tags, the event list. Title is a plain noun phrase.
Skeleton: one sentence saying what the table covers, then the table, then nothing. Reference
pages describe. They do not instruct. Link to the how-to instead.

**Explanation.** The overview and the section indexes. Skeleton: what the thing is, how the
pieces relate, links onward. No steps.

**Index.** One per folder. Two to five sentences, then a list of the section's pages with a
half-line each. An index may carry real content when its section has one or two pages.

Rules for every type:

- One topic per page. The title has to name it in under six words.
- A page over about 120 lines is two pages. Count the lines of the Markdown source, blank
  lines included. A page that section 2 hands one whole subject may run to about 160 rather
  than shed half of it. Past 160 it splits, and a split that adds a page needs the user's
  agreement.
- A page under about 25 lines belongs in its section index.
- At most two heading levels (`##`, then `###` only when a `##` really splits).
- End a page with content, not with a summary of itself. A "See also" list of two or three
  links is allowed when the next step lives elsewhere.
- Never number the headings.

## 4. Tone and language

American English. Short sentences. Second person. Present tense. Active voice.

- Write to the reader as **you**. Never "we", never "the user", never "one".
- Present tense only. Wingman "opens", never "will open".
- Active voice: "Wingman reads the scores", not "the scores are read".
- One idea per sentence. Aim for 15 words. Anything over 25 words is two sentences.
- Paragraphs of at most four sentences. Then a break, a list, or a heading.
- Put the condition before the instruction: "To sing a duet, pick two singers."
- Start a step with its verb. Drop "you can" when it adds nothing.

### Punctuation

- **No em-dashes.** The character `—` never appears in Wingman's text. Neither does a spaced
  hyphen standing in for one. Use a colon, parentheses, or two sentences.
    - Not: `Pick a singer — the colors are fixed.`
    - Write: `Pick a singer. The colors are fixed.`
- No semicolons joining two clauses. Write two sentences.
- Serial comma in a list of three or more: "songs, players, and scores".
- One space after a period. No period at the end of a heading.
- Straight quotes and straight apostrophes.
- Ranges use "to": "3 to 5 singers".

### Words

American spellings, always: **color** (not colour), **favorite**, **gray**, **behavior**,
**organize**, **recognize**, **canceled**, **catalog**, **toward**, **license**.
Two more house spellings: **log in** is the verb and **login** the noun, **set up** the verb
and **setup** the noun.

Never write these:

| Do not write | Write instead |
|---|---|
| simply, just, easy, easily, obviously, of course | Nothing. Delete the word |
| currently, at the moment, for now | Nothing. The docs describe today |
| new, soon, coming, planned, eventually | Nothing. Ship the page when the feature ships |
| powerful, seamless, rich, blazing, magic | What it does |
| utilize, leverage, perform a search | use, use, search |
| please, note that, in order to | Nothing, nothing, to |
| kill, abort, execute (about processes) | stop, cancel, run |
| the user, one, we | you, Wingman |

Contractions are welcome: "it's", "you'll", "don't". One exception: in a warning about
losing something, write the negative out in full, or turn it around into a positive
sentence. "Deleting a song removes its folder from the disk" beats "the folder isn't kept".

Humor is allowed in an example's data. It is never allowed in an instruction.

### Terminology

Use the left column. Never the right column.

| Use | Means | Never |
|---|---|---|
| host | The person running Wingman on the karaoke PC | admin, DJ, operator |
| guest | Somebody at the party without an account | anonymous user, visitor |
| singer | Whoever is singing a song right now | performer |
| administrator | Somebody with the admin role | superuser, root, sysadmin |
| account | A name and password somebody registered | user, profile |
| player | The name a score is filed under, with or without an account | user, participant |
| party | One evening of singing, with its own scores | session, event |
| sing | One run of one song by the chosen singers | play, performance, run |
| wish | A song somebody put on the wishlist | request |
| wishlist | The list of wishes for tonight | queue, playlist |
| favorite | A song somebody marked for themselves | liked song, star |
| playlist | A named list of songs somebody made | collection, set |
| tag | A label on a song | category, label |
| achievement | The thing you earn by singing | trophy, award |
| badge | The picture of an achievement | medal, icon |
| the host screen | The Wingman page on the TV | host view, presenter mode |
| Manage (on the host screen) | The management page behind the host screen | admin panel |
| Ultrastar Deluxe | The karaoke program itself, in prose | UltraStar, US, the game |
| USDX | Only where the app spells it that way, such as the **USDX** settings group | a name for Ultrastar Deluxe in prose |
| USDB | The song database Wingman downloads from | usdb.animux, the database |
| the reel | The random song picker | spinner, wheel, slot machine |
| background music | The songs Wingman plays while nobody is singing | filler, radio, the playlist |
| the player | The block at the top of Home that shows what is playing | now playing, the widget |
| microphone color | The color a singer's microphone is assigned | mic colour, channel |
| permission | What somebody is allowed to do, in user pages | capability |
| capability | The exact name of a permission, in the integration section only | permission |
| role | Guest, User, Trusted, or Admin | group, level |

Three notes on that table.

**"The spinner" is the route's name in code.** In user pages the feature is **the reel**. The
page is **Random song**, and its button is **Spin**. The app draws that button in capitals
through CSS, so write **Spin** and never SPIN.

**A role keeps its own name.** The fourth role is **Admin**, and a page that names the role
writes **Admin**. Somebody who holds it is an administrator, and the person running the
evening is the host. Do not call the host an admin.

**"Session" means three different things in the app today.** Only one of them is a party.
Never carry the word into a user page without saying which one you mean:

| Where the app says it | What it means | Word to use |
|---|---|---|
| The Scores page ("All parties", "Rename party", "Party name") | One evening of singing | party |
| The downloads panel ("Since Wingman started") | Downloads since Wingman was started | this run of Wingman |
| The host screen ("This browser holds host rights") | This browser holds host rights | host rights |

The UI copy pass has renamed all three, so the labels above are what the app says today.
Only the first row is a party. Write the third column, never "session".

### Naming what the reader touches

- Bold every visible label, spelled exactly as the app spells it, without a trailing
  ellipsis: press **Play**, open **Filter**, turn on **Hidden until earned**.
- Say **tap** on phone pages and **click** on the host screen and other PC surfaces. Use
  **select** for a checkbox or an option in a list, and **type** or **enter** for text.
- Name an icon-only button with its glyph and its name: "tap :wingman-pencil: **Edit**". The
  name comes from the button's `aria-label` in the code. Never call it "the pencil icon".
- A path through the app is two labels at most, joined by a chevron: **User** > **Tags**.
  Anything longer is a step list.
- Name a setting by its label and its group: the **Directory** setting in the **Songs**
  group. The label is the last part of the key, sentence cased, so the group is what makes it
  unambiguous. Say when a setting is behind **Advanced**.
- File paths and folder names go in code font: `C:\Users\you\AppData\Local\Ultrastar Wingman`.
- Numbers: numerals for anything the app shows and for measurements. Spell out one to nine in
  ordinary prose. Scores keep their thousands separator: 9,842.
- Where a label in the app contradicts the terminology table, the label is what changes. Write
  the page against the target spelling and see section 11.
- Headings and labels are sentence case. Product names keep their capitals.

## 5. Admonitions

Four types, and no others:

| Type | For | Example content |
|---|---|---|
| `note` | A fact that would break the step list, and that the reader still needs | "A guest keeps their name for the evening on the same phone." |
| `tip` | An optional shortcut nobody has to know | "Hold the reel's button to spin again without leaving the page." |
| `warning` | Something irreversible, something that stops the party, something that loses data | "Deleting a song removes its folder from the disk." |
| `example` | Every worked example on the site | The 80s achievement, built condition by condition |

Markup, verified against the installed zensical:

```markdown
!!! note
    One short paragraph.

!!! example "Sing 10 songs from the 80s in one evening"
    Steps that build the example.

??? note "Log in through Keycloak"
    Long, optional material that most readers skip.
```

Rules:

- At most three admonitions on a page. Two in a row is one too many.
- Never open a page with one. The reader gets the first sentence first.
- Never put a step of the main task inside one. Steps live in the numbered list.
- A warning names the consequence in its first sentence.
- A collapsible block (`???`) needs a title and holds material most readers skip. Never use
  `???+`. If it should stand open, it is not collapsible.
- Do not use an admonition to make a paragraph look important. Rewrite the paragraph.
- No other type. The `info` block on the old download page becomes a `note`, and `danger`,
  `abstract`, `question`, and the rest stay out.
- Examples only where they explain something a sentence cannot. An example always sits in an
  `example` admonition, with a title naming the case.
- `achievements/manage/create.md` carries the worked example "Sing 10 songs from the 80s in one
  evening", built condition by condition, in one `example` admonition.

## 6. Screenshots

A screenshot earns its place when it does one of three things:

1. It introduces a surface the reader has not seen: the song list, the host screen, an
   editor.
2. It points at a control that words cannot locate on their own.
3. It shows a state the reader has to recognize: a download in progress, a masked badge, a
   score row waiting to be corrected.

No screenshot for a list of text, a settings field, a confirmation dialog, or anything a
sentence already covers. Never open a page with a decorative screenshot. Two or three per
page is plenty.

Placement: after the sentence that introduces the surface and before the steps, or right
after the step it illustrates. Never between two steps it does not belong to.

### Capture rules

- Phone surfaces: viewport 390 x 844, device pixel ratio 2, dark theme.
- The host screen: viewport 1280 x 720, device pixel ratio 1, dark theme.
- Crop to the surface being discussed. A modal shot keeps the modal and a hand's width of the
  page behind it. Never include browser chrome, the desktop, or the clock.
- Keep the bottom tab bar only when the page's place in the app matters.
- Dark theme only. The app has one theme and pretending otherwise would be a lie.
- PNG. Store under `docs/user/assets/screenshots/<section>/<id>.png`, where `<id>` is the
  manifest's id.

### In the page

```markdown
![The song list with the filter chips](../assets/screenshots/songs/songs-list.png){ width="320" loading=lazy }
/// caption
The song list. The chips under the search box are the quick filters.
///
```

- `width="320"` for a phone shot, `width="720"` for a host shot.
- Alt text is one sentence, under 155 characters, saying what the reader should see. Never
  start it with "Screenshot of".
- The caption is one short sentence and never repeats the alt text word for word.
- The lightbox is automatic. Never wrap an image in a link.

### Fake data

Every screenshot is taken against a scratch data directory on an alternate port. The user's
own library, names, and scores never appear.

- Players are Futurama characters. The roster is the ten pictures in
  `docs/screenshots/avatars/`: Fry, Leela, Bender, Zoidberg, Amy, Hermes, Farnsworth, Zapp,
  Kif, and Scruffy. Leela holds the administrator account, so management surfaces are
  reachable in a shot. Fry and Bender have accounts. The other seven are guests.
- Those files are the avatars. The seeding script uploads each picture as it lies on disk,
  through the avatar endpoint. It neither crops nor redraws: the repository has no image
  library, and the app accepts a jpeg, png or webp of any shape. Add a character by putting
  a picture in that directory and naming the file after them. Crop it yourself first if it
  looks wrong in the round frame.
- A missing picture is not an error. The script prints which characters have no file, and
  those players keep the app's own initials avatar.
- The folder is gitignored, so the pictures never enter the repository. `docs/.gitignore`
  carries the rule.
- The song list is about 40 plausible entries. Five of them are fixed Easter eggs.
  "Sandstorm" by Darude and "Tequila" by The Champs are both terrible karaoke songs, and both
  are wished for. "Rap God" by Eminem carries an implausible 9,842 for Bender. The one duet is
  "I Got You Babe" by Sonny and Cher, sung by Fry and Leela. "Walking on Sunshine" by Katrina
  and the Waves is the song Fry sings on the TV in the launcher pictures.
- Scores are believable otherwise: most between 3,000 and 8,000, Zoidberg last.
- Two parties, not one. An older one from a week ago, and the one going tonight. A singer
  needs a history before "All my scores" and a progress bar mean anything. The Scores page
  needs a second party before its party selector is worth a look. Both carry a name, so a
  picture never reads back the hour the seed happened to run at.
- One achievement is left one song short for Bender. The sing captured for
  `host-achievements` is the one that completes it.
- One player selector, called *The box by the TV*. Six reader positions, the first two
  wired with a card lying on each: one card is Leela's, the other belongs to nobody. It
  reports a firmware one version behind the bundled image, so its page offers the update
  over Wi-Fi. Fry holds no card, which is why the **My cards** block is photographed on
  his page.
- Ultrastar Deluxe is set up on the scratch instance, so the setup banner on Home stays
  hidden. Point the **Base path** setting in the **USDX** group at the stand-in launcher's
  folder before capturing anything.
- No real names, no real email addresses, no real USDB account.

### The script

Every screenshot comes from one repeatable procedure. Nobody captures one by hand. When a
surface changes, the manifest row changes and the procedure runs again.

That procedure is [screenshots.md](screenshots.md), next to the scripts it describes. It
covers all of this:

1. The scratch `WINGMAN_DATA_DIR` and the alternate ports the run uses. The user's own data
   directory and the instance on port 8080 are never touched. See
   [verifying.md](verifying.md).
2. How to start the backend and the frontend against that scratch directory.
3. The seeding order, because each step needs the one before it: accounts, then players and
   their avatars, then songs, then a party with its scores, then wishes, then tags,
   playlists, and achievements.
4. How to drive the stand-in launcher for the shots that need a song playing or a song just
   finished.
5. How to capture one manifest id on its own, so a single changed surface does not cost a
   full re-run.
6. What to check in a captured file before committing it: the right viewport, no real data,
   no browser chrome.

The script's own inputs live in `docs/screenshots/`, outside `docs_dir`, so they never ship as
site assets. `docs/screenshots/avatars/` already holds the character pictures. Only the
captured PNGs go under `docs/user/assets/screenshots/`.

Four shots need Ultrastar Deluxe to look like it is running: the stage on a phone, the stage
on the TV, the results after a song, and a badge earned on the TV. Those are the rows marked
**launcher** in the manifest. Wingman never launches the real program for a screenshot. The
script writes a stand-in launcher into the scratch directory and points the **Executable**
setting in the **USDX** group at it. Model that stand-in on `FAKE_USDX` in
`backend/tests/test_karaoke_api.py`, which is a Python source string inside the test module
rather than a file you can run. Copy the behavior, not the path.

### Screenshot manifest

The list of screenshots the site needs. Capture exactly these.

Every row names a route and the state to put the app in. A row marked **launcher** cannot be
seeded from the database alone. It needs the stand-in launcher running, described above.

A row asks only for what one viewport holds. Nothing is stitched together and nothing is
captured past the fold. A form several screens long is photographed at the part the page is
about, and the **Must be visible** column names that part alone.

| Id | Page | Route | State to seed | Viewport | Must be visible |
|---|---|---|---|---|---|
| `home` | `party/index.md` | `/` | Signed in as Leela, four wishes | 390x844 | The Wingman tile, the wishlist, the Random song entry |
| `home-playing` | `party/sing.md` | `/` | **launcher**: a song playing | 390x844 | The stage showing cover, title, artist, song controls |
| `songs-list` | `songs/index.md` | `/songs` | Seeded library, two favorites, two sung | 390x844 | Search box, chip row, rows with marks |
| `songs-filter` | `songs/filter.md` | `/songs` | Filter panel open, Video on Yes, Decade set to 1980s | 390x844 | The hint line, both chip clouds, Video on Yes, the Decade chip showing 1980s, and a tag struck through on No |
| `song` | `songs/song.md` | `/songs` | Song modal open on "I Got You Babe" | 390x844 | Cover hero, the wish and favorite toggles, and the summary strip |
| `song-comments` | `songs/song.md` | `/songs` | Song modal, comments sub-view, three comments | 390x844 | The comment list and the composer |
| `song-edit` | `songs/fix-or-delete.md` | `/songs` | Song modal, details editor open | 390x844 | The six labeled inputs, the save row, and **Delete song** under it |
| `player-selection` | `party/sing.md` | `/songs` | Song modal, player selection open | 390x844 | Two singers picked on their microphone colors |
| `wishlist` | `party/wishlist.md` | `/` | Six wishes, two of them wished twice | 390x844 | The wishlist rows, a wish count, the take-back button |
| `playlists` | `songs/playlists.md` | `/songs/playlists` | Three playlists, one global | 390x844 | The cover mosaics, the meta lines, the globe mark |
| `playlist` | `songs/playlists.md` | `/songs/playlists/:id` | A playlist with eight songs | 390x844 | Header with the dice, the action row, song rows |
| `playlist-manage` | `songs/playlists.md` | `/songs/playlists/:id/manage` | Same playlist, two members | 390x844 | Name, description, global checkbox, member rows |
| `reel` | `party/reel.md` | `/spinner` | Reel landed on "Sandstorm" by Darude | 390x844 | The landed frame, the **Pick from** select, the **Spin** button, and **Spin on the host screen** under it |
| `playlist-reel` | `party/reel.md` | `/songs/playlists/:id/spinner` | The same playlist as `playlist`, landed on one of its eight songs | 390x844 | The playlist's name in the header, the landed frame, **Spin on the host screen** under **Spin** |
| `reel-host-spin` | `party/reel.md` | `/spinner` | Signed in as Leela, **Spin on the host screen** pressed, the reel on the TV landed | 390x844 | The cover, the title, and the artist of the song the reel picked, the **Spin again** die, **Play**, and **Cancel** |
| `usdb-search` | `songs/download.md` | `/usdb` | Search results for a common artist | 390x844 | Result rows and the download buttons |
| `usdb-downloads` | `songs/download.md` | `/usdb` | One download at 60 percent, one queued | 390x844 | The downloads panel with both bars |
| `tags-admin` | `tags/index.md` | `/user/tags` | Three tags of the party's own, beside Wingman's own `broken` | 390x844 | Tag rows, the Built-in heading, the eight built-in rows |
| `tag-editor` | `tags/index.md` | `/user/tags/:id` | An existing tag with people rows | 390x844 | The **Permissions** matrix and the **Specific people** row |
| `built-in-tags` | `tags/built-in.md` | `/user/tags/decade` | The Decade built-in | 390x844 | The reduced editor and the line saying why it is reduced |
| `scores-party` | `scores/party.md` | `/scores` | One party, 23 scores, five singers | 390x844 | The party selector at the top, the strip chart, the score rows |
| `scores-spread` | `scores/party.md` | `/scores` | Same party, grouped by player | 390x844 | The spread card with a box row and a stagger row |
| `user` | `scores/your-scores.md` | `/user` | Signed in as Bender | 390x844 | Identity tile, the stat bar, the histogram |
| `user-stats` | `scores/your-scores.md` | `/user/stats` | Bender's own record across both seeded parties | 390x844 | The **Your scores** header, the charts of his own record |
| `user-achievements` | `achievements/index.md` | `/user` | Signed in as Fry, whose earned badges leave room for a bar below them | 390x844 | The open badge strip, its count, one row with a progress bar |
| `achievement-modal` | `achievements/index.md` | `/user` | Signed in as Fry, one of his badges opened large | 390x844 | The badge at hero size, its name, its sentence, the day it was earned |
| `achievements-admin` | `achievements/manage/index.md` | `/user/achievements` | Two of the party's own achievements, one switched off | 390x844 | The three settings, the one list over the whole catalogue, an *Included* row, a lock mark, the off row |
| `achievement-editor` | `achievements/manage/create.md` | `/user/achievements/:id` | The 80s achievement from the worked example | 390x844 | The condition block and its plain sentence |
| `people-admin` | `people/players.md` | `/user/accounts` | Three accounts, seven guests, one of them hidden | 390x844 | Both groups, the role controls, a hidden row |
| `permissions` | `people/roles.md` | `/user/permissions` | Defaults | 390x844 | The three columns Guest, User, and Trusted, and the line saying admins are not in the table |
| `login` | `people/index.md` | `/user` | Signed out | 390x844 | Name, Password, **Log in**, and the **New account** switch |
| `settings` | `settings/index.md` | `/settings` | USDX group open, its Advanced line folded | 390x844 | The group header and its icon, the Base path field, the Advanced line |
| `host-screen` | `host-screen/index.md` | `/host` | A party going, four wishes, five singers scored | 1280x720 | QR card, join address, standing, most wished |
| `host-playing` | `host-screen/index.md` | `/host` | **launcher**: a song playing | 1280x720 | The stage with the cover and the singers |
| `host-results` | `scores/index.md` | `/host` | **launcher**: the song just finished and its scores were written | 1280x720 | The results of the song that finished, the score summary beside its cover |
| `host-achievements` | `achievements/index.md` | `/host` | **launcher**: the sing that completes the achievement the seed left one song short for Bender | 1280x720 | The badges landing for one singer, over the whole screen with no rail beside them, before the results appear |
| `host-manage` | `host-screen/manage.md` | `/host/manage` | Host rights on that browser | 1280x720 | The management rows the host reaches from the TV |
| `selector-admin` | `selector/cards.md` | `/user/devices` | The seeded device online, one known card and one unknown one on its readers | 390x844 | The **On the readers now** list, a named card and an **Unknown card** row |
| `selector-device` | `selector/setup.md` | `/user/devices/:id` | The same device, running one firmware version behind the bundled image | 390x844 | The status lines, **Update firmware** and **Update over Wi-Fi**, the reader rows |
| `user-my-cards` | `selector/cards.md` | `/user` | Signed in as Fry, who holds no card, with an unknown card on a reader | 390x844 | The **My cards** heading, the card's number, and **This is mine** |
| `host-picking` | `selector/index.md` | `/host` | A selection open while the device is online, both cards on their slots | 1280x720 | The song in one centered column over *Picking singers*, the slots with the card holder and **Unknown card**, and no rail |
| `host-reel` | `host-screen/index.md` | `/host` | The selector's start button pressed while the device is online, with **Start a random song** set: a spun selection over both cards, the reel landed | 1280x720 | The reel at rest where the cover stands, the title and artist under it, *Picking singers*, the slots along the foot, and no rail |

## 7. Links and cross references

- Relative Markdown links between pages, with the `.md` extension:
  `[Download songs](../songs/download.md)`. They work on the site and on GitHub.
- Link text names the target: `see [Roles and permissions](../people/roles.md)`. Never "click
  here", never a bare URL, never the whole sentence.
- Link a page the first time it is relevant on the current page, then stop. Three links to
  the same page is two too many.
- Repeat one sentence rather than sending the reader away for one sentence. Link when the
  reader would need a whole page.
- Do not link to `docs/dev/`, to the repository, or to source files from a user page.
- Do not link to a heading in another page unless the heading is the answer.

## 8. Tables, lists, code blocks and keys

- Wrap the Markdown source at about 80 columns, the width the pages already use. Table rows,
  code lines, config lines, and URLs stay on one line, however long they get. Do not rewrap a
  paragraph you are keeping. A rewrap with no text change is noise in the diff.
- Numbered list for a sequence. Bulleted list for a set. Never a bulleted list of one item.
- A step is one action. If a step has a screenshot, the screenshot follows the step.
- Table when every row answers the same two or three questions. Three to six columns. First
  column is what the reader looks up.
- A settings table has exactly these columns: **Setting**, **What it does**, **Default**. Say
  the default as the app shows it, and write "empty" for a blank one. Advanced settings go in
  their own table under an `### Advanced` heading, in the same order as the app.
- Code blocks for commands, file contents, and JSON. Always with a language:
  ```powershell```, ```json```, ```text```. Never for a UI label.
- Keyboard keys use the keys extension: `++ctrl+alt+del++`. Verified in the build.
- Content tabs for the same task on two platforms, and for nothing else:

  ```markdown
  === "Phone"

      Tap **Filter**.

  === "Host screen"

      Click **Filter**.
  ```

  Tabs stay linked across the site through the `content.tabs.link` feature, so label them the
  same way everywhere.

## 9. What not to document

- Internals: modules, classes, tables, event names, the words `service`, `adapter`, `seam`.
  The integration section is the exception, and even there the subject is the interface.
- Code walkthroughs of any kind.
- History and version archaeology. No "as of version", no changelog inside a page, no "this
  used to be". Git has the history.
- What the UI already says. If a field's description on the Settings page is enough, the docs
  table says the same thing once and moves on. If it is not enough, fix the UI copy too.
- The permission matrix, row by row. The app renders it live on **User** > **Permissions**,
  where it always matches the build. `people/roles.md` says what a role is and what each of
  the four is for, then sends the reader to that page for the exact ticks.
- Anything unreleased, planned, or speculative.
- Anything you have not seen work. If you cannot verify a claim, ask, or leave it out.

## 10. The integration section

The site carries one section for developers. It documents what somebody can build on, and
nothing about how Wingman is built. No module names, no class names, no code walkthroughs.

It lives inside `docs_dir` because zensical has one build root, so a second site is not an
option. Separation is by section instead: its own top-level nav folder, its own audience
statement on its index page, and no link into it from a user page.

`docs/user/integrate/` is for people building around Wingman: a Discord bot, a stream
overlay, a bulk importer. Its index page states that audience in the first two sentences, and
says what the section does not cover.

It covers exactly this:

- The REST API: the `/api/v1` base path, the OpenAPI schema the app serves under it, and the
  Swagger page the app exposes. Read the paths out of `backend/src/ultrastar_wingman/app.py`
  and open each one before publishing it.
- How a script authenticates: an account session, the host token, and what a capability means
  for a script that holds one. Capability names are copied from `auth/permissions.py`,
  spelled exactly.
- The WebSocket endpoint and the events it sends. Names and payload fields come from
  `events.py` and the schema classes, never from memory. Say that the socket is server to
  client only.
- The data directory and its SQLite file: where it is, what lives in it, and that outside
  tools read it and never write it. Include how to take a backup.
- The song folder and the txt headers Wingman reads, taken from `songs/txt.py`.
- The `WINGMAN_*` environment variables, taken from `config.py`.

Its own rules:

- Every fact comes from the code, and the writer has seen the code.
- Name endpoints as the router registers them. Name payload fields as the schema spells them.
- Give one short, runnable example per page, in an `example` admonition, using `curl` or
  plain fetch. No framework, no client library, no project scaffolding.
- Promise nothing about stability that is not already true. Say that the schema is the
  contract and that it moves with the app.
- No code walkthroughs, no architecture, no file layout of the repository.
- The same language rules apply. The reader knows HTTP. They still deserve short sentences.

## 11. In-app UI copy

Section 4 binds the text inside the app as well: button labels, the explaining line under a
checkbox, empty states, error sentences, setting names and descriptions, and confirmation
dialogs. Same American English, same short sentences, same terminology table, no em-dashes.

Three UI-specific exceptions:

- A label is a fragment, not a sentence, and takes no period: **Hide songs by default**.
- Space is tight, so a label may drop an article that a sentence would keep: **Add songs**.
- An explaining line stays under about 90 characters, so it fits on a phone in two lines.
  Cut the sentence rather than wrapping to three.

The app's own labels follow section 4, and a page uses the label the app renders. Neither
side gets to drift: a label that breaks a rule here is a bug in the app, not a license for a
page to bold a word this file forbids. Fix the label, then write the page against it.

The copy pass that made the two agree renamed labels as well as sentences. These are the
ones a page written against an older draft still gets wrong:

- **Colour** over the color picker in both editors is **Color**.
- The Scores page called a party a session. It says party.
- The downloads panel's filter is **Since Wingman started**, not a party.
- The host screen says **This browser holds host rights**, not "Host session active". The
  user page names the same browser **Host screen**, with the role **Admin** under it, and
  its button is **Log in as a user**, no longer "Log in as a user instead".
- The USDB sort options spell the range out: **Artist A to Z**, never an en dash.
- The shipped achievement is **Well Traveled**. Migration 0025 renamed it in every database
  that the built-in seed had already run on.

Renaming a label changes the queries in the tests that look for it. Update the tests, never
delete them.

An error sentence says what happened and what to do next, in that order, without blame:
"That name is taken. Pick another one." A confirmation dialog names the consequence in one
sentence, and its button is the bare verb of the action the dialog is titled after:
**Delete**, never **OK** and never a second copy of the title ("Delete song"). The control
that opened it is what says the whole thing — the form's own **Delete song** button.

The look rules for the same surfaces live in [ui-guidelines.md](ui-guidelines.md).

## 12. Review checklist

Before a page is done:

1. One topic, and the title names it.
2. The page type is clear, and the page does not mix two.
3. First sentence says what the page is for.
4. Steps are numbered, one action each, conditions first.
5. Every label is bold and spelled exactly as the app spells it. Every icon-only control is
   named with its glyph and its name.
6. American English. No em-dash, no spaced hyphen, no semicolon joining clauses.
7. No banned word from section 4, no jargon from the codebase.
8. Sentences are short. Nothing runs past 25 words.
9. Admonitions: at most three, right type, none at the top of the page.
10. Screenshots: each earns its place, sits after the sentence that introduces its surface,
    has alt text and a caption, and comes from the manifest and the script.
11. Links are relative, named, and not repeated.
12. Everything on the page was verified against the running app, not remembered.
13. `zensical build --strict --clean` passes, and the page appears in the navigation where
    the structure table says it does.

## 13. Theme, branding and the light scheme

The site looks like the app: same logo, same accent colors, same glyphs.

**The light scheme stays, with branded accents only.** Both palettes carry
`primary = "custom"` and `accent = "custom"`, and `extra_css` defines
`--md-primary-fg-color` from `--highlight-blue-light` (`#4b92cd`) and `--md-accent-fg-color`
from `--highlight-pink-light` (`#9e3b95`). Only the dark scheme takes the app's own
background, under `[data-md-color-scheme="slate"]`. The dark scheme is the default, so the
first thing a reader sees matches the app.

The rejected option was dropping light mode entirely. It would make every screenshot match
its page, but it forces one appearance on readers who need a bright screen. The cost we
accept instead: dark screenshots sit on a light page for those readers. Captions and the
figure frame keep them readable as pictures of the app.

That frame is a ring, not a border: a
`box-shadow: 0 0 0 1px var(--md-default-fg-color--lightest)` on `.md-typeset figure img`. A
ring costs the picture no width, so the figure still fits its column. It earns its place on
the dark scheme, where a dark screenshot sits on a background of almost the same color and
would otherwise have no edge at all.

Config facts, all verified against the installed zensical (0.0.57):

- Setting `[project.markdown_extensions]` replaces zensical's defaults completely. List every
  extension the site uses: `admonition`, `attr_list`, `md_in_html`, `pymdownx.blocks.caption`,
  `pymdownx.details`, `pymdownx.emoji`, `pymdownx.highlight`, `pymdownx.inlinehilite`,
  `pymdownx.keys`, `pymdownx.superfences`, `pymdownx.tabbed` with `alternate_style = true`,
  and `toc.permalink`. Keep `pymdownx.highlight` and `pymdownx.inlinehilite` on the list.
  Without them, fenced code loses its syntax highlighting.
- Replacing the table also drops the options zensical sets on an extension. Give
  `pymdownx.highlight` the three it ships with: `anchor_linenums = true`,
  `line_spans = "__span"`, and `pygments_lang_class = true`. The theme's stylesheet styles
  code lines through the `__span` ids, so a code block loses that styling without them.
- `toc` and `tables` are always on, whatever the list says. Do not add them.
- Custom icons go through the emoji extension's **`options`** table, not a top-level key:
  `"pymdownx.emoji" = { emoji_index = "zensical.extensions.emoji.twemoji", emoji_generator = "zensical.extensions.emoji.to_svg", options = { custom_icons = ["overrides/.icons"] } }`.
  A top-level `custom_icons` key raises `KeyError` at build time.
- The icon path resolves against the working directory of the build, not against the folder
  holding `zensical.toml`. Always build from `docs/`. Built from anywhere else, every Wingman
  shortcode is left in the page as literal text, and `--strict` reports no issue.
- Put the SVGs in `docs/overrides/.icons/wingman/`, outside `docs_dir`, or they ship as site
  assets. A file `wingman/heart.svg` becomes the shortcode `:wingman-heart:`, and the SVG is
  inlined, so `attr_list` classes color it.
- The Wingman SVGs are generated from `ICON_PATHS` in `frontend/src/components/icons.tsx` by
  a script, and never copied by hand. One glyph in the docs means the same thing as in the
  app. The script is `docs/tools/export_icons.py`. Rerun it from the repository root with
  `venv\Scripts\python.exe docs\tools\export_icons.py` whenever an icon changes.
- The lightbox comes from the built-in glightbox extension: `[project.plugins]` with
  `glightbox = {}`. Each image is wrapped in an `<a class="glightbox">` automatically, and the
  theme's own bundle opens it.
- The modern theme paints its bars and its admonitions from its own surfaces, and gives
  neither one a variable of its own. `.md-header` takes `--md-default-bg-color--light` and
  `.md-footer-meta` takes `--md-default-fg-color--lightest`, both shared with other elements,
  so there is no header color to set. That is why `wingman.css` overrides `background-color`
  on those two selectors directly, and scopes the override to
  `[data-md-color-scheme="slate"]`: the light scheme keeps the theme's own bars, whose header
  text is near-black. An admonition is the same story with one extra trap. The stylesheet
  defines `--md-admonition-bg-color` and never reads it, so setting that variable does
  nothing at all.
- Theme features to use: `navigation.tabs`, `navigation.tabs.sticky`,
  `navigation.sections`, `navigation.indexes`, `navigation.top`, `navigation.footer`,
  `navigation.tracking`, `navigation.path`, `toc.follow`, `content.code.copy`,
  `content.tabs.link`, `search.highlight`. With tabs and sections on together, the first
  nav level is the tab row, the second level renders as the sidebar's chapters, and the
  sidebar shows the open tab alone.
- A chapter's icon is the `icon` key in the front matter of its index page, for example
  `icon: wingman/music`. The sidebar template includes `.icons/<that path>.svg`, which
  resolves through `theme.custom_dir = "overrides"` (relative to `zensical.toml`) into
  `docs/overrides/.icons/wingman/`. A wrong name fails the build. The same key on a page
  that is not an index would put the glyph on that page's own row; no page uses it.
- The selected tab, the selected sidebar row and the row under the pointer take the brand
  blue, not the accent pink: `wingman.css` redefines the accent variables inside
  `.md-sidebar--primary` and `.md-tabs`. Pink stays the accent everywhere else.
- `extra_css` paths are relative to `docs_dir`, so the stylesheet lives in the built site.
  Put it at `docs/user/assets/stylesheets/wingman.css` and write
  `extra_css = ["assets/stylesheets/wingman.css"]`.
- `theme.logo` and `theme.favicon` are also relative to `docs_dir`. Copy
  `frontend/public/logo.png` to `docs/user/assets/logo.png` for the logo. The favicon has its
  own file in the app, `frontend/public/favicon-32x32.png`, and that is the better source for
  `theme.favicon`.
- A section with an index page is a nested list whose first entry is the bare index path:

```toml
nav = [
  { "Overview" = "index.md" },
  { "Get started" = [
    "start/index.md",
    { "Install and run" = "start/install.md" },
  ] },
]
```

  With `navigation.indexes` on, the section's own label links to that index page.

- TOML order matters. Plain keys such as `extra_css` and `nav` must stand before the first
  `[table]` or `[[table]]` header, or they become part of that table and are silently
  ignored.

## Sources

- Google developer documentation style guide, highlights: https://developers.google.com/style/highlights
- Google style guide, images and screenshots: https://developers.google.com/style/images
- Google style guide, UI elements: https://developers.google.com/style/ui-elements
- Google style guide, timeless documentation: https://developers.google.com/style/timeless-documentation
- Google style guide, dashes: https://developers.google.com/style/dashes
- Microsoft Writing Style Guide, top 10 tips: https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice
- Diataxis, the framework: https://diataxis.fr/
- Diataxis, how-to guides: https://diataxis.fr/how-to-guides/
- Diataxis, reference: https://diataxis.fr/reference/
- Digital.gov plain language guide: https://digital.gov/guides/plain-language
- Write the Docs, beginner's guide to documentation: https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/
- Mailchimp content style guide, voice and tone: https://styleguide.mailchimp.com/voice-and-tone/
- Apple Support, an article read for consumer help tone: https://support.apple.com/en-us/104987
- Material for MkDocs, admonitions: https://squidfunk.github.io/mkdocs-material/reference/admonitions/
- Material for MkDocs, images: https://squidfunk.github.io/mkdocs-material/reference/images/
- Material for MkDocs, icons and emojis: https://squidfunk.github.io/mkdocs-material/reference/icons-emojis/
- Material for MkDocs, content tabs: https://squidfunk.github.io/mkdocs-material/reference/content-tabs/
