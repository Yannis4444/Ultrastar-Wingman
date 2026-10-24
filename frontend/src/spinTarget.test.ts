import {
  isSpinTarget,
  readSpinTarget,
  SPIN_TARGETS,
  writeSpinTarget,
} from "./spinTarget";

beforeEach(() => window.localStorage.clear());

test("the two places are the guideline's words, this screen first", () => {
  expect(SPIN_TARGETS.map((option) => option.label)).toEqual([
    "This screen",
    "Host screen",
  ]);
});

test("the choice is kept per device, and anything else reads as this screen", () => {
  expect(readSpinTarget()).toBe("local");

  writeSpinTarget("host");
  expect(readSpinTarget()).toBe("host");
  expect(window.localStorage.getItem("wingman.spinTarget")).toBe("host");

  window.localStorage.setItem("wingman.spinTarget", "the-tv");
  expect(readSpinTarget()).toBe("local");
  expect(isSpinTarget("the-tv")).toBe(false);
  expect(isSpinTarget("host")).toBe(true);
});

test("a storage that throws is a default, not a crash", () => {
  const getItem = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  const setItem = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });

  expect(readSpinTarget()).toBe("local");
  expect(() => writeSpinTarget("host")).not.toThrow();

  getItem.mockRestore();
  setItem.mockRestore();
});
