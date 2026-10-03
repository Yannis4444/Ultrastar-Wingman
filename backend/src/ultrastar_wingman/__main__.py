"""`python -m ultrastar_wingman` — start the API server."""

import argparse
import logging
import os
from collections.abc import Sequence

import uvicorn

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
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    settings = get_bootstrap_settings()
    uvicorn.run(
        "ultrastar_wingman.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
    )


if __name__ == "__main__":
    main()
