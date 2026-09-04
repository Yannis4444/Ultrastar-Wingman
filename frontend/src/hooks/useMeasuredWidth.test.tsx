import { render, screen } from "@testing-library/react";
import { useMeasuredWidth } from "./useMeasuredWidth";

/** The chart's own shape: a container to measure, drawn at what it reports. */
function Chart() {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(340);
  return (
    <div className="chart-plot" ref={ref}>
      <span>{width}</span>
    </div>
  );
}

/**
 * jsdom lays nothing out, so both measurements are stubbed: `clientWidth` the
 * way a browser rounds it, `getBoundingClientRect` with the fraction kept.
 */
function layout(clientWidth: number, boxWidth: number): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    clientWidth,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: boxWidth,
    height: 0,
    top: 0,
    left: 0,
    right: boxWidth,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

afterEach(() => vi.restoreAllMocks());

test("a whole-pixel box is drawn at exactly its width", () => {
  layout(289, 289);
  render(<Chart />);

  expect(screen.getByText("289")).toBeInTheDocument();
});

test("a fractional box is drawn inside it, never over its edge", () => {
  // What a zoomed browser hands the charts: `clientWidth` rounds 288.688 up to
  // 289, and a chart drawn 289 wide in that box gives the page a sideways
  // scroll of a third of a pixel (ui-guidelines §1.11).
  layout(289, 288.688);
  render(<Chart />);

  expect(screen.getByText("288")).toBeInTheDocument();
});

test("a container that measures nothing keeps the fallback", () => {
  // A `display: none` ancestor: every mark would land on x = 0.
  layout(0, 0);
  render(<Chart />);

  expect(screen.getByText("340")).toBeInTheDocument();
});
