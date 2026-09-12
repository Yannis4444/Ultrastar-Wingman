import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MusicSettings } from "../api";
import MusicSettingsPanel from "./MusicSettingsPanel";

const { listPlaylists } = vi.hoisted(() => ({ listPlaylists: vi.fn() }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listPlaylists,
}));

test("the reel switch writes preview_on_spin", () => {
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MusicSettingsPanel
        settings={SETTINGS}
        savedField={null}
        busy={false}
        onChange={onChange}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Play the song the reel lands on" }),
  );
  expect(onChange).toHaveBeenCalledWith({ preview_on_spin: false });
});

const SETTINGS: MusicSettings = {
  enabled: false,
  scope: "all",
  playlist: "",
  resume_delay_s: 10,
  preview_on_spin: true,
};

function playlist(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    is_global: false,
    owner_username: null,
    owner_player_id: null,
    song_count: 3,
    duration_seconds: 600,
    my_access: "owner",
    followed: true,
    can_edit: true,
    can_manage: true,
    contains: null,
  };
}

function draw(settings: Partial<MusicSettings> = {}) {
  const onChange = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MusicSettingsPanel
        settings={{ ...SETTINGS, ...settings }}
        savedField={null}
        busy={false}
        onChange={onChange}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist("pl-1", "Warm-up")] },
  });
});

test("the panel is the five options and nothing else", () => {
  draw();
  expect(
    screen.getByRole("checkbox", { name: "Background music" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Play the song the reel lands on" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: "Pick songs from" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("spinbutton", {
      name: "Wait before the music comes back",
    }),
  ).toBeInTheDocument();
  // The playlist row belongs to the playlist scope alone.
  expect(
    screen.queryByRole("combobox", { name: "Playlist" }),
  ).not.toBeInTheDocument();
});

test("the scopes are the reel's, without favorites", () => {
  draw();
  const options = [
    ...screen.getByRole("combobox", { name: "Pick songs from" }).children,
  ].map((option) => option.textContent);
  expect(options).toEqual([
    "All songs",
    "Wishlist",
    "Wishlist (weighted)",
    "A playlist",
  ]);
});

test("switching the music on writes only that", () => {
  const onChange = draw();
  fireEvent.click(screen.getByRole("checkbox", { name: "Background music" }));
  expect(onChange).toHaveBeenCalledWith({ enabled: true });
});

test("the playlist row appears for the playlist scope", async () => {
  draw({ scope: "playlist" });
  const select = await screen.findByRole("combobox", { name: "Playlist" });
  await waitFor(() =>
    expect(screen.getByRole("option", { name: "Warm-up" })).toBeInTheDocument(),
  );
  fireEvent.change(select, { target: { value: "pl-1" } });
});

test("a playlist that is gone says so instead of pretending", async () => {
  draw({ scope: "playlist", playlist: "deleted" });

  expect(
    await screen.findByText(
      "The saved playlist no longer exists, so the music has nothing to play. Choose another one.",
    ),
  ).toBeInTheDocument();
});
