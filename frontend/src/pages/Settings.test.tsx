import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SettingRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Settings from "./Settings";

const {
  listSettings,
  updateSetting,
  getMe,
  launchUsdx,
  listVideoQualityPresets,
} = vi.hoisted(() => ({
  listSettings: vi.fn(),
  updateSetting: vi.fn(),
  getMe: vi.fn(),
  launchUsdx: vi.fn(),
  listVideoQualityPresets: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSettings,
  updateSetting,
  getMe,
  // Never the real one: a test must not start Ultrastar Deluxe.
  launchUsdx,
  listVideoQualityPresets,
}));

const HIGH_FORMAT = "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]";
const MEDIUM_FORMAT = "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]";

function setting(overrides: Partial<SettingRead>): SettingRead {
  return {
    key: "songs.directory",
    value: "",
    value_type: "str",
    default: "",
    group: "Songs",
    description: "Where the songs live.",
    secret: false,
    is_set: false,
    ...overrides,
  };
}

const DIRECTORY = setting({ value: "C:/songs", is_set: true });
const ADDITIONAL = setting({
  key: "songs.additional_directories",
  description: "Further directories, one path per line.",
});
const USERNAME = setting({
  key: "usdb.username",
  group: "USDB",
  description: "The USDB account.",
});
const PASSWORD = setting({
  key: "usdb.password",
  group: "USDB",
  value: null,
  default: null,
  secret: true,
  is_set: true,
  description: "Password of the USDB account.",
});
const PARALLEL = setting({
  key: "downloads.parallel",
  group: "Downloads",
  value_type: "int",
  value: 5,
  default: 2,
  is_set: true,
  description: "How many downloads run at once.",
});
const OVERWRITE = setting({
  key: "downloads.overwrite",
  group: "Downloads",
  value_type: "bool",
  value: false,
  default: false,
  description: "Replace an existing song.",
});

const BASE_PATH = setting({
  key: "usdx.base_path",
  group: "USDX",
  description: "Where Ultrastar Deluxe is installed.",
});
const QUALITY = setting({
  key: "downloads.video_format",
  group: "Downloads",
  value: HIGH_FORMAT,
  default: HIGH_FORMAT,
  description: "Which YouTube stream yt-dlp downloads.",
});

const SETTINGS: SettingRead[] = [
  DIRECTORY,
  ADDITIONAL,
  BASE_PATH,
  USERNAME,
  PASSWORD,
  PARALLEL,
  OVERWRITE,
  QUALITY,
];

const PRESETS = {
  presets: [
    {
      key: "best",
      label: "Best available",
      description: "Whatever YouTube has.",
      video_format: "bestvideo*+bestaudio/best",
    },
    {
      key: "high",
      label: "High (1080p)",
      description: "Full HD.",
      video_format: HIGH_FORMAT,
    },
    {
      key: "medium",
      label: "Medium (720p)",
      description: "Half the size.",
      video_format: MEDIUM_FORMAT,
    },
  ],
};

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  listSettings.mockResolvedValue({ data: SETTINGS });
  listVideoQualityPresets.mockResolvedValue({ data: PRESETS });
  getMe.mockResolvedValue(
    meResponse(["settings.view", "settings.manage"], {
      user: userRead({ role: "admin" }),
      role: "admin",
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

test("the page has a back link to the user page", async () => {
  renderSettings();

  expect(await screen.findByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("the sections are ordered task first and carry no count", async () => {
  renderSettings();

  await screen.findByText("Songs");
  const groups = screen
    .getAllByRole("group")
    .map((group) => group.querySelector("summary")?.textContent);
  expect(groups).toEqual(["Songs", "USDX", "USDB", "Downloads"]);
  // The count was wrong wherever one setting rendered several rows.
  expect(screen.queryByText("1")).not.toBeInTheDocument();
});

test("every group becomes a section with human labels and help text", async () => {
  renderSettings();

  expect(await screen.findByText("Songs")).toBeInTheDocument();
  for (const group of ["USDB", "Downloads"]) {
    expect(screen.getByText(group)).toBeInTheDocument();
  }
  // The label is derived from the key — the raw key is never the label.
  expect(screen.getByLabelText("Directory")).toHaveValue("C:/songs");
  expect(screen.queryByText("songs.directory")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toBeInTheDocument();
  expect(screen.getByText("How many downloads run at once.")).toBeVisible();
  // "one path per line" in the description picks the textarea.
  expect(screen.getByLabelText("Additional directories").tagName).toBe(
    "TEXTAREA",
  );
});

test("a text setting is saved on blur", async () => {
  updateSetting.mockResolvedValue({
    data: { ...USERNAME, value: "singer", is_set: true },
  });
  renderSettings();

  const input = await screen.findByLabelText("Username");
  fireEvent.change(input, { target: { value: "singer" } });
  fireEvent.blur(input);

  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0]).toMatchObject({
      path: { key: "usdb.username" },
      body: { value: "singer" },
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
});

test("an unchanged field is not saved", async () => {
  renderSettings();

  const input = await screen.findByLabelText("Directory");
  fireEvent.change(input, { target: { value: "C:/songs" } });
  fireEvent.blur(input);

  expect(updateSetting).not.toHaveBeenCalled();
});

test("a number setting sends a number, not a string", async () => {
  updateSetting.mockResolvedValue({
    data: { ...PARALLEL, value: 4 },
  });
  renderSettings();

  const input = await screen.findByLabelText("Parallel");
  fireEvent.change(input, { target: { value: "4" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0].body).toEqual({ value: 4 }),
  );
});

test("an input sits under its label, a toggle stays on its line", async () => {
  renderSettings();

  // Labels vary far more in length than values do: sharing the line gave every
  // box a different width. A checkbox is the exception, see SettingField.
  const input = await screen.findByLabelText("Username");
  expect(input.closest(".setting-row")).toHaveClass("setting-row-stacked");
  expect(
    screen.getByLabelText("Overwrite").closest(".setting-row"),
  ).not.toHaveClass("setting-row-stacked");
});

test("a toggle saves immediately", async () => {
  updateSetting.mockResolvedValue({
    data: { ...OVERWRITE, value: true, is_set: true },
  });
  renderSettings();

  fireEvent.click(await screen.findByLabelText("Overwrite"));

  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0]).toMatchObject({
      path: { key: "downloads.overwrite" },
      body: { value: true },
    }),
  );
});

test("a configured secret shows a placeholder and never its value", async () => {
  renderSettings();

  const input = await screen.findByLabelText("Password");
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveValue("");
  expect(input).toHaveAttribute("placeholder", "(unchanged)");
  // An empty box means "keep it" — only Clear removes a secret.
  fireEvent.blur(input);
  expect(updateSetting).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Clear Password" }));
  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0]).toMatchObject({
      path: { key: "usdb.password" },
      body: { value: null },
    }),
  );
});

test("clearing a secret does not first save what was typed", async () => {
  renderSettings();

  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: "hunter2" },
  });
  const clear = screen.getByRole("button", { name: "Clear Password" });
  // The button refuses the focus change (preventDefault -> `false`), so the
  // field's blur-save never runs and the typed secret stays in the browser.
  expect(fireEvent.mouseDown(clear)).toBe(false);
  fireEvent.click(clear);

  await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
  expect(updateSetting.mock.calls[0][0].body).toEqual({ value: null });
});

test("an unset secret has no placeholder and nothing to clear", async () => {
  listSettings.mockResolvedValue({ data: [{ ...PASSWORD, is_set: false }] });
  renderSettings();

  const input = await screen.findByLabelText("Password");
  expect(input).not.toHaveAttribute("placeholder");
  expect(
    screen.queryByRole("button", { name: "Clear Password" }),
  ).not.toBeInTheDocument();
});

test("reset to default sends null and only shows up on a changed setting", async () => {
  updateSetting.mockResolvedValue({
    data: { ...PARALLEL, value: 2, is_set: false },
  });
  renderSettings();

  fireEvent.click(
    await screen.findByRole("button", { name: "Reset Parallel" }),
  );

  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0]).toMatchObject({
      path: { key: "downloads.parallel" },
      body: { value: null },
    }),
  );
  // Back at its default, so there is nothing left to reset.
  expect(
    screen.queryByRole("button", { name: "Reset Parallel" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Reset Overwrite" }),
  ).not.toBeInTheDocument();
});

test("the default value is part of the reset button", async () => {
  renderSettings();

  expect(
    await screen.findByRole("button", { name: "Reset Parallel" }),
  ).toHaveAttribute("title", "Reset to 2");
});

test("a rejected value is reported at its own field", async () => {
  updateSetting.mockRejectedValue({
    detail: "setting 'downloads.parallel' expects int, got float",
  });
  renderSettings();

  const input = await screen.findByLabelText("Parallel");
  fireEvent.change(input, { target: { value: "2.5" } });
  fireEvent.blur(input);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "expects int, got float",
  );
});

test("view-only access disables every input", async () => {
  getMe.mockResolvedValue(
    meResponse(["settings.view"], {
      user: userRead({ role: "user" }),
      role: "user",
    }),
  );
  renderSettings();

  expect(await screen.findByLabelText("Directory")).toBeDisabled();
  expect(screen.getByLabelText("Additional directories")).toBeDisabled();
  expect(screen.getByLabelText("Password")).toBeDisabled();
  expect(screen.getByLabelText("Overwrite")).toBeDisabled();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(
    screen.getByText("You can see the settings but not change them."),
  ).toBeInTheDocument();
});

test("without settings.view the page explains itself instead of asking", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderSettings();

  expect(
    await screen.findByText(/Wingman's settings are for the host/),
  ).toBeInTheDocument();
  expect(listSettings).not.toHaveBeenCalled();
});

test("a broadcast from another browser updates the fields", async () => {
  renderSettings();
  await screen.findByLabelText("Directory");

  FakeSocket.deliver({
    event: "setting.changed",
    key: "songs.directory",
    value: "D:/other",
  });

  expect(await screen.findByDisplayValue("D:/other")).toBeInTheDocument();
});

test("the USDX section offers to run Ultrastar Deluxe and says why", async () => {
  launchUsdx.mockResolvedValue({ data: { started: true } });
  renderSettings();

  expect(await screen.findByText("Run Ultrastar Deluxe")).toBeVisible();
  expect(
    screen.getByText(/microphones, can only be changed in Ultrastar Deluxe/),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Launch" }));

  expect(await screen.findByText("Started")).toBeVisible();
  expect(launchUsdx).toHaveBeenCalledTimes(1);
});

test("an Ultrastar Deluxe that was already up is not reported as an error", async () => {
  launchUsdx.mockResolvedValue({ data: { started: false } });
  renderSettings();

  fireEvent.click(await screen.findByRole("button", { name: "Launch" }));

  expect(await screen.findByText("Running")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a running song is why Ultrastar Deluxe could not be started", async () => {
  launchUsdx.mockRejectedValue({ detail: "already_playing" });
  renderSettings();

  fireEvent.click(await screen.findByRole("button", { name: "Launch" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A song is playing right now",
  );
});

test("an unconfigured Ultrastar Deluxe is explained, not dumped", async () => {
  launchUsdx.mockRejectedValue({
    detail: {
      error: "usdx_not_configured",
      problems: ["'usdx.executable' is not set and cannot be derived"],
    },
  });
  renderSettings();

  fireEvent.click(await screen.findByRole("button", { name: "Launch" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Wingman does not know where Ultrastar Deluxe is installed",
  );
});

test("view-only access has nothing to launch", async () => {
  getMe.mockResolvedValue(
    meResponse(["settings.view"], {
      user: userRead({ role: "user" }),
      role: "user",
    }),
  );
  renderSettings();

  expect(await screen.findByText("Run Ultrastar Deluxe")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Launch" }),
  ).not.toBeInTheDocument();
});

test("the download quality is picked as a preset, not as a format string", async () => {
  updateSetting.mockResolvedValue({
    data: { ...QUALITY, value: MEDIUM_FORMAT, is_set: true },
  });
  renderSettings();

  // Every preset explains itself, and the selected one comes from the stored
  // format string.
  expect(await screen.findByLabelText("High (1080p)")).toBeChecked();
  expect(screen.getByText("Full HD.")).toBeVisible();
  expect(screen.getByLabelText("Best available")).not.toBeChecked();
  // Whatever a preset writes stays readable.
  expect(screen.getByText(HIGH_FORMAT)).toBeVisible();

  fireEvent.click(screen.getByLabelText("Medium (720p)"));

  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0]).toMatchObject({
      path: { key: "downloads.video_format" },
      body: { value: MEDIUM_FORMAT },
    }),
  );
});

test("custom is the only option with a format string to type", async () => {
  updateSetting.mockResolvedValue({
    data: { ...QUALITY, value: "worstvideo", is_set: true },
  });
  renderSettings();

  await screen.findByLabelText("High (1080p)");
  expect(
    screen.queryByLabelText("yt-dlp format string"),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Custom"));
  const input = screen.getByLabelText("yt-dlp format string");
  // Picking Custom alone stores nothing — there is nothing to store yet.
  expect(updateSetting).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "worstvideo" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    expect(updateSetting.mock.calls[0][0].body).toEqual({
      value: "worstvideo",
    }),
  );
});

test("a stored format string no preset covers shows up as custom", async () => {
  listSettings.mockResolvedValue({
    data: [{ ...QUALITY, value: "worstvideo+worstaudio", is_set: true }],
  });
  renderSettings();

  expect(await screen.findByLabelText("Custom")).toBeChecked();
  expect(screen.getByLabelText("yt-dlp format string")).toHaveValue(
    "worstvideo+worstaudio",
  );
});

test("a rejected format string is reported at the quality field", async () => {
  updateSetting.mockRejectedValue({
    detail:
      "setting 'downloads.video_format': a format string must not contain ;",
  });
  renderSettings();

  fireEvent.click(await screen.findByLabelText("Best available"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "must not contain ;",
  );
});

test("view-only access cannot change the download quality", async () => {
  getMe.mockResolvedValue(
    meResponse(["settings.view"], {
      user: userRead({ role: "user" }),
      role: "user",
    }),
  );
  renderSettings();

  expect(await screen.findByLabelText("High (1080p)")).toBeDisabled();
  expect(screen.getByLabelText("Best available")).toBeDisabled();
});
