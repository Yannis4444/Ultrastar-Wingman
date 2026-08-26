import { DICE_FACES, randomDiceFace } from "./dice";

afterEach(() => vi.restoreAllMocks());

test("the die has six faces with the five spelled `dice`", () => {
  expect(DICE_FACES).toHaveLength(6);
  expect(DICE_FACES[4]).toBe("dice");
});

test("a random face spans the whole die", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  expect(randomDiceFace()).toBe("dice-1");
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  expect(randomDiceFace()).toBe("dice-6");
});
