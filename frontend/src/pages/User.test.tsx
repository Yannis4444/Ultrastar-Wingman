import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlayerRead } from "../api";
import User from "./User";

const { listPlayers, createPlayer, deletePlayer, setPlayerAvatar } = vi.hoisted(
  () => ({
    listPlayers: vi.fn(),
    createPlayer: vi.fn(),
    deletePlayer: vi.fn(),
    setPlayerAvatar: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
}));

function player(id: string, name: string): PlayerRead {
  return { id, name, registered: false, has_avatar: false };
}

function renderUser() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <User />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listPlayers.mockReset();
  createPlayer.mockReset();
  deletePlayer.mockReset();
  setPlayerAvatar.mockReset();
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice")] },
  });
});

test("players are listed and a new one can be added", async () => {
  createPlayer.mockResolvedValue({ data: player("bbb", "Bob") });
  renderUser();
  expect(await screen.findByText("Alice")).toBeInTheDocument();

  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice"), player("bbb", "Bob")] },
  });
  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "  Bob  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(createPlayer.mock.calls[0][0].body).toEqual({ name: "Bob" }),
  );
  expect(await screen.findByText("Bob")).toBeInTheDocument();
});

test("a duplicate name is reported instead of silently failing", async () => {
  createPlayer.mockRejectedValue({ detail: "duplicate_name" });
  renderUser();
  await screen.findByText("Alice");

  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "Alice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "There is already a player with that name.",
  );
  expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
});

test("deleting a player asks for confirmation first", async () => {
  deletePlayer.mockResolvedValue({ data: undefined });
  renderUser();

  fireEvent.click(await screen.findByRole("button", { name: "Delete Alice" }));
  expect(deletePlayer).not.toHaveBeenCalled();

  const confirm = screen.getByRole("dialog", { name: "Delete player" });
  expect(confirm).toHaveTextContent('Delete "Alice"?');

  listPlayers.mockResolvedValue({ data: { players: [] } });
  // The row button is labelled "Delete Alice", so this is the prompt's button.
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deletePlayer.mock.calls[0][0].path).toEqual({ player_id: "aaa" }),
  );
  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
});

test("cancelling the delete prompt keeps the player", async () => {
  renderUser();

  fireEvent.click(await screen.findByRole("button", { name: "Delete Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(deletePlayer).not.toHaveBeenCalled();
  expect(screen.getByText("Alice")).toBeInTheDocument();
});

test("an oversized avatar never leaves the browser", async () => {
  renderUser();
  await screen.findByText("Alice");

  const file = new File(["x"], "big.png", { type: "image/png" });
  // 5 MB is the backend's limit; the size is faked so no huge buffer is needed.
  Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText("Avatar for Alice"), {
    target: { files: [file] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "larger than 5 MB",
  );
  expect(setPlayerAvatar).not.toHaveBeenCalled();
});

test("a rejected avatar upload is reported next to the player", async () => {
  setPlayerAvatar.mockRejectedValue({ detail: "unsupported_avatar_type" });
  renderUser();
  await screen.findByText("Alice");

  const file = new File(["not an image"], "cv.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Avatar for Alice"), {
    target: { files: [file] },
  });

  await waitFor(() =>
    expect(setPlayerAvatar.mock.calls[0][0]).toMatchObject({
      path: { player_id: "aaa" },
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Only jpeg, png and webp images work",
  );
});
