import type { ButtonRead, ReaderRead } from "./api";
import {
  discoveredOrder,
  foundLabel,
  localhostSetupUrl,
  pressBaseline,
  pressedOrder,
  proposeActions,
  proposeRoles,
  serverAddress,
  SERVER_ADDRESS_LOCAL,
  SERVER_ADDRESS_SHAPE,
  serverAddressProblem,
} from "./deviceSetup";

function reader(index: number, uid: string | null = null): ReaderRead {
  return { index, state: "wired", role: "unused", uid };
}

function button(index: number, presses: number): ButtonRead {
  return { index, presses, action: "none" };
}

const COLORS = ["blue", "red", "green"];

test("the first pass counts whatever is already lying on the box", () => {
  const current = [reader(0, "AAAA"), reader(1), reader(2, "BBBB")];

  expect(discoveredOrder([], [], current)).toEqual([0, 2]);
});

test("a card that lands is appended, and one that was there is not", () => {
  const before = [reader(0, "AAAA"), reader(1), reader(2)];
  const after = [reader(0, "AAAA"), reader(1), reader(2, "CCCC")];

  expect(discoveredOrder([0], before, after)).toEqual([0, 2]);
});

test("a reader keeps its place when its card is taken off and put back", () => {
  const withCard = [reader(0, "AAAA"), reader(1, "BBBB")];
  const lifted = [reader(0, "AAAA"), reader(1)];
  const order = discoveredOrder([], [], withCard);

  expect(order).toEqual([0, 1]);
  expect(discoveredOrder(order, withCard, lifted)).toEqual([0, 1]);
  expect(discoveredOrder(order, lifted, withCard)).toEqual([0, 1]);
});

test("one reader is the layout where everybody scans in turn", () => {
  expect(proposeRoles([2], COLORS)).toEqual({ "2": "sequential" });
});

test("three readers take the three slots in the host's own order", () => {
  expect(proposeRoles([3, 0, 1], COLORS)).toEqual({
    "3": "slot:blue",
    "0": "slot:red",
    "1": "slot:green",
  });
});

test("readers past the last slot are left with nothing to do", () => {
  const roles = proposeRoles([0, 1, 2, 3, 4, 5, 6], COLORS);

  expect(roles).toEqual({
    "0": "slot:blue",
    "1": "slot:red",
    "2": "slot:green",
    "3": "unused",
    "4": "unused",
    "5": "unused",
    "6": "unused",
  });
});

test("nothing found proposes nothing", () => {
  expect(proposeRoles([], COLORS)).toEqual({});
});

test("a button is seen once its counter passes what it stood at", () => {
  const buttons = [button(0, 7), button(1, 0)];
  const baseline = pressBaseline(buttons);

  expect(baseline).toEqual({ "0": 7, "1": 0 });
  expect(pressedOrder([], baseline, buttons)).toEqual([]);
  expect(pressedOrder([], baseline, [button(0, 8), button(1, 0)])).toEqual([0]);
  expect(pressedOrder([0], baseline, [button(0, 9), button(1, 3)])).toEqual([
    0, 1,
  ]);
});

test("the first three buttons pressed start, clear and cancel", () => {
  expect(proposeActions([2, 0, 3, 1])).toEqual({
    "2": "start",
    "0": "clear",
    "3": "cancel",
    "1": "none",
  });
  expect(proposeActions([])).toEqual({});
});

test("where a reader came in the discovery is a word", () => {
  expect(foundLabel(0)).toBe("found first");
  expect(foundLabel(5)).toBe("found sixth");
  expect(foundLabel(6)).toBe("found 7");
});

test("the localhost address carries this page's own port", () => {
  expect(localhostSetupUrl("8080")).toBe(
    "http://localhost:8080/user/devices/new",
  );
  expect(localhostSetupUrl("5173")).toBe(
    "http://localhost:5173/user/devices/new",
  );
  // A page served on the default port has no port to name.
  expect(localhostSetupUrl("")).toBe("http://localhost/user/devices/new");
});

test("the device is given the address the phones use, never localhost", () => {
  expect(serverAddress("http://192.168.0.5:8080")).toBe(
    "http://192.168.0.5:8080",
  );
  expect(serverAddress("http://192.168.0.5:8080/?join=1")).toBe(
    "http://192.168.0.5:8080",
  );
  expect(serverAddress("http://localhost:8080")).toBe("");
  expect(serverAddress("http://127.0.0.1:8080")).toBe("");
  expect(serverAddress("http://[::1]:8080")).toBe("");
  expect(serverAddress("not a url")).toBe("");
  expect(serverAddress(null)).toBe("");
  expect(serverAddress(undefined)).toBe("");
});

test("an address only this browser understands is refused before it is sent", () => {
  expect(serverAddressProblem("http://192.168.0.5:8080")).toBeNull();
  expect(serverAddressProblem("https://party.example:443")).toBeNull();
  // Not yet typed is not yet wrong.
  expect(serverAddressProblem("  ")).toBeNull();

  expect(serverAddressProblem("http://localhost:8081")).toBe(
    SERVER_ADDRESS_LOCAL,
  );
  expect(serverAddressProblem("http://127.0.0.1:8080")).toBe(
    SERVER_ADDRESS_LOCAL,
  );
  expect(serverAddressProblem("http://[::1]:8080")).toBe(SERVER_ADDRESS_LOCAL);

  expect(serverAddressProblem("192.168.0.5:8080")).toBe(SERVER_ADDRESS_SHAPE);
  expect(serverAddressProblem("ftp://192.168.0.5")).toBe(SERVER_ADDRESS_SHAPE);
});
