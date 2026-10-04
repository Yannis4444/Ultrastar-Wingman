"""Around the server: the port probe a second start stops at, and the window that waits to be
read after a failed start — and the entry point that wires both."""

import errno
import logging
import socket
import sys
from collections.abc import Callable, Iterator

import pytest

from ultrastar_wingman import __main__ as entry_point
from ultrastar_wingman import startup
from ultrastar_wingman.config import get_bootstrap_settings

# --- the port probe ------------------------------------------------------------------------


def held(family: socket.AddressFamily, host: str) -> socket.socket:
    """A listening socket on an ephemeral port of `host`, the way a running Wingman holds it."""
    holder = socket.socket(family, socket.SOCK_STREAM)
    if family == socket.AF_INET6:
        holder.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, True)
    holder.bind((host, 0))
    holder.listen()
    return holder


def free_port() -> int:
    with socket.socket() as finder:
        finder.bind(("127.0.0.1", 0))
        return int(finder.getsockname()[1])


def ipv6_available() -> bool:
    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as attempt:
            attempt.bind(("::1", 0))
    except OSError:
        return False
    return True


@pytest.mark.parametrize(
    ("holder", "probed"),
    [
        # A second Wingman: the same address as the first, `0.0.0.0` by default.
        ("0.0.0.0", "0.0.0.0"),
        ("127.0.0.1", "127.0.0.1"),
        # Every address a name resolves to is tried, and `""` is every interface.
        ("127.0.0.1", "localhost"),
        ("0.0.0.0", ""),
    ],
)
def test_a_port_held_on_ipv4_is_taken(holder: str, probed: str) -> None:
    with held(socket.AF_INET, holder) as holding:
        assert startup.port_is_taken(probed, holding.getsockname()[1])


@pytest.mark.skipif(not ipv6_available(), reason="no IPv6 loopback on this machine")
@pytest.mark.parametrize(("holder", "probed"), [("::1", "::1"), ("::", "::"), ("::", "")])
def test_a_port_held_on_ipv6_is_taken(holder: str, probed: str) -> None:
    with held(socket.AF_INET6, holder) as holding:
        assert startup.port_is_taken(probed, holding.getsockname()[1])


def bind_fails(host: str, port: int) -> bool:
    """What a server's plain bind on `host:port` runs into right now."""
    try:
        with socket.socket() as attempt:
            attempt.bind((host, port))
    except OSError:
        return True
    return False


@pytest.mark.parametrize(("holder", "probed"), [("127.0.0.1", "0.0.0.0"), ("0.0.0.0", "127.0.0.1")])
def test_across_addresses_the_probe_answers_what_the_servers_bind_would(
    holder: str, probed: str
) -> None:
    """Windows lets a listener on every interface and one on a single address share a port,
    Linux does not. The probe is no stricter than the bind uvicorn is about to make: it
    stops a start that would fail, never one that would not."""
    with held(socket.AF_INET, holder) as holding:
        port = holding.getsockname()[1]
        assert startup.port_is_taken(probed, port) is bind_fails(probed, port)


@pytest.mark.parametrize("probed", ["127.0.0.1", "0.0.0.0", "localhost", ""])
def test_a_free_port_is_not_taken(probed: str) -> None:
    port = free_port()

    assert not startup.port_is_taken(probed, port)
    # The probe let go of it: the server can bind it right after.
    with socket.socket() as server:
        server.bind(("127.0.0.1", port))


class RefusedSocket(socket.socket):
    """A socket whose bind meets `error`, recording the options set on it beforehand."""

    error: OSError
    options: list[tuple[int, int]] = []

    def setsockopt(self, level: int, option: int, value: object, *rest: object) -> None:
        RefusedSocket.options.append((level, option))
        super().setsockopt(level, option, value, *rest)  # type: ignore[call-overload]

    def bind(self, _address: object) -> None:
        raise RefusedSocket.error


# Any port: a `RefusedSocket` never binds one, and `free_port` cannot run once it is in place.
NEVER_BOUND = 8093


def refusing(monkeypatch: pytest.MonkeyPatch, error: OSError) -> None:
    RefusedSocket.error = error
    RefusedSocket.options = []
    monkeypatch.setattr(startup.socket, "socket", RefusedSocket)


def test_a_port_windows_holds_exclusively_is_taken(monkeypatch: pytest.MonkeyPatch) -> None:
    """WSAEACCES: another program bound it with SO_EXCLUSIVEADDRUSE, or Hyper-V reserved it."""
    denied = OSError(errno.EACCES, "access denied")
    # typeshed declares `winerror` on Windows alone.
    denied.winerror = startup.WSAEACCES  # type: ignore[attr-defined, unused-ignore]
    refusing(monkeypatch, denied)

    assert startup.port_is_taken("127.0.0.1", NEVER_BOUND)


def test_a_privileged_port_is_left_to_uvicorn(monkeypatch: pytest.MonkeyPatch) -> None:
    """A POSIX EACCES (a port under 1024 without the right to it) is no running Wingman."""
    refusing(monkeypatch, OSError(errno.EACCES, "permission denied"))

    assert not startup.port_is_taken("127.0.0.1", NEVER_BOUND)


@pytest.mark.parametrize("reuses", [True, False])
def test_the_probe_reuses_addresses_exactly_where_asyncio_does(
    monkeypatch: pytest.MonkeyPatch, reuses: bool
) -> None:
    """On POSIX asyncio's bind passes the TIME_WAIT a stopped Wingman leaves, and so must the
    probe, or a restart reads as "already running"; on Windows the flag would pass a live
    listener, and neither sets it."""
    refusing(monkeypatch, OSError(errno.EADDRINUSE, "in use"))
    monkeypatch.setattr(startup, "REUSES_ADDRESSES", reuses)

    startup.port_is_taken("127.0.0.1", NEVER_BOUND)

    assert ((socket.SOL_SOCKET, socket.SO_REUSEADDR) in RefusedSocket.options) is reuses


def test_a_host_that_is_not_this_machines_is_left_to_uvicorn() -> None:
    """Not "taken": the bind fails for another reason, and uvicorn's own error names it."""
    assert not startup.port_is_taken("192.0.2.1", free_port())
    assert not startup.port_is_taken("no-such-host.invalid", free_port())


# --- exit codes and the pause --------------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "expected"), [(None, 0), (0, 0), (3, 3), (2, 2), ("a message", 1)]
)
def test_an_exit_code_follows_pythons_rule(code: object, expected: int) -> None:
    assert startup.exit_code(code) == expected


@pytest.mark.parametrize(
    ("exit_code", "interrupted", "frozen", "isatty", "expected"),
    [
        # The exe, in its own window, failing: the one case that waits.
        (3, False, True, True, True),
        (1, False, True, True, True),
        # Stopped on purpose, or a clean end.
        (0, False, True, True, False),
        (0, True, True, True, False),
        (1, True, True, True, False),
        # A developer's terminal stays open by itself.
        (3, False, False, True, False),
        # Nobody to press Enter: a test, a pipe, a file.
        (3, False, True, False, False),
        (3, False, False, False, False),
    ],
)
def test_only_a_failed_exe_in_a_console_pauses(
    exit_code: int, interrupted: bool, frozen: bool, isatty: bool, expected: bool
) -> None:
    assert startup.should_pause(exit_code, interrupted, frozen, isatty) is expected


@pytest.mark.parametrize("error", [EOFError, OSError, KeyboardInterrupt])
def test_a_pause_never_raises(monkeypatch: pytest.MonkeyPatch, error: type[BaseException]) -> None:
    def ended(_prompt: str) -> str:
        raise error

    monkeypatch.setattr("builtins.input", ended)

    startup.pause()


def test_a_pause_waits_for_enter(monkeypatch: pytest.MonkeyPatch) -> None:
    prompts: list[str] = []

    def entered(prompt: str) -> str:
        prompts.append(prompt)
        return ""

    monkeypatch.setattr("builtins.input", entered)

    startup.pause()

    assert prompts == ["Press Enter to close this window."]


# --- the entry point -----------------------------------------------------------------------


class Entry:
    """`main` with nothing real behind it: what uvicorn did, and whether the window paused."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.monkeypatch = monkeypatch
        self.started: list[str] = []
        self.paused = 0
        self.taken = False
        self.run: Callable[[], None] = lambda: None
        monkeypatch.setattr(entry_point.uvicorn, "run", self._run)
        monkeypatch.setattr(entry_point.console, "configure", lambda *_: False)
        monkeypatch.setattr(entry_point.startup, "port_is_taken", lambda *_: self.taken)
        monkeypatch.setattr(entry_point.startup, "pause", self._pause)

    def _run(self, app: str, **_: object) -> None:
        self.started.append(app)
        self.run()

    def _pause(self) -> None:
        self.paused += 1

    def frozen_in_a_console(self) -> None:
        self.monkeypatch.setattr(sys, "frozen", True, raising=False)
        self.monkeypatch.setattr(entry_point.console, "is_console", lambda _stream: True)


@pytest.fixture
def entry(monkeypatch: pytest.MonkeyPatch) -> Iterator[Entry]:
    monkeypatch.delenv("WINGMAN_USDX_DIR", raising=False)
    monkeypatch.setenv("WINGMAN_PORT", "8093")
    get_bootstrap_settings.cache_clear()
    yield Entry(monkeypatch)
    get_bootstrap_settings.cache_clear()


def test_a_taken_port_stops_the_start_before_uvicorn(
    entry: Entry, caplog: pytest.LogCaptureFixture
) -> None:
    """Nothing of the lifespan runs: no migration, no host token, no browser, no scan."""
    entry.taken = True

    with (
        caplog.at_level(logging.INFO, logger="ultrastar_wingman"),
        pytest.raises(SystemExit) as stopped,
    ):
        entry_point.main([])

    assert stopped.value.code == startup.STARTUP_FAILURE
    assert entry.started == []
    assert "Wingman is already running, or port 8093 is taken" in caplog.messages


def test_a_taken_port_pauses_the_exe(entry: Entry) -> None:
    """The double-clicked icon of a Wingman already running: exactly the window to keep."""
    entry.taken = True
    entry.frozen_in_a_console()

    with pytest.raises(SystemExit):
        entry_point.main([])

    assert entry.paused == 1


def test_a_failed_bind_pauses_the_exe(entry: Entry) -> None:
    def failed() -> None:
        sys.exit(startup.STARTUP_FAILURE)

    entry.run = failed
    entry.frozen_in_a_console()

    with pytest.raises(SystemExit) as stopped:
        entry_point.main([])

    assert stopped.value.code == startup.STARTUP_FAILURE
    assert entry.paused == 1


def test_an_error_is_logged_and_pauses_the_exe(
    entry: Entry, caplog: pytest.LogCaptureFixture
) -> None:
    def broken() -> None:
        raise RuntimeError("the database is locked")

    entry.run = broken
    entry.frozen_in_a_console()

    with pytest.raises(SystemExit) as stopped:
        entry_point.main([])

    assert stopped.value.code == 1
    assert entry.paused == 1
    failure = next(line for line in caplog.records if line.exc_info)
    assert failure.getMessage() == "Wingman stopped on an error"


def test_a_clean_stop_never_pauses(entry: Entry) -> None:
    """uvicorn swallows the Ctrl+C it handles and returns."""
    entry.frozen_in_a_console()

    entry_point.main([])

    assert entry.started == ["ultrastar_wingman.app:create_app"]
    assert entry.paused == 0


def test_ctrl_c_never_pauses(entry: Entry) -> None:
    def interrupted() -> None:
        raise KeyboardInterrupt

    entry.run = interrupted
    entry.frozen_in_a_console()

    with pytest.raises(KeyboardInterrupt):
        entry_point.main([])

    assert entry.paused == 0


def test_a_failure_from_source_never_pauses(entry: Entry) -> None:
    """`python -m ultrastar_wingman` runs in a terminal that stays open by itself."""
    entry.taken = True
    entry.monkeypatch.delattr(sys, "frozen", raising=False)
    entry.monkeypatch.setattr(entry_point.console, "is_console", lambda _stream: True)

    with pytest.raises(SystemExit):
        entry_point.main([])

    assert entry.paused == 0


@pytest.mark.parametrize("redirected", ["stdin", "stdout", "stderr"])
def test_a_redirected_stream_never_pauses(entry: Entry, redirected: str) -> None:
    """`exe > log.txt` in a terminal: the prompt would go into the file and the window
    would wait on nothing it shows."""
    entry.taken = True
    entry.frozen_in_a_console()
    other = object()
    entry.monkeypatch.setattr(sys, redirected, other)
    entry.monkeypatch.setattr(entry_point.console, "is_console", lambda stream: stream is not other)

    with pytest.raises(SystemExit):
        entry_point.main([])

    assert entry.paused == 0
