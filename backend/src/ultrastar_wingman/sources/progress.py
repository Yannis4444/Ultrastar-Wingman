"""One 0 → 100 sweep out of a download's many steps.

A download is a chain of steps that each know their own progress and nothing about
the others: yt-dlp counts its stream from 0 to 100, the ffmpeg install counts its
bytes from 0 to 100, fetching the song text has no percentage at all. Reported as they
come, the UI ring restarts at every step — so a source hands its steps to
`PhasedProgress` instead, which owns the whole scale and gives each step a slice of it.

The scale is what actually runs: a step that never happens (a tool that is already
installed) drops out of it instead of leaving a gap, so a download that skips half the plan
still starts at 0 and ends at 100. The rest follows from that — a step that reports no
percentage sits at the start of its slice, and nothing ever moves backwards.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from .base import ProgressReport

# What the first pass of a repeating step gets. Such a step counts from 0 to 100 more than
# once (yt-dlp downloads video and audio as two streams, each with its own percentage), and
# how often is not known in advance — so every further pass gets the same share of what is
# left of the slice. The first pass being by far the biggest download, the split is roughly
# where the bytes are.
FIRST_PASS_SHARE = 0.8


@dataclass(frozen=True)
class Phase:
    """One step of a download and how much of the total it is worth. `weight` is relative;
    what matters is how the weights compare to each other, not that they add up to anything."""

    step: str
    weight: float
    # Whether the step counts from 0 to 100 several times — see `FIRST_PASS_SHARE`. A step
    # that runs once fills its slice, so the last phase of a plan really reaches 100.
    repeats: bool = False


class PhasedProgress:
    """Wraps a `ProgressReport` and turns per-step percentages into overall ones.

    Steps are matched by the exact string the source reports; a step that is not in the plan
    holds the percentage where it is, so an unlisted step still shows its name in the UI.
    """

    def __init__(self, report: ProgressReport, phases: Sequence[Phase]) -> None:
        if not phases:
            raise ValueError("a progress plan needs at least one phase")
        if sum(phase.weight for phase in phases) <= 0:
            raise ValueError("a progress plan needs a positive total weight")
        self._report = report
        self._phases = tuple(phases)
        self._index: int | None = None
        # The scale: what the phases before the current one were worth, and what the phases
        # that will never run took out of the total.
        self._done = 0.0
        self._skipped = 0.0
        # How much of the current phase earlier passes of it have used up, and what the pass
        # running now may still add.
        self._consumed = 0.0
        self._share = 1.0
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
        reached = self._done + self._phases[index].weight * within
        total = sum(phase.weight for phase in self._phases) - self._skipped
        self._highest = max(self._highest, 100.0 * reached / total)
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
        """Move on to `index`: the phase we leave is done, the ones in between never ran."""
        first = 0 if self._index is None else self._index + 1
        if self._index is not None:
            self._done += self._phases[self._index].weight
        self._skipped += sum(phase.weight for phase in self._phases[first:index])
        self._index = index
        self._consumed = 0.0
        self._share = FIRST_PASS_SHARE if self._phases[index].repeats else 1.0

    def _next_pass(self) -> None:
        self._consumed += self._share
        self._share = (1.0 - self._consumed) * FIRST_PASS_SHARE
