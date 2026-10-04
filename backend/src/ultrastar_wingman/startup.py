"""What happens around the server rather than in it: taking its port before anything starts,
the line that says where it can be reached, and whether the console window waits to be read
once it has stopped.

All of it exists for the host who double-clicks the icon. A second start must not run a
lifespan beside the first one (migrations, a fresh host token and a browser opened on it, a
scan, the download worker marking the running one's download interrupted) only to fail
binding. And a start that fails must not take its reason away with the window it closes.
"""

import contextlib
import errno
import logging
import os
import socket
import sys

import uvicorn

from .console import PACKAGE

# uvicorn's own exit code for a server that never started, a port it could not bind among
# the reasons. `listen` answers the same failure with the same code.
STARTUP_FAILURE = 3
# uvicorn's default backlog, handed to `uvicorn.Config` as well: asyncio listens on the
# sockets again when uvicorn starts serving them, and both calls must ask for the same queue.
BACKLOG = 2048
# What Windows answers a bind on a port another program holds exclusively, or one the
# system has reserved (Hyper-V's excluded ranges): taken as well, as far as Wingman can tell.
WSAEACCES = 10013
# asyncio's own default for `create_server`, which is how uvicorn binds a host and a port. On
# a POSIX system the flag lets a bind past the connections a stopped Wingman left in
# TIME_WAIT (a restart must not read as "already running") and never past a live listener;
# on Windows it would be exactly that, so neither asyncio nor `listen` sets it there.
REUSES_ADDRESSES = os.name == "posix" and sys.platform != "cygwin"
# Addresses that mean "every interface": the host opens Wingman as localhost.
ANY_ADDRESS = ("0.0.0.0", "::", "")
RUNNING = "Wingman is running at http://%s:%d (press Ctrl+C to stop)"

# The package's logger, which `console.configure` lets through at INFO whatever `__name__`
# is under `python -m`.
logger = logging.getLogger(PACKAGE)


def listen(host: str, port: int) -> list[socket.socket]:
    """Take `host:port` for this Wingman: the listening sockets uvicorn is handed, one per
    address `host` resolves to, made the way asyncio's `create_server` makes them for a host
    and a port — the call uvicorn would otherwise make itself, after the lifespan (an IPv6
    socket for IPv6 alone, `SO_REUSEADDR` on POSIX alone: `REUSES_ADDRESSES`, an address
    family the machine has no stack for skipped). uvicorn closes them when it shuts down;
    `__main__.serve` closes them as well, for the start that never got that far.

    Called before the lifespan, so there is no window in which a second start finds the port
    free: a Wingman still migrating its database already holds it. And listening, not merely
    bound, from the first moment: on POSIX two `SO_REUSEADDR` sockets that are bound but not
    listening may share a port, and a browser opened while the lifespan runs waits in the
    backlog until Wingman answers instead of being refused.

    Raises the `OSError` of the bind (or the listen) that failed, every socket already made
    closed again; `is_taken` says whether it means "already running". A host that does not
    resolve — or is no host name at all, which the IDNA codec refuses with a `UnicodeError` —
    is an `OSError` naming it, so it is said in a sentence and not a traceback.
    """
    try:
        addresses = socket.getaddrinfo(
            host or None, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE
        )
    except (OSError, UnicodeError) as error:
        raise OSError(f"no address found for {host!r} ({error})") from error
    listeners: list[socket.socket] = []
    try:
        for family, kind, protocol, _, address in dict.fromkeys(addresses):
            try:
                listener = socket.socket(family, kind, protocol)
            except OSError:
                # asyncio's rule too: a family this machine has no stack for.
                continue
            listeners.append(listener)
            if REUSES_ADDRESSES:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if family == socket.AF_INET6:
                listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, True)
            try:
                listener.bind(address)
            except OSError as error:
                if error.errno != errno.EADDRNOTAVAIL:
                    raise
                # asyncio's rule (bpo-30945): the family is not enabled on this machine.
                listeners.pop().close()
                continue
            listener.listen(BACKLOG)
            listener.setblocking(False)
        if not listeners:
            raise OSError(errno.EADDRNOTAVAIL, f"no address of {host!r} can be bound here")
    except BaseException:
        for listener in listeners:
            listener.close()
        raise
    return listeners


def is_taken(error: OSError) -> bool:
    """Whether a failed `listen` means something already holds the port. A POSIX EACCES (a
    port under 1024 without the right to it), a host that is not this machine's or a name
    that does not resolve is a failed start of another kind."""
    return error.errno == errno.EADDRINUSE or getattr(error, "winerror", 0) == WSAEACCES


def display_host(host: str) -> str:
    """The host as an address bar takes it: `localhost` for every interface, an IPv6
    address in brackets."""
    if host in ANY_ADDRESS:
        return "localhost"
    if ":" in host:
        return f"[{host}]"
    return host


class WingmanServer(uvicorn.Server):
    """uvicorn's server, saying where Wingman can be reached once it can be.

    uvicorn logs no "running on" line for sockets it is handed, so this one does, at the
    moment uvicorn would have: once the lifespan has finished and the sockets are served. A
    failed lifespan exits inside `super().startup`, so a start that failed never says it, and
    neither does one Ctrl+C reached during the lifespan: it stops the moment it has started,
    and "press Ctrl+C to stop" right after the host pressed it would read as ignored.
    """

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=sockets)
        if self.started and sockets and not self.should_exit:
            port = sockets[0].getsockname()[1]
            logger.info(RUNNING, display_host(self.config.host), port)


def exit_code(code: object) -> int:
    """The process exit code a `SystemExit` carrying `code` ends with: `None` is success, a
    number is itself, and anything else (a message) is 1 — Python's own rule."""
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    return 1


def should_pause(exit_code: int, interrupted: bool, frozen: bool, isatty: bool) -> bool:
    """Whether the window waits for Enter before it closes: only after a failure, never after
    Ctrl+C, only in the exe (a developer's terminal stays open by itself, and the exe is what
    a double-click opens a window of its own for), and only where somebody can press Enter
    (stdin, stdout and stderr all a console, which a test, a pipe and a service never are)."""
    return exit_code != 0 and not interrupted and frozen and isatty


def pause() -> None:
    """Wait for Enter. A stdin that ends, breaks or is interrupted closes the window as well."""
    with contextlib.suppress(EOFError, OSError, KeyboardInterrupt):
        input("Press Enter to close this window.")
