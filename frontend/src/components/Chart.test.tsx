import { render, screen } from "@testing-library/react";
import { buildBoxplotOption, buildHistogramOption } from "../stats";
import Chart from "./Chart";

// Every other stats test mocks this module, so this is the only place the real
// echarts wiring runs: a missing `echarts` instance or an unregistered series
// type fails on mount, and nothing else in the suite would notice.
test.each([
  ["boxplot", buildBoxplotOption([])],
  ["histogram", buildHistogramOption([])],
])("the %s chart mounts with echarts wired up", (kind, option) => {
  render(<Chart option={option} height={100} label={`${kind} chart`} />);

  expect(
    screen.getByRole("img", { name: `${kind} chart` }),
  ).toBeInTheDocument();
});
