# Documentation Guide

Two audiences, two places. Never mix them.

## User documentation — `docs/user/` (built with zensical)

Markdown, built into the docs site with **zensical** (config in
`docs/zensical.toml`, `docs_dir = "user"` — zensical has no exclude option,
so the user pages live in their own subdirectory and `docs/dev/` stays
outside the build root). Build the site with:

```powershell
venv\Scripts\python.exe -m pip install -r docs\requirements.txt
cd docs; ..\venv\Scripts\python.exe -m zensical build --strict --clean
```

This is the main documentation effort: Wingman is used by non-developers at
karaoke parties.

### What to write

One page per user-facing feature, created **in the same branch as the
feature**. A feature without its docs page is not done. Pages to expect:
setup/installation, connecting USDX, downloading songs, playlists &
favorites, accounts & permissions, settings, statistics, the randomizer,
troubleshooting.

### How to write it

- **Task-first.** Titles are things the user wants to do ("Download songs
  from USDB"), not component names ("The USDB module").
- Start each page with one or two sentences of what the feature is for, then
  numbered steps. Screenshots where the UI isn't self-explanatory (store them
  under `docs/user/assets/`, PNG, sensible width).
- Short sentences, no jargon. If a backend term leaks into user docs
  ("source adapter"), rewrite it in user language ("where songs come from").
- Standard Markdown plus admonitions for warnings/tips:

  ```markdown
  !!! warning
      Ultrastar Deluxe must be closed before changing this setting.
  ```

  Keep to plain Markdown + admonitions; don't adopt generator-specific
  features without checking they exist in zensical first.
- Document the current release only. No "as of version X" archaeology — git
  has history.

## Developer documentation — `docs/dev/` + code

- The guides in `docs/dev/` (this folder) cover *how we work*. Update them
  when a rule changes; delete rules that stopped being true.
- *How the code works* lives in the code: docstrings on public
  interfaces/services (what it does, what it raises), a short `README.md` per
  top-level component (backend, frontend) covering how to run it locally.
- Architecture decisions that would surprise a newcomer (why we don't use
  USDX's score storage, how song identity works) get a short section in
  [architecture.md](architecture.md) — one paragraph each, not ADR ceremony.

## Rules for all docs

- Wrong docs are worse than no docs: whoever changes behavior updates the
  docs in the same commit/branch.
- Relative links between pages so they work on the site and on GitHub.
- English only.
