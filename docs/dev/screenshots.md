# Taking the documentation screenshots

Every picture on the user site comes from one repeatable run. Nobody captures one by
hand. When a surface changes, the manifest row changes and the run happens again.

The rules the pictures follow are section 6 of [documentation.md](documentation.md).
This page is how to produce them. The scripts live in `docs/screenshots/`, outside the
site build root, so none of them ever ships as a site asset.

## Prerequisites

- The repo venv: `D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe`. Never system
  Python. Every Python command on this page runs from the repository root, where the
  relative `venv\Scripts\python.exe` is that same file. No extra package is needed: `httpx`,
  `websockets` and SQLAlchemy come with the backend, which `pip install -e "backend[dev]"`
  already put there.
- A built frontend. Run `npm run build` in `frontend/` once. The scratch backend serves
  `frontend/dist`, so there is no vite in this loop.
- Chrome at `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`. Pass
  `--chrome <path>` if it is somewhere else.
- The character pictures in `docs/screenshots/avatars/` (see [Avatars](#avatars)).

## The one command

```powershell
venv\Scripts\python.exe docs\screenshots\capture.py --all
```

That seeds a scratch Wingman, drives a headless Chrome through all 35 manifest rows,
writes the PNGs, then kills every process it started and deletes the scratch directory.
It prints one summary line per id: who was looking, whether it worked, the pixel size,
and the element it waited for. A failed id is named with its reason and no file is
written.

Useful flags:

| Flag | What it does |
|---|---|
| `--id <id>` | One manifest id, starting whatever it needs |
| `--keep` | Leave the scratch instance running afterwards, for a look |
| `--chrome <path>` | Another Chrome binary |
| `--data-dir <path>` | Another scratch directory |
| `--port` / `--usdb-port` / `--cdp-port` | Other ports |

## What it starts

These are the defaults. The flags above change any of them, and everything below assumes
the values the run actually used.

| Thing | Where |
|---|---|
| Scratch data directory | `%TEMP%\wingman-screenshots` |
| Wingman backend and UI | `http://127.0.0.1:8091` |
| Stand-in USDB server | `http://127.0.0.1:8092` |
| Headless Chrome, debugging port | `9346` |
| Chrome profile | inside the scratch directory |

None of that touches the developer's own Wingman on port 8080 or their real data
directory. See [verifying.md](verifying.md) for why that matters.

The scratch directory gets a `.wingman-screenshots` marker file the moment it is created,
and the scripts delete no directory that lacks it. A mistyped `--data-dir` therefore fails
loudly instead of taking somebody's live data with it.

## How the instance is filled

`docs/screenshots/seed.py` does the seeding, and `capture.py` calls it. The order is
fixed, because each step needs the one before it:

1. The fake song library is written to disk, then the stand-in launcher beside it.
2. The stand-in USDB server and the backend start.
3. The host token is read out of the backend log and exchanged for a cookie. It is
   single use per backend start, so the capture run never exchanges it again.
4. Accounts: Leela, then Fry, then Bender. The first account an instance ever has is its
   administrator, so Leela has to come first.
5. Guest players and everybody's avatar. Scruffy is then hidden.
6. Settings: the USDX paths, the stand-in USDB address, the join URL.
7. A library scan.
8. Two parties with their sings and scores, written straight into the database.
9. Wishes, favorites, playlists, tags, comments, achievements, the two download rows.
10. The run waits until the achievements pass has counted the history and left Bender
    one song short of the *Eighties Marathon*.

Everything the seed learns is written to `<data dir>\screenshots.json`. `capture.py`
reads playlist, tag, song and player ids from there and hardcodes none of them.

Identities are per browser context, so several can be open at once. The host uses the
seed's cookie; Leela, Fry and Bender log in over `POST /auth/login` with the placeholder
passwords in `scenario.py`; the guest browser carries no cookie at all.

## The stand-in launcher

Four rows need Ultrastar Deluxe to look like it is running: `home-playing`,
`host-playing`, `host-results` and `host-achievements`. Wingman never launches the real
program for a screenshot. `docs/screenshots/standin_usdx.py` takes its place, and the
**Executable** setting in the **USDX** group points at it.

The stand-in holds the song until a sentinel file appears, which is what lets a picture
be taken of a song that is playing. `capture.py` runs two takes:

1. Fry and Leela sing a song from 2010, which earns nobody anything. `home-playing` and
   `host-playing` are taken while it holds. Then the song is released, and the results
   appear at once, which is `host-results`.
2. The history is rewound, and Bender sings a song from the eighties on his own. That
   completes two achievements, and the badges take the stage before the results do,
   which is `host-achievements`.

Release, never kill: a killed stand-in is still waiting for its sentinel. Both takes are
rewound afterwards, so the instance ends where it started.

## Capturing one id

```powershell
venv\Scripts\python.exe docs\screenshots\capture.py --id songs-filter
```

With no scratch instance around, that seeds one, takes the picture and tears it down
again. With one already up (from `--keep`, or from `seed.py up`), it uses that one and
leaves it standing.

## Where the files land

`docs/user/assets/screenshots/<section>/<id>.png`, where `<section>` is the first path
segment of the manifest row's **Page** column. `home` belongs to `party/index.md`, so it
is written to `party/home.png`. Only the captured PNGs go under `docs/user/`.

Section 6 owns what a page does with it: the markup, the width, the alt text, the caption.

## Avatars

`docs/screenshots/avatars/` holds one picture per character. Ten names are expected:
`amy`, `bender`, `farnsworth`, `fry`, `hermes`, `kif`, `leela`, `scruffy`, `zapp` and
`zoidberg`, each as `.jpg`, `.jpeg`, `.png` or `.webp`.

The folder is gitignored, so the pictures are never repository content. Each one is
uploaded as it lies on disk, never cropped or re-encoded, so crop a picture by hand if it
looks wrong in the round frame. A missing picture is not an error: the seed prints a line
naming the characters it found no file for, and those players keep the app's own initials
avatar.

## Adding a manifest row

Two places, and a check that they agree:

1. Add the row to the manifest table in [documentation.md](documentation.md) section 6.
   Give it an id, the page it belongs to, the route, the state, the viewport, and what
   has to be visible.
2. Add an entry under the same id to `ROWS` in `docs/screenshots/capture.py`: who is
   looking, the viewport, the route, the steps that put the surface in that state, and a
   JavaScript expression that is true once the picture can be taken.

`capture.py` parses the manifest table and refuses to start when the two lists differ.
It names what is missing on either side.

## Changing the fake data

- `docs/screenshots/scenario.py` is the story: the roster, both parties with every
  score, the wishes, favorites, playlists, tags, comments and achievements. Its module
  docstring names the two rules the numbers have to keep.
- `docs/screenshots/songs.json` is the library. Four entries are fixed Easter eggs and
  must not be renamed: Sandstorm, Tequila, Rap God and the duet I Got You Babe.
- `docs/screenshots/usdb_catalogue.json` is what the stand-in USDB server offers.

Re-seed after any of these. The scratch instance is not migrated, it is rebuilt.

## Checking a file before committing

Open the PNG and look for:

- The right size. A phone shot is 780x1688 pixels, a host shot is 1280x720. `capture.py`
  refuses to write anything else, so this is a second pair of eyes rather than a test.
- No browser chrome, no desktop, no clock.
- Dark theme. The app has one.
- No real data. No real name, no real path, no address of the machine it was taken on.
  The join URL has to read `192.168.1.42:8091`.
- The avatars are pictures, not initials. Initials mean the avatar folder was empty.
- What the manifest row says has to be visible really is on screen, not merely in the
  page somewhere below the fold.

## Cleanup if the run dies

`capture.py` kills what it started, in a `finally` block, on failure as well. If it is
killed itself, clean up by hand:

```powershell
venv\Scripts\python.exe docs\screenshots\seed.py teardown
```

That kills the backend and the stand-in USDB by the process ids in `screenshots.json`,
reaps any stand-in launcher still waiting, and deletes the scratch directory.

`seed.py` takes `--data-dir` **before** the subcommand, unlike `capture.py`, so a run on
another directory ends with `seed.py --data-dir <path> teardown`.

Chrome is not in the state file, but `capture.py` prints its process id on the way up. Look
for a leftover on the ports the run used, `netstat -ano | findstr ":8091 :8092 :9346"` for
the defaults, and kill only a process id you can attribute to this run:
`taskkill /PID <pid> /T /F`. Never by name. See [verifying.md](verifying.md) for the full
cleanup rules.
