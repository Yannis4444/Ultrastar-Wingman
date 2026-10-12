"""Putting Ultrastar Deluxe's window in front of the others. Windows only.

Why this is needed: Windows does not let just any process put a window in the foreground.
`SetForegroundWindow` succeeds only for a process that *is* the foreground process, was
started by it, received the last input event, or once nobody has touched the keyboard or
mouse for `SPI_GETFOREGROUNDLOCKTIMEOUT` (200 000 ms unless somebody changed it); a
window a process shows for the first time is activated under the same rule (measured:
a tkinter window started from a background console process stayed behind the browser).
Anybody else gets a flashing taskbar button instead.

Wingman is a console program nobody looks at, so USDX, started by it, inherits no right
at all: its window comes up **behind** the browser whenever somebody used this PC within
the last 200 s — which is exactly what a host who pressed Play on the host screen, or
*Launch* in the settings, has just done — and in front when the song was picked on a
phone after the PC sat untouched for longer. That is the "sometimes".

`STARTUPINFO.wShowWindow` cannot help: it picks the first `ShowWindow`'s *state*
(normal, minimised, …), not the right to be activated. `AllowSetForegroundWindow` cannot
either: only a process that may set the foreground itself may hand the right on, and
Wingman may not. A plain `SetForegroundWindow` from Wingman is tried first, because it
does work once the lock has run out, and then the one thing measured to work while it has
not (Windows 10, a tkinter window behind Firefox): attaching this thread's input to the
foreground window's thread for the length of one `SetForegroundWindow` +
`BringWindowToTop`, then detaching. Ruled out on purpose: a synthetic key press (the
"Alt trick" — it reaches whatever the host is typing into, and opens menus),
`SwitchToThisWindow` ("not intended for general use"), and a topmost toggle (moves the
window up without giving it the keyboard, so Esc would still go to the browser).

It happens once per launch, as soon as USDX shows its window, and never again: a host
who goes back to the browser afterwards is left alone. Nothing here can fail a sing —
every outcome is a log line.
"""

import asyncio
import enum
import logging
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)

# How long to wait for USDX to show a window. It creates the window hidden and shows it
# once its sound and its renderer are up (`Initialize3D`), which is seconds after the start;
# a window that takes longer than this is not one the host is waiting for any more.
WINDOW_TIMEOUT_SECONDS = 30.0
POLL_SECONDS = 0.25


@dataclass(frozen=True)
class TopLevelWindow:
    handle: int
    pid: int
    visible: bool
    # An owned window (a dialog, a tool window) is never the application's own window.
    owned: bool


class Desktop(Protocol):
    """What this module needs of the window manager — the Windows one in production, a
    fake in the tests. Every method may block for a moment: callers run them in a thread."""

    def windows(self) -> Sequence[TopLevelWindow]: ...

    def foreground(self) -> int | None: ...

    def pid_of(self, handle: int) -> int: ...

    def is_minimized(self, handle: int) -> bool: ...

    def restore(self, handle: int) -> None: ...

    def set_foreground(self, handle: int) -> None: ...

    def set_foreground_attached(self, handle: int, foreground: int) -> None:
        """`set_foreground` with this thread's input attached to `foreground`'s thread."""
        ...


class Outcome(enum.Enum):
    ALREADY = "already"
    RAISED = "raised"
    REFUSED = "refused"


def find_window(desktop: Desktop, pid: int) -> int | None:
    """The first visible, unowned top-level window of `pid`. Blocking."""
    for window in desktop.windows():
        if window.pid == pid and window.visible and not window.owned:
            return window.handle
    return None


def raise_window(desktop: Desktop, handle: int, pid: int) -> Outcome:
    """Put `handle` in front, the polite way first. Blocking."""
    # Before anything else: a minimised window can still be the foreground window, and
    # "in front" means the host can see it.
    if desktop.is_minimized(handle):
        desktop.restore(handle)
    previous = desktop.foreground()
    if previous is not None and (previous == handle or desktop.pid_of(previous) == pid):
        return Outcome.ALREADY
    desktop.set_foreground(handle)
    if desktop.foreground() == handle:
        return Outcome.RAISED
    if previous is not None:
        desktop.set_foreground_attached(handle, previous)
        if desktop.foreground() == handle:
            return Outcome.RAISED
    return Outcome.REFUSED


async def bring_to_front(
    pid: int,
    is_running: Callable[[], bool],
    *,
    desktop: Desktop | None = None,
    wait_seconds: float = WINDOW_TIMEOUT_SECONDS,
    poll: float = POLL_SECONDS,
) -> None:
    """Wait for `pid` to show its window, then put that window in front — once.

    Gives up quietly when the process ends first or shows nothing within `wait_seconds`. Never
    raises (cancellation aside): this runs beside a sing, and a window left behind is a
    nuisance, never a reason to refuse one.
    """
    try:
        desktop = desktop if desktop is not None else system_desktop()
        if desktop is None:
            return
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait_seconds
        while (handle := await asyncio.to_thread(find_window, desktop, pid)) is None:
            if not is_running():
                return
            if loop.time() >= deadline:
                logger.debug("Ultrastar Deluxe showed no window within %.0f s", wait_seconds)
                return
            await asyncio.sleep(poll)
        outcome = await asyncio.to_thread(raise_window, desktop, handle, pid)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        logger.warning("Could not bring Ultrastar Deluxe to the front: %s", error)
        return
    if outcome is Outcome.REFUSED:
        logger.warning(
            "Ultrastar Deluxe is behind another window: Windows did not let Wingman "
            "bring it to the front"
        )
    else:
        logger.debug("Ultrastar Deluxe window: %s", outcome.value)


def system_desktop() -> Desktop | None:
    """The real window manager, or `None` where there is none to talk to."""
    if sys.platform == "win32":
        return _Win32Desktop()
    return None


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    _GW_OWNER = 4
    _SW_RESTORE = 9

    _user32.EnumWindows.argtypes = [_WNDENUMPROC, wintypes.LPARAM]
    _user32.EnumWindows.restype = wintypes.BOOL
    _user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    _user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    _user32.IsWindowVisible.argtypes = [wintypes.HWND]
    _user32.IsWindowVisible.restype = wintypes.BOOL
    _user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    _user32.GetWindow.restype = wintypes.HWND
    _user32.GetForegroundWindow.argtypes = []
    _user32.GetForegroundWindow.restype = wintypes.HWND
    _user32.IsIconic.argtypes = [wintypes.HWND]
    _user32.IsIconic.restype = wintypes.BOOL
    # The asynchronous variant: USDX's own thread does the work, so a busy USDX cannot
    # hold this one up.
    _user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
    _user32.ShowWindowAsync.restype = wintypes.BOOL
    _user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    _user32.SetForegroundWindow.restype = wintypes.BOOL
    _user32.BringWindowToTop.argtypes = [wintypes.HWND]
    _user32.BringWindowToTop.restype = wintypes.BOOL
    _user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    _user32.AttachThreadInput.restype = wintypes.BOOL
    _kernel32.GetCurrentThreadId.argtypes = []
    _kernel32.GetCurrentThreadId.restype = wintypes.DWORD

    def _owner(handle: int) -> tuple[int, int]:
        """The thread and the process that created `handle`."""
        pid = wintypes.DWORD()
        thread = _user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
        return thread, pid.value

    class _Win32Desktop:
        def windows(self) -> Sequence[TopLevelWindow]:
            found: list[TopLevelWindow] = []

            def visit(handle: int, _: int) -> bool:
                found.append(
                    TopLevelWindow(
                        handle=handle,
                        pid=_owner(handle)[1],
                        visible=bool(_user32.IsWindowVisible(handle)),
                        owned=bool(_user32.GetWindow(handle, _GW_OWNER)),
                    )
                )
                return True

            _user32.EnumWindows(_WNDENUMPROC(visit), 0)
            return found

        def foreground(self) -> int | None:
            handle: int | None = _user32.GetForegroundWindow()
            return handle or None

        def pid_of(self, handle: int) -> int:
            return _owner(handle)[1]

        def is_minimized(self, handle: int) -> bool:
            return bool(_user32.IsIconic(handle))

        def restore(self, handle: int) -> None:
            _user32.ShowWindowAsync(handle, _SW_RESTORE)

        def set_foreground(self, handle: int) -> None:
            _user32.SetForegroundWindow(handle)

        def set_foreground_attached(self, handle: int, foreground: int) -> None:
            own = _kernel32.GetCurrentThreadId()
            other = _owner(foreground)[0]
            if other == 0 or other == own:
                return
            if not _user32.AttachThreadInput(own, other, True):
                return
            try:
                _user32.SetForegroundWindow(handle)
                _user32.BringWindowToTop(handle)
            finally:
                _user32.AttachThreadInput(own, other, False)
