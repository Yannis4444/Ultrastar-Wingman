import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LoudnessPassStatus, SettingRead } from "../api";
import { BUNDLED_USDX_NOTE } from "../errors";
import { LOUDNESS_PASS_NOTE } from "../loudness";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Settings from "./Settings";

const {
  listSettings,
  updateSetting,
  getMe,
  getJoinInfo,
  launchUsdx,
  listVideoQualityPresets,
  usdxStatus,
  readLoudnessPass,
  startLoudnessPass,
  stopLoudnessPass,
} = vi.hoisted(() => ({
  listSettings: vi.fn(),
  updateSetting: vi.fn(),
  getMe: vi.fn(),
  getJoinInfo: vi.fn(),
  launchUsdx: vi.fn(),
  listVideoQualityPresets: vi.fn(),
  usdxStatus: vi.fn(),
  readLoudnessPass: vi.fn(),
  startLoudnessPass: vi.fn(),
  stopLoudnessPass: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSettings,
  updateSetting,
  getMe,
  getJoinInfo,
  // Never the real one: a test must not start Ultrastar Deluxe.
  launchUsdx,
  listVideoQualityPresets,
  usdxStatus,
  readLoudnessPass,
  startLoudnessPass,
  stopLoudnessPass,
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
    advanced: false,
    is_set: false,
    ...overrides,
  };
}

const DIRECTORY = setting({ value: "C:/songs", is_set: true });
const ADDITIONAL = setting({
  key: "songs.additional_directories",
  description: "Further directories, one path per line.",
  advanced: true,
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

const JOIN_URL = setting({
  key: "host.join_url",
  group: "Host",
  description: "The address guests open on their phones — empty picks one.",
});

const SETTINGS: SettingRead[] = [
  JOIN_URL,
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
  getJoinInfo.mockResolvedValue({ data: { url: "http://192.168.0.10:8080" } });
  listVideoQualityPresets.mockResolvedValue({ data: PRESETS });
  usdxStatus.mockResolvedValue({
    data: { configured: true, problems: [], bundled: false, usdx_dir: null },
  });
  // Never the real ones: a test must not rewrite anybody's songs.
  readLoudnessPass.mockResolvedValue({ data: loudnessPass() });
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
  // Only the sections themselves — a group's own "Advanced" half is a
  // `<details>` too, and it is not one of them.
  const groups = screen
    .getAllByRole("group")
    .filter((group) => group.classList.contains("settings-group"))
    .map((group) => group.querySelector("summary")?.textContent);
  expect(groups).toEqual(["Host", "Songs", "USDX", "USDB", "Downloads"]);
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

test("an input has the line under its label to itself, a toggle has not", async () => {
  renderSettings();

  // Labels vary far more in length than values do: sharing the line gave every
  // box a different width. A checkbox is the exception, see SettingField.
  const input = await screen.findByLabelText("Username");
  const control = input.parentElement;
  expect(control).toHaveClass("setting-control");
  // The label's line is a line of its own, above the box.
  expect(control?.previousElementSibling).toHaveClass("setting-row");
  expect(control?.querySelectorAll("*")).toHaveLength(1);

  const toggle = screen.getByLabelText("Overwrite");
  const field = toggle.closest(".setting-field");
  expect(toggle.closest(".setting-row")).toContainElement(
    screen.getByText("Overwrite"),
  );
  expect(field?.querySelector(".setting-control")).toBeNull();
});

test("the acknowledgement sits on the label's line, not on the input's", async () => {
  updateSetting.mockResolvedValue({
    data: { ...USERNAME, value: "singer", is_set: true },
  });
  renderSettings();

  const input = await screen.findByLabelText("Username");
  fireEvent.change(input, { target: { value: "singer" } });
  fireEvent.blur(input);

  const saved = await screen.findByText("Saved");
  const row = saved.closest(".setting-row");
  expect(row).toContainElement(screen.getByText("Username"));
  expect(row).not.toContainElement(input);
});

test("the reset button stands on the label's line, above the input", async () => {
  renderSettings();

  const reset = await screen.findByRole("button", { name: "Reset Parallel" });
  const row = reset.closest(".setting-row");
  expect(row).toContainElement(screen.getByText("Parallel"));
  expect(row).not.toContainElement(screen.getByLabelText("Parallel"));
  // The slot "Saved" will take is already there, so the button does not slide
  // the moment a save is acknowledged.
  expect(row?.querySelector(".setting-saved")).toBeInTheDocument();
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

test("the Host section carries the join URL and the address it produces", async () => {
  renderSettings();

  const input = await screen.findByLabelText("Join URL");
  expect(input).toHaveValue("");
  expect(input).toHaveClass("text-input-quiet");
  // Empty means "guess it", and the guess is the one thing the registry's own
  // description cannot say — the QR code and this line come from `/join`.
  expect(
    await screen.findByText(/Guests open http:\/\/192\.168\.0\.10:8080\./),
  ).toBeVisible();
});

test("a join URL no phone could open is refused at its own field", async () => {
  updateSetting.mockRejectedValue({
    detail:
      "setting 'host.join_url': a join URL must start with http:// or https://",
  });
  renderSettings();

  const input = await screen.findByLabelText("Join URL");
  fireEvent.change(input, { target: { value: "ftp://nope" } });
  fireEvent.blur(input);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "must start with http:// or https://",
  );
});

test("a saved join URL refetches the address the QR code will carry", async () => {
  updateSetting.mockResolvedValue({
    data: { ...JOIN_URL, value: "http://party.local:1234", is_set: true },
  });
  renderSettings();

  const input = await screen.findByLabelText("Join URL");
  getJoinInfo.mockResolvedValue({ data: { url: "http://party.local:1234" } });
  fireEvent.change(input, { target: { value: "http://party.local:1234" } });
  fireEvent.blur(input);

  FakeSocket.deliver({
    event: "setting.changed",
    key: "host.join_url",
    value: "http://party.local:1234",
  });

  expect(
    await screen.findByText(/Guests open http:\/\/party\.local:1234\./),
  ).toBeVisible();
});

test("a setting a normal setup never touches is folded away in its group", async () => {
  renderSettings();

  // Inside Songs, not in an "Advanced" section of its own: what a setting
  // belongs to does not change, only how loudly it is shown.
  const advanced = (await screen.findByText("Additional directories")).closest(
    "details",
  );
  expect(advanced).toHaveClass("settings-advanced");
  expect(advanced?.parentElement).toHaveClass("settings-group");
  expect(screen.getByLabelText("Additional directories")).not.toBeVisible();
  expect(screen.getByLabelText("Directory")).toBeVisible();
  // A group whose settings are all ordinary keeps no empty toggle.
  expect(screen.getAllByText("Advanced")).toHaveLength(1);

  fireEvent.click(screen.getByText("Advanced"));

  expect(screen.getByLabelText("Additional directories")).toBeVisible();
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

test("the launch row holds its state slot open before anything is started", async () => {
  launchUsdx.mockResolvedValue({ data: { started: true } });
  renderSettings();

  const launch = await screen.findByRole("button", { name: "Launch" });
  const row = launch.closest(".setting-row");
  // Empty, but the same box the word will stand in — its width is the class's,
  // so "Started" must not push the button sideways when it arrives.
  const slot = row?.querySelector(".run-usdx-state");
  expect(slot).toBeInTheDocument();
  expect(slot).toBeEmptyDOMElement();

  fireEvent.click(launch);

  const started = await screen.findByText("Started");
  expect(started).toHaveClass("setting-saved", "run-usdx-state");
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

const ADMIN = ["songs.view", "settings.view", "settings.manage"];

function asAdmin() {
  getMe.mockResolvedValue(
    meResponse(ADMIN, { user: userRead({ role: "admin" }), role: "admin" }),
  );
}

function bundledInstall(usdx_dir: string | null = "C:\\Wingman\\usdx") {
  // What the backend answers then: no USDX row in the list at all.
  listSettings.mockResolvedValue({
    data: SETTINGS.filter((row) => row.group !== "USDX"),
  });
  usdxStatus.mockResolvedValue({
    data: { configured: true, problems: [], bundled: true, usdx_dir },
  });
}

test("a bundled Ultrastar Deluxe keeps the USDX section, with a line instead of paths", async () => {
  asAdmin();
  bundledInstall();
  renderSettings();

  // The setup dialog's sentence, word for word.
  const note = await screen.findByText(BUNDLED_USDX_NOTE, { exact: false });
  expect(note).toHaveClass("section-note");
  expect(note).toHaveTextContent("It is in C:\\Wingman\\usdx.");
  const section = note.closest(".settings-group");
  expect(section?.querySelector("summary")).toHaveTextContent("USDX");
  // The Launch row still has a job: the microphones live in USDX alone.
  expect(screen.getByRole("button", { name: "Launch" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Base path")).not.toBeInTheDocument();
  // In its usual place in the page order.
  const groups = screen
    .getAllByRole("group")
    .filter((group) => group.classList.contains("settings-group"))
    .map((group) => group.querySelector("summary")?.textContent);
  expect(groups).toEqual(["Host", "Songs", "USDX", "USDB", "Downloads"]);
});

test("the bundled line names no directory to a reader the status does not tell", async () => {
  asAdmin();
  bundledInstall(null);
  renderSettings();

  // The shared sentence and nothing after it.
  const note = await screen.findByText(BUNDLED_USDX_NOTE);
  expect(note).not.toHaveTextContent("It is in");
});

test("a bundled launch failure does not point at paths that are not there", async () => {
  asAdmin();
  bundledInstall();
  launchUsdx.mockRejectedValue(new Error("boom"));
  renderSettings();

  fireEvent.click(await screen.findByRole("button", { name: "Launch" }));

  const alert = await screen.findByRole("alert");
  expect(alert).not.toHaveTextContent(/paths/);
});

test("an Ultrastar Deluxe the host points at keeps its path fields", async () => {
  asAdmin();
  renderSettings();

  expect(await screen.findByLabelText("Base path")).toBeInTheDocument();
  await waitFor(() => expect(usdxStatus).toHaveBeenCalled());
  expect(
    screen.queryByText(/comes with this installation/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Launch" })).toBeInTheDocument();
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

// --- the songs already in the library ------------------------------------------

const NORMALIZE = setting({
  key: "downloads.normalize_loudness",
  group: "Downloads",
  value_type: "bool",
  value: true,
  default: true,
  description: "Even out each download's loudness.",
});

function loudnessPass(
  overrides: Partial<LoudnessPassStatus> = {},
): LoudnessPassStatus {
  return {
    state: "idle",
    waiting: false,
    total: 0,
    done: 0,
    counts: {
      tagged: 0,
      already_tagged: 0,
      unsupported: 0,
      silent: 0,
      missing: 0,
      in_use: 0,
      failed: 0,
    },
    ended: null,
    error: null,
    song: null,
    ...overrides,
  };
}

/** What `loudness.changed` carries: the pass without the song in hand. */
function loudnessEvent(overrides: Partial<LoudnessPassStatus>) {
  const payload: Partial<LoudnessPassStatus> = loudnessPass(overrides);
  delete payload.song;
  return { event: "loudness.changed", loudness: payload };
}

function withNormalize() {
  listSettings.mockResolvedValue({ data: [...SETTINGS, NORMALIZE] });
}

test("the row under Normalize loudness offers to even out the songs already there", async () => {
  withNormalize();
  renderSettings();

  const button = await screen.findByRole("button", { name: "Even out" });
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getByText("Songs already in the library")).toBeVisible();
  expect(screen.getByText(LOUDNESS_PASS_NOTE)).toBeVisible();
  // The row right after the switch it belongs to.
  const field = screen
    .getByLabelText("Normalize loudness")
    .closest(".setting-field");
  expect(field?.nextElementSibling).toContainElement(button);
});

test("pressing Even out starts the pass, and the line follows it to its end", async () => {
  withNormalize();
  startLoudnessPass.mockResolvedValue({
    data: loudnessPass({ state: "running" }),
  });
  renderSettings();

  const button = await screen.findByRole("button", { name: "Even out" });
  await waitFor(() => expect(button).toBeEnabled());
  readLoudnessPass.mockResolvedValue({
    data: loudnessPass({
      state: "running",
      total: 340,
      done: 11,
      song: { id: "usdb:1", title: "Waterloo", artist: "ABBA" },
    }),
  });
  fireEvent.click(button);

  await waitFor(() => expect(startLoudnessPass).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText("Looking for songs to even out…"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();

  const reads = readLoudnessPass.mock.calls.length;
  // The count arrives first, with no song in hand yet: nothing to ask for.
  FakeSocket.deliver(loudnessEvent({ state: "running", total: 340, done: 0 }));
  expect(await screen.findByText("1 of 340.")).toBeVisible();
  expect(readLoudnessPass).toHaveBeenCalledTimes(reads);

  // The next song in hand: the counts move at once, the song comes with the
  // one GET this message sets off.
  FakeSocket.deliver(loudnessEvent({ state: "running", total: 340, done: 11 }));
  expect(await screen.findByText("12 of 340: Waterloo by ABBA")).toBeVisible();
  expect(readLoudnessPass).toHaveBeenCalledTimes(reads + 1);

  // A wait beginning and ending keeps the song, and asks for nothing.
  FakeSocket.deliver(
    loudnessEvent({ state: "running", total: 340, done: 11, waiting: true }),
  );
  expect(
    await screen.findByText("12 of 340. Paused until Ultrastar Deluxe closes."),
  ).toBeVisible();
  FakeSocket.deliver(loudnessEvent({ state: "running", total: 340, done: 11 }));
  expect(await screen.findByText("12 of 340: Waterloo by ABBA")).toBeVisible();
  expect(readLoudnessPass).toHaveBeenCalledTimes(reads + 1);
  // One line that truncates, so a long title never moves the page below it.
  expect(screen.getByText("12 of 340: Waterloo by ABBA")).toHaveClass(
    "loudness-pass-progress",
  );

  FakeSocket.deliver(
    loudnessEvent({
      ended: "finished",
      total: 340,
      done: 340,
      counts: {
        ...loudnessPass().counts,
        tagged: 300,
        already_tagged: 20,
        failed: 15,
        silent: 5,
      },
    }),
  );
  expect(
    await screen.findByText(
      "Evened out 300 songs. 20 had their loudness already. 20 could not be evened out.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Even out" })).toBeEnabled();
});

test("a GET still under way never puts an older pass back over a newer message", async () => {
  withNormalize();
  readLoudnessPass.mockResolvedValue({
    data: loudnessPass({ state: "running", total: 4, done: 0 }),
  });
  renderSettings();
  expect(await screen.findByText("1 of 4.")).toBeVisible();

  // The next song in hand sets off a GET that answers late, with the pass as
  // it stood before the wait that the following message reports.
  let answerLate: (value: { data: LoudnessPassStatus }) => void = () => {};
  readLoudnessPass.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answerLate = resolve;
      }),
  );
  readLoudnessPass.mockResolvedValue({
    data: loudnessPass({
      state: "running",
      total: 4,
      done: 1,
      waiting: true,
      song: { id: "usdb:1", title: "Waterloo", artist: "ABBA" },
    }),
  });
  FakeSocket.deliver(loudnessEvent({ state: "running", total: 4, done: 1 }));
  await waitFor(() => expect(readLoudnessPass).toHaveBeenCalledTimes(2));
  FakeSocket.deliver(
    loudnessEvent({ state: "running", total: 4, done: 1, waiting: true }),
  );
  answerLate({
    data: loudnessPass({
      state: "running",
      total: 4,
      done: 1,
      song: { id: "usdb:1", title: "Waterloo", artist: "ABBA" },
    }),
  });

  expect(
    await screen.findByText("2 of 4. Paused until Ultrastar Deluxe closes."),
  ).toBeVisible();
  await waitFor(() => expect(readLoudnessPass).toHaveBeenCalledTimes(3));
  expect(
    screen.getByText("2 of 4. Paused until Ultrastar Deluxe closes."),
  ).toBeVisible();
});

test("a pass waiting for a song says so, and Stop stops it", async () => {
  withNormalize();
  readLoudnessPass.mockResolvedValue({
    data: loudnessPass({ state: "running", total: 4, done: 1, waiting: true }),
  });
  stopLoudnessPass.mockResolvedValue({
    data: loudnessPass({
      ended: "stopped",
      total: 4,
      done: 1,
      counts: { ...loudnessPass().counts, tagged: 1 },
    }),
  });
  renderSettings();

  expect(
    await screen.findByText("2 of 4. Paused until Ultrastar Deluxe closes."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));

  expect(
    await screen.findByText("Stopped after 1 of 4. Evened out 1 song."),
  ).toBeVisible();
  expect(stopLoudnessPass).toHaveBeenCalledTimes(1);
});

test("a pass that could not start says why", async () => {
  withNormalize();
  readLoudnessPass.mockResolvedValue({
    data: loudnessPass({ ended: "failed", error: "ffmpeg not found." }),
  });
  renderSettings();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "ffmpeg not found.",
  );
  expect(screen.getByText(LOUDNESS_PASS_NOTE)).toBeVisible();
});

test("view-only access gets no row to even out the songs", async () => {
  withNormalize();
  getMe.mockResolvedValue(
    meResponse(["settings.view"], {
      user: userRead({ role: "user" }),
      role: "user",
    }),
  );
  renderSettings();

  expect(await screen.findByLabelText("Normalize loudness")).toBeDisabled();
  expect(
    screen.queryByText("Songs already in the library"),
  ).not.toBeInTheDocument();
  expect(readLoudnessPass).not.toHaveBeenCalled();
});
