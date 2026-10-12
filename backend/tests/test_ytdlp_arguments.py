"""The host's own yt-dlp arguments: how the one line is split, what the validator refuses,
how the setting is stored and served, and what is hidden from anything shown."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.downloads import media
from ultrastar_wingman.downloads.ytdlp_arguments import (
    MAX_LENGTH,
    REDACTED,
    redactor,
    split_ytdlp_args,
    validate_ytdlp_args,
)
from ultrastar_wingman.settings import DEFINITIONS, SettingsService, SettingValueError

SETTING = media.YTDLP_ARGS_SETTING


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        pytest.param("", [], id="empty"),
        pytest.param("   ", [], id="blank"),
        pytest.param(
            "--cookies-from-browser firefox", ["--cookies-from-browser", "firefox"], id="plain"
        ),
        # The reason POSIX shlex.split is not used: it would read `\U` as an escaped `U`.
        pytest.param(
            r"--cookies C:\Users\x\cookies.txt",
            ["--cookies", r"C:\Users\x\cookies.txt"],
            id="backslash-path",
        ),
        pytest.param(
            r'--cookies "C:\My Files\cookies.txt"',
            ["--cookies", r"C:\My Files\cookies.txt"],
            id="double-quoted-spaces",
        ),
        # A quoted path ending in a backslash: with escaping on, `\"` would swallow the quote.
        pytest.param(
            r'--paths "C:\My Files\"', ["--paths", "C:\\My Files\\"], id="trailing-backslash"
        ),
        pytest.param("--password 'my secret'", ["--password", "my secret"], id="single-quoted"),
        pytest.param("""--password 'say "hi"'""", ["--password", 'say "hi"'], id="nested-quote"),
        pytest.param("--cookies=a.txt", ["--cookies=a.txt"], id="equals"),
        # `#` is no comment: a password may hold one.
        pytest.param("--password pa#ss", ["--password", "pa#ss"], id="hash"),
        pytest.param('--password ""', ["--password", ""], id="empty-quoted"),
        pytest.param(
            "-v\t--no-mtime\n--ignore-config",
            ["-v", "--no-mtime", "--ignore-config"],
            id="tab-newline",
        ),
        # Pasted from a web page or typed on a phone: a no-break space separates too, and
        # inside quotes it stays part of the argument like any other space.
        pytest.param(
            "--cookies-from-browser\xa0firefox --password 'a\xa0b'",
            ["--cookies-from-browser", "firefox", "--password", "a\xa0b"],
            id="no-break-space",
        ),
    ],
)
def test_the_line_is_split_like_a_shell_without_escapes(value: str, expected: list[str]) -> None:
    assert split_ytdlp_args(value) == expected
    validate_ytdlp_args(value)


@pytest.mark.parametrize(
    ("value", "reason"),
    [
        pytest.param('--cookies "C:\\x\\cookies.txt', "quote is never closed", id="open-double"),
        pytest.param("--password 'secret", "quote is never closed", id="open-single"),
        pytest.param("-v -- --no-mtime", "bare --", id="end-of-options"),
        pytest.param("-v\x00", "control characters", id="nul"),
        pytest.param("-v\x1b[0m", "control characters", id="escape"),
        pytest.param("-v " * MAX_LENGTH, "at most", id="too-long"),
    ],
)
def test_an_unusable_line_is_refused_with_a_sentence(value: str, reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        validate_ytdlp_args(value)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("--username bob", id="long"),
        pytest.param("-u bob", id="short"),
        pytest.param("-ubob", id="short-attached"),
        pytest.param("--username=bob", id="equals"),
        pytest.param("--usern bob", id="abbreviated"),
        pytest.param("--ap-username bob --password pw", id="tv-provider"),
    ],
)
def test_a_login_without_its_password_is_refused(value: str) -> None:
    """yt-dlp 2026.08.19, run with `--username bob` and stdin closed, was still waiting for
    the password after 25 seconds: `getpass` asks the console, not the input."""
    with pytest.raises(ValueError, match="give the password with the username"):
        validate_ytdlp_args(value)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("--username bob --password pw", id="long"),
        pytest.param("-u bob -ppw", id="short"),
        pytest.param("--username=bob --passw=pw", id="abbreviated"),
        pytest.param("--ap-username bob --ap-password pw", id="tv-provider"),
        # Neither a login nor a password: options that only start alike.
        pytest.param("--use-extractors youtube --paths C:\\x -P C:\\y", id="look-alikes"),
    ],
)
def test_a_complete_login_is_accepted(value: str) -> None:
    validate_ytdlp_args(value)


def test_a_quoted_double_dash_is_still_an_end_of_options() -> None:
    """yt-dlp never sees the quotes, so `"--"` is the same `--`."""
    with pytest.raises(ValueError, match="bare --"):
        validate_ytdlp_args('-v "--"')


def test_the_setting_is_a_secret_with_its_rule_in_the_description() -> None:
    definition = DEFINITIONS[SETTING]
    assert definition.secret
    assert definition.advanced
    assert definition.default == ""
    assert "backslash" in definition.description
    # "per line" would turn the settings page's box into a textarea, and a line break is
    # only a separator here.
    assert "per line" not in definition.description


async def test_the_setting_refuses_what_the_validator_refuses(session: AsyncSession) -> None:
    with pytest.raises(SettingValueError):
        await SettingsService(session).set(SETTING, "--password 'secret")


async def test_an_unbalanced_quote_is_reported_at_the_field(client: AsyncClient) -> None:
    response = await client.patch(
        f"/api/v1/settings/{SETTING}", json={"value": "--password 'hunter2"}
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "quote is never closed" in detail
    assert "hunter2" not in detail


async def test_the_value_is_never_served(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    value = "--username me --password hunter2"
    response = await client.patch(f"/api/v1/settings/{SETTING}", json={"value": value})
    assert response.status_code == 200
    assert response.json()["value"] is None
    # The websocket every guest phone holds hears that it changed, and nothing else.
    changed = [event for event in broadcast_events if event.get("event") == "setting.changed"]
    assert changed
    assert "hunter2" not in str(broadcast_events)

    listing = (await client.get("/api/v1/settings")).json()
    row = next(setting for setting in listing if setting["key"] == SETTING)
    assert row["value"] is None
    assert row["is_set"] is True
    assert "hunter2" not in str(listing)


async def test_the_download_reads_the_configured_arguments(session: AsyncSession) -> None:
    assert await media.ytdlp_args(session) == []

    await SettingsService(session).set(SETTING, r'--cookies "C:\My Files\c.txt" -v')

    assert await media.ytdlp_args(session) == ["--cookies", r"C:\My Files\c.txt", "-v"]


def test_every_value_is_hidden_and_no_option_name() -> None:
    redact = redactor(["--password", "hunter2", "--video-password=s3cret", "--no-mtime"])

    assert redact("ERROR: [generic] 'hunter2' is not a valid URL") == (
        f"ERROR: [generic] '{REDACTED}' is not a valid URL"
    )
    assert redact("using s3cret and hunter2") == f"using {REDACTED} and {REDACTED}"
    assert redact("--password and --no-mtime are fine") == "--password and --no-mtime are fine"


def test_a_value_is_hidden_the_way_python_prints_it() -> None:
    """yt-dlp does not hide a `--cookies` path in `--verbose` or in a traceback, and both
    print it with its backslashes doubled — this line is a real one, from yt-dlp 2026.08.19
    handed a cookies file in a folder that does not exist."""
    redact = redactor(["--cookies", r"C:\My Files\c.txt", "--add-headers", 'X:"a\'b"'])

    assert redact(
        "FileNotFoundError: [Errno 2] No such file or directory: 'C:\\\\My Files\\\\c.txt'"
    ) == (f"FileNotFoundError: [Errno 2] No such file or directory: '{REDACTED}'")
    assert redact(r"""[debug] Command-line config: ['--add-headers', 'X:"a\'b"']""") == (
        f"[debug] Command-line config: ['--add-headers', '{REDACTED}']"
    )


def test_a_value_attached_to_a_short_option_is_hidden() -> None:
    """yt-dlp's own `--verbose` masking knows `-p secret` and `--password=secret`, not
    `-psecret`."""
    redact = redactor(["-u", "bob", "-phunter2"])

    assert redact("[debug] Command-line config: ['-u', 'PRIVATE', '-phunter2']") == (
        f"[debug] Command-line config: ['-u', 'PRIVATE', '{REDACTED}']"
    )
    assert redact("'hunter2' is not a valid URL") == f"'{REDACTED}' is not a valid URL"


def test_a_value_is_hidden_as_a_word_of_its_own() -> None:
    """A short value must not shred every word that contains it."""
    redact = redactor(["--format", "mp4"])

    assert redact("downloading mp4 as mp4a") == f"downloading {REDACTED} as mp4a"


def test_a_value_containing_another_is_hidden_whole() -> None:
    redact = redactor(["--password", "my secret", "secret"])

    assert redact("'my secret'") == f"'{REDACTED}'"


def test_without_arguments_nothing_is_touched() -> None:
    assert redactor([])("anything at all") == "anything at all"
    assert redactor(["--no-mtime", "--password="])("--password=") == "--password="
