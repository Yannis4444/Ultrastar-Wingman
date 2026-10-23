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
import {
  SONGS,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
} from "../test/shareCard";
import ShareCardPanel, {
  LONG_PRESS_NOTE,
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

function touchScreen(coarse: boolean): void {
  defineOn(window, "matchMedia", (query: string) => ({
    matches: coarse && query.includes("coarse"),
    media: query,
  }));
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

/** The picture, once the first drawing is in. */
function preview(): Promise<HTMLElement> {
  return screen.findByRole("img", { name: /^Share card/ });
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
  expect(lastRequest().kind).toBe("party");
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

test("a party's card offers format, look, focus and what stands under the podium", async () => {
  renderPanel(partyTarget());
  await preview();
  expect(pills("Format")).toEqual([
    ["Square", true, false],
    ["Story", false, false],
  ]);
  expect(pills("Look")).toEqual([
    ["Dark", true, false],
    ["Mosaic", false, false],
  ]);
  expect(pills("Focus")).toEqual([
    ["Podium", true, false],
    ["Spread", false, false],
  ]);
  expect(pills("Under the podium")).toEqual([
    ["Ranking", true, false],
    ["Score strip", false, false],
  ]);

  fireEvent.click(screen.getByRole("radio", { name: "Score strip" }));
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ under: "strip" }),
  );
  // A story has room for both, so the choice leaves.
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() =>
    expect(lastRequest().options).toMatchObject({ format: "story" }),
  );
  expect(screen.queryByRole("group", { name: "Under the podium" })).toBeNull();
});

test("a look the card cannot draw is a disabled pill over the reason", async () => {
  // Two of the six covers arrive: no Mosaic.
  for (const song of SONGS.slice(2)) broken.add(coverUrl(song.id));
  renderPanel(partyTarget());
  await preview();
  expect(pills("Look")).toEqual([
    ["Dark", true, false],
    ["Mosaic", false, true],
  ]);
  const note = within(screen.getByRole("group", { name: "Look" })).getByText(
    "Mosaic needs four different covers, and this party has 2.",
  );
  expect(note).toHaveClass("section-note");
});

test("a song without a cover cannot take the Cover look, and says why", async () => {
  const only = cardScore("chiara", 8662, SONGS[0]);
  broken.add(coverUrl(SONGS[0].id));
  renderPanel(scoreTarget([only]));
  await preview();
  expect(pills("Look")).toEqual([
    ["Dark", true, false],
    ["Cover", false, true],
  ]);
  expect(
    screen.getByText("This song has no cover, so the card stays dark."),
  ).toBeInTheDocument();
  // A score card has no party choices.
  expect(screen.queryByRole("group", { name: "Focus" })).toBeNull();
  expect(screen.queryByLabelText("Only me and my place")).toBeNull();
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
});

test("the panel remembers format, look and toggles on this device", async () => {
  renderPanel(partyTarget());
  await preview();
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  fireEvent.click(screen.getByRole("radio", { name: "Mosaic" }));
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

  cleanup();
  renderPanel(partyTarget());
  await preview();
  expect(screen.getByRole("radio", { name: "Story" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Mosaic" })).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Other singers' pictures" }),
  ).not.toBeChecked();
  expect(lastRequest().options).toMatchObject({
    format: "story",
    look: "mosaic",
  });
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
  expect(screen.queryByRole("img", { name: /^Share card/ })).toBeNull();

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
  // Going back lets the last card go.
  expect(revoked).toEqual(["blob:card-1"]);
  fireEvent.click(await screen.findByRole("button", { name: /Dancing Queen/ }));

  // Nothing of the first card is left to press, and no choice is drawn
  // against pictures that have not arrived.
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /^Share card/ })).toBeNull();
  expect(document.querySelector(".share-actions")).toBeNull();
  expect(screen.queryByRole("group", { name: "Look" })).toBeNull();

  arrive();
  const image = await preview();
  expect(image).toHaveAttribute("src", "blob:card-2");
  expect(image).toHaveAccessibleName(
    "Share card: Chiara scored 8662 on Dancing Queen",
  );
  expect(pills("Look")).toEqual([
    ["Dark", true, false],
    ["Cover", false, false],
  ]);
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
  // Drawn once, with the flag: the history is waited for, not patched in.
  expect(renderCard).toHaveBeenCalledTimes(1);
  const request = lastRequest();
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

test("every picture URL is let go: the old one on a redraw, the last on close", async () => {
  const { unmount } = renderPanel(partyTarget());
  await preview();
  expect(created).toEqual(["blob:card-1"]);
  expect(revoked).toEqual([]);

  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() =>
    expect(screen.getByRole("img", { name: /^Share card/ })).toHaveAttribute(
      "src",
      "blob:card-2",
    ),
  );
  // The old picture stands until the new one is on screen: let go any sooner,
  // it could flash as a broken image.
  expect(revoked).toEqual([]);
  fireEvent.load(screen.getByRole("img", { name: /^Share card/ }));
  expect(revoked).toEqual(["blob:card-1"]);

  unmount();
  expect(revoked).toEqual(["blob:card-1", "blob:card-2"]);
  expect(revoked.length).toBe(created.length);
});

test("the old picture stays up while the card is drawn again", async () => {
  renderPanel(partyTarget());
  await preview();
  let finish: (blob: Blob) => void = () => undefined;
  renderCard.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("img", { name: /^Share card/ })).toHaveAttribute(
    "src",
    "blob:card-1",
  );
  expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  finish(new Blob(["png"], { type: "image/png" }));
  await waitFor(() =>
    expect(screen.getByRole("img", { name: /^Share card/ })).toHaveAttribute(
      "src",
      "blob:card-2",
    ),
  );
});

test("a press while the card is drawn again never sends the card from before", async () => {
  const share = shareableBrowser();
  const write = copyableBrowser();
  renderPanel(partyTarget());
  await preview();
  let finish: (blob: Blob) => void = () => undefined;
  renderCard.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  await waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));

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

test("a redraw that fails takes the picture from before with it", async () => {
  shareableBrowser();
  renderPanel(partyTarget());
  await preview();
  renderCard.mockRejectedValue(new Error("no canvas"));
  fireEvent.click(screen.getByRole("radio", { name: "Story" }));
  expect(
    await screen.findByText("The card could not be drawn in this browser."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /^Share card/ })).toBeNull();
  expect(document.querySelector(".share-actions")).toBeNull();
  expect(revoked).toEqual(["blob:card-1"]);
});

test("a card that cannot be drawn says so and offers no buttons", async () => {
  renderCard.mockRejectedValue(new Error("no canvas"));
  renderPanel(partyTarget());
  expect(
    await screen.findByText("The card could not be drawn in this browser."),
  ).toBeInTheDocument();
  expect(document.querySelector(".share-actions")).toBeNull();
});
