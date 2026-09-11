import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SettingRead } from "../api";
import VolumeField from "./VolumeField";

const { updateSetting } = vi.hoisted(() => ({ updateSetting: vi.fn() }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  updateSetting,
}));

function setting(overrides: Partial<SettingRead> = {}): SettingRead {
  return {
    key: "sound.music_volume",
    value: 60,
    default: 60,
    value_type: "int",
    group: "Sound",
    description: "How loud the background music is.",
    secret: false,
    advanced: false,
    is_set: false,
    ...overrides,
  };
}

function draw(overrides: Partial<SettingRead> = {}, readOnly = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <VolumeField setting={setting(overrides)} readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateSetting.mockResolvedValue({ data: setting({ value: 25 }) });
});

test("a volume is a slider, not a box to type a number into", () => {
  draw();
  const slider = screen.getByRole("slider", {
    name: "Music volume",
  });
  expect(slider).toHaveAttribute("type", "range");
  expect(slider).toHaveValue("60");
});

test("the row says the number out loud, so it can be read back", () => {
  draw();
  expect(screen.getByText("60%")).toBeInTheDocument();
});

test("dragging writes once, after the finger settles", async () => {
  draw();
  const slider = screen.getByRole("slider");

  fireEvent.change(slider, { target: { value: "40" } });
  fireEvent.change(slider, { target: { value: "30" } });
  fireEvent.change(slider, { target: { value: "25" } });

  await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
  expect(updateSetting.mock.calls[0][0].body).toEqual({ value: 25 });
});

test("a reader who may only look cannot move it", () => {
  draw({}, true);
  expect(screen.getByRole("slider")).toBeDisabled();
});

test("only a volume that is not the default offers a way back", () => {
  const { unmount } = draw();
  expect(
    screen.queryByRole("button", { name: /^Reset/ }),
  ).not.toBeInTheDocument();
  unmount();

  draw({ value: 20 });
  expect(screen.getByRole("button", { name: /^Reset/ })).toBeInTheDocument();
});
