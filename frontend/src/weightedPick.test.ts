import { weightedPick } from "./weightedPick";

const weight = (item: { weight: number }) => item.weight;

test("nothing to pick from is nothing picked", () => {
  expect(weightedPick([], weight)).toBeUndefined();
});

test("a pool where nothing weighs anything picks nothing", () => {
  const items = [{ weight: 0 }, { weight: -1 }, { weight: Number.NaN }];

  expect(weightedPick(items, weight, () => 0)).toBeUndefined();
});

test("each item takes a slice of the draw as wide as its weight", () => {
  // 1 + 3 = 4: the first quarter lands on `a`, the rest on `b`.
  const a = { name: "a", weight: 1 };
  const b = { name: "b", weight: 3 };

  expect(weightedPick([a, b], weight, () => 0)).toBe(a);
  expect(weightedPick([a, b], weight, () => 0.249)).toBe(a);
  expect(weightedPick([a, b], weight, () => 0.25)).toBe(b);
  expect(weightedPick([a, b], weight, () => 0.999)).toBe(b);
});

test("an item that weighs nothing is never landed on", () => {
  const nothing = { name: "nothing", weight: 0 };
  const some = { name: "some", weight: 0.5 };

  expect(weightedPick([nothing, some], weight, () => 0)).toBe(some);
  expect(weightedPick([some, nothing], weight, () => 0.999999)).toBe(some);
});

test("the draw defaults to Math.random", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.9);
  const a = { name: "a", weight: 1 };
  const b = { name: "b", weight: 1 };

  expect(weightedPick([a, b], weight)).toBe(b);
  vi.restoreAllMocks();
});

test("many draws share out as the weights say", () => {
  // The design's three wishers: one wish, three, twenty — 1, 1 + ln 3 and
  // 1 + ln 20 of 7.094. A plain sweep of the unit interval stands in for a
  // seeded generator, so the shares are exact up to the sweep's step.
  const items = [
    { name: "a", weight: 1 },
    { name: "b", weight: 1 + Math.log(3) },
    { name: "c", weight: 1 + Math.log(20) },
  ];
  const landed = { a: 0, b: 0, c: 0 };
  const draws = 10_000;
  for (let step = 0; step < draws; step += 1) {
    const item = weightedPick(items, weight, () => (step + 0.5) / draws);
    if (item) landed[item.name as keyof typeof landed] += 1;
  }

  expect(landed.a / 100).toBeCloseTo(14.1, 0);
  expect(landed.b / 100).toBeCloseTo(29.6, 0);
  expect(landed.c / 100).toBeCloseTo(56.3, 0);
});
