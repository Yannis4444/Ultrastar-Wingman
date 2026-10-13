"""Putting USDX's window in front after a launch, against a fake desktop.

Nothing here touches the real window manager (`conftest.no_desktop` makes sure of that for
every other test too); how the real one behaves was measured by hand, see `usdx_window`.
"""

import logging
from collections.abc import Sequence

import pytest

from ultrastar_wingman.karaoke import usdx_window
from ultrastar_wingman.karaoke.usdx_window import (
    Outcome,
    TopLevelWindow,
    bring_to_front,
    find_window,
    raise_window,
)
from ultrastar_wingman.karaoke.usdx_window import system_desktop as real_system_desktop

USDX_PID = 4242
USDX_WINDOW = 100
BROWSER_WINDOW = 200
BROWSER_PID = 77


def window(
    handle: int, pid: int = USDX_PID, *, visible: bool = True, owned: bool = False
) -> TopLevelWindow:
    return TopLevelWindow(handle=handle, pid=pid, visible=visible, owned=owned)


class FakeDesktop:
    """A browser in front, and whatever windows the test lists — `appears_after` polls
    see none of them yet. `plain` and `attached` say which of the two ways to the front
    Windows lets through."""

    def __init__(
        self,
        windows: Sequence[TopLevelWindow] = (),
        *,
        appears_after: int = 0,
        foreground: int | None = BROWSER_WINDOW,
        plain: bool = False,
        attached: bool = True,
        minimized: bool = False,
    ) -> None:
        self._windows = list(windows)
        self._appears_after = appears_after
        self._foreground = foreground
        self._plain = plain
        self._attached = attached
        self._minimized = minimized
        self.polls = 0
        self.calls: list[str] = []

    def windows(self) -> Sequence[TopLevelWindow]:
        self.polls += 1
        return self._windows if self.polls > self._appears_after else []

    def foreground(self) -> int | None:
        return self._foreground

    def pid_of(self, handle: int) -> int:
        if handle == BROWSER_WINDOW:
            return BROWSER_PID
        return next(w.pid for w in self._windows if w.handle == handle)

    def is_minimized(self, handle: int) -> bool:
        return self._minimized

    def restore(self, handle: int) -> None:
        self.calls.append(f"restore {handle}")

    def set_foreground(self, handle: int) -> None:
        self.calls.append(f"plain {handle}")
        if self._plain:
            self._foreground = handle

    def set_foreground_attached(self, handle: int, foreground: int) -> None:
        self.calls.append(f"attached {handle} to {foreground}")
        if self._attached:
            self._foreground = handle


# --- finding the window ------------------------------------------------------------------


def test_the_window_is_the_visible_unowned_one_of_the_process() -> None:
    desktop = FakeDesktop(
        [
            window(1, pid=BROWSER_PID),
            # SDL's own helper windows, IME windows and the like: hidden.
            window(2, visible=False),
            # A dialog USDX might own.
            window(3, owned=True),
            window(USDX_WINDOW),
        ]
    )

    assert find_window(desktop, USDX_PID) == USDX_WINDOW


def test_a_process_without_a_window_has_none() -> None:
    desktop = FakeDesktop([window(1, pid=BROWSER_PID), window(2, visible=False)])

    assert find_window(desktop, USDX_PID) is None


# --- raising it --------------------------------------------------------------------------


def test_a_window_already_in_front_is_left_alone() -> None:
    """USDX took the foreground itself (nobody had touched the PC for a while)."""
    desktop = FakeDesktop([window(USDX_WINDOW)], foreground=USDX_WINDOW)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.ALREADY
    assert desktop.calls == []


def test_another_window_of_usdx_in_front_counts_as_in_front() -> None:
    desktop = FakeDesktop([window(USDX_WINDOW), window(5)], foreground=5)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.ALREADY
    assert desktop.calls == []


def test_the_plain_way_is_tried_first() -> None:
    """It works whenever the foreground lock has run out, and attaches to nobody."""
    desktop = FakeDesktop([window(USDX_WINDOW)], plain=True)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.RAISED
    assert desktop.calls == [f"plain {USDX_WINDOW}"]


def test_a_refused_plain_try_attaches_to_the_window_in_front() -> None:
    """The live case: somebody just clicked in the browser, Wingman may not take the
    foreground, so its thread borrows the browser's input for one call."""
    desktop = FakeDesktop([window(USDX_WINDOW)])

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.RAISED
    assert desktop.calls == [
        f"plain {USDX_WINDOW}",
        f"attached {USDX_WINDOW} to {BROWSER_WINDOW}",
    ]


def test_both_ways_refused_is_said_so() -> None:
    desktop = FakeDesktop([window(USDX_WINDOW)], attached=False)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.REFUSED


def test_with_nothing_in_front_there_is_nobody_to_attach_to() -> None:
    desktop = FakeDesktop([window(USDX_WINDOW)], foreground=None)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.REFUSED
    assert desktop.calls == [f"plain {USDX_WINDOW}"]


def test_a_minimised_window_is_restored_first() -> None:
    """The already-open USDX the host asks for again may have been minimised."""
    desktop = FakeDesktop([window(USDX_WINDOW)], plain=True, minimized=True)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.RAISED
    assert desktop.calls == [f"restore {USDX_WINDOW}", f"plain {USDX_WINDOW}"]


def test_a_minimised_window_in_front_is_restored_too() -> None:
    """Measured: minimising a window from another process leaves it the foreground window
    when Windows will not hand the foreground to the next one."""
    desktop = FakeDesktop([window(USDX_WINDOW)], foreground=USDX_WINDOW, minimized=True)

    assert raise_window(desktop, USDX_WINDOW, USDX_PID) is Outcome.ALREADY
    assert desktop.calls == [f"restore {USDX_WINDOW}"]


# --- waiting for it ----------------------------------------------------------------------


async def test_it_waits_for_the_window_and_acts_once() -> None:
    desktop = FakeDesktop([window(USDX_WINDOW)], appears_after=3)

    await bring_to_front(USDX_PID, lambda: True, desktop=desktop, poll=0)

    assert desktop.polls == 4
    assert desktop.calls == [
        f"plain {USDX_WINDOW}",
        f"attached {USDX_WINDOW} to {BROWSER_WINDOW}",
    ]


async def test_it_gives_up_when_the_process_ends_first() -> None:
    desktop = FakeDesktop([window(USDX_WINDOW)], appears_after=1_000)
    running = iter([True, True, False])

    await bring_to_front(USDX_PID, lambda: next(running), desktop=desktop, poll=0)

    assert desktop.polls == 3
    assert desktop.calls == []


async def test_it_gives_up_after_the_timeout(caplog: pytest.LogCaptureFixture) -> None:
    desktop = FakeDesktop([window(USDX_WINDOW)], appears_after=1_000)

    with caplog.at_level(logging.DEBUG, logger=usdx_window.__name__):
        await bring_to_front(USDX_PID, lambda: True, desktop=desktop, wait_seconds=0, poll=0)

    assert desktop.calls == []
    assert [record.levelno for record in caplog.records] == [logging.DEBUG]


async def test_a_refusal_is_one_warning(caplog: pytest.LogCaptureFixture) -> None:
    desktop = FakeDesktop([window(USDX_WINDOW)], attached=False)

    with caplog.at_level(logging.DEBUG, logger=usdx_window.__name__):
        await bring_to_front(USDX_PID, lambda: True, desktop=desktop, poll=0)

    assert [record.levelno for record in caplog.records] == [logging.WARNING]
    assert "behind another window" in caplog.records[0].getMessage()


async def test_an_error_is_one_warning_and_never_raised(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """This runs beside a sing: nothing in it may fail one."""

    class BrokenDesktop(FakeDesktop):
        def windows(self) -> Sequence[TopLevelWindow]:
            raise OSError("access denied")

    with caplog.at_level(logging.DEBUG, logger=usdx_window.__name__):
        await bring_to_front(USDX_PID, lambda: True, desktop=BrokenDesktop(), poll=0)

    assert [record.levelno for record in caplog.records] == [logging.WARNING]
    assert "access denied" in caplog.records[0].getMessage()


async def test_without_a_desktop_it_does_nothing() -> None:
    """Off Windows (and in every other test, see `conftest.no_desktop`)."""
    await bring_to_front(USDX_PID, lambda: pytest.fail("nothing to wait for"))


def test_there_is_no_desktop_off_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(usdx_window.sys, "platform", "linux")

    assert real_system_desktop() is None
