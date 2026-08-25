import { backTarget } from "./backLink";

test("a linking page's way back is read out of the router state", () => {
  expect(backTarget({ back: "/host/manage" })).toBe("/host/manage");
});

test("state that names no way back leaves the page's own default in place", () => {
  // Everything a history entry can hold: nothing (typed URL, reload of an entry
  // pushed without state), someone else's state, or a `back` that is not a path.
  expect(backTarget(null)).toBeNull();
  expect(backTarget(undefined)).toBeNull();
  expect(backTarget("/host/manage")).toBeNull();
  expect(backTarget({ scrollTo: 200 })).toBeNull();
  expect(backTarget({ back: 42 })).toBeNull();
});
