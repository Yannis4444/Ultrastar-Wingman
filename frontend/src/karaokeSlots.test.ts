import { parseSlots, recolored, resized } from "./karaokeSlots";

// USDX's own order, which is the order new slots are filled from.
const PALETTE = ["blue", "red", "green", "yellow", "orange", "pink"];

test("the stored string is read as a list, whitespace and all", () => {
  expect(parseSlots("blue, red ,green")).toEqual(["blue", "red", "green"]);
  expect(parseSlots("")).toEqual([]);
  expect(parseSlots(null)).toEqual([]);
});

test("growing takes the next colors nobody has yet", () => {
  expect(resized(["green"], 4, PALETTE)).toEqual([
    "green",
    "blue",
    "red",
    "yellow",
  ]);
});

test("shrinking drops the slots from the end", () => {
  expect(resized(["green", "blue", "red"], 2, PALETTE)).toEqual([
    "green",
    "blue",
  ]);
});

test("a color nobody had replaces the slot's own", () => {
  expect(recolored(["blue", "red"], 0, "pink")).toEqual(["pink", "red"]);
});

test("a color another slot has is swapped, never duplicated", () => {
  expect(recolored(["blue", "red", "green"], 2, "blue")).toEqual([
    "green",
    "red",
    "blue",
  ]);
});
