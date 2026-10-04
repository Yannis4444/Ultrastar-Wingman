"""The console window's format, and the two filters that make uvicorn's lines read like it."""

import io
import logging
import sys
from collections.abc import Iterator

import pytest
from pydantic import ValidationError

from ultrastar_wingman import console
from ultrastar_wingman.config import BootstrapSettings


def record(
    message: str,
    *args: object,
    level: int = logging.INFO,
    name: str = "ultrastar_wingman.songs.scanner",
) -> logging.LogRecord:
    made = logging.LogRecord(name, level, __file__, 1, message, args or None, None)
    # A fixed moment; which time of day it is depends on the machine's zone, so the tests
    # compare against `time_of` rather than a literal.
    made.created = 0.0
    return made


def time_of(made: logging.LogRecord) -> str:
    return console.ConsoleFormatter().formatTime(made, console.TIME_FORMAT)


def test_an_info_line_is_the_time_and_the_message() -> None:
    line = record("Song library scanned: %d added", 3)

    formatted = console.ConsoleFormatter().format(line)

    assert formatted == f"{time_of(line)}  Song library scanned: 3 added"
    # The time of day alone: the date is the window's.
    assert len(time_of(line)) == len("21:14:03")


def test_a_warning_says_so_and_info_does_not() -> None:
    line = record("Skipped the song %s", "x.txt", level=logging.WARNING)

    assert (
        console.ConsoleFormatter().format(line)
        == f"{time_of(line)}  WARNING  Skipped the song x.txt"
    )


def test_the_logger_is_named_only_in_the_debug_view() -> None:
    line = record("Song library scanned")

    assert "songs.scanner" not in console.ConsoleFormatter().format(line)
    assert console.ConsoleFormatter(verbose=True).format(line) == (
        f"{time_of(line)}  [songs.scanner]  Song library scanned"
    )
    other = record("Running upgrade", name="alembic.runtime.migration")
    assert "[alembic.runtime.migration]" in console.ConsoleFormatter(verbose=True).format(other)


def test_a_traceback_follows_its_line() -> None:
    try:
        raise RuntimeError("the database went away")
    except RuntimeError:
        line = record("importing the scores failed", level=logging.ERROR)
        line.exc_info = sys.exc_info()

    formatted = console.ConsoleFormatter().format(line).splitlines()

    assert formatted[0] == f"{time_of(line)}  ERROR  importing the scores failed"
    assert formatted[1] == "Traceback (most recent call last):"
    assert formatted[-1] == "RuntimeError: the database went away"


def uvicorn_record(message: str, *args: object, level: int = logging.INFO) -> logging.LogRecord:
    return record(message, *args, level=level, name="uvicorn.error")


def test_uvicorns_running_line_becomes_the_address_a_host_opens() -> None:
    line = uvicorn_record(
        "Uvicorn running on %s://%s:%d (Press CTRL+C to quit)", "http", "0.0.0.0", 8080
    )

    assert console.UvicornFilter().filter(line) is True
    assert line.getMessage() == "Wingman is running at http://localhost:8080 (press Ctrl+C to stop)"


def test_a_running_line_on_one_address_keeps_it() -> None:
    line = uvicorn_record(
        "Uvicorn running on %s://[%s]:%d (Press CTRL+C to quit)", "http", "fe80::1", 8081
    )

    console.UvicornFilter().filter(line)

    assert line.getMessage() == "Wingman is running at http://[fe80::1]:8081 (press Ctrl+C to stop)"


def test_shutting_down_is_said_in_wingmans_words() -> None:
    line = uvicorn_record("Shutting down")

    assert console.UvicornFilter().filter(line) is True
    assert line.getMessage() == "Wingman is stopping"


@pytest.mark.parametrize(
    ("message", "args"),
    [
        ("Started server process [%d]", (1234,)),
        ("Waiting for application startup.", ()),
        ("Application startup complete.", ()),
        ("Waiting for application shutdown.", ()),
        ("Application shutdown complete.", ()),
        ("Finished server process [%d]", (1234,)),
        ('%s - "WebSocket %s" [accepted]', ("192.168.1.20:52144", "/api/v1/ws")),
        ('%s - "WebSocket %s" 403', ("192.168.1.20:52144", "/api/v1/ws")),
        # The `websockets` library's own, through the logger uvicorn hands it.
        ("connection open", ()),
        ("connection closed", ()),
        ("connection rejected (%d %s)", (400, "Bad Request")),
    ],
)
def test_uvicorns_chatter_is_left_to_the_debug_view(message: str, args: tuple[object, ...]) -> None:
    assert console.UvicornFilter().filter(uvicorn_record(message, *args)) is False
    assert console.UvicornFilter(verbose=True).filter(uvicorn_record(message, *args)) is True


def test_uvicorns_warnings_and_errors_always_pass_untouched() -> None:
    bind = uvicorn_record(
        "[Errno 10048] error while attempting to bind on address ('0.0.0.0', 8080)",
        level=logging.ERROR,
    )
    waiting = uvicorn_record("Waiting for connections to close. (CTRL+C to force quit)")

    assert console.UvicornFilter().filter(bind) is True
    assert "error while attempting to bind on address" in bind.getMessage()
    # Not chatter: it is why Ctrl+C did not stop Wingman at once.
    assert console.UvicornFilter().filter(waiting) is True


def access_record(method: str, path: str, status: int) -> logging.LogRecord:
    return record(
        '%s - "%s %s HTTP/%s" %d',
        "127.0.0.1:52144",
        method,
        path,
        "1.1",
        status,
        name="uvicorn.access",
    )


def test_an_access_line_is_method_path_status_and_client() -> None:
    line = access_record("GET", "/api/v1/songs", 200)

    assert console.AccessFilter().filter(line) is True
    assert line.getMessage() == "GET /api/v1/songs 200 (127.0.0.1:52144)"


@pytest.mark.parametrize(
    "path",
    [
        "/host?hostToken=HaLzGncHfm-YwH86aAPWWhpSn_Cpyty70Mt19CNQcrk",
        "/api/v1/auth/oidc/callback?code=secret-code&state=secret-state",
    ],
)
def test_an_access_line_never_carries_the_query(path: str) -> None:
    line = access_record("GET", path, 200)

    console.AccessFilter().filter(line)

    assert "?" not in line.getMessage()
    assert "secret" not in line.getMessage()
    assert "HaLzGncHfm" not in line.getMessage()


def test_a_websocket_handshake_in_the_debug_view_never_carries_the_query() -> None:
    line = uvicorn_record(
        '%s - "WebSocket %s" [accepted]', "192.168.1.20:52144", "/api/v1/ws?code=secret"
    )

    assert console.UvicornFilter(verbose=True).filter(line) is True
    assert line.getMessage() == '192.168.1.20:52144 - "WebSocket /api/v1/ws" [accepted]'


@pytest.mark.parametrize(
    "message",
    ["< cookie: wingman_session=secret-session", '> TEXT \'{"event":"server.ready"}\' [42 bytes]'],
)
def test_the_websocket_wire_dump_never_shows_not_even_in_the_debug_view(message: str) -> None:
    # The `websockets` library's DEBUG lines, through the logger uvicorn hands it.
    line = uvicorn_record(message, level=logging.DEBUG)

    assert console.UvicornFilter(verbose=True).filter(line) is False
    assert console.UvicornFilter().filter(line) is False


@pytest.fixture
def restored_logging() -> Iterator[None]:
    """`configure` changes process-wide logging; put back what pytest had."""
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    levels = {name: logging.getLogger(name).level for name in ("ultrastar_wingman", "uvicorn")}
    filters = {
        name: list(logging.getLogger(name).filters) for name in ("uvicorn.error", "uvicorn.access")
    }
    try:
        yield
    finally:
        root.handlers[:] = handlers
        root.setLevel(level)
        for name, logger_level in levels.items():
            logging.getLogger(name).setLevel(logger_level)
        for name, logger_filters in filters.items():
            logging.getLogger(name).filters[:] = logger_filters


@pytest.mark.usefixtures("restored_logging")
def test_configure_lets_wingman_speak_and_keeps_other_libraries_quiet() -> None:
    stream = io.StringIO()

    access_log = console.configure("info", stream)
    logging.getLogger("ultrastar_wingman.songs.scanner").info("Song library scanned")
    logging.getLogger("ultrastar_wingman.songs.scanner").debug("no song txt in a folder")
    logging.getLogger("alembic.runtime.migration").info("Running upgrade 0034 -> 0035")
    logging.getLogger("httpx").info("HTTP Request: GET https://usdb.animux.de")
    logging.getLogger("uvicorn.error").info("Application startup complete.")

    assert access_log is False
    assert [line.split("  ", 1)[1] for line in stream.getvalue().splitlines()] == [
        "Song library scanned"
    ]


@pytest.mark.usefixtures("restored_logging")
def test_the_debug_view_brings_the_access_log_and_the_names() -> None:
    stream = io.StringIO()

    access_log = console.configure("debug", stream)
    logging.getLogger("ultrastar_wingman.songs.scanner").debug("no song txt in a folder")

    assert access_log is True
    assert "DEBUG  [songs.scanner]  no song txt in a folder" in stream.getvalue()


@pytest.mark.usefixtures("restored_logging")
def test_configuring_again_replaces_the_filters_rather_than_stacking_them() -> None:
    console.configure("debug", io.StringIO())
    console.configure("info", io.StringIO())

    for name, kind in (
        ("uvicorn.error", console.UvicornFilter),
        ("uvicorn.access", console.AccessFilter),
    ):
        mine = [kept for kept in logging.getLogger(name).filters if isinstance(kept, kind)]
        assert len(mine) == 1
    # The second call's view: the chatter is dropped again.
    assert not logging.getLogger("uvicorn.error").filter(
        uvicorn_record("Started server process [%d]", 1)
    )


def settings_from_the_environment() -> BootstrapSettings:
    # Not a developer's `.env`: the variable this test sets is the only input.
    return BootstrapSettings(_env_file=None)  # type: ignore[call-arg]


def test_the_log_level_is_read_in_any_case(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WINGMAN_LOG_LEVEL", " DEBUG ")
    assert settings_from_the_environment().log_level == "debug"

    monkeypatch.setenv("WINGMAN_LOG_LEVEL", "chatty")
    with pytest.raises(ValidationError):
        settings_from_the_environment()

    monkeypatch.delenv("WINGMAN_LOG_LEVEL")
    assert settings_from_the_environment().log_level == "info"
