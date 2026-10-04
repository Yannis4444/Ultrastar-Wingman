"""What happens around the server rather than in it: whether its port is free before anything
starts, and whether the console window waits to be read once it has stopped.

Both exist for the host who double-clicks the icon. A second start must not run a lifespan
beside the first one (migrations, a fresh host token and a browser opened on it, a scan, the
download worker marking the running one's download interrupted) only to fail binding. And a
start that fails must not take its reason away with the window it closes.
"""

import contextlib
import errno
import os
import socket
import sys

# uvicorn's own exit code for a server that never started, a port it could not bind among
# the reasons. The probe answers the same failure with the same code.
STARTUP_FAILURE = 3
# What Windows answers a bind on a port another program holds exclusively, or one the
# system has reserved (Hyper-V's excluded ranges): taken as well, as far as Wingman can tell.
WSAEACCES = 10013
# asyncio's own default for `create_server`, which is what uvicorn binds through. On a POSIX
# system the flag lets a bind past the connections a stopped Wingman left in TIME_WAIT (a
# restart must not read as "already running") and never past a live listener; on Windows it
# would be exactly that, so neither asyncio nor the probe sets it there.
REUSES_ADDRESSES = os.name == "posix" and sys.platform != "cygwin"


def port_is_taken(host: str, port: int) -> bool:
    """Whether a server could not listen on `host:port` right now, because something holds it.

    A bind, not a connect: binding is what uvicorn does, so the answer is the one it would
    get — on `0.0.0.0` that is "taken" when anything holds the port on any interface, which a
    connect to one address would miss. Every address `host` resolves to is tried the way
    asyncio's `create_server` binds it (an IPv6 socket for IPv6 alone, `SO_REUSEADDR` on
    POSIX alone: `REUSES_ADDRESSES`).

    Racy by nature: the port can be taken between this answer and uvicorn's bind. That case
    is uvicorn's error, and a failed start like any other. Any other failure (a host that is
    not this machine's, a name that does not resolve) is `False` too: uvicorn says what it is.
    """
    try:
        addresses = socket.getaddrinfo(
            host or None, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE
        )
    except OSError:
        return False
    for family, kind, protocol, _, address in dict.fromkeys(addresses):
        with socket.socket(family, kind, protocol) as probe:
            if REUSES_ADDRESSES:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if family == socket.AF_INET6:
                probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, True)
            try:
                probe.bind(address)
            except OSError as error:
                if error.errno == errno.EADDRINUSE or getattr(error, "winerror", 0) == WSAEACCES:
                    return True
    return False


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
