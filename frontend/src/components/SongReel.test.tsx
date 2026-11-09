import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SongRead } from "../api";
import SongReel, { REVEAL_MS, type Spin } from "./SongReel";

function song(id: string, title: string): SongRead {
  return {
    id,
    source: "usdb",
    title,
    artist: `Artist of ${title}`,
    duration_seconds: 100,
    has_video: false,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  };
}

const QUEEN = song("usdb:1", "Dancing Queen");
const AFRICA = song("usdb:2", "Africa");
const WATERLOO = song("usdb:3", "Waterloo");
const POOL = [QUEEN, AFRICA, WATERLOO];

/** The cover of every reel entry, top (winner) to bottom. */
function reelSongIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(".spinner-reel img")]
    .map((cover) => cover.getAttribute("src") ?? "")
    .map((source) => decodeURIComponent(source.split("/")[4] ?? ""));
}

/** The entry on show at the bottom of the reel: what it starts moving from. */
function resting(container: HTMLElement): Element | null {
  return container.querySelector(".spinner-reel > :last-child");
}

function reelElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".spinner-reel");
  if (element === null) throw new Error("no reel");
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("before the first spin the window is an empty, disabled button", () => {
  const { container } = render(
    <SongReel spin={null} fillers={POOL} onOpen={vi.fn()} />,
  );

  expect(
    screen.getByRole("button", { name: "Nothing spun yet" }),
  ).toBeDisabled();
  expect(reelSongIds(container)).toEqual([]);
});

test("a spin builds the reel from the fillers, lands on the winner and says so", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSettled = vi.fn();
  const { container } = render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      onSettled={onSettled}
      onOpen={vi.fn()}
    />,
  );

  const ids = reelSongIds(container);
  // 40-60 fillers plus the winner and the resting entry.
  expect(ids.length).toBeGreaterThan(40);
  // The winner is at the top — where the reel comes to rest — and the first
  // spin starts from the logo the window was showing.
  expect(ids[0]).toBe("usdb:2");
  expect(new Set(ids)).toEqual(new Set(["usdb:1", "usdb:2", "usdb:3"]));
  expect(resting(container)).toHaveClass("spinner-cover-logo");
  // Parked at the bottom, then sent to the top under a transition.
  expect(reelElement(container).style.transition).toMatch(/transform/);
  expect(reelElement(container).style.transform).toBe("translateY(0)");
  // Still running: nothing to open yet, and nothing has been reported.
  expect(
    screen.getByRole("button", { name: "Nothing spun yet" }),
  ).toBeDisabled();
  expect(onSettled).not.toHaveBeenCalled();

  act(() => vi.advanceTimersByTime(REVEAL_MS - 100));
  expect(onSettled).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(100));

  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledWith(AFRICA);
  // Settled: one cover, at rest, and the way into the song.
  expect(reelSongIds(container)).toEqual(["usdb:2"]);
  expect(reelElement(container).style.transition).toBe("");
  expect(
    screen.getByRole("button", { name: "Details for Africa" }),
  ).toBeEnabled();
});

test("the next spin starts from the cover the last one landed on", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { container, rerender } = render(
    <SongReel spin={{ id: 1, winner: AFRICA }} fillers={POOL} />,
  );
  act(() => vi.advanceTimersByTime(REVEAL_MS));

  rerender(<SongReel spin={{ id: 2, winner: QUEEN }} fillers={POOL} />);

  const ids = reelSongIds(container);
  expect(ids.length).toBeGreaterThan(40);
  expect(ids[0]).toBe("usdb:1");
  expect(resting(container)?.tagName).toBe("IMG");
  expect(ids[ids.length - 1]).toBe("usdb:2");
});

test("the same spin drawn again with new objects moves nothing", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSettled = vi.fn();
  const { container, rerender } = render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={[...POOL]}
      onSettled={onSettled}
    />,
  );
  const before = reelSongIds(container);

  // A broadcast redrawing the selection hands the host a new winner object and
  // a new filler list every time a slot moves; a re-render is not a spin.
  rerender(
    <SongReel
      spin={{ id: 1, winner: { ...AFRICA } }}
      fillers={[...POOL]}
      onSettled={onSettled}
    />,
  );

  expect(reelSongIds(container)).toEqual(before);
  // And the reveal timer was not reset by it: the reel lands on time.
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test("a settled start draws the winner at rest and reports nothing", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSettled = vi.fn();
  const { container } = render(
    <SongReel
      spin={{ id: 3, winner: WATERLOO }}
      fillers={POOL}
      settled
      onSettled={onSettled}
      onOpen={vi.fn()}
    />,
  );

  // One cover and no transition: a host screen turned on after the reel
  // landed shows the song, not a five-second replay.
  expect(reelSongIds(container)).toEqual(["usdb:3"]);
  expect(reelElement(container).style.transition).toBe("");
  expect(
    screen.getByRole("button", { name: "Details for Waterloo" }),
  ).toBeEnabled();
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(onSettled).not.toHaveBeenCalled();
});

test("a spin declared over while it runs is cut short and lands at once", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSettled = vi.fn();
  const { container, rerender } = render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      onSettled={onSettled}
      onOpen={vi.fn()}
    />,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(reelSongIds(container).length).toBeGreaterThan(40);
  expect(onSettled).not.toHaveBeenCalled();

  // A press in the room skipped the animation: the caller says the spin is
  // over with the covers still flying past.
  rerender(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      settled
      onSettled={onSettled}
      onOpen={vi.fn()}
    />,
  );

  // The winner stands in the window, with nothing left of the glide, and the
  // caller hears about it now rather than in four seconds.
  expect(reelSongIds(container)).toEqual(["usdb:2"]);
  expect(reelElement(container).style.transition).toBe("");
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledWith(AFRICA);
  expect(
    screen.getByRole("button", { name: "Details for Africa" }),
  ).toBeEnabled();

  // The reveal timer went with the spin: the landing is not reported twice.
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test("a newer spin that arrives settled mid-spin is what stands, not the cut-short one", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSettled = vi.fn();
  const { container, rerender } = render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      onSettled={onSettled}
    />,
  );
  act(() => vi.advanceTimersByTime(1000));

  // Two broadcasts in one render: a respin, and its spin already over. The
  // new spin is drawn at rest; the old reel's cut-short must not land it back.
  rerender(
    <SongReel
      spin={{ id: 2, winner: QUEEN }}
      fillers={POOL}
      settled
      onSettled={onSettled}
    />,
  );

  expect(reelSongIds(container)).toEqual(["usdb:1"]);
  expect(onSettled).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(reelSongIds(container)).toEqual(["usdb:1"]);
  expect(onSettled).not.toHaveBeenCalled();
});

test("declaring a reel at rest settled moves nothing", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSettled = vi.fn();
  const { container, rerender } = render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      onSettled={onSettled}
    />,
  );
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(onSettled).toHaveBeenCalledTimes(1);

  // The spin landed on its own a moment ago and the caller only now says so.
  rerender(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      settled
      onSettled={onSettled}
    />,
  );

  expect(reelSongIds(container)).toEqual(["usdb:2"]);
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test("reduced motion lands at once", () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const onSettled = vi.fn();
  const { container } = render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      onSettled={onSettled}
      onOpen={vi.fn()}
    />,
  );

  // No covers fly past, and the caller hears about the landing in the same
  // breath — a spin did happen, it just took no time.
  expect(reelSongIds(container)).toEqual(["usdb:2"]);
  expect(reelElement(container).style.transition).toBe("");
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledWith(AFRICA);
  expect(
    screen.getByRole("button", { name: "Details for Africa" }),
  ).toBeEnabled();
});

test("with nothing to fill from, the winner flies past itself", () => {
  const { container } = render(
    <SongReel spin={{ id: 1, winner: AFRICA }} fillers={[]} />,
  );

  const ids = reelSongIds(container);
  expect(ids.length).toBeGreaterThan(40);
  expect(new Set(ids)).toEqual(new Set(["usdb:2"]));
});

test("the settled cover opens the song, and only once it has settled", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onOpen = vi.fn();
  render(
    <SongReel
      spin={{ id: 1, winner: AFRICA }}
      fillers={POOL}
      onOpen={onOpen}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Nothing spun yet" }));
  expect(onOpen).not.toHaveBeenCalled();

  act(() => vi.advanceTimersByTime(REVEAL_MS));
  fireEvent.click(screen.getByRole("button", { name: "Details for Africa" }));

  expect(onOpen).toHaveBeenCalledWith(AFRICA);
});

test("without a way in, the window is a frame and not a button", () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const spin: Spin = { id: 1, winner: AFRICA };
  const { container } = render(<SongReel spin={spin} fillers={POOL} />);
  act(() => vi.advanceTimersByTime(REVEAL_MS));

  // The TV has nobody to press it: a disabled button there would be a control
  // that never does anything.
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(container.querySelector(".spinner-window")?.tagName).toBe("DIV");
  expect(reelSongIds(container)).toEqual(["usdb:2"]);
});
