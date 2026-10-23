import {
  type HostShortcut,
  hostShortcut,
  nudgedVolume,
  type ShortcutPress,
} from "./hostShortcuts";

const EVERY: ReadonlySet<HostShortcut> = new Set([
  "play-pause",
  "skip",
  "volume-up",
  "volume-down",
  "fullscreen",
]);

function press(key: string, overrides: Partial<ShortcutPress> = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: document.body,
    ...overrides,
  };
}

const open = { modalOpen: false, available: EVERY };

test("each key does its one thing, a shifted letter included", () => {
  expect(hostShortcut(press(" "), open)).toBe("play-pause");
  expect(hostShortcut(press("k"), open)).toBe("play-pause");
  expect(hostShortcut(press("K"), open)).toBe("play-pause");
  expect(hostShortcut(press("n"), open)).toBe("skip");
  expect(hostShortcut(press("N"), open)).toBe("skip");
  expect(hostShortcut(press("f"), open)).toBe("fullscreen");
  expect(hostShortcut(press("F"), open)).toBe("fullscreen");
  expect(hostShortcut(press("ArrowUp"), open)).toBe("volume-up");
  expect(hostShortcut(press("ArrowDown"), open)).toBe("volume-down");
});

test("every other key is nobody's, Esc above all", () => {
  for (const key of ["Escape", "Enter", "Tab", "ArrowLeft", "m", "p", "F11"])
    expect(hostShortcut(press(key), open)).toBeNull();
});

test("Ctrl, Alt and Meta leave the key to the browser and the system", () => {
  for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
    expect(hostShortcut(press("k", { [modifier]: true }), open)).toBeNull();
    expect(
      hostShortcut(press("ArrowUp", { [modifier]: true }), open),
    ).toBeNull();
  }
  // Shift is not one of them: Caps Lock and a shifted K are still K.
  expect(hostShortcut(press("K", { key: "K" }), open)).toBe("play-pause");
});

test("a key pressed in a control is that control's", () => {
  const owners = [
    "<input>",
    '<input type="range">',
    "<select></select>",
    "<textarea></textarea>",
    "<button>Stop</button>",
    '<a href="/host/manage">Manage</a>',
    '<div contenteditable="true">x</div>',
    '<div contenteditable="">x</div>',
  ];
  for (const html of owners) {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const element = host.firstElementChild as Element;
    expect(hostShortcut(press(" ", { target: element }), open)).toBeNull();
    expect(
      hostShortcut(press("ArrowUp", { target: element }), open),
    ).toBeNull();
    host.remove();
  }
});

test("an element that takes no keys passes them on, and so does one inside it", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<div contenteditable="false"><span>x</span></div><a>no href</a>';
  document.body.append(host);
  const span = host.querySelector("span") as Element;
  const anchor = host.querySelector("a") as Element;
  expect(hostShortcut(press("k", { target: span }), open)).toBe("play-pause");
  expect(hostShortcut(press("k", { target: anchor }), open)).toBe("play-pause");
  // A press with no element behind it at all, the window's own.
  expect(hostShortcut(press("k", { target: window }), open)).toBe("play-pause");
  host.remove();
});

test("an open dialog keeps every key", () => {
  for (const key of [" ", "k", "n", "f", "ArrowUp", "ArrowDown"])
    expect(
      hostShortcut(press(key), { modalOpen: true, available: EVERY }),
    ).toBeNull();
});

test("a key without its control does nothing", () => {
  const volumeOnly = {
    modalOpen: false,
    available: new Set<HostShortcut>(["volume-up", "volume-down"]),
  };
  expect(hostShortcut(press("k"), volumeOnly)).toBeNull();
  expect(hostShortcut(press(" "), volumeOnly)).toBeNull();
  expect(hostShortcut(press("n"), volumeOnly)).toBeNull();
  expect(hostShortcut(press("f"), volumeOnly)).toBeNull();
  expect(hostShortcut(press("ArrowUp"), volumeOnly)).toBe("volume-up");

  const nothing = { modalOpen: false, available: new Set<HostShortcut>() };
  expect(hostShortcut(press("ArrowDown"), nothing)).toBeNull();
});

test("a held arrow repeats, a held letter or Space does not", () => {
  expect(hostShortcut(press("ArrowUp", { repeat: true }), open)).toBe(
    "volume-up",
  );
  expect(hostShortcut(press("ArrowDown", { repeat: true }), open)).toBe(
    "volume-down",
  );
  for (const key of [" ", "k", "n", "f"])
    expect(hostShortcut(press(key, { repeat: true }), open)).toBeNull();
});

test("a key that is still being composed is the input method's", () => {
  expect(hostShortcut(press("k", { isComposing: true }), open)).toBeNull();
});

test("the volume moves by five and stays inside 0 to 100", () => {
  expect(nudgedVolume(80, "volume-up")).toBe(85);
  expect(nudgedVolume(80, "volume-down")).toBe(75);
  expect(nudgedVolume(97, "volume-up")).toBe(100);
  expect(nudgedVolume(100, "volume-up")).toBe(100);
  expect(nudgedVolume(3, "volume-down")).toBe(0);
  expect(nudgedVolume(40, "skip")).toBe(40);
});
