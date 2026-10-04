"""`python -m ultrastar_wingman` — start the API server."""

import argparse
import logging
import os
from collections.abc import Sequence

import uvicorn

from . import APP_NAME, __version__, console
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
    logging.getLogger(console.PACKAGE).info("%s %s", APP_NAME, __version__)
    uvicorn.run(
        "ultrastar_wingman.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        # None: uvicorn installs no handlers of its own, so its lines go through the one
        # `console.configure` installed and share its format.
        log_config=None,
        access_log=access_log,
    )


if __name__ == "__main__":
    main()
