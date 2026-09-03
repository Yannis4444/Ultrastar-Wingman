# Screenshot inputs

Everything the documentation screenshots are taken against. Inputs and scripts only. No
picture in this folder ever ships to the site: the built pages live under `docs/user/`, and
`docs/zensical.toml` builds `docs/user` alone, so this folder is outside the build root.

The procedure that uses these files is [docs/dev/screenshots.md](../dev/screenshots.md);
the rules the pictures follow are section 6 of
[docs/dev/documentation.md](../dev/documentation.md).

| File | What it is |
|---|---|
| `capture.py` | Takes the pictures: it seeds an instance, drives a headless Chrome over CDP through every manifest row, and writes one PNG per row. Start here. |
| `seed.py` | Brings up a scratch Wingman and fills it. One command line, plus small subcommands for putting a single surface into a single state. `capture.py` calls it, and so can you. |
| `scenario.py` | The party as data: the roster, the two parties with every score, the wishes, playlists, tags, comments and achievements. Change the story here. |
| `songs.json` | The fake library, about forty songs with the four fixed Easter eggs. |
| `library.py` | Writes that library into the scratch directory: a header-only USDX txt, a generated cover and a placeholder video per song. Also runnable on its own. |
| `standin_usdx.py` | Takes Ultrastar Deluxe's place. It holds the song until a sentinel file appears, so a picture can be taken of a song that is playing. |
| `fake_usdb.py` | Takes usdb.animux.de's place, so the download pages can be photographed without an account and without touching the real site. |
| `usdb_catalogue.json` | What that stand-in server has in its catalogue. |
| `avatars/` | The player pictures. Gitignored, so they are never repository content. A missing file is reported and that player keeps the app's own initials avatar. |

## The short version

From the repository root, with the frontend built once (`npm run build` in `frontend/`),
every picture in one command:

```powershell
venv\Scripts\python.exe docs\screenshots\capture.py --all
```

To bring the instance up and look at it by hand instead:

```powershell
venv\Scripts\python.exe docs\screenshots\seed.py up
```

That prints the port, the process ids, the cookies to set on the browser, the account
passwords and the ids the screenshot manifest names. When you are done:

```powershell
venv\Scripts\python.exe docs\screenshots\seed.py teardown
```

Nothing here ever touches the developer's own Wingman on port 8080 or their real data
directory. The scratch instance listens on 8091 and the stand-in USDB on 8092.
