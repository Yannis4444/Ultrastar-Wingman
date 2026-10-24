import { DEFAULT_PREFS, PREFS_KEY, readPrefs, writePrefs } from "./prefs";

beforeEach(() => window.localStorage.clear());

test("nothing stored reads as the defaults", () => {
  expect(readPrefs()).toEqual(DEFAULT_PREFS);
  // The Wingman logo is on until the reader takes it off, and a party opens
  // on its Podium.
  expect(DEFAULT_PREFS.logo).toBe(true);
  expect(DEFAULT_PREFS.partyDesign).toBe("podium");
});

test("what an older build wrote, without the logo, reads with the logo on", () => {
  window.localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ format: "story", partyNameAndDate: false }),
  );
  expect(readPrefs()).toEqual({
    ...DEFAULT_PREFS,
    format: "story",
    partyNameAndDate: false,
    logo: true,
  });
});

test("an older build's party look carries over, and its only-me is dropped", () => {
  window.localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ partyLook: "mosaic", onlyMe: true }),
  );
  expect(readPrefs()).toEqual({ ...DEFAULT_PREFS, partyDesign: "mosaic" });
  window.localStorage.setItem(PREFS_KEY, JSON.stringify({ partyLook: "dark" }));
  expect(readPrefs()).toEqual(DEFAULT_PREFS);
});

test("what was written is what is read back", () => {
  const prefs = {
    format: "story",
    scoreLook: "cover",
    partyDesign: "strip",
    otherPictures: false,
    partyNameAndDate: false,
    logo: false,
  } as const;
  writePrefs(prefs);
  expect(readPrefs()).toEqual(prefs);
});

test("Spread and You are never read back as the design to open on", () => {
  for (const partyDesign of ["spread", "you"]) {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ partyDesign }));
    expect(readPrefs().partyDesign).toBe("podium");
  }
});

test("a value this build does not know falls back alone", () => {
  window.localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      format: "portrait",
      partyDesign: "mosaic",
      logo: "off",
    }),
  );
  expect(readPrefs()).toEqual({ ...DEFAULT_PREFS, partyDesign: "mosaic" });
});

test("something that is not JSON reads as the defaults", () => {
  window.localStorage.setItem(PREFS_KEY, "{not json");
  expect(readPrefs()).toEqual(DEFAULT_PREFS);
});

test("storage that throws never reaches the panel", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readPrefs()).toEqual(DEFAULT_PREFS);
  expect(() => writePrefs(DEFAULT_PREFS)).not.toThrow();
  get.mockRestore();
  set.mockRestore();
});
