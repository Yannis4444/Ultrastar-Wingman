"""The rules a tag can carry: what makes the scanner put it on a song.

A tag is either manual or automatic, never both. A manual tag is what people put on
songs; an automatic one carries exactly one rule from this registry, and then nobody
assigns or unassigns it — `service.apply_rules` derives its rows from the library and
reconciles them after every scan.

The registry is the seam architecture.md asks for: a rule is a small class with a `kind`,
a label for the editor, whether it takes a value, the SQL a matching song satisfies, and —
for the value kinds — the values the library actually holds, so the editor can suggest
them. A sixth rule is one more class and one more entry in `RULES`, nothing else.

Comparison for the value kinds is trimmed and case-insensitive: a library writes
"English", " english" and "English " for the same language. A song whose column is NULL
matches nothing — SQL comparison against NULL is not false but unknown, which is the same
answer here: a song without a language is not a song in some language.
"""

from abc import ABC, abstractmethod
from typing import ClassVar

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from ..songs.model import Song


class UnknownRuleKindError(ValueError):
    def __init__(self, kind: str) -> None:
        super().__init__(f"unknown rule kind '{kind}'")
        self.kind = kind


class RuleValueError(ValueError):
    """The value does not fit the kind: missing where one is needed, or given where the
    rule has nothing to compare it to."""


class Rule(ABC):
    """One reason a tag belongs on a song.

    Deliberately a filter and not a `matches(song)`: reconciling a tag over a library of
    a few thousand songs is one query this way, and a per-song predicate would be a few
    thousand.
    """

    kind: ClassVar[str]
    # What the editor's select says. The value kinds end in an ellipsis, because the text
    # input behind them finishes the sentence.
    label: ClassVar[str]
    needs_value: ClassVar[bool]

    @abstractmethod
    def condition(self, value: str | None) -> ColumnElement[bool]:
        """What a song has to satisfy to carry the tag."""

    async def suggestions(self, session: AsyncSession) -> list[str]:
        """The values this rule's field holds in the library, for the editor's datalist.
        Empty for a rule that takes no value."""
        return []

    def normalized(self, value: str | None) -> str | None:
        """The value as it is stored, or `RuleValueError`. A rule without a value refuses
        one rather than dropping it: a request that carries `"value": "English"` on *Duet*
        means something the backend cannot do, and silence would look like it did it."""
        if value is not None and value.strip():
            raise RuleValueError(f"the rule '{self.kind}' takes no value")
        return None


class DuetRule(Rule):
    kind = "duet"
    label = "Duet"
    needs_value = False

    def condition(self, value: str | None) -> ColumnElement[bool]:
        return Song.is_duet.is_(True)


class HasVideoRule(Rule):
    kind = "has_video"
    label = "Has video"
    needs_value = False

    def condition(self, value: str | None) -> ColumnElement[bool]:
        # The same "has a video" the song list draws: a `#VIDEO` tag naming a file that is
        # not on disk is not a video anybody can watch, and the scanner already resolved it.
        return Song.video_file.is_not(None)


class TextColumnRule(Rule):
    """A rule over one of the song's text fields: the field equals a value, trimmed and
    case-insensitively."""

    needs_value = True

    @abstractmethod
    def column(self) -> InstrumentedAttribute[str | None]:
        """The song column this rule reads. A method and not an attribute: a mapped column
        is a descriptor, so one held as an attribute would read back as the *value* it
        stands for instead of the column itself."""

    def condition(self, value: str | None) -> ColumnElement[bool]:
        # `normalized` refuses a missing value, so a rule row without one — only a
        # hand-edited database can hold that — raises here instead of matching everything.
        return func.lower(func.trim(self.column())) == self.normalized(value).lower()

    async def suggestions(self, session: AsyncSession) -> list[str]:
        column = self.column()
        values = await session.scalars(select(column).where(column.is_not(None)).distinct())
        # Deduplicated case-insensitively as well: a datalist offering both "English" and
        # "english" reads like a bug, and either one matches the same songs. Which
        # spelling survives must not depend on the order SQLite hands the rows over, so
        # the values are sorted first and the first spelling of each wins.
        stripped = sorted(
            (value.strip() for value in values if value and value.strip()),
            key=lambda value: (value.casefold(), value),
        )
        seen: dict[str, str] = {}
        for value in stripped:
            seen.setdefault(value.casefold(), value)
        return list(seen.values())

    def normalized(self, value: str | None) -> str:
        """Never None, unlike the base: these kinds have nothing to match without one."""
        if value is None or not value.strip():
            raise RuleValueError(f"the rule '{self.kind}' needs a value")
        return value.strip()


class LanguageRule(TextColumnRule):
    kind = "language"
    label = "Language is…"

    def column(self) -> InstrumentedAttribute[str | None]:
        return Song.language


class GenreRule(TextColumnRule):
    kind = "genre"
    label = "Genre is…"

    def column(self) -> InstrumentedAttribute[str | None]:
        return Song.genre


class EditionRule(TextColumnRule):
    kind = "edition"
    label = "Edition is…"

    def column(self) -> InstrumentedAttribute[str | None]:
        return Song.edition


# The registry. Order is the order the editor's select offers them in: the two flags
# first, then the fields somebody has to fill in.
RULES: dict[str, Rule] = {
    rule.kind: rule
    for rule in (DuetRule(), HasVideoRule(), LanguageRule(), GenreRule(), EditionRule())
}


def get(kind: str) -> Rule:
    """Raises `UnknownRuleKindError`."""
    rule = RULES.get(kind)
    if rule is None:
        raise UnknownRuleKindError(kind)
    return rule


def all_rules() -> list[Rule]:
    return list(RULES.values())
