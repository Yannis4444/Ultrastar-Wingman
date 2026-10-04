"""The console window: one line format for Wingman's own loggers and uvicorn's.

The host reads this in the window the exe opens — a plain Windows console, where colour is
not something to count on — so the format is plain text, short and the same for every line:
the time of day (the date is the window's), a level only when it is not INFO, the message.
`WINGMAN_LOG_LEVEL=debug` is the developer's view: every line names its logger, and
uvicorn's per-request access log comes back.

uvicorn is handed no logging config of its own (`log_config=None`), so its records reach the
one handler installed here. Two filters on its loggers make them read like Wingman's: the
"running on" line becomes the address a host can open, and the lines that say nothing to a
host (the server process starting, every WebSocket handshake) are left to the debug view.
"""

import logging
import sys
from typing import Literal, TextIO, get_args

PACKAGE = "ultrastar_wingman"
TIME_FORMAT = "%H:%M:%S"

LogLevel = Literal["debug", "info", "warning", "error"]
LOG_LEVELS: tuple[str, ...] = get_args(LogLevel)

# What uvicorn says at INFO about its own process and lifespan. A host gains nothing from
# them: "Wingman is running at …" (the rewritten line below) is the one that matters.
UVICORN_CHATTER = (
    "Started server process",
    "Waiting for application startup",
    "Application startup complete",
    "Waiting for application shutdown",
    "Application shutdown complete",
    "Finished server process",
    # The `websockets` library's own lines: uvicorn hands it `uvicorn.error` as its logger,
    # so every phone that connects (or reconnects) would say "connection open".
    "connection open",
    "connection closed",
    "connection rejected",
)
# uvicorn's own line once it is listening: "Uvicorn running on %s://%s:%d (Press …)", the
# host bracketed for IPv6. Rewritten, not dropped: it is the moment Wingman can be reached,
# and a bind failure never gets this far.
UVICORN_RUNNING = "Uvicorn running on "
RUNNING = "Wingman is running at %s://%s:%d (press Ctrl+C to stop)"
# uvicorn's words for the moment Ctrl+C (or the window closing) reaches it.
UVICORN_STOPPING = "Shutting down"
STOPPING = "Wingman is stopping"
# uvicorn.error logs every WebSocket handshake at INFO ('%s - "WebSocket %s" [accepted]'):
# one per phone, every time one reconnects.
UVICORN_WEBSOCKET = '%s - "WebSocket '
# Addresses that mean "every interface": the host opens Wingman as localhost.
ANY_ADDRESS = ("0.0.0.0", "::", "")


def short_name(logger_name: str) -> str:
    """`songs.scanner` for `ultrastar_wingman.songs.scanner`; any other logger as it is."""
    return logger_name.removeprefix(f"{PACKAGE}.")


class ConsoleFormatter(logging.Formatter):
    """`21:14:03  message`, `21:14:03  WARNING  message`, and with `verbose` the logger's
    name in brackets before the message. A traceback follows on the lines below."""

    def __init__(self, verbose: bool = False) -> None:
        super().__init__(datefmt=TIME_FORMAT)
        self.verbose = verbose

    def format(self, record: logging.LogRecord) -> str:
        parts = [self.formatTime(record, self.datefmt)]
        if record.levelno != logging.INFO:
            parts.append(record.levelname)
        if self.verbose:
            parts.append(f"[{short_name(record.name)}]")
        parts.append(record.getMessage())
        line = "  ".join(parts)
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            line = f"{line}\n{record.exc_text}"
        if record.stack_info:
            line = f"{line}\n{self.formatStack(record.stack_info)}"
        return line


class UvicornFilter(logging.Filter):
    """On `uvicorn.error`: the "running on" and "shutting down" lines in Wingman's words, the
    chatter dropped unless `verbose`. Warnings and errors (a port already taken, a traceback)
    always pass untouched."""

    def __init__(self, verbose: bool = False) -> None:
        super().__init__()
        self.verbose = verbose

    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno < logging.INFO:
            # uvicorn says nothing of its own here below INFO; the `websockets` library does,
            # through the logger uvicorn hands it: every handshake header (a phone's session
            # cookie among them) and every frame. Not even the debug view shows that.
            return False
        message = str(record.msg)
        args = record.args
        if message.startswith(UVICORN_RUNNING) and isinstance(args, tuple) and len(args) == 3:
            scheme, host, port = args
            if host in ANY_ADDRESS:
                host = "localhost"
            elif ":" in str(host):
                host = f"[{host}]"
            record.msg = RUNNING
            record.args = (scheme, host, port)
            return True
        if message == UVICORN_STOPPING:
            record.msg = STOPPING
            return True
        if message.startswith(UVICORN_WEBSOCKET) and isinstance(args, tuple) and len(args) >= 2:
            # The handshake line carries the path with its query, like an access line.
            client, path, *rest = args
            record.args = (client, str(path).split("?", 1)[0], *rest)
        if self.verbose or record.levelno > logging.INFO:
            return True
        return not message.startswith((*UVICORN_CHATTER, UVICORN_WEBSOCKET))


class AccessFilter(logging.Filter):
    """On `uvicorn.access`, which only logs in the debug view: `GET /api/v1/songs 200
    (127.0.0.1:52144)`, the query string left out — it is where a one-time host token and
    a single sign-on callback's code travel."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) == 5:
            client, method, path, _http_version, status = args
            record.msg = "%s %s %s (%s)"
            record.args = (method, str(path).split("?", 1)[0], status, client)
        return True


def configure(level: LogLevel = "info", stream: TextIO | None = None) -> bool:
    """Install the console handler. Answers whether uvicorn's access log is wanted, which
    is the debug view alone: everything a host needs from a request is said by the service
    that handled it, in words and with names.

    Wingman's loggers and uvicorn's get `level`; every other library stays at WARNING, so
    alembic's line per migration and httpx's line per request never reach the window.
    stderr and not stdout: its error handler replaces what the console's code page cannot
    show instead of raising in the middle of a party.
    """
    verbose = level == "debug"
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(ConsoleFormatter(verbose=verbose))
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(logging.WARNING)
    numeric = logging.getLevelNamesMapping()[level.upper()]
    for name in (PACKAGE, "uvicorn"):
        logging.getLogger(name).setLevel(numeric)
    for name, added in (
        ("uvicorn.error", UvicornFilter(verbose=verbose)),
        ("uvicorn.access", AccessFilter()),
    ):
        # Replaced, never stacked: a second call must not leave the first call's filter on.
        target = logging.getLogger(name)
        target.filters[:] = [kept for kept in target.filters if type(kept) is not type(added)]
        target.addFilter(added)
    return verbose
