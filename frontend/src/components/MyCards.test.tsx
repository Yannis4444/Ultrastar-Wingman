import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CardRead, PlayerRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import MyCards from "./MyCards";

const {
  getMe,
  getDeviceStatus,
  listUnknownCards,
  listMyCards,
  claimCard,
  forgetCard,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getDeviceStatus: vi.fn(),
  listUnknownCards: vi.fn(),
  listMyCards: vi.fn(),
  claimCard: vi.fn(),
  forgetCard: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getDeviceStatus,
  listUnknownCards,
  listMyCards,
  claimCard,
  forgetCard,
}));

const HEADING = "My cards";
const EMPTY = "Put a card on the player selector to claim it.";

const PLAYER: PlayerRead = {
  id: "aaa",
  name: "Alice",
  registered: true,
  hidden: false,
  has_avatar: false,
};

function card(uid: string): CardRead {
  return { uid, player: PLAYER, created_at: "2026-09-06T18:00:00Z" };
}

function renderCards() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyCards />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  // A signed-in account with a player, which is what claiming a card takes.
  getMe.mockResolvedValue(
    meResponse(["songs.view", "players.view"], {
      user: userRead(),
      role: "user",
    }),
  );
  getDeviceStatus.mockResolvedValue({ data: { online: true } });
  listUnknownCards.mockResolvedValue({ data: { uids: [] } });
  listMyCards.mockResolvedValue({ data: { cards: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("a selector in the room with nothing on it invites a card", async () => {
  renderCards();

  expect(
    await screen.findByRole("heading", { name: HEADING }),
  ).toBeInTheDocument();
  expect(screen.getByText(EMPTY)).toBeInTheDocument();
});

test("an unclaimed card on a reader can be taken", async () => {
  listUnknownCards.mockResolvedValue({ data: { uids: ["A1B2C3D4"] } });
  claimCard.mockResolvedValue({ data: card("A1B2C3D4") });
  renderCards();

  const claim = await screen.findByRole("button", { name: "This is mine" });
  expect(screen.getByText("A1B2C3D4")).toBeInTheDocument();
  // The invitation is for a reader with nothing at all, not for one looking at
  // a card they could claim.
  expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

  // Once it is theirs the card moves lists, so both are asked again.
  listUnknownCards.mockResolvedValue({ data: { uids: [] } });
  listMyCards.mockResolvedValue({ data: { cards: [card("A1B2C3D4")] } });
  fireEvent.click(claim);

  await waitFor(() =>
    expect(claimCard.mock.calls[0][0].path).toEqual({ uid: "A1B2C3D4" }),
  );
  expect(
    await screen.findByRole("button", { name: "Forget card" }),
  ).toBeInTheDocument();
});

test("a card somebody else was faster with says so", async () => {
  listUnknownCards.mockResolvedValue({ data: { uids: ["A1B2C3D4"] } });
  // The generated client throws the parsed body, and a 409 carries the slug.
  claimCard.mockRejectedValue({ detail: "card_taken" });
  renderCards();

  fireEvent.click(await screen.findByRole("button", { name: "This is mine" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Somebody else already holds that card.",
  );
  // Still offered: the list is what the readers report, and the refusal is
  // about who holds it rather than about the row being wrong.
  expect(screen.getByRole("button", { name: "This is mine" })).toBeEnabled();
});

test("forgetting a card asks first and says what it costs", async () => {
  listMyCards.mockResolvedValue({ data: { cards: [card("A1B2C3D4")] } });
  forgetCard.mockResolvedValue({ data: undefined });
  renderCards();

  fireEvent.click(await screen.findByRole("button", { name: "Forget card" }));

  const dialog = await screen.findByRole("dialog", {
    name: "Forget this card?",
  });
  expect(dialog).toHaveTextContent(
    "Forget card A1B2C3D4? It stops selecting you.",
  );

  listMyCards.mockResolvedValue({ data: { cards: [] } });
  fireEvent.click(screen.getByRole("button", { name: "Forget" }));

  await waitFor(() =>
    expect(forgetCard.mock.calls[0][0].path).toEqual({ uid: "A1B2C3D4" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Forget card" }),
    ).not.toBeInTheDocument(),
  );
});

test("a card put down on the selector arrives without a reload", async () => {
  renderCards();
  await screen.findByText(EMPTY);

  listUnknownCards.mockResolvedValue({ data: { uids: ["FEEDFACE"] } });
  act(() => FakeSocket.deliver({ event: "devices.changed" }));

  expect(await screen.findByText("FEEDFACE")).toBeInTheDocument();
  // Both listings are the caller's own view of the same readers, so both are
  // asked again.
  await waitFor(() => expect(listMyCards).toHaveBeenCalledTimes(2));
});

test("no selector and no card of your own, no block at all", async () => {
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  const { container } = renderCards();

  // Nothing is drawn, but the answers have to be in before that means
  // anything: wait for the request the block would be drawn from.
  await waitFor(() => expect(listMyCards).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test("a card of your own survives the selector being switched off", async () => {
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  listMyCards.mockResolvedValue({ data: { cards: [card("A1B2C3D4")] } });
  renderCards();

  expect(
    await screen.findByRole("heading", { name: HEADING }),
  ).toBeInTheDocument();
  expect(screen.getByText("A1B2C3D4")).toBeInTheDocument();
});

test("the host session is a browser, not a singer", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"], { is_host: true }));
  const { container } = renderCards();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  // And it asks for nobody's cards: `/devices/cards/mine` would answer 401.
  expect(listMyCards).not.toHaveBeenCalled();
});
