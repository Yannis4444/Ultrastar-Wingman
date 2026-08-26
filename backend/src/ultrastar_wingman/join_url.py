"""The address the host screen advertises — what the QR code encodes.

Wingman guesses it from the outgoing network interface, which is right on a normal
machine and wrong on one with a VPN, a Hyper-V switch or two NICs. `host.join_url`
overrides the guess, so this module owns what a usable override looks like.

A leaf on purpose: `settings.py` imports the validator and `api.py` the normaliser, and
neither of them may be imported back from here (the registry has to stay
domain-agnostic — same arrangement as `karaoke.slots` and `downloads.video_quality`).
"""

from urllib.parse import SplitResult, urlsplit, urlunsplit

# A join URL is an address on the local network, not a link with a query string; a value
# this long is a paste accident.
MAX_LENGTH = 200

# What a phone's browser can be handed. Anything else would produce a QR code that
# scans fine and then goes nowhere.
ALLOWED_SCHEMES = ("http", "https")


def _has_port(parts: SplitResult) -> bool:
    try:
        return parts.port is not None
    except ValueError:
        # A port that is not a number: refused at write time, and never something to
        # "fix" by appending a second one behind it.
        return True


def normalize_join_url(value: str, port: int | None = None) -> str:
    """The stored override in the form a phone should open, or `""` for "guess it".

    Three forgiving fixes, because a host types an address and not a URL:

    - a value without a scheme gets `http://`;
    - a trailing slash goes (the QR is read by a human as well, and
      `http://192.168.0.5:1234` is the shorter thing to compare with the router);
    - a value that is a bare address — no scheme *and* no port, i.e. `192.168.1.5` —
      gets `port` appended. Wingman does not listen on 80, so an address without one
      sends every guest nowhere, and "my PC is at 192.168.1.5" is the whole reason this
      setting exists. A **typed** scheme is left alone: `https://party.example` is a
      reverse proxy on its default port, and appending Wingman's own would break it.
    """
    text = value.strip()
    if not text:
        return ""
    typed_scheme = "://" in text
    if not typed_scheme:
        text = f"http://{text}"
    # Only a path's trailing slash may go: `http://` alone must not become `http:`.
    trimmed = text.rstrip("/")
    parts = urlsplit(trimmed)
    if not parts.hostname:
        return text
    if port is not None and not typed_scheme and not _has_port(parts):
        return urlunsplit(parts._replace(netloc=f"{parts.netloc}:{port}"))
    return trimmed


def validate_join_url(value: object) -> None:
    """Raise `ValueError` for an override that could not be opened on a phone.

    Deliberately narrow: only what cannot be meant is refused (a wrong scheme, no host,
    whitespace inside, a non-numeric port). A reachable-looking address Wingman cannot
    reach itself is still accepted — the host can see their own network, this process
    cannot.
    """
    text = str(value).strip()
    if not text:
        return  # empty is the default: pick the LAN address automatically
    if len(text) > MAX_LENGTH:
        raise ValueError(f"a join URL is at most {MAX_LENGTH} characters")
    if any(character.isspace() for character in text):
        raise ValueError("a join URL must not contain spaces")

    parts = urlsplit(normalize_join_url(text))
    if parts.scheme not in ALLOWED_SCHEMES:
        raise ValueError("a join URL must start with http:// or https://")
    if not parts.hostname:
        raise ValueError("a join URL needs a host, e.g. http://192.168.0.5:1234")
    try:
        # urlsplit only parses the port when it is asked for it.
        _ = parts.port
    except ValueError as error:
        raise ValueError("the port of a join URL must be a number") from error
