"""The host's own yt-dlp arguments (`downloads.ytdlp_arguments`): one line of text, split into
the argument list every download run gets ahead of Wingman's own.

A leaf like `video_quality`: `settings.py` imports it for the validator, so it must never
import the registry back.

The rule is a shell's quoting without a shell's escaping. Whitespace separates arguments,
and double or single quotes keep one together across spaces — but a backslash is an
ordinary character, because the arguments this exists for are Windows paths
(`--cookies C:\\Users\\me\\cookies.txt`), and POSIX `shlex.split` would eat every backslash
in them. `#` is ordinary too: it starts no comment, so a password may hold one. The price is
that a quote character can only be written inside the other kind of quote (`'a"b'`).
"""

import json
import re
import shlex
from collections.abc import Callable, Sequence

# Far below what Windows accepts on one command line (32767 characters) together with
# Wingman's own arguments, and far above anything a host types into one field.
MAX_LENGTH = 4000

# Ends yt-dlp's options: everything Wingman adds behind the host's arguments — the progress
# template, the format, the output file — would be read as URLs to download.
END_OF_OPTIONS = "--"

# What a value of the host's arguments reads as in anything Wingman shows or logs.
REDACTED = "***"

# shlex separates on ASCII whitespace alone, but a line pasted from a web page or typed on a
# phone keyboard can carry a no-break space between an option and its value — which would
# otherwise arrive as one argument yt-dlp calls "no such option". Every other character
# `str.isspace` knows separates too; inside quotes none of them splits anything.
_WHITESPACE = "".join(chr(code) for code in range(0x3001) if chr(code).isspace())


def split_ytdlp_args(value: str) -> list[str]:
    """The argument list `value` stands for. Raises `ValueError` with a sentence the
    settings page can show for a quote that is never closed."""
    lexer = shlex.shlex(value, posix=True)
    lexer.whitespace = _WHITESPACE
    lexer.whitespace_split = True
    lexer.escape = ""
    lexer.commenters = ""
    try:
        return list(lexer)
    except ValueError as error:
        raise ValueError(
            "a quote is never closed: end each quoted argument with the quote it starts with"
        ) from error


def redactor(args: Sequence[str]) -> Callable[[str], str]:
    """What turns a line of yt-dlp's output into one that may be shown: every value among
    `args` — an argument that is not an option, what follows the `=` of a long one, or a
    short one with its value attached — replaced by `REDACTED` wherever it stands as a word
    of its own.

    yt-dlp says nothing about a password it is handed, but it does repeat a value it took
    for something else: a `--password my secret` without quotes leaves `secret` to be read
    as a URL, and `'secret' is not a valid URL` is the error. That error is the download's
    message, which the console prints and the websocket hands every guest phone. Which
    option takes a value is yt-dlp's grammar and not Wingman's, so every value is hidden —
    a `firefox` included, which costs a message one word and the host nothing, since the
    arguments are their own.

    A value is also hidden the way Python and JSON print it, backslashes doubled: yt-dlp
    hides `--username` and `--password` in its `--verbose` command line itself, but not a
    `--cookies` path or a `--proxy`, and a traceback quotes them in that form — a
    `FileNotFoundError: ... 'C:\\\\My Files\\\\c.txt'` among the last lines of stderr."""
    plain = {value for arg in args for value in _values_of(arg) if value}
    values = sorted(
        plain
        | {repr(value)[1:-1] for value in plain}
        | {json.dumps(value)[1:-1] for value in plain},
        # The longest first, so a value that contains another one is hidden whole.
        key=len,
        reverse=True,
    )
    if not values:
        return lambda line: line
    pattern = re.compile(
        r"(?<!\w)(?:" + "|".join(re.escape(value) for value in values) + r")(?!\w)"
    )
    return lambda line: pattern.sub(REDACTED, line)


def _values_of(arg: str) -> tuple[str, ...]:
    if not arg.startswith("-"):
        return (arg,)
    if not arg.startswith("--"):
        # A short option takes its value attached as well (`-psecret`), which yt-dlp's own
        # `--verbose` masking does not recognise: the whole argument is hidden, and the
        # value on its own. A cluster of flags (`-vU`) is hidden alike, which costs a
        # message nothing anybody needs to read.
        return (arg, arg[2:]) if len(arg) > 2 else ()
    _, _, value = arg.partition("=")
    return (value,)


# yt-dlp asks for the password of a login given without one, and it asks the console
# itself (`getpass`), not its input: a closed stdin does not end the question, and the
# download would wait for an answer nobody sees. These are its only two such questions.
# An option is named by its short form (`-u`, its value attached or not), by its full long
# form, or by a prefix of that no shorter than the given one — yt-dlp takes any prefix that
# is not ambiguous (`--usern`), and the shortest is set past every other option's name.
_Option = tuple[str | None, str, str]
_PROMPTING_LOGINS: tuple[tuple[_Option, _Option], ...] = (
    (("-u", "--usern", "--username"), ("-p", "--passw", "--password")),
    ((None, "--ap-u", "--ap-username"), (None, "--ap-p", "--ap-password")),
)


def _names(args: Sequence[str], option: _Option) -> bool:
    short, shortest, full = option
    for arg in args:
        if arg.startswith("--"):
            name = arg.partition("=")[0]
            if full.startswith(name) and len(name) >= len(shortest):
                return True
        elif short is not None and arg.startswith(short):
            return True
    return False


def _asks_for_a_password(args: Sequence[str]) -> bool:
    return any(
        _names(args, user) and not _names(args, password) for user, password in _PROMPTING_LOGINS
    )


def validate_ytdlp_args(value: object) -> None:
    text = str(value)
    if len(text) > MAX_LENGTH:
        raise ValueError(f"the arguments are at most {MAX_LENGTH} characters")
    # A NUL cannot be handed to a program at all (the download would fail on an exception
    # rather than a message), and no other control character is meant either. Whitespace
    # is the separator, so a pasted tab or line break is just that.
    if any(not character.isprintable() and not character.isspace() for character in text):
        raise ValueError("the arguments must not contain control characters")
    args = split_ytdlp_args(text)
    if END_OF_OPTIONS in args:
        raise ValueError(
            "remove the bare --, which would end yt-dlp's options before Wingman's own"
        )
    if _asks_for_a_password(args):
        raise ValueError(
            "give the password with the username (--password, or --ap-password for "
            "--ap-username): yt-dlp would stop to ask for it, and the download would wait "
            "forever"
        )
