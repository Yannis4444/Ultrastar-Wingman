"""One 0 → 100 sweep out of a download's many steps.

A download is a chain of steps that each know their own progress and nothing about
the others: yt-dlp counts its stream from 0 to 100, the ffmpeg install counts its
bytes from 0 to 100, fetching the song text has no percentage at all. Reported as they
come, the UI ring restarts at every step — so a source hands its steps to
`PhasedProgress` instead, which owns the whole scale and gives each step a slice of it.

The result is monotone by construction: a step that never runs (a tool that is already
installed) is skipped over, a step that reports no percentage sits at the start of its
slice, and nothing ever moves backwards.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from .base import ProgressReport

# What the first pass of a step gets, when a step turns out to have several passes (yt-dlp
# downloads video and audio as two streams, each counting from 0 to 100). Every further pass
# gets the same share of what is left, so the slice can hold any number of passes without
# knowing how many are coming — and with the first pass being by far the biggest download,
# the split is roughly where the bytes are.
FIRST_PASS_SHARE = 0.8


@dataclass(frozen=True)
class Phase:
    """One step of a download and how much of the total it is worth. `weight` is relative;
    what matters is how the weights compare to each other, not that they add up to anything."""

    step: str
    weight: float


class PhasedProgress:
    """Wraps a `ProgressReport` and turns per-step percentages into overall ones.

    Steps are matched by the exact string the source reports; a step that is not in the plan
    holds the percentage where it is, so an unlisted step still shows its name in the UI.
    """

    def __init__(self, report: ProgressReport, phases: Sequence[Phase]) -> None:
        if not phases:
            raise ValueError("a progress plan needs at least one phase")
        self._report = report
        self._phases = tuple(phases)
        total = sum(phase.weight for phase in self._phases)
        if total <= 0:
            raise ValueError("a progress plan needs a positive total weight")
        self._starts: list[float] = []
        offset = 0.0
        for phase in self._phases:
            self._starts.append(100.0 * offset / total)
            offset += phase.weight
        self._spans = [
            (self._starts[index + 1] if index + 1 < len(self._starts) else 100.0)
            - self._starts[index]
            for index in range(len(self._starts))
        ]
        self._index: int | None = None
        # How much of the current slice earlier passes of the current step have used up, and
        # what the pass running now may still add.
        self._consumed = 0.0
        self._share = FIRST_PASS_SHARE
        self._last_percent = 0.0
        self._highest = 0.0

    async def __call__(self, percent: float | None, step: str) -> None:
        await self._report(self._overall(percent, step), step)

    def _overall(self, percent: float | None, step: str) -> float:
        index = self._phase_index(step)
        if index is None:
            return self._highest
        if index != self._index:
            self._enter(index)
        elif percent is not None and percent < self._last_percent:
            # The step started counting again: a second yt-dlp stream, a retried transfer.
            self._next_pass()
        self._last_percent = 0.0 if percent is None else percent
        within = self._consumed + self._share * self._last_percent / 100.0
        self._highest = max(self._highest, self._starts[index] + self._spans[index] * within)
        return self._highest

    def _phase_index(self, step: str) -> int | None:
        """The phase this step belongs to, ignoring phases already behind us — a step name
        that comes around a second time (a retry) stays where it is instead of rewinding."""
        start = 0 if self._index is None else self._index
        for index in range(start, len(self._phases)):
            if self._phases[index].step == step:
                return index
        return None

    def _enter(self, index: int) -> None:
        self._index = index
        self._consumed = 0.0
        self._share = FIRST_PASS_SHARE

    def _next_pass(self) -> None:
        self._consumed += self._share
        self._share = (1.0 - self._consumed) * FIRST_PASS_SHARE
