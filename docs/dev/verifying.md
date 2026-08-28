# Verifying in the running app

Unit tests come first (see [testing.md](testing.md)); this guide is for the
part they cannot cover — seeing a change in the real UI, on a phone-sized
viewport and on the host TV layout — and for leaving the machine as you found
it afterwards.

## The user's instances are off limits

The developer normally has their own backend on **:8080** and vite on
**:5173**, pointed at their live `WINGMAN_DATA_DIR` (real players, scores,
settings, downloads). Treat those as read-only:

- Never start a real sing, change a setting, queue a download or create
  players/playlists against the live data. Anything that writes runs against a
  **scratch data dir** on **alternate ports**:

  ```powershell
  $env:WINGMAN_DATA_DIR = "<scratchpad>\data"; $env:WINGMAN_PORT = "8081"
  $env:WINGMAN_OPEN_BROWSER = "false"
  D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe -m ultrastar_wingman
  ```

  `WINGMAN_OPEN_BROWSER=false` matters: otherwise the backend opens the host
  page itself and consumes the one-time host token you need below.
- Vite on another port with the proxy pointed at :8081 needs a temporary
  config. Create it under a **fresh file name** (`vite.<purpose>.tmp.config.ts`),
  run `npx vite --config <file> --port 5189`, and delete the file when done.
  Point `songs.directory` at a small fixture library; the real songs folder
  is fine to *read*.
- Record the PID of every process you start. You will need it for cleanup.

## Admin without a password

Nobody types credentials during verification — not the user's, not made-up
ones for external services. The password-free way to be admin is the host
token: the backend logs a line containing `hostToken=…` on start. Open
`http://localhost:<vite-port>/host?hostToken=<token>`; the exchange sets a
persistent trusted-admin cookie that also works through the vite proxy. The
token is single-use per backend start; `POST /api/v1/auth/logout` drops you
back to guest.

Logged-in-*account* UI (a `user` role, a player bound to an account) cannot be
reached this way. Verify it with unit tests (`meResponse` in
`src/test/auth.ts`) or by intercepting `/api/v1/auth/me` in a harness, and say
explicitly in the report what stayed unverified.

## Viewports

- **Phone:** 390×844 is the reference; nothing may scroll sideways at 360.
  A maximized Chrome ignores window resizing, so either use device emulation
  (headless below) or inject a 390×844 iframe into a blank same-origin page and
  drive it via `contentDocument` (React selects need the native value setter
  plus a bubbling `change` event).
- **Host TV:** 1280×720 and larger.

## Without a backend, without a browser tool

Three harnesses that have proven reliable when Chrome automation is unavailable:

1. **Canned API in vite.** A temporary vite config whose `configureServer`
   middleware answers `/api/*` with fixed JSON (a cookie can pick the state,
   e.g. `stage=playing`) lets the real frontend render any state — a running
   sing with a worst-case title, six singers, every capability granted — with
   no backend and no USDX.
2. **Headless Chrome over CDP.** `chrome.exe --headless=new
   --remote-debugging-port=9333 --user-data-dir=<scratchpad>\profile`, driven
   by a venv-python script over `websockets`: `Target.createTarget` →
   `Target.attachToTarget` (flatten) → `Emulation.setDeviceMetricsOverride`
   (390×844 mobile or 1280×720) → `Network.setCookie` → `Page.navigate` → wait
   → `Runtime.evaluate` (`getBoundingClientRect` as JSON) →
   `Page.captureScreenshot`. For pure CSS questions, a static HTML file with
   the real `index.css` + the page's CSS and `chrome.exe --headless=new
   --virtual-time-budget=1500 --dump-dom file:///…` is enough (`--window-size`
   is ignored there — vary a wrapper div's width instead).
3. **Firefox over WebDriver BiDi**, for "does this look right in Firefox
   too": `firefox.exe -profile <scratchpad>fprofile -no-remote --headless
   --remote-debugging-port=9222` prints `WebDriver BiDi listening on ws://…`,
   and a venv-python script over `websockets` drives it: `session.new` →
   `browsingContext.getTree` → `browsingContext.navigate` (`wait: complete`)
   → `script.evaluate`. End with `session.end`, or the next connection is
   refused with "Maximum number of active sessions". `--screenshot` does not
   work here (the software compositor fails to map its framebuffer), so ask
   the page what it computed — `getComputedStyle(...)` as JSON — instead of
   looking at pixels. Firefox refuses `file://` links to another directory, so
   a static harness has to inline the CSS it wants to test.

## Singing

"Play" launches the real Ultrastar Deluxe. Avoid it in verification. If a
check truly needs it, do it once against the scratch data dir, end it with
`POST /api/v1/karaoke/stop`, and confirm no `ultrastardx` process survives.

## Cleanup — every time, and don't trust reports

Processes started in the background outlive the agent and even the session;
a leftover backend on :8080 has blocked the developer's own app before. Agents'
"servers killed" claims have repeatedly been wrong, so the orchestrator or the
session that started things sweeps at the end:

1. `netstat -ano | findstr LISTENING` (or `grep -E ":(8080|8081|5173|5189)\s"`)
   and `Get-Process node, python | Select-Object Id, ProcessName, Path` — a
   stale vite may no longer hold its port.
2. Identify **before** killing:
   `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object ProcessId, ParentProcessId, CommandLine`.
   Temp vite configs and scratch `WINGMAN_DATA_DIR`s are the giveaways for
   yours. The venv's `python.exe` is a launcher whose child is
   `C:\Python312\python.exe -m ultrastar_wingman` — check the parent before
   concluding anything from the path.
3. **Kill only by PID you own:** `taskkill //PID <pid> //T //F` (the doubled
   slashes are the Git-Bash spelling; in PowerShell it is `/PID <pid> /T /F`).
   Never `taskkill //IM python.exe`, `//FI`, or `Stop-Process -Name` —
   name-based kills hit the user's processes. If an orphan cannot be attributed to you,
   leave it, exclude its port, and list it for the user.
4. Delete temp vite configs and the scratch data dir; close tabs you opened;
   revert any setting you changed on a shared instance; remove test
   players/playlists you created.
