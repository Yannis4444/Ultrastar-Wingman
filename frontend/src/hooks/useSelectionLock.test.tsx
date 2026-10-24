import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { SelectionOpened, SelectionRead, SongRead } from "../api";
import { FakeSocket } from "../test/fakeSocket";
import {
  latest,
  useSelectionLock,
  type SelectionAdoption,
  type SelectionLostReason,
} from "./useSelectionLock";

const SONG: SongRead = {
  id: "usdb:1",
  source: "usdb",
  title: "Dancing Queen",
  artist: "ABBA",
  duration_seconds: 231,
  has_video: true,
  is_duet: false,
  created_at: "2026-01-01T12:00:00Z",
  language: "English",
  genre: "Pop",
  year: 1976,
  edition: null,
  creator: null,
};

const TOKEN = "selection-token";
const OPENED_AT = "2026-09-06T20:00:00.000Z";

function selection(extra: Partial<SelectionRead> = {}): SelectionRead {
  return {
    song: SONG,
    slots: [],
    opened_at: OPENED_AT,
    updated_at: "2026-09-06T20:00:01.000Z",
    auto_start_at: null,
    ...extra,
  };
}

const OPENED: SelectionOpened = { selection: selection(), token: TOKEN };

const onLost = vi.fn<(reason: SelectionLostReason) => void>();
const onChanged = vi.fn<(next: SelectionRead) => void>();

/**
 * The smallest modal there is: one button per method, and the token on show —
 * here, where nothing is drawn for anybody, so a test can read what the ref
 * holds. Every press re-renders, because the token lives in a ref and a ref
 * redraws nothing on its own.
 */
function Holder({ adopt }: { adopt?: SelectionAdoption }) {
  const lock = useSelectionLock({ adopt, onLost, onChanged });
  const [, setPresses] = useState(0);
  const pressing = (action: () => void) => () => {
    action();
    setPresses((count) => count + 1);
  };
  return (
    <div>
      <output>{lock.token() ?? "none"}</output>
      <button type="button" onClick={pressing(() => lock.hold(OPENED))}>
        hold
      </button>
      <button type="button" onClick={pressing(() => lock.forget())}>
        forget
      </button>
      <button type="button" onClick={pressing(() => lock.close())}>
        close
      </button>
    </div>
  );
}

const fetchMock = vi.fn();

/** Every `DELETE …/selection` so far. */
function releases(): unknown[][] {
  return fetchMock.mock.calls.filter((args) =>
    String(args[0]).startsWith("/api/v1/karaoke/selection"),
  );
}

/** What every close has to look like: the token in the header and nowhere else. */
function expectRelease(call: unknown[], token = TOKEN): void {
  // No query at all: a token in the URL lands in an access log.
  expect(call[0]).toBe("/api/v1/karaoke/selection");
  expect(call[1]).toMatchObject({
    method: "DELETE",
    keepalive: true,
    headers: { "X-Selection-Token": token },
  });
}

/** The `selection.changed` broadcast, as the backend sends it. */
function broadcast(next: SelectionRead | null): void {
  act(() =>
    FakeSocket.deliver({ event: "selection.changed", selection: next }),
  );
}

/** A page ending, the way a closing tab or a navigation away announces it. */
function pageHide(persisted: boolean): void {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  act(() => {
    window.dispatchEvent(event);
  });
}

const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("no network in tests"));
  vi.stubGlobal("fetch", fetchMock);
  onLost.mockReset();
  onChanged.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("holds nothing until an answer lands, then the token out of it", () => {
  render(<Holder />);
  expect(screen.getByRole("status")).toHaveTextContent("none");

  press("hold");

  expect(screen.getByRole("status")).toHaveTextContent(TOKEN);
});

test("an adopted selection is held from the first render", () => {
  render(<Holder adopt={{ selection: selection(), token: "handed-on" }} />);

  expect(screen.getByRole("status")).toHaveTextContent("handed-on");
});

test("close gives the room back once, with the token in the header", async () => {
  const { unmount } = render(<Holder />);
  press("hold");

  press("close");
  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0]);

  // Pressed again, and unmounted after: the token is gone, nothing is sent.
  press("close");
  unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(releases()).toHaveLength(1);
});

test("an answer that lands after close is given straight back", () => {
  render(<Holder />);

  press("close");
  press("hold");

  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0]);
  expect(screen.getByRole("status")).toHaveTextContent("none");
});

test("forget drops the token and sends nothing", async () => {
  const { unmount } = render(<Holder />);
  press("hold");

  press("forget");
  unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  // Play started the song, or another modal took the selection on: the room is
  // not given back, because the selection is not over.
  expect(releases()).toHaveLength(0);
});

test("unmounting gives the room back", async () => {
  const { unmount } = render(<Holder />);
  press("hold");

  unmount();

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
});

test("React's development double-invoke does not give an adopted token back", async () => {
  // The token is in the ref from the first render, and StrictMode runs the
  // effect's cleanup once on this component while it stays mounted. Releasing
  // there would close the selection the picker had just been handed.
  const { unmount } = render(
    <StrictMode>
      <Holder adopt={{ selection: selection(), token: "handed-on" }} />
    </StrictMode>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(releases()).toHaveLength(0);
  expect(screen.getByRole("status")).toHaveTextContent("handed-on");

  // The real unmount still gives it back.
  unmount();
  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0], "handed-on");
});

test("a closing tab gives the room back, and the unmount after it sends nothing", () => {
  const { unmount } = render(<Holder />);
  press("hold");

  pageHide(false);
  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0]);

  unmount();
  expect(releases()).toHaveLength(1);
});

test("a page put in the back/forward cache keeps its token", async () => {
  const { unmount } = render(<Holder />);
  press("hold");

  pageHide(true);
  expect(releases()).toHaveLength(0);

  unmount();
  await waitFor(() => expect(releases()).toHaveLength(1));
});

test("a broadcast about the held selection is an update", () => {
  render(<Holder />);
  press("hold");

  const next = selection({ updated_at: "2026-09-06T20:00:05.000Z" });
  broadcast(next);

  expect(onChanged).toHaveBeenCalledWith(next);
  expect(onLost).not.toHaveBeenCalled();
});

test("no selection at all is a loss by closing", () => {
  render(<Holder />);
  press("hold");

  broadcast(null);

  expect(onLost).toHaveBeenCalledWith("closed");
  // The component decides whether that was its own doing: the token stays.
  expect(screen.getByRole("status")).toHaveTextContent(TOKEN);
});

test("a selection opened at another time is a loss by replacement", () => {
  render(<Holder />);
  press("hold");

  broadcast(selection({ opened_at: "2026-09-06T20:05:00.000Z" }));

  expect(onLost).toHaveBeenCalledWith("replaced");
  expect(onChanged).not.toHaveBeenCalled();
});

test("without a token a broadcast is nobody's business", () => {
  render(<Holder />);

  broadcast(null);
  broadcast(selection());

  expect(onLost).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});

/**
 * A component that stays on the page across selections — the Random song
 * page's *Host screen*: it takes the room again with `begin`, and holds the
 * answer with the ticket that came with it.
 */
function Reopener() {
  const lock = useSelectionLock({ onLost, onChanged });
  const [, setPresses] = useState(0);
  const [ticket, setTicket] = useState<number | null>(null);
  const pressing = (action: () => void) => () => {
    action();
    setPresses((count) => count + 1);
  };
  return (
    <div>
      <output>{lock.token() ?? "none"}</output>
      <button type="button" onClick={pressing(() => setTicket(lock.begin()))}>
        begin
      </button>
      {/* Takes the room again but keeps the old ticket for `hold`: the
          answer to the earlier open, landing late. */}
      <button type="button" onClick={pressing(() => void lock.begin())}>
        begin again
      </button>
      <button
        type="button"
        onClick={pressing(() => lock.hold(OPENED, ticket ?? undefined))}
      >
        hold
      </button>
      <button type="button" onClick={pressing(() => void lock.close())}>
        close
      </button>
    </div>
  );
}

test("begin takes the room again after a close, and the answer is held", () => {
  render(<Reopener />);
  press("begin");
  press("hold");
  press("close");
  expect(releases()).toHaveLength(1);

  press("begin");
  press("hold");

  expect(screen.getByRole("status")).toHaveTextContent(TOKEN);
  expect(releases()).toHaveLength(1);
});

test("an answer to an open sent before the last close is given back, even after begin", () => {
  render(<Reopener />);
  // Sent with the first ticket, then the pills came back and the next SPIN
  // took the room again before the first answer landed.
  press("begin");
  press("close");
  press("begin again");
  press("hold");

  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0]);
  expect(screen.getByRole("status")).toHaveTextContent("none");
});

test("close settles once the room has answered the DELETE", async () => {
  let answer: () => void = () => {};
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
  );
  let closed = false;
  function Closer() {
    const lock = useSelectionLock({ onLost, onChanged });
    return (
      <button
        type="button"
        onClick={() => {
          lock.hold(OPENED);
          void lock.close().then(() => {
            closed = true;
          });
        }}
      >
        go
      </button>
    );
  }
  render(<Closer />);

  press("go");
  await act(async () => {});
  expect(closed).toBe(false);

  await act(async () => {
    answer();
  });
  expect(closed).toBe(true);
});

test("latest never steps back to an older selection", () => {
  const older = selection({ updated_at: "2026-09-06T20:00:01.000Z" });
  const newer = selection({ updated_at: "2026-09-06T20:00:02.000Z" });

  expect(latest(null, older)).toBe(older);
  expect(latest(older, newer)).toBe(newer);
  expect(latest(newer, older)).toBe(newer);
});
