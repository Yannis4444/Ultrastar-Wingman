import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import { iconNames } from "../test/icons";
import AddSongsModal from "./AddSongsModal";

const { getMe } = vi.hoisted(() => ({ getMe: vi.fn() }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
}));

function renderModal(capabilities: string[]) {
  getMe.mockResolvedValue(meResponse(capabilities));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AddSongsModal onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => getMe.mockReset());

test("a source card reads as a button into its search", async () => {
  renderModal(["usdb.search"]);

  const card = await screen.findByRole("link", { name: /USDB/ });
  expect(card).toHaveAttribute("href", "/usdb");
  // The card says where a tap leads; without this it is only a poster.
  expect(card).toHaveTextContent("Search");
  expect(iconNames(card)).toEqual(["globe", "chevron-right"]);
});

test("a source the role may not use is not offered", async () => {
  renderModal(["songs.view"]);

  // Unknown capabilities allow the action, so the card is there until
  // `/auth/me` answers — the assertion has to outlast that.
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: /USDB/ }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText(/New songs come from/)).toBeInTheDocument();
});
