import type { PlayerRead } from "./api";
import {
  readAssignment,
  rememberedAssignment,
  slotBody,
  writeAssignment,
} from "./playerSlots";

function player(id: string, hidden = false): PlayerRead {
  return { id, name: id, registered: false, hidden, has_avatar: false };
}

beforeEach(() => window.localStorage.clear());

test("what was written is what is read back", () => {
  writeAssignment({ blue: "aaa", red: "bbb" });

  expect(readAssignment()).toEqual({ blue: "aaa", red: "bbb" });
});

test("nothing stored, or garbage stored, reads as nobody", () => {
  expect(readAssignment()).toEqual({});

  window.localStorage.setItem("wingman.playerSlots", "{not json");
  expect(readAssignment()).toEqual({});
});

test("the body carries only the slots somebody stands on, in the colors' order", () => {
  expect(
    slotBody(["blue", "red", "green"], { green: "ccc", blue: "aaa" }),
  ).toEqual([
    { color: "blue", player_id: "aaa" },
    { color: "green", player_id: "ccc" },
  ]);
});

test("the remembered assignment drops unknown colors, gone players and hidden ones", () => {
  writeAssignment({ blue: "aaa", red: "gone", green: "ccc", yellow: "aaa" });

  expect(
    rememberedAssignment(
      [player("aaa"), player("ccc", true)],
      ["blue", "red", "green"],
    ),
  ).toEqual({ blue: "aaa" });
});
