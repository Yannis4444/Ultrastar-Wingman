import { renderHook } from "@testing-library/react";
import { useWingmanEvent, type WingmanEvent } from "./useWingmanEvents";

interface SettingChanged extends WingmanEvent {
  key: string;
  value: string;
}

/** Stands in for the browser socket: the suite must never open a connection. */
class FakeSocket {
  static last: FakeSocket | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => vi.unstubAllGlobals());

test("a subscriber receives the whole flat backend message", () => {
  const received: SettingChanged[] = [];
  const { unmount } = renderHook(() =>
    useWingmanEvent<SettingChanged>("setting.changed", (message) =>
      received.push(message),
    ),
  );

  expect(FakeSocket.last?.url).toMatch(/\/api\/v1\/ws$/);
  FakeSocket.last?.onmessage?.(
    new MessageEvent("message", {
      data: '{"event":"setting.changed","key":"usdb.username","value":"bob"}',
    }),
  );
  // Not for this subscriber: must not be delivered.
  FakeSocket.last?.onmessage?.(
    new MessageEvent("message", { data: '{"event":"server.ready"}' }),
  );

  expect(received).toEqual([
    { event: "setting.changed", key: "usdb.username", value: "bob" },
  ]);

  unmount();
  expect(FakeSocket.last?.close).toHaveBeenCalled();
});
