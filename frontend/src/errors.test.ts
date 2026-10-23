import {
  errorDetail,
  errorMessage,
  explainUsdxProblem,
  missingPermission,
  usdxLaunchRefusal,
  usdxProblems,
  validationMessage,
} from "./errors";

test("a 422 is read as the sentence the model refused it with", () => {
  const refusal = {
    detail: [
      {
        type: "value_error",
        loc: ["body", "definition", 0],
        msg: "Value error, '(a+' is not a valid regular expression: missing ), unterminated subpattern at position 0",
      },
    ],
  };

  expect(validationMessage(refusal)).toBe(
    "'(a+' is not a valid regular expression: missing ), unterminated subpattern at position 0.",
  );
  // The slug path must not read a list as one, and this path must not read a
  // slug or the USDX report as a validation error.
  expect(errorDetail(refusal)).toBeNull();
  expect(validationMessage({ detail: "already_playing" })).toBeNull();
  expect(
    validationMessage({ detail: { error: "usdx_not_configured" } }),
  ).toBeNull();
  expect(validationMessage(null)).toBeNull();
  expect(validationMessage({ detail: [] })).toBeNull();
  expect(validationMessage({ detail: [{ loc: ["body"] }] })).toBeNull();
});

test("a string detail is passed through, a permission denial is named", () => {
  expect(errorDetail({ detail: "already_playing" })).toBe("already_playing");
  expect(missingPermission({ detail: "missing_permission:karaoke.sing" })).toBe(
    "karaoke.sing",
  );
  expect(errorMessage({ detail: "already_playing" }, "Nope.")).toBe("Nope.");
  expect(
    errorMessage({ detail: "missing_permission:karaoke.stop" }, "Nope."),
  ).toContain("karaoke.stop");
});

test("the USDX report comes out of the object detail", () => {
  const problems = ["'songs.directory' is not set"];

  expect(
    usdxProblems({ detail: { error: "usdx_not_configured", problems } }),
  ).toEqual(problems);
  // Same body through the generic path: still an object, so still no slug.
  expect(
    errorDetail({ detail: { error: "usdx_not_configured", problems } }),
  ).toBeNull();
});

test("every other error shape stays out of the USDX path", () => {
  // A FastAPI validation error is an object detail too, and must not be read as
  // a setup problem.
  expect(
    usdxProblems({ detail: [{ loc: ["body"], msg: "field required" }] }),
  ).toBeNull();
  expect(usdxProblems({ detail: { error: "already_playing" } })).toBeNull();
  expect(usdxProblems({ detail: "already_playing" })).toBeNull();
  expect(usdxProblems({})).toBeNull();
  expect(usdxProblems(null)).toBeNull();
  // Shaped right but with junk in the list: the strings survive, the rest goes.
  expect(
    usdxProblems({
      detail: { error: "usdx_not_configured", problems: ["a", 7, null] },
    }),
  ).toEqual(["a"]);
});

test("each backend problem gets its own explanation", () => {
  const explained = [
    "'usdx.executable' is not set and cannot be derived from 'usdx.base_path'",
    "'usdx.config_file' is not set and cannot be derived from 'usdx.base_path'",
    "'usdx.avatars_dir' is not set and cannot be derived from 'usdx.base_path'",
    "'usdx.ultrastar_db' is not set and cannot be derived from 'usdx.base_path'",
    "'usdx.songs_dir' is not set and cannot be derived from 'usdx.base_path'",
    "'usdx.executable' is not a file: C:\\usdx\\nope.exe",
    "'songs.directory' is not set",
    "'songs.directory' is not a directory: D:\\gone",
    "cannot start 'C:\\usdx\\ultrastardx.exe': [WinError 216] not compatible",
  ].map(explainUsdxProblem);

  // Every one of them is turned into something else, and into something of its
  // own — no two settings share a sentence.
  expect(new Set(explained).size).toBe(explained.length);
  // No settings key leaks into the prose.
  expect(
    explained.every(
      (sentence) =>
        !sentence.includes("usdx.") && !sentence.includes("songs.directory"),
    ),
  ).toBe(true);
  expect(explained[5]).toContain("no Ultrastar Deluxe program at that path");
  expect(explained[7]).toContain("does not exist");
  // A failed launch arrives as a path problem as well, and its raw text is the one
  // that would put a host path (and a WinError) in front of a party guest.
  expect(explained[8]).toContain("refused to start");
  expect(explained[8]).not.toContain("C:\\usdx");
  expect(explained[8]).not.toContain("WinError");
});

test("the bundled folder's problems say what to do, and name no path", () => {
  const ascii = explainUsdxProblem(
    "the bundled Ultrastar Deluxe is in a folder that is not plain ASCII: C:\\Users\\Jürgen\\AppData\\Local\\Programs\\Ultrastar Wingman\\usdx",
  );
  const writable = explainUsdxProblem(
    "the bundled songs folder cannot be written to: C:\\Karaoke\\Ultrastar Wingman\\usdx\\songs",
  );

  expect(ascii).toContain("cannot start songs from there");
  expect(ascii).toContain("install it again into a plain folder");
  expect(writable).toContain("Give your Windows account the right to change");
  for (const sentence of [ascii, writable]) {
    expect(sentence).not.toContain("Jürgen");
    expect(sentence).not.toContain("C:\\Karaoke\\Ultrastar Wingman\\usdx");
    expect(sentence).not.toContain("bundled");
  }
});

test("an unknown problem is shown as it came", () => {
  expect(explainUsdxProblem("something entirely new")).toBe(
    "something entirely new",
  );
});

test("a refused launch is the song that is playing, or the setup in words", () => {
  expect(usdxLaunchRefusal({ detail: "already_playing" })).toEqual([
    "A song is playing right now. Ultrastar Deluxe is busy with it.",
  ]);
  const problems = ["something entirely new", "something else"];
  expect(
    usdxLaunchRefusal({ detail: { error: "usdx_not_configured", problems } }),
  ).toEqual(problems.map(explainUsdxProblem));
  // Anything else is the caller's to word.
  expect(usdxLaunchRefusal({ detail: "invalid_host_token" })).toBeNull();
  expect(usdxLaunchRefusal(new TypeError("Failed to fetch"))).toBeNull();
});
