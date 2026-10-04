"""The console window: one line format for Wingman's own loggers and uvicorn's.

The host reads this in the window the exe opens — a plain Windows console, where colour is
not something to count on — so the format is plain text, short and the same for every line:
the time of day (the date is the window's), a level only when it is not INFO, the message.
`WINGMAN_LOG_LEVEL=debug` is the developer's view: every line names its logger, and
uvicorn's per-request access log comes back.

uvicorn is handed no logging config of its own (`log_config=None`), so its records reach the
one handler installed here. Two filters on its loggers make them read like Wingman's: the
"shutting down" line is said in Wingman's words, and the lines that say nothing to a host
(the server process starting, every WebSocket handshake) are left to the debug view. uvicorn
says no "running on" line at all: it is handed its sockets (`startup.listen`), and
`startup.WingmanServer` says where Wingman can be reached instead.

In a real console the lines are written by a thread of their own (`configure`): the classic
Windows console stops every write while text is selected in it (QuickEdit, which is also how
the host copies the host link), and a write that waits must not be the server waiting.
"""

import logging
import queue
import sys
from logging.handlers import QueueHandler, QueueListener
from typing import Literal, TextIO, get_args

PACKAGE = "ultrastar_wingman"
TIME_FORMAT = "%H:%M:%S"

LogLevel = Literal["debug", "info", "warning", "error"]
LOG_LEVELS: tuple[str, ...] = get_args(LogLevel)

# What uvicorn says at INFO about its own process and lifespan. A host gains nothing from
# them: "Wingman is running at …" (`startup.WingmanServer`) is the one that matters.
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
# uvicorn's words for the moment Ctrl+C (or the window closing) reaches it.
UVICORN_STOPPING = "Shutting down"
STOPPING = "Wingman is stopping"
# uvicorn.error logs every WebSocket handshake at INFO ('%s - "WebSocket %s" [accepted]'):
# one per phone, every time one reconnects.
UVICORN_WEBSOCKET = '%s - "WebSocket '


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
    """On `uvicorn.error`: the "shutting down" line in Wingman's words, the chatter dropped
    unless `verbose`. Warnings and errors (a failed startup, a traceback) always pass
    untouched."""

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


def is_console(stream: object) -> bool:
    """Whether `stream` is a terminal somebody is looking at. `False` for a file, a pipe,
    pytest's capture, and the `None` a windowed build has instead of a stream."""
    isatty = getattr(stream, "isatty", None)
    try:
        return callable(isatty) and bool(isatty())
    except (ValueError, OSError):
        # A closed stream, or one pytest refuses to read from.
        return False


# The thread writing the lines while `configure` runs in a real console, and the formatter
# `stop` writes with once it is gone.
_writer: QueueListener | None = None
_formatter: logging.Formatter | None = None


def stop() -> None:
    """Write every line still queued, end the writing thread, and write directly from here
    on — so a sentence logged before a pause is on screen before the pause's own prompt. A
    no-op unless `configure` started that thread."""
    global _writer
    if _writer is None:
        return
    writer, _writer = _writer, None
    writer.stop()
    root = logging.getLogger()
    for existing in list(root.handlers):
        if isinstance(existing, QueueHandler):
            root.removeHandler(existing)
    direct = logging.StreamHandler(sys.stderr)
    direct.setFormatter(_formatter)
    root.addHandler(direct)


def configure(level: LogLevel = "info", stream: TextIO | None = None) -> bool:
    """Install the console handler. Answers whether uvicorn's access log is wanted, which
    is the debug view alone: everything a host needs from a request is said by the service
    that handled it, in words and with names.

    Wingman's loggers and uvicorn's get `level`; every other library stays at WARNING, so
    alembic's line per migration and httpx's line per request never reach the window.
    stderr and not stdout: its error handler replaces what the console's code page cannot
    show instead of raising in the middle of a party.

    Into a real console (no `stream`, stderr a terminal) the server only queues a line and
    a thread writes it, so a selection in the window holds up that thread and nothing else;
    `stop` ends it. A file, a pipe or a given stream is written directly, in order, at once.
    """
    global _writer, _formatter
    stop()
    verbose = level == "debug"
    _formatter = ConsoleFormatter(verbose=verbose)
    handler: logging.Handler
    if stream is None and is_console(sys.stderr):
        # The record is formatted here, on the logging thread: `QueueHandler.prepare` turns
        # it into its finished text (the traceback included) before it is queued, so the
        # writing thread only prints that text.
        handler = QueueHandler(queue.SimpleQueue())
        output = logging.StreamHandler(sys.stderr)
        output.setFormatter(logging.Formatter("%(message)s"))
        _writer = QueueListener(handler.queue, output)
        _writer.start()
        # A `warnings.warn` would otherwise go to stderr itself, past the queue.
        logging.captureWarnings(True)
    else:
        handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(_formatter)
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
