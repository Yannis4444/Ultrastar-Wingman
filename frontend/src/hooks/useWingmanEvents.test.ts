import { renderHook } from "@testing-library/react";
import { FakeSocket } from "../test/fakeSocket";
import { useWingmanEvent, type WingmanEvent } from "./useWingmanEvents";

interface SettingChanged extends WingmanEvent {
  key: string;
  value: string;
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
