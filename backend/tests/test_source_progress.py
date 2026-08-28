"""The progress plan that turns a download's many steps into one 0 → 100 sweep."""

import pytest

from ultrastar_wingman.sources.progress import Phase, PhasedProgress

PLAN = (
    Phase("first", 10),
    Phase("optional", 10),
    Phase("long", 70, repeats=True),
    Phase("last", 10),
)


class Recorder:
    """Stands in for the download queue's reporter and keeps what it was told."""

    def __init__(self) -> None:
        self.reports: list[tuple[float, str]] = []

    async def __call__(self, percent: float | None, step: str) -> None:
        assert percent is not None, "the plan must never report an unknown percentage"
        self.reports.append((percent, step))

    @property
    def percentages(self) -> list[float]:
        return [percent for percent, _ in self.reports]


def is_monotone(percentages: list[float]) -> bool:
    pairs = zip(percentages, percentages[1:], strict=False)
    return all(later >= earlier for earlier, later in pairs)


async def test_a_full_run_sweeps_from_zero_to_the_end_without_ever_going_back() -> None:
    recorder = Recorder()
    report = PhasedProgress(recorder, PLAN)
    await report(None, "first")
    for percent in range(0, 101, 10):
        await report(float(percent), "optional")
    for percent in range(0, 101, 10):
        await report(float(percent), "long")
    await report(None, "last")

    assert recorder.percentages[0] == 0.0
    assert is_monotone(recorder.percentages)
    assert 90.0 <= recorder.percentages[-1] <= 100.0


async def test_a_step_without_a_percentage_sits_at_the_start_of_its_slice() -> None:
    recorder = Recorder()
    report = PhasedProgress(recorder, PLAN)
    await report(None, "first")
    await report(None, "optional")

    assert recorder.percentages == [0.0, 10.0]


async def test_a_skipped_step_leaves_the_scale_instead_of_a_gap() -> None:
    """ffmpeg is only downloaded once, so every later download jumps over that phase — and
    then the ten percent it would have been worth belong to the steps that do run."""
    recorder = Recorder()
    report = PhasedProgress(recorder, PLAN)
    await report(None, "first")
    await report(0.0, "long")
    await report(100.0, "last")

    # 10 of the 90 that are left, not 10 of 100 with a hole where the skipped phase was.
    assert recorder.percentages[1] == pytest.approx(100 * 10 / 90)
    assert recorder.percentages[-1] == 100.0


async def test_a_step_that_counts_again_shares_its_slice_with_the_first_pass() -> None:
    """yt-dlp downloads video and audio as two streams, each counting from 0 to 100 — the
    second one continues where the first stopped instead of restarting the bar."""
    recorder = Recorder()
    report = PhasedProgress(recorder, PLAN)
    await report(50.0, "long")
    await report(100.0, "long")
    after_first_pass = recorder.percentages[-1]
    await report(0.0, "long")
    await report(100.0, "long")

    assert is_monotone(recorder.percentages)
    assert after_first_pass < recorder.percentages[-1] < 90.0


async def test_an_unlisted_step_shows_its_name_and_holds_the_percentage() -> None:
    recorder = Recorder()
    report = PhasedProgress(recorder, PLAN)
    await report(100.0, "long")
    held = recorder.percentages[-1]
    await report(None, "something the plan does not know")

    assert recorder.reports[-1] == (held, "something the plan does not know")


async def test_a_step_reported_again_after_the_next_one_started_does_not_rewind() -> None:
    recorder = Recorder()
    report = PhasedProgress(recorder, PLAN)
    await report(100.0, "long")
    reached = recorder.percentages[-1]
    await report(0.0, "first")

    assert recorder.percentages[-1] == reached


@pytest.mark.parametrize(
    "phases",
    [
        pytest.param((), id="empty"),
        pytest.param((Phase("nothing", 0),), id="weightless"),
    ],
)
def test_a_plan_that_cannot_be_a_scale_is_refused(phases: tuple[Phase, ...]) -> None:
    with pytest.raises(ValueError):
        PhasedProgress(Recorder(), phases)
