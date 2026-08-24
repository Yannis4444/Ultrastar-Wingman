import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SettingRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Settings from "./Settings";

const { listSettings, updateSetting, getMe } = vi.hoisted(() => ({
  listSettings: vi.fn(),
  updateSetting: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSettings,
  updateSetting,
  getMe,
}));

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

const SETTINGS: SettingRead[] = [
  DIRECTORY,
  ADDITIONAL,
  USERNAME,
  PASSWORD,
  PARALLEL,
  OVERWRITE,
];

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  listSettings.mockResolvedValue({ data: SETTINGS });
  getMe.mockResolvedValue(
    meResponse(["settings.view", "settings.manage"], {
      user: userRead({ role: "admin" }),
      role: "admin",
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

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
