import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SettingRead } from "../api";
import KaraokeSlotsField from "./KaraokeSlotsField";

const { listKaraokeColors, listKaraokeSlots, updateSetting } = vi.hoisted(
  () => ({
    listKaraokeColors: vi.fn(),
    listKaraokeSlots: vi.fn(),
    updateSetting: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listKaraokeColors,
  listKaraokeSlots,
  updateSetting,
}));

// The first six of USDX's sixteen, which is all these tests need to grow to.
const PALETTE = [
  { name: "blue", hex: "#048BB9" },
  { name: "red", hex: "#D00000" },
  { name: "green", hex: "#00AC00" },
  { name: "yellow", hex: "#E7E700" },
  { name: "orange", hex: "#E77300" },
  { name: "pink", hex: "#E764A3" },
];

const SETTING: SettingRead = {
  key: "karaoke.player_colors",
  value: "blue,red",
  value_type: "str",
  default: "blue,red,green,yellow",
  group: "Karaoke",
  description: "The singing slots, as Ultrastar Deluxe color names.",
  secret: false,
  is_set: true,
};

function renderField(setting: SettingRead = SETTING, readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <KaraokeSlotsField setting={setting} readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

/**
 * Both selects are filled from the backend, so a test may only touch them once
 * the palette and the counts arrived.
 */
async function ready(): Promise<void> {
  await screen.findByRole("option", { name: "6" });
  // Every slot select offers the whole palette, so "pink" is not unique.
  await screen.findAllByRole("option", { name: "pink" });
}

beforeEach(() => {
  updateSetting.mockReset();
  updateSetting.mockResolvedValue({ data: { ...SETTING } });
  listKaraokeColors.mockResolvedValue({ data: { colors: PALETTE } });
  listKaraokeSlots.mockResolvedValue({
    data: {
      slots: PALETTE.slice(0, 2),
      player_counts: [1, 2, 3, 4, 6],
    },
  });
});

test("the count and one row per slot come from the stored value", async () => {
  renderField();
  await ready();

  expect(screen.getByLabelText("Players")).toHaveValue("2");
  expect(screen.getByLabelText("Slot 1")).toHaveValue("blue");
  expect(screen.getByLabelText("Slot 2")).toHaveValue("red");
  expect(screen.queryByLabelText("Slot 3")).toBeNull();
});

test("only the counts the backend offers can be picked", async () => {
  renderField();
  await ready();

  const options = screen.getAllByRole("option", { name: /^[0-9]+$/ });
  expect(options.map((option) => option.textContent)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "6",
  ]);
});

test("raising the count appends the colors USDX would have used", async () => {
  renderField();
  await ready();

  fireEvent.change(screen.getByLabelText("Players"), {
    target: { value: "4" },
  });

  await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
  expect(updateSetting.mock.calls[0][0]).toMatchObject({
    path: { key: "karaoke.player_colors" },
    body: { value: "blue,red,green,yellow" },
  });
});

test("lowering the count drops the slots from the end", async () => {
  renderField();
  await ready();

  fireEvent.change(screen.getByLabelText("Players"), {
    target: { value: "1" },
  });

  await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
  expect(updateSetting.mock.calls[0][0].body).toEqual({ value: "blue" });
});

test("recoloring a slot saves the whole list", async () => {
  renderField();
  await ready();

  fireEvent.change(screen.getByLabelText("Slot 2"), {
    target: { value: "pink" },
  });

  await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
  expect(updateSetting.mock.calls[0][0].body).toEqual({ value: "blue,pink" });
});

test("picking a color another slot has swaps the two", async () => {
  renderField();
  await ready();

  fireEvent.change(screen.getByLabelText("Slot 2"), {
    target: { value: "blue" },
  });

  await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
  expect(updateSetting.mock.calls[0][0].body).toEqual({ value: "red,blue" });
});

test("the backend's complaint is shown verbatim", async () => {
  updateSetting.mockRejectedValueOnce({
    detail:
      "setting 'karaoke.player_colors': every player needs a color of their own",
  });
  renderField();
  await ready();

  fireEvent.change(screen.getByLabelText("Players"), {
    target: { value: "6" },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "every player needs a color of their own",
  );
});

test("without the palette the count cannot be changed", async () => {
  // Raising it would save fewer slots than the box shows: there are no colors
  // to grow into.
  listKaraokeColors.mockRejectedValue(new Error("offline"));
  renderField();
  await screen.findByRole("option", { name: "6" });

  expect(screen.getByLabelText("Players")).toBeDisabled();
  expect(screen.getByLabelText("Slot 1")).toBeDisabled();
});

test("a viewer who may not change settings gets no editable control", async () => {
  renderField(SETTING, true);
  await ready();

  expect(screen.getByLabelText("Players")).toBeDisabled();
  expect(screen.getByLabelText("Slot 1")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Reset the player slots" }),
  ).toBeNull();
});
