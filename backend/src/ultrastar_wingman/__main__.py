"""`python -m ultrastar_wingman` — start the API server."""

import argparse
import logging
import os
import sys
from collections.abc import Sequence

import uvicorn

from . import APP_NAME, __version__, console, startup
from .config import get_bootstrap_settings


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="ultrastar_wingman", description="Ultrastar Wingman")
    parser.add_argument(
        "--usdx-dir",
        metavar="DIR",
        help=(
            "the Ultrastar Deluxe this Wingman brings along. Every USDX path is derived from "
            "it and the USDX settings are not offered. Overrides WINGMAN_USDX_DIR."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    """Run Wingman until it is stopped. A start that fails leaves the exe's window open on
    its reason until Enter is pressed (`startup.should_pause`); Ctrl+C never does."""
    code, interrupted = 0, False
    try:
        serve(argv)
    except KeyboardInterrupt:
        # Ctrl+C before the server started (`serve` swallows the one uvicorn handled).
        interrupted = True
        raise
    except SystemExit as stopped:
        # `serve`'s way of failing a start (a port it could not take), uvicorn's (a
        # lifespan that failed), and argparse's.
        code = startup.exit_code(stopped.code)
        raise
    except Exception:
        logging.getLogger(console.PACKAGE).exception("Wingman stopped on an error")
        code = 1
        raise SystemExit(code) from None
    finally:
        # The queued lines first, so the reason is on screen above the prompt.
        console.stop()
        frozen = bool(getattr(sys, "frozen", False))
        # stdout too: `input` writes its prompt there, and a window waiting on a prompt that
        # went into a file looks hung.
        isatty = all(console.is_console(stream) for stream in (sys.stdin, sys.stdout, sys.stderr))
        if startup.should_pause(code, interrupted, frozen, isatty):
            startup.pause()


def serve(argv: Sequence[str] | None = None) -> None:
    # The console first, in its default view: a setting that does not parse is then said in
    # the same format as everything else. The settings' own view replaces it right after.
    console.configure()
    args = parse_args(argv)
    if args.usdx_dir is not None:
        # Through the environment, the one channel every bootstrap setting already reads:
        # uvicorn builds the app from an import string and hands the factory nothing, and
        # the environment is what makes the argument outrank the variable and the `.env`.
        os.environ["WINGMAN_USDX_DIR"] = args.usdx_dir
        get_bootstrap_settings.cache_clear()
    settings = get_bootstrap_settings()
    access_log = console.configure(settings.log_level)
    # The package's logger and not `__name__`, which is `__main__` under `python -m` and so
    # outside the loggers `configure` lets through at INFO.
    logger = logging.getLogger(console.PACKAGE)
    logger.info("%s %s", APP_NAME, __version__)
    try:
        # Before uvicorn and so before the lifespan, and held from here on: a second start
        # must not migrate, mint a host token, open a browser on it, scan, or mark the first
        # one's download as interrupted, only to fail binding afterwards — not even while
        # the first one is still starting up.
        sockets = startup.listen(settings.host, settings.port)
    except OSError as error:
        if startup.is_taken(error):
            logger.error("Wingman is already running, or port %d is taken", settings.port)
        else:
            logger.error("Wingman cannot listen on port %d: %s", settings.port, error)
        sys.exit(startup.STARTUP_FAILURE)
    # What `uvicorn.run` did, around a server handed the sockets instead of binding its own.
    # Its `load_app` check before the server is left out: `Config.load` imports the same
    # string, and exits with the same code when it cannot.
    config = uvicorn.Config(
        "ultrastar_wingman.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        # None: uvicorn installs no handlers of its own, so its lines go through the one
        # `console.configure` installed and share its format.
        log_config=None,
        access_log=access_log,
        backlog=startup.BACKLOG,
    )
    server = startup.WingmanServer(config)
    try:
        server.run(sockets=sockets)
    except KeyboardInterrupt:
        # uvicorn re-raises the Ctrl+C it handled once it has shut down: a clean stop. One
        # that came before the server started is `main`'s, which never pauses on it.
        if not server.started:
            raise
    finally:
        # uvicorn closes them on shutdown, and never gets there when the lifespan fails.
        for listener in sockets:
            listener.close()
    if not server.started:
        sys.exit(startup.STARTUP_FAILURE)


if __name__ == "__main__":
    main()
