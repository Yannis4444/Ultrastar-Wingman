"""`python -m ultrastar_wingman` — start the API server."""

import logging

import uvicorn

from .config import get_bootstrap_settings


def main() -> None:
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
