# Recipes

Step lists for the changes that come up most. Each assumes the codebase map in
[CLAUDE.md](../../CLAUDE.md) and the rules in [code-style.md](code-style.md).
When a recipe and the code disagree, the code has moved on — fix the recipe in
the same commit.

## Add an API endpoint

1. **Read model** in `<module>/schema.py` (Pydantic, FastAPI-free). Reuse an
   existing one if the shape already exists.
2. **Service method** in `<module>/service.py`. Raise a domain exception
   (`SongNotFoundError`, …) rather than an `HTTPException`; the handler maps it.
3. **Route** in `<module>/api.py`: `response_model=…`,
   `dependencies=[Depends(require("<area>.<verb>"))]`. Plural nouns for
   resources, a verb only for a true action (`POST /songs/{id}/sing`). Errors
   are `HTTPException` with a machine-readable `detail`. A handler that returns
   songs or takes a song id also takes `HiddenSongsDep` and passes it to
   `songs.api.song_or_404` (or filters the ids out): a tag's `view_songs` hides
   songs everywhere, see [architecture](architecture.md#permissions).
4. **Capability**: if none fits, add `<area>.<verb>` to `CAPABILITIES` in
   `auth/permissions.py` and to `DEFAULT_GROUP_CAPABILITIES` there (Guest,
   User, Trusted — never Admin, which holds every capability by rule), and seed
   it for a database that already exists with a migration of its own:
   insert-if-missing into `group_capabilities` for `guest` and `user`, and for
   Trusted only while the group exists, because the host may have deleted it
   ([permission-groups.md §8.4](permission-groups.md#84-seeding-a-capability-from-now-on)
   has the statement). `test_permissions.test_the_migration_seeds_the_module_defaults`
   keeps the two in step. Mention it in `docs/user/people/groups.md`, the page
   that says what each group may do. The permissions UI groups by the
   `<area>` prefix and shows the verb, so a new capability needs no frontend
   change beyond an area icon if the area is new (`RolePermissions.tsx`).
5. **Tests** in `tests/test_<module>_api.py`: happy path with `client`
   (admin), the error case. Add the route to `ROUTES` in
   `tests/test_permissions.py` — the matrix test proves that every identity
   without the capability gets 403 and that no capability is unlisted.
6. **Regenerate the frontend client** (below) and commit the `src/api/*.gen.ts`
   changes with the feature.
7. **Use it** through the generated TanStack options:
   `useQuery(listFooOptions())`, `useMutation(createFooMutation())` from
   `src/api/@tanstack/react-query.gen`. Never hand-write request types.
8. **Docs**: user-facing behaviour → the matching `docs/user/` page.

### Regenerate the API client

With a backend on :8080: `npm run generate-api` (cwd `frontend/`).

Without one (the user's backend may be stale or absent), dump the schema and
point the generator at the file. The dump is a script, not a `python -c`
one-liner: the venv python is only ever called by absolute path on a file
(CLAUDE.md), so write this to `<scratchpad>\dump_openapi.py` first —

```python
import json
from pathlib import Path

from ultrastar_wingman.app import create_app

# Written here rather than by a `>` redirect: PowerShell's redirect writes
# UTF-8 *with* a BOM, and the generator's JSON parser refuses one.
Path(r"<scratchpad>\openapi.json").write_text(
    json.dumps(create_app().openapi()), encoding="utf-8"
)
```

— and then run it:

```powershell
$env:WINGMAN_DATA_DIR = "<scratchpad>\gen"   # isolated DB, never the live one
D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe <scratchpad>\dump_openapi.py
cd frontend; npx openapi-ts --input <scratchpad>\openapi.json
```

`openapi-ts.config.ts` supplies output path and plugins; do not commit a
changed `input`. The output is identical to `npm run generate-api`.

## Add a setting

1. `register(SettingDefinition(key="<group>.<name>", value_type=…,
   default=…, group="<Group>", description="…", validate=…))` in
   `backend/src/ultrastar_wingman/settings.py`. Groups are display sections;
   the description is user-facing text (task-first, no jargon). Add
   `advanced=True` when a normal setup never touches it — an override of
   something Wingman derives, or a knob only a broken environment needs: the
   page folds those away inside their group.
2. Read it where needed via `SettingsService`; react to changes by
   subscribing to `setting.changed` if the value is consumed by a long-lived
   object.
3. The Settings page renders every registered setting by group automatically
   (`pages/Settings.tsx`, `SettingField`). Only add a bespoke field component
   (`KaraokeSlotsField`, `VideoQualityField`) when the value needs structure
   a text/number/toggle cannot give — and register it in the page's field map.
4. Test the validator in `tests/test_settings_service.py`; add the setting to
   the table of its group in `docs/user/settings/reference.md`.

## Add a WebSocket event

1. `class FooHappened(Event)` in `events.py` with
   `event: Literal["foo.happened"] = "foo.happened"` and typed payload fields
   (reuse `schema.py` read models — never import from `api.py`).
2. `await event_bus.broadcast(FooHappened(...))` from the service that owns the
   change. Backend tests assert on the `broadcast_events` fixture.
3. Frontend: `useWingmanEvent<FooHappened>("foo.happened", handler)` in the
   component or a hook; usually the handler invalidates or patches a query.
   Tests deliver it with `FakeSocket.deliver({ event: "foo.happened", … })`.
4. Document the message shape in `frontend/README.md` only if the contract
   itself changes (it is flat JSON with an `event` discriminator).

## Add an icon

Append one `d` string to `ICON_PATHS` in `components/icons.tsx` (24×24, solid
shapes, several subpaths in the one string are fine — no `stroke`, no `<g>`).
Check the family rules in [ui-guidelines.md](ui-guidelines.md#3-icons) first.
Tests assert glyph choice with `iconNames()` from `src/test/icons.ts`.

A glyph a tag may be given goes into `PICKER_ICON_NAMES` in the same file as
well — the tag editor's picker is that allowlist and nothing else, in the order
[ui-guidelines.md](ui-guidelines.md#3-icons) fixes, because most of
`ICON_PATHS` already means something else in the app. A tag may still carry a
glyph the list leaves out (one written before the list, or by hand): the picker
keeps such a one chosen and choosable for that tag.

## Add a page or sub-page

1. `pages/Name.tsx` + `Name.css` + `Name.test.tsx`. Sub-pages start with
   `<PageHeader title="…" back="/parent">`; gated pages check
   `auth.loaded && auth.can("…")` and otherwise render a `settings-notice`
   sentence saying who may do this.
2. Route in `App.tsx`; parent entry in `COVERS` in `components/BottomNav.tsx`.
3. Tests follow the existing pattern: `vi.mock("../api/sdk.gen", …)` with
   `vi.hoisted` fns for the sdk calls the page makes, `meResponse(...)` for
   `/auth/me`, `QueryClientProvider` + `MemoryRouter` around the page,
   `FakeSocket` for events. Mock the sdk, not the query options.
4. `docs/user/`: a task-first page or section; update the codebase map's route
   list in `CLAUDE.md`.

## Add a migration

1. Change the SQLAlchemy model in `<module>/model.py`.
2. `venv -m alembic revision --autogenerate -m "<what>"` (cwd `backend/`),
   rename the file to the next `NNNN_<what>.py`, review the generated
   operations (autogenerate misses server defaults and data moves).
3. The app migrates to head on startup; tests run migrations against a fresh
   DB once per session (the template every test copies — see
   [testing.md](testing.md#the-test-database)), so a bad migration fails the
   suite. A downgrade is exercised only by a test that steps back itself.

## Add an extension-point implementation

Song source (`sources/base.py`), karaoke launcher (`karaoke/launcher.py`),
auth provider (`auth/providers.py`): implement the Protocol in its own module,
register it in the module's registry (importing it in `sources/__init__.py`
is what registers a source), and run the interface's contract tests against
it — a new implementation ships with the same test suite the existing one
passes. Never import FastAPI from an implementation.

## Change user-facing behaviour

Whatever moves a button, renames a tab, adds a setting or changes a flow also
updates the `docs/user/` page in the same branch and rebuilds the site
(`..\venv\Scripts\python.exe -m zensical build --strict --clean`, cwd
`docs/`). A feature without its docs is not done.
