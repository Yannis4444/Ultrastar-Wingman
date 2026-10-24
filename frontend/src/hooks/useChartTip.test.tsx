import { fireEvent, render, screen } from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import ScoreHistogram from "../components/ScoreHistogram";

// The hook is driven through the histogram: its twenty columns tile the whole
// plot, so a tap inside it always lands on a bucket and never on the nothing
// the container's own `clear` waits for. Everything that closes such a tip has
// to come from outside the chart.

const song: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: null,
  has_video: false,
  is_duet: false,
  created_at: "2026-01-01T12:00:00Z",
  language: null,
  genre: null,
  year: null,
  edition: null,
  creator: null,
  source: "usdb",
};

let nextId = 1;

function score(value: number): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: `sing-${nextId}`,
    player_id: null,
    player_name: "Alice",
    score: value,
    difficulty: 2,
    placement: null,
    field_size: null,
    recorded_at: "2026-08-23T20:00:00Z",
    song,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

const SCORES = [score(2100), score(5100), score(6100), score(8800)];

/** jsdom has no PointerEvent and drops `pointerType` from fireEvent's options:
 * a plain event with the field assigned carries it through. */
function pointerDown(target: Element, pointerType = "touch") {
  fireEvent(
    target,
    Object.assign(new Event("pointerdown", { bubbles: true }), {
      pointerType,
    }),
  );
}

function pointerEvent(
  target: Element,
  type: "pointerover" | "pointerout",
  pointerType: string,
) {
  fireEvent(
    target,
    Object.assign(new Event(type, { bubbles: true }), { pointerType }),
  );
}

/** A finger on one bucket's column of the chart named `label`. */
function tapBucket(label: string, index: number) {
  const chart = screen.getByRole("img", { name: label });
  const column = chart.querySelectorAll("[data-tipkey]")[index];
  pointerDown(column);
  fireEvent.click(column);
}

function tips() {
  return [...document.querySelectorAll(".chart-tip")];
}

function renderPage() {
  return render(
    <>
      <h1>Scores</h1>
      <button type="button">Elsewhere</button>
      <ScoreHistogram scores={SCORES} height={96} label="Alice" />
      <ScoreHistogram scores={SCORES} height={96} label="Bob" />
    </>,
  );
}

test("the document listeners exist only while a tip is open", () => {
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  renderPage();
  const added = () =>
    add.mock.calls.filter(([type]) => type === "pointerdown").length;
  const removed = () =>
    remove.mock.calls.filter(([type]) => type === "pointerdown").length;
  expect(added()).toBe(0);

  tapBucket("Alice", 10);
  expect(added()).toBe(1);
  // Capture phase, so a target that stops propagation still closes the tip.
  expect(add.mock.calls.find(([type]) => type === "pointerdown")?.[2]).toBe(
    true,
  );

  // Another bucket of the same chart keeps the listener it has.
  tapBucket("Alice", 12);
  expect(tips()[0]).toHaveTextContent("6000 to 6500");
  expect(added()).toBe(1);
  expect(removed()).toBe(0);

  tapBucket("Alice", 12);
  expect(tips()).toHaveLength(0);
  expect(removed()).toBe(1);
  add.mockRestore();
  remove.mockRestore();
});

test("a press anywhere outside the chart closes its tip", () => {
  renderPage();

  tapBucket("Alice", 10);
  expect(tips()).toHaveLength(1);
  // The page head: nothing there listens for clicks at all.
  pointerDown(screen.getByRole("heading", { name: "Scores" }));
  expect(tips()).toHaveLength(0);

  tapBucket("Alice", 10);
  // A control that swallows the press still cannot keep the tip up.
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.addEventListener("pointerdown", (event) => event.stopPropagation());
  pointerDown(elsewhere, "mouse");
  expect(tips()).toHaveLength(0);
});

test("a press inside the chart is the chart's own: it moves the tip", () => {
  renderPage();

  tapBucket("Alice", 10);
  tapBucket("Alice", 17);
  expect(tips()).toHaveLength(1);
  expect(tips()[0]).toHaveTextContent("8500 to 9000");
});

test("Escape closes the tip", () => {
  renderPage();

  tapBucket("Alice", 10);
  fireEvent.keyDown(document, { key: "Enter" });
  expect(tips()).toHaveLength(1);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(tips()).toHaveLength(0);
});

test("a second tap on the same bucket still takes the tip away", () => {
  renderPage();

  tapBucket("Bob", 4);
  expect(tips()[0]).toHaveTextContent("2000 to 2500");
  tapBucket("Bob", 4);
  expect(tips()).toHaveLength(0);
});

test("the page holds one tip: opening one closes another chart's", () => {
  renderPage();
  const alice = screen.getByRole("img", { name: "Alice" });
  const bob = screen.getByRole("img", { name: "Bob" });

  tapBucket("Alice", 10);
  tapBucket("Bob", 17);
  expect(tips()).toHaveLength(1);
  expect(bob.querySelector(".chart-tip")).toHaveTextContent("8500 to 9000");
  expect(alice.querySelector(".chart-tip")).toBeNull();

  // A mouse hovering one chart while the other holds a tapped tip: no press,
  // and still one tip.
  pointerEvent(
    alice.querySelectorAll("[data-tipkey]")[12],
    "pointerover",
    "mouse",
  );
  expect(tips()).toHaveLength(1);
  expect(alice.querySelector(".chart-tip")).toHaveTextContent("6000 to 6500");
  expect(bob.querySelector(".chart-tip")).toBeNull();
});

test("a mouse's tip still leaves with the mouse", () => {
  renderPage();
  const column = screen
    .getByRole("img", { name: "Alice" })
    .querySelectorAll("[data-tipkey]")[10];

  pointerEvent(column, "pointerover", "mouse");
  expect(tips()[0]).toHaveTextContent("5000 to 5500");
  pointerEvent(column, "pointerout", "mouse");
  expect(tips()).toHaveLength(0);
});
