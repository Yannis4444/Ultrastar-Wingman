import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ScoreWithContext } from "../api";
import { coverUrl } from "../shareCard/content";
import { LOGO_URL, type CardRequest } from "../shareCard/draw";
import { TOGGLES_REST } from "../shareCard/possible";
import { PREFS_KEY } from "../shareCard/prefs";
import { meResponse, userRead } from "../test/auth";
import { iconNames } from "../test/icons";
import {
  SONGS,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
} from "../test/shareCard";
import ShareCardPanel, {
  LONG_PRESS_NOTE,
  SETTLE_MS,
  type ShareTarget,
} from "./ShareCardPanel";

const { getMe, listSongScores, renderCard, loadCardImages } = vi.hoisted(
  () => ({
    getMe: vi.fn(),
    listSongScores: vi.fn(),
    renderCard: vi.fn(),
    loadCardImages: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSongScores,
}));

// The canvas is part 1's and tested there; here the picture is any PNG.
vi.mock("../shareCard/draw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shareCard/draw")>()),
  renderCard,
}));

// jsdom loads no picture at all: the URLs a test names as broken are the ones
// that "failed", every other one arrived.
vi.mock("../shareCard/images", () => ({ loadCardImages }));

let broken = new Set<string>();
let created: string[] = [];
let revoked: string[] = [];

function defineOn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
  });
}

/** A browser that may share and copy files — a secure context. */
function shareableBrowser(share = vi.fn(() => Promise.resolve())) {
  defineOn(navigator, "canShare", () => true);
  defineOn(navigator, "share", share);
  return share;
}

function copyableBrowser(write = vi.fn(() => Promise.resolve())) {
  vi.stubGlobal(
    "ClipboardItem",
    class {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    },
  );
  defineOn(navigator, "clipboard", { write });
  return write;
}

/** The media the page matches: a touch screen, and less motion. */
function media({
  coarse = false,
  reducedMotion = false,
}: { coarse?: boolean; reducedMotion?: boolean } = {}): void {
  defineOn(window, "matchMedia", (query: string) => ({
    matches:
      (coarse && query.includes("coarse")) ||
      (reducedMotion && query.includes("reduced-motion")),
    media: query,
  }));
}

function touchScreen(coarse: boolean): void {
  media({ coarse });
}

beforeEach(() => {
  broken = new Set();
  created = [];
  revoked = [];
  getMe.mockReset();
  listSongScores.mockReset();
  renderCard.mockReset();
  loadCardImages.mockReset();
  getMe.mockResolvedValue(
    meResponse(["stats.view"], {
      user: userRead({ player_id: "chiara", username: "Chiara" }),
      role: "user",
    }),
  );
  renderCard.mockImplementation(() =>
    Promise.resolve(new Blob(["png"], { type: "image/png" })),
  );
  loadCardImages.mockImplementation((urls: string[]) =>
    Promise.resolve(
      new Map(
        urls
          .filter((url) => !broken.has(url))
          .map((url) => [url, {} as HTMLImageElement]),
      ),
    ),
  );
  let next = 0;
  defineOn(URL, "createObjectURL", () => {
    const url = `blob:card-${++next}`;
    created.push(url);
    return url;
  });
  defineOn(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  defineOn(window, "isSecureContext", true);
  touchScreen(false);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const key of ["canShare", "share", "clipboard"])
    delete (navigator as unknown as Record<string, unknown>)[key];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo;
});

function renderPanel(target: ShareTarget, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ShareCardPanel
        target={target}
        players={cardPlayers()}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

/** Four singers, two scores each: every party slide can be drawn. Chiara,
 * the reader, is the best of them. */
const party = cardParty(4, 2);

function partyTarget(scores: ScoreWithContext[] = party): ShareTarget {
  return { kind: "party", session: partySession(), scores };
}

function scoreTarget(
  score: ScoreWithContext,
  pageScores: ScoreWithContext[] = [score],
): ShareTarget {
  return { kind: "score", score, session: partySession(), pageScores };
}

/** A score of somebody else's, so every toggle reaches the card. */
const theirs = () => cardScore("alice", 8662, SONGS[0]);

/** The request of the latest drawing. */
function lastRequest(): CardRequest {
  const calls = renderCard.mock.calls;
  return calls[calls.length - 1][0] as CardRequest;
}

/** Every request drawn so far, in order. */
function requests(): CardRequest[] {
  return renderCard.mock.calls.map((call) => call[0] as CardRequest);
}

/** Which slide a request was drawn for. */
function designOf(request: CardRequest): string {
  if (request.kind === "score") return request.options.look;
  if (request.content.onlyMe) return "you";
  if (request.options.focus === "spread") return "spread";
  if (request.options.look === "mosaic") return "mosaic";
  return request.options.under === "strip" ? "strip" : "podium";
}

function carousel(): HTMLElement {
  return screen.getByRole("region", { name: "Designs" });
}

/** The slide in view. */
function inView(): HTMLElement {
  const slide = document.querySelector<HTMLElement>(
    '.share-slide[aria-current="true"]',
  );
  if (slide === null) throw new Error("no slide in view");
  return slide;
}

/** The name under the dots, which is the slide in view's. */
function designName(): string {
  return document.querySelector(".share-design-name")?.textContent ?? "";
}

/** The picture in view, if it is drawn. */
function shown(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>(
    '.share-slide[aria-current="true"] img',
  );
}

/** The picture in view, once its first drawing is in. */
async function preview(): Promise<HTMLImageElement> {
  return waitFor(() => {
    const image = shown();
    if (image === null) throw new Error("not drawn yet");
    return image;
  });
}

/** The buttons' row, in the order it draws them. */
function actions(): string[] {
  const row = document.querySelector(".share-actions") as HTMLElement;
  return [...row.children].map((child) => child.textContent ?? "");
}

function primary(): string | null {
  return (
    document.querySelector(".share-actions .button-primary")?.textContent ??
    null
  );
}

function nextDesign(): HTMLElement {
  return screen.getByRole("button", { name: "Next design" });
}

function previousDesign(): HTMLElement {
  return screen.getByRole("button", { name: "Previous design" });
}

/** Moves on `times` slides with the arrow. */
function forward(times: number): void {
  for (let i = 0; i < times; i++) fireEvent.click(nextDesign());
}

/** The dots, as `[in view, dimmed]`. */
function dots(): [boolean, boolean][] {
  return [...document.querySelectorAll(".share-dot")].map((dot) => [
    dot.classList.contains("share-dot-on"),
    dot.classList.contains("share-dot-dimmed"),
  ]);
}

/** The slides, by the names they are read out with. */
function slideNames(): string[] {
  return within(carousel())
    .getAllByRole("group")
    .map((slide) => slide.getAttribute("aria-label") ?? "");
}

function stored(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Record<
    string,
    unknown
  >;
}

/** The three toggles, as `[name, pressed, dimmed]`, in the row's order. */
function toggles(): [string, boolean, boolean][] {
  const row = screen.getByRole("group", { name: "On the card" });
  return within(row)
    .getAllByRole("button")
    .map((button) => [
      button.getAttribute("aria-label") ?? "",
      button.getAttribute("aria-pressed") === "true",
      button.getAttribute("aria-disabled") === "true",
    ]);
}

function toggle(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The line under the toggles. */
function line(): string {
  return document.querySelector(".share-toggle-line")?.textContent ?? "";
}

/** A pointer coming over an element. jsdom has no `PointerEvent`, so the
 * `pointerType` React reads is put on the event by hand. */
function pointerOver(element: Element, pointerType: string): void {
  const event = new MouseEvent("pointerover", { bubbles: true });
  defineOn(event, "pointerType", pointerType);
  fireEvent(element, event);
}

/**
 * Lays the carousel out the way a browser would — jsdom has no layout and no
 * scroll-snap — so the scroll position can be read: a 300px row, slides 252
 * wide and 8 apart behind a 16px spacer, and a `scrollTo` that moves the row
 * at once and says so the way the browser does, with a scroll event.
 */
function layOut(): { scrollTo: ReturnType<typeof vi.fn> } {
  const row = carousel();
  defineOn(row, "clientWidth", 300);
  defineOn(row, "scrollLeft", 0);
  row.querySelectorAll<HTMLElement>(".share-slide").forEach((slide, i) => {
    defineOn(slide, "offsetLeft", 24 + i * 260);
    defineOn(slide, "offsetWidth", 252);
  });
  const scrollTo = vi.fn(function (
    this: HTMLElement,
    options: ScrollToOptions,
  ) {
    defineOn(this, "scrollLeft", options.left ?? 0);
    fireEvent.scroll(this);
  });
  defineOn(row, "scrollTo", scrollTo);
  return { scrollTo };
}

/** A finger leaving the row at `left`: a scroll, then nothing for a while. */
function swipeTo(left: number): void {
  const row = carousel();
  defineOn(row, "scrollLeft", left);
  fireEvent.scroll(row);
}

// ---------------------------------------------------------------- the panel

test("the panel is the bare blurred modal, named for a party and with no heading, the close alone", async () => {
  const { onClose } = renderPanel(partyTarget());
  const dialog = screen.getByRole("dialog", { name: "Share this party" });
  expect(dialog).toHaveClass("modal-bare");
  expect(dialog.parentElement).toHaveClass("modal-backdrop-blur");
  // The name is the dialog's alone: nothing on screen heads the panel.
  expect(within(dialog).queryByRole("heading")).toBeNull();
  expect(within(dialog).queryByText("Share this party")).toBeNull();
  // The first drawing is a wait, and the wait is the app's one indicator.
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  const image = await preview();
  expect(image).toHaveAttribute("src", "blob:card-1");
  expect(image).toHaveAccessibleName(
    "Share card of Friday karaoke, ranked by best score",
  );
  expect(requests()[0].kind).toBe("party");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a score's panel is named for a score and draws that one score", async () => {
  renderPanel(scoreTarget(theirs()));
  expect(
    screen.getByRole("dialog", { name: "Share this score" }),
  ).toBeInTheDocument();
  expect(await preview()).toHaveAccessibleName(
    "Share card: Alice scored 8662 on Bohemian Rhapsody",
  );
  // No list of scores to choose from: the card is there at once.
  expect(document.querySelector(".score-entry")).toBeNull();
});

test("on plain http there is Save image alone, and it is the primary", async () => {
  renderPanel(partyTarget());
  await preview();
  expect(actions()).toEqual(["Save image"]);
  expect(primary()).toBe("Save image");
  const save = screen.getByRole("link", { name: "Save image" });
  expect(save).toHaveAttribute("download", "wingman-friday-karaoke.png");
  expect(save).toHaveAttribute("href", "blob:card-1");
});

test("where the browser shares files, Share is the primary beside Copy and Save", async () => {
  shareableBrowser();
  copyableBrowser();
  renderPanel(partyTarget());
  await preview();
  expect(actions()).toEqual(["Copy image", "Save image", "Share"]);
  expect(primary()).toBe("Share");
});

test("a browser that shares but refuses this file draws no Share", async () => {
  defineOn(navigator, "canShare", () => false);
  defineOn(navigator, "share", vi.fn());
  renderPanel(partyTarget());
  await preview();
  expect(actions()).toEqual(["Save image"]);
});

test("Share hands the system the file alone, no title and no text", async () => {
  const share = shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(share).toHaveBeenCalledTimes(1);
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(Object.keys(data)).toEqual(["files"]);
  expect(data.files?.[0].name).toBe("wingman-friday-karaoke.png");
  expect(data.files?.[0].type).toBe("image/png");
});

test("closing the share sheet is no failure: nothing follows", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
  shareableBrowser(
    vi.fn(() => Promise.reject(new DOMException("closed", "AbortError"))),
  );
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(navigator.share).toHaveBeenCalled());
  await Promise.resolve();
  expect(click).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.querySelector(".share-status")).toBeNull();
  click.mockRestore();
});

test("a refused share falls back to saving the picture, and says so", async () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  shareableBrowser(
    vi.fn(() => Promise.reject(new DOMException("no", "NotAllowedError"))),
  );
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(
    await screen.findByText(
      "This browser would not share the picture, so it was saved instead.",
    ),
  ).toBeInTheDocument();
  expect(click).toHaveBeenCalledTimes(1);
  expect(click.mock.contexts[0]).toHaveAttribute("download");
  click.mockRestore();
});

test("Copy image puts the PNG on the clipboard", async () => {
  const write = copyableBrowser();
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
  expect(
    await screen.findByText("Copied. Paste it into a chat."),
  ).toBeInTheDocument();
  const [items] = write.mock.calls[0] as unknown as [
    { items: Record<string, Blob> }[],
  ];
  expect(Object.keys(items[0].items)).toEqual(["image/png"]);
});

test("Copy image copies the slide in view, never another slide's picture", async () => {
  const write = copyableBrowser();
  // Each design's file says which design it is, in its size: jsdom's blobs
  // cannot be read back.
  const sizes: Record<string, number> = {
    podium: 1,
    strip: 2,
    mosaic: 3,
    spread: 4,
    you: 5,
  };
  renderCard.mockImplementation((request: CardRequest) =>
    Promise.resolve(
      new Blob(["x".repeat(sizes[designOf(request)])], { type: "image/png" }),
    ),
  );
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Strip");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy image" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const [items] = write.mock.calls[0] as unknown as [
    { items: Record<string, Blob> }[],
  ];
  expect(items[0].items["image/png"].size).toBe(sizes.strip);
});

test("a touch screen on plain http reads the long-press hint above the picture, from the start", async () => {
  defineOn(window, "isSecureContext", false);
  touchScreen(true);
  renderPanel(partyTarget());
  // There while the first picture is still on its way, so nothing moves
  // under it when the picture comes.
  const hint = screen.getByText(LONG_PRESS_NOTE);
  expect(hint).toHaveClass("section-note");
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  await preview();
  expect(
    hint.compareDocumentPosition(carousel()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText(LONG_PRESS_NOTE)).toBe(hint);
});

test("a mouse, or a secure page, needs no long-press hint", async () => {
  defineOn(window, "isSecureContext", false);
  renderPanel(partyTarget());
  await preview();
  expect(screen.queryByText(LONG_PRESS_NOTE)).toBeNull();
  cleanup();
  defineOn(window, "isSecureContext", true);
  touchScreen(true);
  renderPanel(partyTarget());
  await preview();
  expect(screen.queryByText(LONG_PRESS_NOTE)).toBeNull();
});

// ---------------------------------------------------------------- designs

test("a party's designs are a carousel of Podium, Strip, Mosaic, Spread and You, in that order", async () => {
  renderPanel(partyTarget());
  await preview();
  const row = carousel();
  expect(row).toHaveAttribute("aria-roledescription", "carousel");
  expect(row).toHaveAttribute("tabindex", "0");
  expect(slideNames()).toEqual([
    "Podium, 1 of 5",
    "Strip, 2 of 5",
    "Mosaic, 3 of 5",
    "Spread, 4 of 5",
    "You, 5 of 5",
  ]);
  for (const slide of within(row).getAllByRole("group"))
    expect(slide).toHaveAttribute("aria-roledescription", "slide");
  // Opened on Podium, the default: its name under the dots, its dot lit.
  expect(designName()).toBe("Podium");
  expect(inView()).toHaveAttribute("data-design", "podium");
  expect(dots()).toEqual([
    [true, false],
    [false, false],
    [false, false],
    [false, false],
    [false, false],
  ]);
  expect(document.querySelector(".share-dots")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  // The slide in view and its neighbour are drawn, the one in view first;
  // the rest are not.
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  expect(requests().map(designOf)).toEqual(["podium", "strip"]);
});

test("Podium draws ranks 4 to 6 under the podium, Strip the score strip, in both formats", async () => {
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  const [podium, strip] = requests();
  expect(podium.options).toMatchObject({
    look: "dark",
    focus: "podium",
    under: "ranking",
  });
  expect(strip.options).toMatchObject({
    look: "dark",
    focus: "podium",
    under: "strip",
  });
  // On a story too: the layout draws the rows on both and the strip on
  // Strip (share-cards §4.2).
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(4));
  expect(
    requests()
      .slice(2)
      .map((request) => request.options),
  ).toEqual([
    expect.objectContaining({ format: "story", under: "ranking" }),
    expect.objectContaining({ format: "story", under: "strip" }),
  ]);
});

test("three singers' Podium is the podium alone, never the strip in its place", async () => {
  renderPanel(partyTarget(cardParty(3, 2)));
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  expect(requests().map((request) => request.options)).toEqual([
    expect.objectContaining({ under: "none" }),
    expect.objectContaining({ under: "strip" }),
  ]);
});

test("You is the sharer alone, with their own place", async () => {
  renderPanel(partyTarget());
  await preview();
  forward(4);
  expect(designName()).toBe("You");
  await waitFor(() => expect(requests().map(designOf)).toContain("you"));
  const request = requests().find((drawn) => designOf(drawn) === "you");
  if (request?.kind !== "party") throw new Error("not a party card");
  expect(request.content.ranking.map((entry) => entry.person.name)).toEqual([
    "Chiara",
  ]);
  expect(request.content.myPlace).toBe("1st of 4");
  expect(request.options).toMatchObject({ look: "dark", focus: "podium" });
  expect(await preview()).toHaveAccessibleName(
    "Share card of Friday karaoke: Chiara's scores",
  );
});

test("somebody who did not sing at the party has a dimmed You slot, with why", async () => {
  getMe.mockResolvedValue(meResponse(["stats.view"]));
  renderPanel(partyTarget());
  await preview();
  const you = within(carousel()).getByRole("group", { name: "You, 5 of 5" });
  expect(you.querySelector(".share-slide-dimmed")).not.toBeNull();
  expect(
    within(you).getByText("You did not sing at this party."),
  ).toBeInTheDocument();
});

test("a score's designs are Dark and Cover", async () => {
  renderPanel(scoreTarget(theirs()));
  await preview();
  expect(slideNames()).toEqual(["Dark, 1 of 2", "Cover, 2 of 2"]);
  expect(dots()).toHaveLength(2);
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  expect(requests().map(designOf)).toEqual(["dark", "cover"]);
});

// ----------------------------------------------------------------- format

test("the format is two borderless radios at the end of the dots row, after a rule", async () => {
  renderPanel(partyTarget());
  await preview();
  const group = screen.getByRole("radiogroup", { name: "Format" });
  const square = within(group).getByRole("radio", { name: "Square" });
  const story = within(group).getByRole("radio", { name: "Story" });
  expect(square).toBeChecked();
  expect(story).not.toBeChecked();
  // The glyph is what is drawn; the word is the reader's alone.
  expect(iconNames(square.closest("label") as HTMLElement)).toEqual([
    "format-square",
  ]);
  expect(iconNames(story.closest("label") as HTMLElement)).toEqual([
    "format-story",
  ]);
  expect(
    within(story.closest("label") as HTMLElement).getByText("Story"),
  ).toHaveClass("visually-hidden");
  // No chip box or pill: a bare glyph.
  expect(group.querySelector(".chip, .share-pill-text")).toBeNull();
  // In the dots row, to the right of the dots and the next arrow, after the
  // rule — and so under the picture, not over it.
  const nav = document.querySelector(".share-carousel-nav") as HTMLElement;
  expect(group.parentElement).toBe(nav);
  const order = [...nav.children].map((child) =>
    child.classList.contains("share-dots")
      ? "dots"
      : child.classList.contains("share-nav-rule")
        ? "rule"
        : child === group
          ? "format"
          : (child.getAttribute("aria-label") ?? ""),
  );
  expect(order).toEqual([
    "Previous design",
    "dots",
    "Next design",
    "rule",
    "format",
  ]);
  expect(
    carousel().compareDocumentPosition(group) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.click(story);
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ format: "story" }),
  );
  expect(story).toBeChecked();
  expect(document.querySelector(".share-slide-box-story")).not.toBeNull();
});

// --------------------------------------------------------------- carousel

test("Next and Previous move the slide in view, and it is what the buttons send", async () => {
  const share = shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  expect(previousDesign()).toBeDisabled();
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Strip");
  expect(inView()).toHaveAttribute("data-design", "strip");
  expect(dots().map(([on]) => on)).toEqual([false, true, false, false, false]);
  // Strip was drawn as the neighbour already; Mosaic is its neighbour now,
  // and is drawn.
  await waitFor(() =>
    expect(requests().map(designOf)).toEqual(["podium", "strip", "mosaic"]),
  );
  const strip = await preview();
  expect(strip).toHaveAttribute("src", "blob:card-2");
  expect(screen.getByRole("link", { name: "Save image" })).toHaveAttribute(
    "href",
    "blob:card-2",
  );
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(data.files?.[0]).toBeInstanceOf(File);

  forward(3);
  expect(designName()).toBe("You");
  expect(nextDesign()).toBeDisabled();
  await preview();
  for (let i = 0; i < 4; i++) fireEvent.click(previousDesign());
  expect(designName()).toBe("Podium");
  expect(previousDesign()).toBeDisabled();
  // Every slide was drawn once: going back draws nothing again.
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(5));
  expect(new Set(requests().map(designOf)).size).toBe(5);
});

test("an arrow that reaches its end hands the keyboard to the other one", async () => {
  renderPanel(scoreTarget(theirs()));
  await preview();
  nextDesign().focus();
  fireEvent.click(nextDesign());
  expect(nextDesign()).toBeDisabled();
  expect(previousDesign()).toHaveFocus();
  fireEvent.click(previousDesign());
  expect(nextDesign()).toHaveFocus();
});

test("the arrow keys on the carousel move it, and the row does not scroll by itself", async () => {
  renderPanel(partyTarget());
  await preview();
  const row = carousel();
  // `fireEvent` answers false when the default was prevented.
  expect(fireEvent.keyDown(row, { key: "ArrowRight" })).toBe(false);
  expect(designName()).toBe("Strip");
  fireEvent.keyDown(row, { key: "ArrowRight" });
  expect(designName()).toBe("Mosaic");
  fireEvent.keyDown(row, { key: "ArrowLeft" });
  expect(designName()).toBe("Strip");
  // Any other key is the row's own.
  expect(fireEvent.keyDown(row, { key: "Tab" })).toBe(true);
});

test("the arrows scroll the row smoothly, and at once for less motion", async () => {
  renderPanel(partyTarget());
  await preview();
  const { scrollTo } = layOut();
  fireEvent.click(nextDesign());
  // Strip's middle (24 + 260 + 126) in the row's middle (150).
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 260, behavior: "smooth" });

  media({ reducedMotion: true });
  fireEvent.keyDown(carousel(), { key: "ArrowRight" });
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 520, behavior: "instant" });
});

test("the other format narrows the slides to the story's picture and keeps the one in view in the middle", async () => {
  renderPanel(partyTarget());
  await preview();
  expect(carousel()).toHaveClass("share-carousel-square");
  const { scrollTo } = layOut();
  fireEvent.click(nextDesign());
  scrollTo.mockClear();
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  // A story slide is as wide as its picture, so a neighbour peeks in.
  expect(carousel()).toHaveClass("share-carousel-story");
  expect(carousel()).not.toHaveClass("share-carousel-square");
  // Every slide changed width under the scroll position: Strip is brought
  // back to the middle at once, before the paint, not run to.
  expect(scrollTo).toHaveBeenCalledWith({ left: 260, behavior: "instant" });
  expect(designName()).toBe("Strip");
});

test("a swipe settles on the slide nearest the middle, and that slide is the choice", async () => {
  renderPanel(partyTarget());
  await preview();
  layOut();
  // Not yet: the row is still moving.
  swipeTo(240);
  expect(designName()).toBe("Podium");
  await waitFor(() => expect(designName()).toBe("Strip"), {
    timeout: SETTLE_MS * 10,
  });
  expect(stored()).toEqual(expect.objectContaining({ partyDesign: "strip" }));
  // Past the middle of the next gap is Mosaic.
  swipeTo(470);
  await waitFor(() => expect(designName()).toBe("Mosaic"), {
    timeout: SETTLE_MS * 10,
  });
  expect(await preview()).toHaveAttribute("src", "blob:card-3");
});

test("a design the card cannot draw is a dimmed slot with its sentence, and the buttons hold still there", async () => {
  // Two of the six covers arrive: no Mosaic.
  for (const song of SONGS.slice(2)) broken.add(coverUrl(song.id));
  shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  const mosaic = within(carousel()).getByRole("group", {
    name: "Mosaic, 3 of 5",
  });
  expect(mosaic.querySelector("img")).toBeNull();
  expect(within(mosaic).getByText("Mosaic")).toBeInTheDocument();
  expect(
    within(mosaic).getByText(
      "Mosaic needs four different covers, and this party has 2.",
    ),
  ).toBeInTheDocument();
  expect(mosaic.querySelector(".share-slide-dimmed")).not.toBeNull();
  expect(dots()).toEqual([
    [true, false],
    [false, false],
    [false, true],
    [false, false],
    [false, false],
  ]);
  // The slot's reason is in the slot, never in the toggles' line.
  expect(line()).toBe(TOGGLES_REST);

  forward(2);
  expect(designName()).toBe("Mosaic");
  // Its neighbours are drawn; the slot itself never is.
  await waitFor(() =>
    expect(requests().map(designOf)).toEqual(["podium", "strip", "spread"]),
  );
  const shareButton = screen.getByRole("button", { name: "Share" });
  const save = screen.getByRole("link", { name: "Save image" });
  expect(shareButton).toBeDisabled();
  expect(save).toHaveAttribute("aria-disabled", "true");
  expect(fireEvent.click(save)).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  // A dimmed slot is no choice to remember.
  expect(stored().partyDesign).toBe("strip");

  fireEvent.click(previousDesign());
  expect(shareButton).toBeEnabled();
  expect(save).not.toHaveAttribute("aria-disabled");
});

test("a song without a cover has a dimmed Cover slot, and says why", async () => {
  broken.add(coverUrl(SONGS[0].id));
  renderPanel(scoreTarget(theirs()));
  await preview();
  const cover = within(carousel()).getByRole("group", {
    name: "Cover, 2 of 2",
  });
  expect(
    within(cover).getByText("This song has no cover, so the card stays dark."),
  ).toBeInTheDocument();
  expect(cover.querySelector("img")).toBeNull();
});

// ---------------------------------------------------------------- toggles

test("the same three toggles stand in the same order on every slide of both cards", async () => {
  const names = [
    "Other singers' pictures",
    "Party name and date",
    "Wingman logo",
  ];
  renderPanel(partyTarget());
  await preview();
  for (let i = 0; i < 5; i++) {
    expect(toggles().map(([name]) => name)).toEqual(names);
    if (i < 4) fireEvent.click(nextDesign());
  }
  const row = screen.getByRole("group", { name: "On the card" });
  const buttons = within(row).getAllByRole("button");
  for (const button of buttons) {
    expect(button).toHaveClass("icon-button", "icon-toggle");
    // Named for the option, never for the action.
    expect(button).toHaveAttribute("title", button.getAttribute("aria-label"));
  }
  expect(iconNames(buttons[0])).toEqual(["image"]);
  expect(iconNames(buttons[1])).toEqual(["calendar"]);
  // The logo toggle's glyph is the logo itself.
  expect(buttons[2].querySelector("img")).toHaveAttribute("src", LOGO_URL);
  // No checkbox is left of the old list, and no *Only me* or *Under the
  // podium* among the options.
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(/Only me|Under the podium/)).toBeNull();

  cleanup();
  renderPanel(scoreTarget(theirs()));
  await preview();
  expect(toggles().map(([name]) => name)).toEqual(names);
  fireEvent.click(nextDesign());
  expect(toggles().map(([name]) => name)).toEqual(names);
});

test("a toggle pressed off is struck through, and the card is drawn without it", async () => {
  renderPanel(partyTarget());
  await preview();
  expect(toggles()).toEqual([
    ["Other singers' pictures", true, false],
    ["Party name and date", true, false],
    ["Wingman logo", true, false],
  ]);
  expect(lastRequest().options.logo).toBe(true);
  fireEvent.click(toggle("Wingman logo"));
  expect(toggle("Wingman logo")).toHaveAttribute("aria-pressed", "false");
  await waitFor(() => expect(lastRequest().options.logo).toBe(false));
  expect(stored()).toEqual(expect.objectContaining({ logo: false }));

  fireEvent.click(toggle("Party name and date"));
  await waitFor(() => {
    const request = lastRequest();
    expect(request.kind === "party" && request.content.head).toBeNull();
  });
  fireEvent.click(toggle("Other singers' pictures"));
  await waitFor(() => {
    const request = lastRequest();
    expect(
      request.kind === "party" &&
        request.content.ranking
          .filter((entry) => !entry.isMe)
          .every((entry) => entry.person.avatar.url === null),
    ).toBe(true);
  });
  expect(toggles().map(([, pressed]) => pressed)).toEqual([
    false,
    false,
    false,
  ]);

  // Remembered, on the other card kind too.
  cleanup();
  renderPanel(scoreTarget(theirs()));
  await preview();
  expect(toggle("Wingman logo")).toHaveAttribute("aria-pressed", "false");
  expect(lastRequest()).toMatchObject({
    kind: "score",
    options: { logo: false },
  });
});

test("a toggle a slide cannot honour is dimmed in place and keeps the state the other slides use", async () => {
  renderPanel(partyTarget());
  await preview();
  // Pictures off on the Podium…
  fireEvent.click(toggle("Other singers' pictures"));
  expect(toggles()[0]).toEqual(["Other singers' pictures", false, false]);
  // …and on You, where the only face is the reader's own, it is dimmed —
  // still drawn off, still there, still focusable.
  forward(4);
  expect(designName()).toBe("You");
  expect(toggles()[0]).toEqual(["Other singers' pictures", false, true]);
  const pictures = toggle("Other singers' pictures");
  expect(pictures).not.toBeDisabled();
  act(() => pictures.focus());
  expect(pictures).toHaveFocus();
  expect(line()).toBe("Nobody else is on this card.");
  // A press changes nothing, and says why.
  fireEvent.click(pictures);
  expect(toggles()[0]).toEqual(["Other singers' pictures", false, true]);
  expect(stored().otherPictures).toBe(false);
  expect(line()).toBe("Nobody else is on this card.");
  // The others stay live there.
  expect(toggles()[1][2]).toBe(false);
  expect(toggles()[2][2]).toBe(false);
  // Back on the Podium the state the reader left is what is drawn.
  for (let i = 0; i < 4; i++) fireEvent.click(previousDesign());
  expect(toggles()[0]).toEqual(["Other singers' pictures", false, false]);
});

test("on the reader's own score the pictures toggle is dimmed, on somebody else's it is live", async () => {
  renderPanel(scoreTarget(cardScore("chiara", 8662, SONGS[0])));
  await preview();
  expect(toggles()[0]).toEqual(["Other singers' pictures", true, true]);
  cleanup();
  renderPanel(scoreTarget(theirs()));
  await preview();
  expect(toggles()[0]).toEqual(["Other singers' pictures", true, false]);
});

test("the line rests on its hint, and a mouse over a toggle reads that toggle's sentence", async () => {
  renderPanel(partyTarget());
  await preview();
  const note = document.querySelector(".share-toggle-line") as HTMLElement;
  expect(note).toHaveClass("section-note");
  expect(note).toHaveAttribute("aria-live", "polite");
  expect(line()).toBe("Press a symbol to take it off the card or put it back.");
  // A finger's emulated hover is not a second trigger.
  pointerOver(toggle("Wingman logo"), "touch");
  expect(line()).toBe(TOGGLES_REST);
  pointerOver(toggle("Wingman logo"), "mouse");
  expect(line()).toBe("The Wingman logo is on the card.");
  pointerOver(toggle("Party name and date"), "mouse");
  expect(line()).toBe("The party's name and date are on the card.");
  // The pointer leaving never puts the resting line back.
  fireEvent.pointerLeave(toggle("Party name and date"));
  expect(line()).toBe("The party's name and date are on the card.");
  // The keyboard reaches it the same way.
  act(() => toggle("Other singers' pictures").focus());
  expect(line()).toBe("Other singers' pictures are on the card.");
});

test("on a touch screen a tap changes the option and explains it, and a second tap undoes it", async () => {
  touchScreen(true);
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(toggle("Wingman logo"));
  expect(toggle("Wingman logo")).toHaveAttribute("aria-pressed", "false");
  expect(line()).toBe("The Wingman logo is left off.");
  await waitFor(() => expect(lastRequest().options.logo).toBe(false));
  fireEvent.click(toggle("Wingman logo"));
  expect(toggle("Wingman logo")).toHaveAttribute("aria-pressed", "true");
  expect(line()).toBe("The Wingman logo is on the card.");
  fireEvent.click(toggle("Other singers' pictures"));
  expect(line()).toBe("Other singers are drawn as their initials.");
});

test("a new slide coming into view re-reads the last toggle's sentence for itself", async () => {
  renderPanel(partyTarget());
  await preview();
  pointerOver(toggle("Other singers' pictures"), "mouse");
  expect(line()).toBe("Other singers' pictures are on the card.");
  // The spread draws no faces: there the same toggle says why, untouched.
  forward(3);
  expect(designName()).toBe("Spread");
  expect(toggles()[0][2]).toBe(true);
  expect(line()).toBe("The spread draws names, not pictures.");
  fireEvent.click(nextDesign());
  expect(line()).toBe("Nobody else is on this card.");
  for (let i = 0; i < 4; i++) fireEvent.click(previousDesign());
  expect(line()).toBe("Other singers' pictures are on the card.");
});

test("with the name and date off the file and the alt text still name the party", async () => {
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  fireEvent.click(toggle("Party name and date"));
  await waitFor(() => {
    const request = lastRequest();
    expect(request.kind === "party" && request.content.head).toBeNull();
  });
  // Drawn again, the slide in view first.
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Save image" })).toHaveAttribute(
      "href",
      "blob:card-3",
    ),
  );
  expect(screen.getByRole("link", { name: "Save image" })).toHaveAttribute(
    "download",
    "wingman-friday-karaoke.png",
  );
  expect(shown()).toHaveAccessibleName(
    "Share card of Friday karaoke, ranked by best score",
  );
});

// --------------------------------------------------------------- memory

test("the panel remembers the format, the design in view and the toggles, but never Spread or You", async () => {
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  forward(2);
  fireEvent.click(toggle("Other singers' pictures"));
  expect(stored()).toEqual(
    expect.objectContaining({
      format: "story",
      partyDesign: "mosaic",
      otherPictures: false,
    }),
  );
  // Spread and You are not kept: Mosaic stays the one remembered.
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Spread");
  expect(stored().partyDesign).toBe("mosaic");
  fireEvent.click(nextDesign());
  expect(designName()).toBe("You");
  await preview();
  expect(stored().partyDesign).toBe("mosaic");

  cleanup();
  renderCard.mockClear();
  renderPanel(partyTarget());
  await preview();
  expect(screen.getByRole("radio", { name: "Story" })).toBeChecked();
  expect(designName()).toBe("Mosaic");
  expect(toggle("Other singers' pictures")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // Opened on Mosaic, so Mosaic is drawn first.
  expect(requests()[0].options).toMatchObject({
    format: "story",
    look: "mosaic",
  });
});

test("Strip is remembered and opened on again", async () => {
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(nextDesign());
  expect(stored().partyDesign).toBe("strip");
  cleanup();
  renderPanel(partyTarget());
  await preview();
  expect(designName()).toBe("Strip");
});

test("a score card remembers Cover, apart from the party's design", async () => {
  renderPanel(scoreTarget(theirs()));
  await preview();
  fireEvent.click(nextDesign());
  expect(stored()).toEqual(
    expect.objectContaining({ scoreLook: "cover", partyDesign: "podium" }),
  );
  cleanup();
  renderPanel(scoreTarget(theirs()));
  await preview();
  expect(designName()).toBe("Cover");
});

test("a remembered design this card cannot draw opens on the first slide", async () => {
  window.localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ partyDesign: "mosaic" }),
  );
  for (const song of SONGS.slice(2)) broken.add(coverUrl(song.id));
  renderPanel(partyTarget());
  await preview();
  expect(designName()).toBe("Podium");
  // And it is still remembered for a party that can.
  expect(stored().partyDesign).toBe("mosaic");
});

test("storage that throws leaves the panel working on its defaults", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ format: "story" }),
  );
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Strip");
  get.mockRestore();
  set.mockRestore();
});

// ------------------------------------------------------------- one score

test("the rest of the sing comes from the page", async () => {
  const mine = cardScore("chiara", 8662, SONGS[0], { sing_id: "duet" });
  const partner = cardScore("alice", 7100, SONGS[0], { sing_id: "duet" });
  renderPanel(scoreTarget(mine, [mine, partner]));
  await preview();
  const request = lastRequest();
  expect(request.kind === "score" && request.content.partners).toEqual([
    "Alice",
  ]);
});

test("without stats.history nothing is asked and the card carries no flag", async () => {
  const only = cardScore("chiara", 9999, SONGS[0]);
  renderPanel(scoreTarget(only));
  await preview();
  expect(listSongScores).not.toHaveBeenCalled();
  const request = lastRequest();
  expect(request.kind === "score" && request.content.flag).toBeNull();
});

test("with stats.history the song's history decides New Highscore", async () => {
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.history"], {
      user: userRead({ player_id: "chiara" }),
    }),
  );
  const only = cardScore("chiara", 9500, SONGS[0]);
  const older = cardScore("alice", 9100, SONGS[0]);
  listSongScores.mockResolvedValue({ data: { scores: [only, older] } });
  renderPanel(scoreTarget(only));
  await preview();
  expect(listSongScores.mock.calls[0][0].path).toEqual({
    song_id: SONGS[0].id,
  });
  // Drawn once per slide, each with the flag: the history is waited for, not
  // patched in.
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  for (const request of requests())
    expect(request.kind === "score" && request.content.flag).toBe("highscore");
});

test("a failed history read draws the card without a flag", async () => {
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.history"], {
      user: userRead({ player_id: "chiara" }),
    }),
  );
  listSongScores.mockRejectedValue(new Error("offline"));
  const only = cardScore("chiara", 9500, SONGS[0]);
  renderPanel(scoreTarget(only));
  await preview();
  const request = lastRequest();
  expect(request.kind === "score" && request.content.flag).toBeNull();
});

// ------------------------------------------------------------- pictures

test("every picture URL is let go: each slide's old one on a redraw, the rest on close", async () => {
  const { unmount } = renderPanel(partyTarget());
  await preview();
  fireEvent.click(nextDesign());
  await waitFor(() =>
    expect(created).toEqual(["blob:card-1", "blob:card-2", "blob:card-3"]),
  );
  expect(revoked).toEqual([]);

  // Strip in view: drawn again first, then its two neighbours.
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(created).toHaveLength(6));
  expect(shown()).toHaveAttribute("src", "blob:card-4");
  // The old pictures stand until the new ones are on screen: let go any
  // sooner, they could flash as broken images.
  expect(revoked).toEqual([]);
  fireEvent.load(shown() as HTMLImageElement);
  expect(revoked).toEqual(["blob:card-2"]);
  for (const image of document.querySelectorAll("img.share-preview-image"))
    fireEvent.load(image);
  expect([...revoked].sort()).toEqual([
    "blob:card-1",
    "blob:card-2",
    "blob:card-3",
  ]);

  unmount();
  expect([...revoked].sort()).toEqual([...created].sort());
});

test("the old picture stays up while the card is drawn again", async () => {
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  let finish: (blob: Blob) => void = () => undefined;
  renderCard.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(3));
  expect(shown()).toHaveAttribute("src", "blob:card-1");
  expect(within(inView()).queryByRole("status")).toBeNull();
  finish(new Blob(["png"], { type: "image/png" }));
  await waitFor(() => expect(shown()).toHaveAttribute("src", "blob:card-3"));
});

test("a press while the card is drawn again never sends the card from before", async () => {
  const share = shareableBrowser();
  const write = copyableBrowser();
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  let finish: (blob: Blob) => void = () => undefined;
  renderCard.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(3));

  // The square picture still stands, and nothing sends it.
  const shareButton = screen.getByRole("button", { name: "Share" });
  const copyButton = screen.getByRole("button", { name: "Copy image" });
  const save = screen.getByRole("link", { name: "Save image" });
  expect(shareButton).toBeDisabled();
  expect(copyButton).toBeDisabled();
  expect(save).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(shareButton);
  fireEvent.click(copyButton);
  // `fireEvent` answers false when the click's default was prevented.
  expect(fireEvent.click(save)).toBe(false);
  expect(share).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();

  finish(new Blob(["story picture"], { type: "image/png" }));
  await waitFor(() => expect(shareButton).toBeEnabled());
  expect(save).not.toHaveAttribute("aria-disabled");
  fireEvent.click(shareButton);
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(data.files?.[0].size).toBe("story picture".length);
});

test("a swipe onto a slide still being drawn holds the buttons until its own picture is in", async () => {
  const share = shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  let finish: (blob: Blob) => void = () => undefined;
  renderCard.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  // On to Strip, drawn, then to Mosaic, which is still on its way.
  fireEvent.click(nextDesign());
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(3));
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Mosaic");
  expect(shown()).toBeNull();
  expect(
    within(inView()).getByRole("status", { name: "Loading" }),
  ).toBeTruthy();
  const shareButton = screen.getByRole("button", { name: "Share" });
  expect(shareButton).toBeDisabled();
  expect(screen.getByRole("link", { name: "Save image" })).not.toHaveAttribute(
    "href",
  );
  fireEvent.click(shareButton);
  expect(share).not.toHaveBeenCalled();

  finish(new Blob(["the mosaic"], { type: "image/png" }));
  await waitFor(() => expect(shareButton).toBeEnabled());
  fireEvent.click(shareButton);
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(data.files?.[0].size).toBe("the mosaic".length);
});

test("a redraw that fails takes the picture from before with it", async () => {
  shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(created).toHaveLength(2));
  renderCard.mockRejectedValue(new Error("no canvas"));
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  expect(
    await screen.findByText("The card could not be drawn in this browser."),
  ).toBeInTheDocument();
  expect(shown()).toBeNull();
  expect(document.querySelector(".share-actions")).toBeNull();
  await waitFor(() =>
    expect([...revoked].sort()).toEqual(["blob:card-1", "blob:card-2"]),
  );
});

test("a card that cannot be drawn says so and offers no buttons", async () => {
  renderCard.mockRejectedValue(new Error("no canvas"));
  renderPanel(partyTarget());
  expect(
    await screen.findByText("The card could not be drawn in this browser."),
  ).toBeInTheDocument();
  expect(document.querySelector(".share-actions")).toBeNull();
});
