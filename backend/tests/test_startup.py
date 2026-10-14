"""Around the server: the port a start takes before anything else (and a second start is
refused at), the line saying where Wingman can be reached, the window that waits to be read
after a failed start — and the entry point that wires them."""

import asyncio
import errno
import logging
import socket
import sys
from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import httpx
import pytest
import uvicorn
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from ultrastar_wingman import __main__ as entry_point
from ultrastar_wingman import startup
from ultrastar_wingman.config import get_bootstrap_settings

# --- taking the port -----------------------------------------------------------------------


def held(family: socket.AddressFamily, host: str) -> socket.socket:
    """A listening socket on an ephemeral port of `host`, made by somebody other than Wingman."""
    holder = socket.socket(family, socket.SOCK_STREAM)
    if family == socket.AF_INET6:
        holder.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, True)
    holder.bind((host, 0))
    holder.listen()
    return holder


def free_port(family: socket.AddressFamily = socket.AF_INET, host: str = "127.0.0.1") -> int:
    with socket.socket(family) as finder:
        finder.bind((host, 0))
        return int(finder.getsockname()[1])


def ipv6_available() -> bool:
    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as attempt:
            attempt.bind(("::1", 0))
    except OSError:
        return False
    return True


needs_ipv6 = pytest.mark.skipif(not ipv6_available(), reason="no IPv6 loopback on this machine")


def refused(host: str, port: int) -> OSError | None:
    """What `listen` runs into on `host:port` right now — `None` when it could take it, in
    which case it lets go again."""
    try:
        listeners = startup.listen(host, port)
    except OSError as error:
        return error
    for listener in listeners:
        listener.close()
    return None


def taken(host: str, port: int) -> bool:
    error = refused(host, port)
    return error is not None and startup.is_taken(error)


@pytest.mark.parametrize(
    ("holder", "probed"),
    [
        # A second Wingman: the same address as the first, `0.0.0.0` by default.
        ("0.0.0.0", "0.0.0.0"),
        ("127.0.0.1", "127.0.0.1"),
        # Every address a name resolves to is taken, and `""` is every interface.
        ("127.0.0.1", "localhost"),
        ("0.0.0.0", ""),
    ],
)
def test_a_port_held_on_ipv4_is_taken(holder: str, probed: str) -> None:
    with held(socket.AF_INET, holder) as holding:
        assert taken(probed, holding.getsockname()[1])


@needs_ipv6
@pytest.mark.parametrize(("holder", "probed"), [("::1", "::1"), ("::", "::"), ("::", "")])
def test_a_port_held_on_ipv6_is_taken(holder: str, probed: str) -> None:
    with held(socket.AF_INET6, holder) as holding:
        assert taken(probed, holding.getsockname()[1])


@pytest.mark.parametrize(
    ("family", "host"),
    [
        (socket.AF_INET, "127.0.0.1"),
        (socket.AF_INET, "0.0.0.0"),
        pytest.param(socket.AF_INET6, "::1", marks=needs_ipv6),
    ],
)
def test_a_second_start_is_refused_while_the_first_holds_the_port(
    family: socket.AddressFamily, host: str
) -> None:
    """The first start holds what it took for as long as it runs, its lifespan included: there
    is no moment in which the second one finds the port free."""
    first = startup.listen(host, free_port(family, host))
    try:
        error = refused(host, first[0].getsockname()[1])
    finally:
        for listener in first:
            listener.close()

    assert error is not None
    assert startup.is_taken(error)


@pytest.mark.parametrize(
    ("family", "host"),
    [(socket.AF_INET, "127.0.0.1"), pytest.param(socket.AF_INET6, "::1", marks=needs_ipv6)],
)
def test_the_sockets_taken_are_listening(family: socket.AddressFamily, host: str) -> None:
    """Not merely bound: a browser opened while the lifespan runs connects into the backlog
    and waits for Wingman's answer instead of being refused."""
    listeners = startup.listen(host, free_port(family, host))
    try:
        assert [listener.family for listener in listeners] == [family]
        port = listeners[0].getsockname()[1]
        # Nobody accepts it: the connection completes into the backlog.
        with socket.create_connection((host, port), timeout=5):
            pass
    finally:
        for listener in listeners:
            listener.close()


@pytest.mark.parametrize("probed", ["127.0.0.1", "0.0.0.0", "localhost", ""])
def test_a_free_port_is_taken_and_let_go(probed: str) -> None:
    port = free_port()

    assert refused(probed, port) is None
    # Closed again: the next start can take it.
    with socket.socket() as server:
        server.bind(("127.0.0.1", port))


@needs_ipv6
def test_a_refused_start_lets_go_of_what_it_had_taken(monkeypatch: pytest.MonkeyPatch) -> None:
    """`localhost` is two addresses here: the one taken before the refusal is given back."""
    resolve = socket.getaddrinfo

    def ipv6_first(*args: Any, **kwargs: Any) -> Any:
        # Whatever order this machine resolves `localhost` in: `::1` is taken, then
        # `127.0.0.1` is refused.
        return sorted(resolve(*args, **kwargs), key=lambda info: info[0] != socket.AF_INET6)

    if socket.AF_INET6 not in {info[0] for info in resolve("localhost", 0)}:
        pytest.skip("localhost is no IPv6 address on this machine")
    monkeypatch.setattr(startup.socket, "getaddrinfo", ipv6_first)
    with held(socket.AF_INET, "127.0.0.1") as holding:
        port = holding.getsockname()[1]

        assert taken("localhost", port)
        with socket.socket(socket.AF_INET6) as after:
            after.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, True)
            after.bind(("::1", port))


def bind_fails(host: str, port: int) -> bool:
    """What a server's plain bind on `host:port` runs into right now."""
    try:
        with socket.socket() as attempt:
            attempt.bind((host, port))
    except OSError:
        return True
    return False


@pytest.mark.parametrize(("holder", "probed"), [("127.0.0.1", "0.0.0.0"), ("0.0.0.0", "127.0.0.1")])
def test_across_addresses_a_start_is_refused_where_a_bind_would_be(
    holder: str, probed: str
) -> None:
    """Windows lets a listener on every interface and one on a single address share a port,
    Linux does not. `listen` is a bind like any other: it refuses exactly where the system
    does, never where it would not."""
    with held(socket.AF_INET, holder) as holding:
        port = holding.getsockname()[1]
        assert taken(probed, port) is bind_fails(probed, port)


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

    assert taken("127.0.0.1", NEVER_BOUND)


def test_a_privileged_port_is_a_failure_of_another_kind(monkeypatch: pytest.MonkeyPatch) -> None:
    """A POSIX EACCES (a port under 1024 without the right to it) is no running Wingman."""
    refusing(monkeypatch, OSError(errno.EACCES, "permission denied"))

    error = refused("127.0.0.1", NEVER_BOUND)

    assert error is not None
    assert not startup.is_taken(error)


@pytest.mark.parametrize("reuses", [True, False])
def test_listen_reuses_addresses_exactly_where_asyncio_does(
    monkeypatch: pytest.MonkeyPatch, reuses: bool
) -> None:
    """On POSIX asyncio's bind passes the TIME_WAIT a stopped Wingman leaves, and so must
    `listen`, or a restart reads as "already running"; on Windows the flag would pass a live
    listener, and neither sets it."""
    refusing(monkeypatch, OSError(errno.EADDRINUSE, "in use"))
    monkeypatch.setattr(startup, "REUSES_ADDRESSES", reuses)

    assert taken("127.0.0.1", NEVER_BOUND)
    assert ((socket.SOL_SOCKET, socket.SO_REUSEADDR) in RefusedSocket.options) is reuses


@pytest.mark.parametrize(
    "host",
    [
        "192.0.2.1",
        "no-such-host.invalid",
        # Longer than a DNS label may be: the IDNA codec's UnicodeError, never a traceback.
        "a" * 70,
    ],
)
def test_a_host_that_is_not_this_machines_is_a_failure_of_another_kind(host: str) -> None:
    """Not "taken": the start fails, and the error names the host and why."""
    error = refused(host, free_port())

    assert isinstance(error, OSError)
    assert not startup.is_taken(error)
    assert repr(host) in str(error)


@pytest.mark.parametrize(
    ("host", "shown"),
    [
        ("0.0.0.0", "localhost"),
        ("::", "localhost"),
        ("", "localhost"),
        ("127.0.0.1", "127.0.0.1"),
        ("fe80::1", "[fe80::1]"),
        ("wingman.lan", "wingman.lan"),
    ],
)
def test_the_running_line_names_an_address_a_browser_opens(host: str, shown: str) -> None:
    assert startup.display_host(host) == shown


# --- the server ----------------------------------------------------------------------------

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]
REQUEST = b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"


class EarlyBrowser:
    """An ASGI app whose startup is visited by a browser — it connects while the lifespan is
    still running — and whose first answered request stops the server. With `fail`, the
    lifespan fails instead; with `interrupt`, Ctrl+C reaches it (what uvicorn's signal
    handler does) and nobody visits."""

    def __init__(self, port: int, fail: bool = False, interrupt: bool = False) -> None:
        self.port = port
        self.fail = fail
        self.interrupt = interrupt
        self.server: uvicorn.Server | None = None
        self.browser: tuple[asyncio.StreamReader, asyncio.StreamWriter] | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    if self.fail:
                        await send({"type": "lifespan.startup.failed", "message": "broken"})
                        return
                    if self.interrupt:
                        assert self.server is not None
                        self.server.should_exit = True
                        await send({"type": "lifespan.startup.complete"})
                        continue
                    self.browser = await asyncio.open_connection("127.0.0.1", self.port)
                    self.browser[1].write(REQUEST)
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        elif scope["type"] == "http":
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})
            assert self.server is not None
            self.server.should_exit = True


def serving(app: EarlyBrowser) -> startup.WingmanServer:
    config = uvicorn.Config(app, host="127.0.0.1", port=app.port, log_config=None)
    server = startup.WingmanServer(config)
    app.server = server
    return server


async def test_the_server_answers_a_browser_that_came_during_the_lifespan(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The handed-over socket is what uvicorn serves, and a connection it queued while the
    lifespan ran is answered once it is over."""
    listeners = startup.listen("127.0.0.1", free_port())
    port = listeners[0].getsockname()[1]
    app = EarlyBrowser(port)

    with caplog.at_level(logging.INFO, logger="ultrastar_wingman"):
        await asyncio.wait_for(serving(app).serve(sockets=listeners), 30)

    assert app.browser is not None
    reader, writer = app.browser
    response = await asyncio.wait_for(reader.read(), 10)
    writer.close()
    assert response.startswith(b"HTTP/1.1 200")
    assert f"Wingman is running at http://127.0.0.1:{port} (press Ctrl+C to stop)" in (
        caplog.messages
    )
    # uvicorn closes the sockets it was handed when it shuts down.
    assert all(listener.fileno() == -1 for listener in listeners)


async def test_a_failed_lifespan_never_says_wingman_is_running(
    caplog: pytest.LogCaptureFixture,
) -> None:
    listeners = startup.listen("127.0.0.1", free_port())
    app = EarlyBrowser(listeners[0].getsockname()[1], fail=True)

    try:
        with (
            caplog.at_level(logging.INFO, logger="ultrastar_wingman"),
            pytest.raises(SystemExit) as stopped,
        ):
            await serving(app).serve(sockets=listeners)
    finally:
        for listener in listeners:
            listener.close()

    assert stopped.value.code == startup.STARTUP_FAILURE
    assert not any("is running" in message for message in caplog.messages)


async def test_ctrl_c_during_the_lifespan_stops_without_saying_wingman_is_running(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The server still starts — and stops at once, its sockets closed — but "press Ctrl+C
    to stop" right after the host pressed it would read as ignored."""
    listeners = startup.listen("127.0.0.1", free_port())
    app = EarlyBrowser(listeners[0].getsockname()[1], interrupt=True)
    server = serving(app)

    with caplog.at_level(logging.INFO, logger="ultrastar_wingman"):
        await asyncio.wait_for(server.serve(sockets=listeners), 30)

    assert server.started
    assert not any("is running" in message for message in caplog.messages)
    assert all(listener.fileno() == -1 for listener in listeners)


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


class FakeServer:
    """`startup.WingmanServer` with nothing real behind it: what it was handed, and how the
    run the test chose went."""

    def __init__(self, entry: "Entry", config: uvicorn.Config) -> None:
        self.entry = entry
        self.config = config
        self.started = False

    def run(self, sockets: list[socket.socket] | None = None) -> None:
        self.entry.handed.append(sockets)
        self.started = self.entry.starts
        self.entry.run()


class Entry:
    """`main` with nothing real behind it: the sockets it took, what it handed the server, how
    the server's run went, and whether the window paused. `listen` is real for a test that
    sets `real_listen`, and otherwise hands out unbound sockets — the configured port may
    well be held by the Wingman this machine runs for real."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.monkeypatch = monkeypatch
        self.acquired: list[socket.socket] = []
        self.handed: list[list[socket.socket] | None] = []
        self.servers: list[FakeServer] = []
        self.paused = 0
        self.refusal: OSError | None = None
        self.real_listen = False
        # What the server ends its run with, and what it does during it.
        self.starts = True
        self.run: Callable[[], None] = lambda: None
        self._listen_for_real = startup.listen
        monkeypatch.setattr(entry_point.startup, "listen", self._listen)
        monkeypatch.setattr(entry_point.startup, "WingmanServer", self._server)
        # True: uvicorn's access log on, which leaves uvicorn's loggers as they are when the
        # real `uvicorn.Config` below configures them.
        monkeypatch.setattr(entry_point.console, "configure", lambda *_: True)
        monkeypatch.setattr(entry_point.startup, "pause", self._pause)

    def _listen(self, host: str, port: int) -> list[socket.socket]:
        if self.real_listen:
            self.acquired = self._listen_for_real(host, port)
        elif self.refusal is not None:
            raise self.refusal
        else:
            self.acquired = [socket.socket()]
        return self.acquired

    def _server(self, config: uvicorn.Config) -> FakeServer:
        server = FakeServer(self, config)
        self.servers.append(server)
        return server

    def _pause(self) -> None:
        self.paused += 1

    def frozen_in_a_console(self) -> None:
        self.monkeypatch.setattr(sys, "frozen", True, raising=False)
        self.monkeypatch.setattr(entry_point.console, "is_console", lambda _stream: True)


@pytest.fixture
def entry(monkeypatch: pytest.MonkeyPatch) -> Iterator[Entry]:
    monkeypatch.delenv("WINGMAN_USDX_DIR", raising=False)
    monkeypatch.setenv("WINGMAN_HOST", "127.0.0.1")
    monkeypatch.setenv("WINGMAN_PORT", "8093")
    get_bootstrap_settings.cache_clear()
    yield Entry(monkeypatch)
    get_bootstrap_settings.cache_clear()


def test_a_start_hands_the_server_the_sockets_it_took(entry: Entry) -> None:
    entry.frozen_in_a_console()

    entry_point.main([])

    (server,) = entry.servers
    assert entry.handed == [entry.acquired]
    assert server.config.app == "ultrastar_wingman.app:create_app"
    assert server.config.factory
    assert (server.config.host, server.config.port) == ("127.0.0.1", 8093)
    assert server.config.backlog == startup.BACKLOG
    # Closed once the server is done with them, whatever uvicorn did.
    assert all(listener.fileno() == -1 for listener in entry.acquired)
    assert entry.paused == 0


async def scheme_behind(trusted: str | list[str], proxy: str) -> str:
    """The scheme an app sees for an https request a reverse proxy at `proxy` forwarded,
    through the middleware uvicorn puts in front of it with `forwarded_allow_ips`."""
    seen: list[str] = []

    async def app(scope: Any, receive: Any, send: Any) -> None:
        seen.append(scope["scheme"])
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    # `Any`: uvicorn's ASGI types and httpx's do not line up, the protocol does.
    proxied: Any = ProxyHeadersMiddleware(app, trusted_hosts=trusted)
    transport = httpx.ASGITransport(app=proxied, client=(proxy, 4711))
    async with httpx.AsyncClient(transport=transport, base_url="http://wingman") as client:
        await client.get("/", headers={"X-Forwarded-Proto": "https"})
    return seen[0]


async def test_a_reverse_proxy_on_another_machine_is_believed_about_https(entry: Entry) -> None:
    """The OIDC redirect_uri takes its scheme from the request, so a Wingman served over
    https by a proxy elsewhere on the network must not advertise http."""
    entry.monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)

    entry_point.main([])

    (server,) = entry.servers
    assert server.config.forwarded_allow_ips == "*"
    assert await scheme_behind(server.config.forwarded_allow_ips, "192.168.1.10") == "https"
    # uvicorn's own default, for contrast: the same proxy is ignored.
    assert await scheme_behind("127.0.0.1", "192.168.1.10") == "http"


def test_uvicorns_variable_still_narrows_who_is_believed(entry: Entry) -> None:
    entry.monkeypatch.setenv("FORWARDED_ALLOW_IPS", "192.168.1.10")

    entry_point.main([])

    (server,) = entry.servers
    assert server.config.forwarded_allow_ips == "192.168.1.10"


def test_a_port_another_wingman_holds_stops_the_start_before_uvicorn(
    entry: Entry, caplog: pytest.LogCaptureFixture
) -> None:
    """Nothing of the lifespan runs: no migration, no host token, no browser, no scan."""
    entry.real_listen = True
    # The first Wingman, through the same `listen` (the entry's, real from here on).
    first = startup.listen("127.0.0.1", free_port())
    port = first[0].getsockname()[1]
    entry.monkeypatch.setenv("WINGMAN_PORT", str(port))
    get_bootstrap_settings.cache_clear()

    try:
        with (
            caplog.at_level(logging.INFO, logger="ultrastar_wingman"),
            pytest.raises(SystemExit) as stopped,
        ):
            entry_point.main([])
    finally:
        for listener in first:
            listener.close()

    assert stopped.value.code == startup.STARTUP_FAILURE
    assert entry.servers == []
    assert f"Wingman is already running, or port {port} is taken" in caplog.messages


def test_a_port_that_cannot_be_taken_otherwise_names_the_reason(
    entry: Entry, caplog: pytest.LogCaptureFixture
) -> None:
    entry.refusal = OSError(errno.EACCES, "permission denied")

    with caplog.at_level(logging.INFO, logger="ultrastar_wingman"), pytest.raises(SystemExit) as s:
        entry_point.main([])

    assert s.value.code == startup.STARTUP_FAILURE
    assert entry.servers == []
    assert "Wingman cannot listen on port 8093: [Errno 13] permission denied" in caplog.messages


def test_a_taken_port_pauses_the_exe(entry: Entry) -> None:
    """The double-clicked icon of a Wingman already running: exactly the window to keep."""
    entry.refusal = OSError(errno.EADDRINUSE, "in use")
    entry.frozen_in_a_console()

    with pytest.raises(SystemExit):
        entry_point.main([])

    assert entry.paused == 1


def test_a_failed_lifespan_pauses_the_exe(entry: Entry) -> None:
    def failed() -> None:
        sys.exit(startup.STARTUP_FAILURE)

    entry.run = failed
    entry.starts = False
    entry.frozen_in_a_console()

    with pytest.raises(SystemExit) as stopped:
        entry_point.main([])

    assert stopped.value.code == startup.STARTUP_FAILURE
    assert entry.paused == 1
    # uvicorn never reached its shutdown, which is what closes them.
    assert all(listener.fileno() == -1 for listener in entry.acquired)


def test_a_server_that_never_started_fails_the_start(entry: Entry) -> None:
    """`uvicorn.run`'s own rule, kept: a run that returns without having started is exit 3."""
    entry.starts = False
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


def test_ctrl_c_is_a_clean_stop(entry: Entry) -> None:
    """uvicorn shuts down on the Ctrl+C it handles and raises it again afterwards."""

    def interrupted() -> None:
        raise KeyboardInterrupt

    entry.run = interrupted
    entry.frozen_in_a_console()

    entry_point.main([])

    assert entry.paused == 0


def test_ctrl_c_before_the_server_started_never_pauses(entry: Entry) -> None:
    def interrupted() -> None:
        raise KeyboardInterrupt

    entry.run = interrupted
    entry.starts = False
    entry.frozen_in_a_console()

    with pytest.raises(KeyboardInterrupt):
        entry_point.main([])

    assert entry.paused == 0


def test_a_failure_from_source_never_pauses(entry: Entry) -> None:
    """`python -m ultrastar_wingman` runs in a terminal that stays open by itself."""
    entry.refusal = OSError(errno.EADDRINUSE, "in use")
    entry.monkeypatch.delattr(sys, "frozen", raising=False)
    entry.monkeypatch.setattr(entry_point.console, "is_console", lambda _stream: True)

    with pytest.raises(SystemExit):
        entry_point.main([])

    assert entry.paused == 0


@pytest.mark.parametrize("redirected", ["stdin", "stdout", "stderr"])
def test_a_redirected_stream_never_pauses(entry: Entry, redirected: str) -> None:
    """`exe > log.txt` in a terminal: the prompt would go into the file and the window
    would wait on nothing it shows."""
    entry.refusal = OSError(errno.EADDRINUSE, "in use")
    entry.frozen_in_a_console()
    other = object()
    entry.monkeypatch.setattr(sys, redirected, other)
    entry.monkeypatch.setattr(entry_point.console, "is_console", lambda stream: stream is not other)

    with pytest.raises(SystemExit):
        entry_point.main([])

    assert entry.paused == 0
