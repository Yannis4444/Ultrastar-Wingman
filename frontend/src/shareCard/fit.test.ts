import { fakeMeasure } from "../test/shareCard";
import {
  ELLIPSIS,
  ellipsize,
  fitLine,
  fitLines,
  fontString,
  wrap,
} from "./fit";

const bold52 = { size: 52, weight: "bold" as const };

test("a line that fits stays whole at its first size", () => {
  expect(fitLine("Chiara", [48, 36], "bold", 680, fakeMeasure)).toEqual({
    text: "Chiara",
    size: 48,
  });
});

test("a singer's name shrinks 48 → 36 before it is cut", () => {
  // 20 characters: 576 px at 48 bold, 432 at 36.
  const name = "Maximiliane Hohenzol";
  expect(fitLine(name, [48, 36], "bold", 500, fakeMeasure)).toEqual({
    text: name,
    size: 36,
  });
  const cut = fitLine(name, [48, 36], "bold", 300, fakeMeasure);
  expect(cut.size).toBe(36);
  expect(cut.text.endsWith(ELLIPSIS)).toBe(true);
  expect(
    fakeMeasure(cut.text, { size: 36, weight: "bold" }),
  ).toBeLessThanOrEqual(300);
});

test("an ellipsis never follows a space", () => {
  // "Alice Cooper" cut right after the space would read "Alice …".
  const font = { size: 10, weight: "normal" as const };
  const cut = ellipsize("Alice Cooper", font, 6 * 5.5 + 0.1, fakeMeasure);
  expect(cut).toBe(`Alice${ELLIPSIS}`);
});

test("an emoji is never split by the cut", () => {
  const font = { size: 10, weight: "normal" as const };
  const cut = ellipsize("🎤🎤🎤🎤🎤🎤", font, 3 * 5.5, fakeMeasure);
  expect(cut).toBe(`🎤🎤${ELLIPSIS}`);
});

test("a flag or a joined emoji is one character to the cut", () => {
  const font = { size: 10, weight: "normal" as const };
  // Each flag is two code points, each family five: Array.from would cut
  // between them and leave a lone regional letter or a bare joiner.
  const flags = "🇩🇪🇫🇷🇮🇹🇪🇸";
  const cut = ellipsize(flags, font, 4 * 5.5, fakeMeasure);
  expect(cut).toBe(`🇩🇪${ELLIPSIS}`);
  const family = "👩‍👩‍👧";
  const lines = wrap(family.repeat(4), font, 6 * 5.5, fakeMeasure);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) {
    expect(line.length % family.length).toBe(0);
  }
});

test("a right-to-left title without spaces is fitted and cut like any other", () => {
  const title = "שלום".repeat(30);
  const fitted = fitLines(title, [52, 44], "bold", 680, 2, fakeMeasure);
  expect(fitted.size).toBe(44);
  expect(fitted.lines).toHaveLength(2);
  expect(fitted.lines.every((line) => line !== "")).toBe(true);
  expect(fitted.lines[1].endsWith(ELLIPSIS)).toBe(true);
  for (const line of fitted.lines) {
    expect(fakeMeasure(line, { size: 44, weight: "bold" })).toBeLessThanOrEqual(
      680,
    );
  }
});

test("a title wraps onto two lines at 52 when it can", () => {
  const fitted = fitLines(
    "Total Eclipse of the Heart",
    [52, 44],
    "bold",
    680,
    2,
    fakeMeasure,
  );
  expect(fitted.size).toBe(52);
  expect(fitted.lines).toEqual(["Total Eclipse of the", "Heart"]);
});

test("a title steps down to 44 before it gives up a word", () => {
  // Three lines at 52, two at 44.
  const title = "Nothing's Gonna Change My Love for You Tonight";
  expect(wrap(title, bold52, 680, fakeMeasure)).toHaveLength(3);
  const fitted = fitLines(title, [52, 44], "bold", 680, 2, fakeMeasure);
  expect(fitted.size).toBe(44);
  expect(fitted.lines).toHaveLength(2);
  expect(fitted.lines.join(" ")).toBe(title);
});

test("a title too long even at 44 ends in an ellipsis on line 2, never a third", () => {
  const title =
    "Nothing's Gonna Change My Love for You (Extended Midnight Version Remastered 2011)";
  const fitted = fitLines(title, [52, 44], "bold", 680, 2, fakeMeasure);
  expect(fitted.size).toBe(44);
  expect(fitted.lines).toHaveLength(2);
  expect(fitted.lines[1].endsWith(ELLIPSIS)).toBe(true);
  for (const line of fitted.lines) {
    expect(fakeMeasure(line, { size: 44, weight: "bold" })).toBeLessThanOrEqual(
      680,
    );
  }
});

test("a word wider than the line is broken on characters, and comes back whole", () => {
  const word = "Supercalifragilisticexpialidocious".repeat(3);
  const lines = wrap(word, bold52, 680, fakeMeasure);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join("")).toBe(word);
  const fitted = fitLines(word, [52], "bold", 680, 2, fakeMeasure);
  // The second line is the word's continuation, without a space put into it.
  expect(fitted.lines[0] + fitted.lines[1].slice(0, -1)).toBe(
    word.slice(0, fitted.lines[0].length + fitted.lines[1].length - 1),
  );
});

test("the font string carries the system stack", () => {
  expect(fontString({ size: 32, weight: "bold" })).toMatch(
    /^bold 32px -apple-system, .*sans-serif$/,
  );
});
