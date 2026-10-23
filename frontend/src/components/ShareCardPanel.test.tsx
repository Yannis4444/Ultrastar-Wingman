import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ScoreWithContext } from "../api";
import type { CardRequest } from "../shareCard/draw";
import { coverUrl } from "../shareCard/content";
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

const party = cardParty(4, 2);

function partyTarget(scores: ScoreWithContext[] = party): ShareTarget {
  return { kind: "party", session: partySession(), scores };
}

function scoreTarget(scores: ScoreWithContext[]): ShareTarget {
  return {
    kind: "score",
    scores,
    grouping: "player",
    session: partySession(),
    pageScores: scores,
  };
}

/** The request of the latest drawing. */
function lastRequest(): CardRequest {
  const calls = renderCard.mock.calls;
  return calls[calls.length - 1][0] as CardRequest;
}

/** Every request drawn so far, in order. */
function requests(): CardRequest[] {
  return renderCard.mock.calls.map((call) => call[0] as CardRequest);
}

/** The look and the focus a request draws: which slide it was for. */
function designOf(request: CardRequest): string {
  if (request.kind === "score") return request.options.look;
  return request.options.focus === "spread" ? "spread" : request.options.look;
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

/** The dots, as `[in view, dimmed]`. */
function dots(): [boolean, boolean][] {
  return [...document.querySelectorAll(".share-dot")].map((dot) => [
    dot.classList.contains("share-dot-on"),
    dot.classList.contains("share-dot-dimmed"),
  ]);
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

test("the party bar's panel is titled for a party and draws the card as a picture", async () => {
  renderPanel(partyTarget());
  expect(
    screen.getByRole("dialog", { name: "Share this party" }),
  ).toBeInTheDocument();
  // The first drawing is a wait, and the wait is the app's one indicator.
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  const image = await preview();
  expect(image).toHaveAttribute("src", "blob:card-1");
  expect(image).toHaveAccessibleName(
    "Share card of Friday karaoke, ranked by best score",
  );
  expect(requests()[0].kind).toBe("party");
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
  const sizes: Record<string, number> = { dark: 1, mosaic: 2, spread: 3 };
  renderCard.mockImplementation((request: CardRequest) =>
    Promise.resolve(
      new Blob(["x".repeat(sizes[designOf(request)])], { type: "image/png" }),
    ),
  );
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Mosaic");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy image" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const [items] = write.mock.calls[0] as unknown as [
    { items: Record<string, Blob> }[],
  ];
  expect(items[0].items["image/png"].size).toBe(sizes.mosaic);
});

test("a touch screen on plain http reads the long-press hint under the picture", async () => {
  defineOn(window, "isSecureContext", false);
  touchScreen(true);
  renderPanel(partyTarget());
  await preview();
  expect(screen.getByText(LONG_PRESS_NOTE)).toHaveClass("section-note");
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

/** The pills of one group, as `[label, checked, disabled]`. */
function pills(legend: string): [string, boolean, boolean][] {
  const group = screen.getByRole("group", { name: legend });
  return within(group)
    .getAllByRole("radio")
    .map((radio) => [
      radio.closest("label")?.textContent ?? "",
      (radio as HTMLInputElement).checked,
      (radio as HTMLInputElement).disabled,
    ]);
}

/** The slides, by the names they are read out with. */
function slideNames(): string[] {
  return within(carousel())
    .getAllByRole("group")
    .map((slide) => slide.getAttribute("aria-label") ?? "");
}

test("a party's designs are a carousel of Dark, Mosaic and Spread, in that order", async () => {
  renderPanel(partyTarget());
  await preview();
  const row = carousel();
  expect(row).toHaveAttribute("aria-roledescription", "carousel");
  expect(row).toHaveAttribute("tabindex", "0");
  expect(slideNames()).toEqual([
    "Dark, 1 of 3",
    "Mosaic, 2 of 3",
    "Spread, 3 of 3",
  ]);
  for (const slide of within(row).getAllByRole("group"))
    expect(slide).toHaveAttribute("aria-roledescription", "slide");
  // Opened on Dark, the default: its name under the dots, its dot lit.
  expect(designName()).toBe("Dark");
  expect(inView()).toHaveAttribute("data-design", "dark");
  expect(dots()).toEqual([
    [true, false],
    [false, false],
    [false, false],
  ]);
  expect(document.querySelector(".share-dots")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  // The slide in view and its neighbour are drawn, the one in view first;
  // the spread, two away, is not.
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  expect(requests().map(designOf)).toEqual(["dark", "mosaic"]);
  expect(requests()[1].options).toMatchObject({
    look: "mosaic",
    focus: "podium",
  });
});

test("a score's designs are Dark and Cover", async () => {
  renderPanel(scoreTarget([cardScore("chiara", 8662, SONGS[0])]));
  await preview();
  expect(slideNames()).toEqual(["Dark, 1 of 2", "Cover, 2 of 2"]);
  expect(dots()).toHaveLength(2);
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  expect(requests().map(designOf)).toEqual(["dark", "cover"]);
  // A score card has no party choices.
  expect(screen.queryByText("Under the podium")).toBeNull();
  expect(screen.queryByLabelText("Only me and my place")).toBeNull();
});

test("the format is two icon-only pills, Square and Story", async () => {
  renderPanel(partyTarget());
  await preview();
  expect(pills("Format")).toEqual([
    ["Square", true, false],
    ["Story", false, false],
  ]);
  const square = screen.getByRole("radio", { name: "Square" });
  const story = screen.getByRole("radio", { name: "Story" });
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
  // Over the carousel.
  const format = screen.getByRole("group", { name: "Format" });
  expect(
    format.compareDocumentPosition(carousel()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.click(story);
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ format: "story" }),
  );
  expect(document.querySelector(".share-slide-box-story")).not.toBeNull();
});

test("Next and Previous move the slide in view, and it is what the buttons send", async () => {
  const share = shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  expect(previousDesign()).toBeDisabled();
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Mosaic");
  expect(inView()).toHaveAttribute("data-design", "mosaic");
  expect(dots().map(([on]) => on)).toEqual([false, true, false]);
  // Mosaic was drawn as the neighbour already; the spread is its neighbour
  // now, and is drawn.
  await waitFor(() =>
    expect(requests().map(designOf)).toEqual(["dark", "mosaic", "spread"]),
  );
  expect(requests()[2].options).toMatchObject({
    look: "dark",
    focus: "spread",
    under: "none",
  });
  const mosaic = await preview();
  expect(mosaic).toHaveAttribute("src", "blob:card-2");
  expect(screen.getByRole("link", { name: "Save image" })).toHaveAttribute(
    "href",
    "blob:card-2",
  );
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(data.files?.[0]).toBeInstanceOf(File);

  fireEvent.click(nextDesign());
  expect(designName()).toBe("Spread");
  expect(nextDesign()).toBeDisabled();
  expect(await preview()).toHaveAttribute("src", "blob:card-3");
  fireEvent.click(previousDesign());
  fireEvent.click(previousDesign());
  expect(designName()).toBe("Dark");
  expect(previousDesign()).toBeDisabled();
  // Every slide was drawn once: going back draws nothing again.
  expect(renderCard).toHaveBeenCalledTimes(3);
});

test("an arrow that reaches its end hands the keyboard to the other one", async () => {
  renderPanel(partyTarget());
  await preview();
  nextDesign().focus();
  fireEvent.click(nextDesign());
  expect(nextDesign()).toHaveFocus();
  fireEvent.click(nextDesign());
  expect(nextDesign()).toBeDisabled();
  expect(previousDesign()).toHaveFocus();
  fireEvent.click(previousDesign());
  fireEvent.click(previousDesign());
  expect(nextDesign()).toHaveFocus();
});

test("the arrow keys on the carousel move it, and the row does not scroll by itself", async () => {
  renderPanel(partyTarget());
  await preview();
  const row = carousel();
  // `fireEvent` answers false when the default was prevented.
  expect(fireEvent.keyDown(row, { key: "ArrowRight" })).toBe(false);
  expect(designName()).toBe("Mosaic");
  fireEvent.keyDown(row, { key: "ArrowRight" });
  fireEvent.keyDown(row, { key: "ArrowRight" });
  expect(designName()).toBe("Spread");
  fireEvent.keyDown(row, { key: "ArrowLeft" });
  expect(designName()).toBe("Mosaic");
  // Any other key is the row's own.
  expect(fireEvent.keyDown(row, { key: "Tab" })).toBe(true);
});

test("the arrows scroll the row smoothly, and at once for less motion", async () => {
  renderPanel(partyTarget());
  await preview();
  const { scrollTo } = layOut();
  fireEvent.click(nextDesign());
  // Mosaic's middle (24 + 260 + 126) in the row's middle (150).
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
  // Every slide changed width under the scroll position: Mosaic is brought
  // back to the middle at once, before the paint, not run to.
  expect(scrollTo).toHaveBeenCalledWith({ left: 260, behavior: "instant" });
  expect(designName()).toBe("Mosaic");
});

test("a swipe settles on the slide nearest the middle, and that slide is the choice", async () => {
  renderPanel(partyTarget());
  await preview();
  layOut();
  // Not yet: the row is still moving.
  swipeTo(240);
  expect(designName()).toBe("Dark");
  await waitFor(() => expect(designName()).toBe("Mosaic"), {
    timeout: SETTLE_MS * 10,
  });
  expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}")).toEqual(
    expect.objectContaining({ partyLook: "mosaic" }),
  );
  // Past the middle of the last gap is the spread.
  swipeTo(470);
  await waitFor(() => expect(designName()).toBe("Spread"), {
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
    name: "Mosaic, 2 of 3",
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
    [false, true],
    [false, false],
  ]);
  // Never drawn: a Mosaic that cannot be drawn would come back as Dark.
  expect(requests().map(designOf)).toEqual(["dark"]);

  fireEvent.click(nextDesign());
  expect(designName()).toBe("Mosaic");
  // Its neighbour, the spread, is drawn; the slot itself never is.
  await waitFor(() =>
    expect(requests().map(designOf)).toEqual(["dark", "spread"]),
  );
  const shareButton = screen.getByRole("button", { name: "Share" });
  const save = screen.getByRole("link", { name: "Save image" });
  expect(shareButton).toBeDisabled();
  expect(save).toHaveAttribute("aria-disabled", "true");
  expect(fireEvent.click(save)).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  // A dimmed slot is no choice to remember.
  expect(
    JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}").partyLook,
  ).not.toBe("mosaic");

  fireEvent.click(previousDesign());
  expect(shareButton).toBeEnabled();
  expect(save).not.toHaveAttribute("aria-disabled");
});

test("a song without a cover has a dimmed Cover slot, and says why", async () => {
  const only = cardScore("chiara", 8662, SONGS[0]);
  broken.add(coverUrl(SONGS[0].id));
  renderPanel(scoreTarget([only]));
  await preview();
  const cover = within(carousel()).getByRole("group", {
    name: "Cover, 2 of 2",
  });
  expect(
    within(cover).getByText("This song has no cover, so the card stays dark."),
  ).toBeInTheDocument();
  expect(cover.querySelector("img")).toBeNull();
});

test("Under the podium keeps its row on every party slide", async () => {
  renderPanel(partyTarget());
  await preview();
  const row = document.querySelector(".share-under") as HTMLElement;
  const variants = row.querySelectorAll(".share-under-variant").length;
  const active = () =>
    row.querySelector('.share-under-variant[data-active="true"]');
  // On a square Dark podium: the pills.
  expect(pills("Under the podium")).toEqual([
    ["Ranking", true, false],
    ["Score strip", false, false],
  ]);
  fireEvent.click(screen.getByRole("radio", { name: "Score strip" }));
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ under: "strip" }),
  );
  // Only Dark takes it: the Mosaic it does not reach is not drawn again.
  expect(requests().map(designOf)).toEqual(["dark", "mosaic", "dark"]);

  // Mosaic: the sentence in the pills' place, the row where it was.
  fireEvent.click(nextDesign());
  expect(screen.queryByRole("group", { name: "Under the podium" })).toBeNull();
  expect(active()).toHaveTextContent(
    "Mosaic keeps the podium alone over the covers.",
  );
  fireEvent.click(nextDesign());
  expect(active()).toHaveTextContent(
    "The spread takes the place of the podium.",
  );
  // So it does where the spread cannot be drawn: the sentence is the
  // design's, never the podium's pills in its slot.
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Only me and my place" }),
  );
  await waitFor(() =>
    expect(
      document.querySelector('[data-design="spread"] .share-slide-dimmed'),
    ).not.toBeNull(),
  );
  expect(screen.queryByRole("group", { name: "Under the podium" })).toBeNull();
  expect(active()).toHaveTextContent(
    "The spread takes the place of the podium.",
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Only me and my place" }),
  );
  expect(row.querySelectorAll(".share-under-variant")).toHaveLength(variants);
  expect(document.querySelector(".share-under")).toBe(row);

  // A story has room for both, on every slide.
  fireEvent.click(previousDesign());
  fireEvent.click(previousDesign());
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ format: "story" }),
  );
  expect(screen.queryByRole("group", { name: "Under the podium" })).toBeNull();
  expect(active()).toHaveTextContent(
    "A story has room for the ranking and the strip both.",
  );
});

test("the toggles are checkboxes the card is drawn with", async () => {
  renderPanel(partyTarget());
  await preview();
  const names = screen.getByRole("checkbox", { name: "Party name and date" });
  expect(names).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Other singers' pictures" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Only me and my place" }),
  ).not.toBeChecked();

  fireEvent.click(names);
  await waitFor(() => {
    const request = lastRequest();
    expect(request.kind === "party" && request.content.sub).toBeNull();
  });

  fireEvent.click(
    screen.getByRole("checkbox", { name: "Only me and my place" }),
  );
  await waitFor(() => {
    const request = lastRequest();
    expect(request.kind === "party" && request.content.onlyMe).toBe(true);
  });
  // Only me leaves nobody to compare with: the spread dims.
  expect(
    within(
      within(carousel()).getByRole("group", { name: "Spread, 3 of 3" }),
    ).getByText(
      "Only me and my place shows one singer, and the spread compares several.",
    ),
  ).toBeInTheDocument();
});

test("the Wingman logo is a toggle, on by default, on both cards, remembered", async () => {
  renderPanel(partyTarget());
  await preview();
  const logo = screen.getByRole("checkbox", { name: "Wingman logo" });
  expect(logo).toBeChecked();
  expect(lastRequest().options.logo).toBe(true);
  // The third of the column: pictures, name and date, logo, only me.
  const toggles = [
    ...document.querySelectorAll<HTMLInputElement>(
      '.share-toggles input[type="checkbox"]',
    ),
  ].map((input) => input.closest("label")?.textContent);
  expect(toggles).toEqual([
    "Other singers' pictures",
    "Party name and date",
    "Wingman logo",
    "Only me and my place",
  ]);

  fireEvent.click(logo);
  await waitFor(() => expect(lastRequest().options.logo).toBe(false));
  expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}")).toEqual(
    expect.objectContaining({ logo: false }),
  );

  cleanup();
  renderPanel(scoreTarget([cardScore("chiara", 8662, SONGS[0])]));
  await preview();
  expect(
    screen.getByRole("checkbox", { name: "Wingman logo" }),
  ).not.toBeChecked();
  expect(lastRequest()).toMatchObject({
    kind: "score",
    options: { logo: false },
  });
});

test("with the name and date off the file and the alt text still name the party", async () => {
  renderPanel(partyTarget());
  await preview();
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Party name and date" }),
  );
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

test("the panel remembers the format, the design in view and the toggles", async () => {
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  fireEvent.click(nextDesign());
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Other singers' pictures" }),
  );
  expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}")).toEqual(
    expect.objectContaining({
      format: "story",
      partyLook: "mosaic",
      otherPictures: false,
    }),
  );
  // The spread is not kept: Mosaic stays the one remembered.
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Spread");
  expect(
    JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}").partyLook,
  ).toBe("mosaic");

  cleanup();
  renderCard.mockClear();
  renderPanel(partyTarget());
  await preview();
  expect(screen.getByRole("radio", { name: "Story" })).toBeChecked();
  expect(designName()).toBe("Mosaic");
  expect(
    screen.getByRole("checkbox", { name: "Other singers' pictures" }),
  ).not.toBeChecked();
  // Opened on Mosaic, so Mosaic is drawn first.
  expect(requests()[0].options).toMatchObject({
    format: "story",
    look: "mosaic",
  });
});

test("a score card remembers Cover, apart from the party's look", async () => {
  renderPanel(scoreTarget([cardScore("chiara", 8662, SONGS[0])]));
  await preview();
  fireEvent.click(nextDesign());
  expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}")).toEqual(
    expect.objectContaining({ scoreLook: "cover", partyLook: "dark" }),
  );
  cleanup();
  renderPanel(scoreTarget([cardScore("chiara", 8662, SONGS[0])]));
  await preview();
  expect(designName()).toBe("Cover");
});

test("a remembered design this card cannot draw opens on Dark", async () => {
  window.localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ partyLook: "mosaic" }),
  );
  for (const song of SONGS.slice(2)) broken.add(coverUrl(song.id));
  renderPanel(partyTarget());
  await preview();
  expect(designName()).toBe("Dark");
  // And it is still remembered for a party that can.
  expect(
    JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}").partyLook,
  ).toBe("mosaic");
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
  expect(designName()).toBe("Mosaic");
  get.mockRestore();
  set.mockRestore();
});

test("somebody who did not sing at the party gets Only me disabled, with why", async () => {
  getMe.mockResolvedValue(meResponse(["stats.view"]));
  renderPanel(partyTarget());
  await preview();
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "Only me and my place" }),
    ).toBeDisabled(),
  );
  expect(
    screen.getByText("You did not sing at this party."),
  ).toBeInTheDocument();
});

test("Share a score on a group of several asks which score first", async () => {
  const scores = [
    cardScore("chiara", 9124, SONGS[0]),
    cardScore("chiara", 8662, SONGS[1]),
    cardScore("chiara", 7000, SONGS[2]),
  ];
  const { onClose } = renderPanel(scoreTarget(scores));
  const dialog = screen.getByRole("dialog", { name: "Share this score" });
  const rows = within(dialog).getAllByRole("button", {
    name: /Bohemian|Dancing|Africa/,
  });
  // As the group draws them, best first, each leading on to the card.
  expect(rows.map((row) => row.textContent)).toEqual([
    "Bohemian RhapsodyQueen9124",
    "Dancing QueenABBA8662",
    "AfricaToto7000",
  ]);
  for (const row of rows)
    expect(row.querySelector(".share-choice-chevron")).toBeInTheDocument();
  expect(renderCard).not.toHaveBeenCalled();

  fireEvent.click(rows[1]);
  await preview();
  const request = lastRequest();
  expect(request.kind === "score" && request.content.score).toBe(8662);

  // The close goes back to the list, not out of the panel.
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("button", { name: /Dancing Queen/ }),
  ).toHaveFocus();
  expect(shown()).toBeNull();

  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("another score from the list is a new first drawing, never the last card", async () => {
  const first = cardScore("chiara", 9124, SONGS[0]);
  const second = cardScore("chiara", 8662, SONGS[1]);
  renderPanel(scoreTarget([first, second]));
  fireEvent.click(screen.getByRole("button", { name: /Bohemian Rhapsody/ }));
  expect(await preview()).toHaveAttribute("src", "blob:card-1");
  // Swiped on to Cover, which is remembered…
  fireEvent.click(nextDesign());
  await waitFor(() => expect(created).toHaveLength(2));

  // The second song's pictures take their time.
  let arrive: () => void = () => undefined;
  loadCardImages.mockImplementation(
    (urls: string[]) =>
      new Promise((resolve) => {
        arrive = () =>
          resolve(new Map(urls.map((url) => [url, {} as HTMLImageElement])));
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  // Going back lets the last card go, every slide of it.
  expect(revoked).toEqual(["blob:card-1", "blob:card-2"]);
  fireEvent.click(await screen.findByRole("button", { name: /Dancing Queen/ }));

  // Nothing of the first card is left to press, and no choice is drawn
  // against pictures that have not arrived.
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector(".share-actions")).toBeNull();
  expect(screen.queryByRole("region", { name: "Designs" })).toBeNull();

  arrive();
  const image = await preview();
  // …so the next card opens on it, and draws it first.
  expect(designName()).toBe("Cover");
  expect(image).toHaveAttribute("src", "blob:card-3");
  expect(image).toHaveAccessibleName(
    "Share card: Chiara scored 8662 on Dancing Queen",
  );
  expect(slideNames()).toEqual(["Dark, 1 of 2", "Cover, 2 of 2"]);
});

test("a group of one score goes straight to its card, and the close closes", async () => {
  const only = cardScore("chiara", 8662, SONGS[0]);
  const { onClose } = renderPanel(scoreTarget([only]));
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the rest of the sing comes from the page, not from the group", async () => {
  const mine = cardScore("chiara", 8662, SONGS[0], { sing_id: "duet" });
  const partner = cardScore("alice", 7100, SONGS[0], { sing_id: "duet" });
  renderPanel({
    kind: "score",
    scores: [mine],
    grouping: "player",
    session: partySession(),
    pageScores: [mine, partner],
  });
  await preview();
  const request = lastRequest();
  expect(request.kind === "score" && request.content.partners).toEqual([
    "Alice",
  ]);
});

test("without stats.history nothing is asked and the card carries no flag", async () => {
  const only = cardScore("chiara", 9999, SONGS[0]);
  renderPanel(scoreTarget([only]));
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
  renderPanel(scoreTarget([only]));
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
  renderPanel(scoreTarget([only]));
  await preview();
  const request = lastRequest();
  expect(request.kind === "score" && request.content.flag).toBeNull();
});

test("every picture URL is let go: each slide's old one on a redraw, the rest on close", async () => {
  const { unmount } = renderPanel(partyTarget());
  await preview();
  fireEvent.click(nextDesign());
  await waitFor(() =>
    expect(created).toEqual(["blob:card-1", "blob:card-2", "blob:card-3"]),
  );
  expect(revoked).toEqual([]);

  // Mosaic in view: drawn again first, then its two neighbours.
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(created).toHaveLength(6));
  expect(shown()).toHaveAttribute("src", "blob:card-4");
  // The old pictures stand until the new ones are on screen: let go any
  // sooner, they could flash as broken images.
  expect(revoked).toEqual([]);
  fireEvent.load(shown() as HTMLImageElement);
  expect(revoked).toEqual(["blob:card-2"]);
  for (const image of document.querySelectorAll("img")) fireEvent.load(image);
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
  // On to Mosaic, drawn, then to the spread, which is still on its way.
  fireEvent.click(nextDesign());
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(3));
  fireEvent.click(nextDesign());
  expect(designName()).toBe("Spread");
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

  finish(new Blob(["the spread"], { type: "image/png" }));
  await waitFor(() => expect(shareButton).toBeEnabled());
  fireEvent.click(shareButton);
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(data.files?.[0].size).toBe("the spread".length);
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
