import type { Condition, SelectorClause } from "./api";
import {
  achievementColorClass,
  achievementDescription,
  achievementGlyph,
  achievementIconUrl,
  achievementName,
  COMPARATOR_LABELS,
  COMPARATORS,
  conditionHasProgress,
  conditionProblem,
  conditionSentence,
  conditionTarget,
  importSummary,
  isMasked,
  MAX_PATTERN_LENGTH,
  METRIC_LABELS,
  METRICS,
  progressFraction,
  progressLabel,
  REGEX_NOTE,
  SELECTOR_FIELD_KINDS,
  SELECTOR_FIELD_OPS,
  SELECTOR_FIELDS,
  SELECTOR_OP_LABELS,
  selectorOpFor,
  songMode,
} from "./achievements";
import {
  achievementRead,
  condition,
  maskedAchievementRead,
} from "./test/achievements";

describe("achievementIconUrl", () => {
  it("names the icon endpoint of the achievement", () => {
    expect(achievementIconUrl("a-golden")).toBe(
      "/api/v1/achievements/a-golden/icon",
    );
  });

  it("escapes an id that would otherwise change the path", () => {
    expect(achievementIconUrl("a/b?c")).toBe(
      "/api/v1/achievements/a%2Fb%3Fc/icon",
    );
  });

  it("keeps one stable URL when there is no version to add", () => {
    // No picture, a file that has gone, or a masked row: `icon_version` is
    // null, and the URL must not gain a query that changes on every render.
    expect(achievementIconUrl("a-golden", null)).toBe(
      achievementIconUrl("a-golden"),
    );
  });

  it("carries the row's version, so a replaced picture is fetched again", () => {
    expect(achievementIconUrl("a-golden", 3)).toBe(
      "/api/v1/achievements/a-golden/icon?v=3",
    );
  });
});

describe("achievementGlyph", () => {
  it("takes the glyph the achievement names", () => {
    expect(achievementGlyph("crown")).toBe("crown");
  });

  it("falls back to the feature's own glyph, never to nothing", () => {
    expect(achievementGlyph(null)).toBe("trophy");
    // A glyph a newer backend knows and this build does not.
    expect(achievementGlyph("unicorn")).toBe("trophy");
  });
});

describe("achievementColorClass", () => {
  it("uses the tags' four classes and no others", () => {
    expect(achievementColorClass("gold")).toBe("tag-color-gold");
    expect(achievementColorClass("blue")).toBe("tag-color-blue");
  });

  it("reads an unknown colour as the plain one", () => {
    expect(achievementColorClass("chartreuse")).toBe("tag-color-neutral");
  });
});

describe("a masked achievement", () => {
  it("is the one whose name the API blanked", () => {
    expect(isMasked(maskedAchievementRead())).toBe(true);
    expect(isMasked(achievementRead())).toBe(false);
    // Hidden but earned: the whole row comes through, and nothing is masked.
    expect(isMasked(achievementRead({ hidden: true }))).toBe(false);
  });

  it("stands in for the name and the sentence without giving either away", () => {
    const masked = maskedAchievementRead();
    expect(achievementName(masked)).toBe("Hidden achievement");
    expect(achievementDescription(masked)).toBe(
      "Earn it to find out what this is.",
    );
  });

  it("leaves an ordinary row exactly as it came", () => {
    const row = achievementRead();
    expect(achievementName(row)).toBe("Golden Voice");
    expect(achievementDescription(row)).toBe("Score 9,000 or more in a song.");
  });
});

describe("progress", () => {
  it("is the fraction of the target reached", () => {
    expect(progressFraction(7, 10)).toBeCloseTo(0.7);
    expect(progressLabel(7, 10)).toBe("7 / 10");
  });

  it("never runs past the target", () => {
    expect(progressFraction(14, 10)).toBe(1);
    expect(progressLabel(14, 10)).toBe("10 / 10");
  });

  it("draws no bar when there is no progress to draw", () => {
    // A masked row, and one whose conditions are none of them monotone.
    expect(progressFraction(null, 10)).toBeNull();
    expect(progressFraction(3, null)).toBeNull();
    expect(progressLabel(null, null)).toBeNull();
  });

  it("draws none for a target nobody has to reach", () => {
    expect(progressFraction(0, 0)).toBeNull();
    expect(progressLabel(2, -1)).toBeNull();
  });
});

describe("importSummary", () => {
  const NAMES: Record<string, string> = {
    "a-golden": "Golden Voice",
    "a-duet": "Duettist",
    "a-night": "Night Owl",
    "a-early": "Early Bird",
  };
  const nameOf = (id: string): string => NAMES[id] ?? id;

  it("names both halves while there are few enough to read", () => {
    expect(
      importSummary({ created: ["a-golden"], updated: ["a-duet"] }, nameOf),
    ).toBe("Added Golden Voice and updated Duettist.");
  });

  it("counts instead of listing once a side runs long", () => {
    expect(
      importSummary(
        {
          created: [],
          updated: ["a-golden", "a-duet", "a-night", "a-early"],
        },
        nameOf,
      ),
    ).toBe("Updated 4 achievements.");
  });

  it("says nothing about a side nothing happened on", () => {
    expect(
      importSummary({ created: ["a-golden", "a-duet"], updated: [] }, nameOf),
    ).toBe("Added Golden Voice and Duettist.");
  });

  it("falls back to the id of an achievement the page has not seen yet", () => {
    // What a just-created one is until the refetch lands — and an id is still
    // truer than a blank.
    expect(
      importSummary({ created: ["a-stranger"], updated: [] }, nameOf),
    ).toBe("Added a-stranger.");
  });

  it("never answers with nothing at all", () => {
    expect(importSummary({ created: [], updated: [] }, nameOf)).toBe(
      "The archive held nothing to import.",
    );
  });
});

describe("conditionTarget", () => {
  it("is the value itself for `at least`", () => {
    expect(conditionTarget(condition({ comparator: ">=", value: 9000 }))).toBe(
      9000,
    );
  });

  it("is one past it for `more than` — that has to be exceeded", () => {
    expect(conditionTarget(condition({ comparator: ">", value: 9000 }))).toBe(
      9001,
    );
  });

  it("is nothing at all for the three that count downwards", () => {
    for (const comparator of ["=", "<=", "<"] as const)
      expect(conditionTarget(condition({ comparator }))).toBeNull();
  });

  it("is nothing for a target everybody has already reached", () => {
    expect(
      conditionTarget(condition({ comparator: ">=", value: 0 })),
    ).toBeNull();
    expect(conditionHasProgress(condition({ comparator: ">", value: 0 }))).toBe(
      true,
    );
    expect(conditionHasProgress(condition({ comparator: "<" }))).toBe(false);
  });
});

describe("the editor's vocabulary", () => {
  it("names every metric the backend has, once each", () => {
    expect([...METRICS].sort()).toEqual(Object.keys(METRIC_LABELS).sort());
    expect(METRIC_LABELS.any_score).toBe("Any score");
    expect(METRIC_LABELS.different_artists).toBe("Different artists");
  });

  it("names every comparator, loosest first", () => {
    expect([...COMPARATORS]).toEqual([">=", ">", "=", "<=", "<"]);
    expect([...COMPARATORS].sort()).toEqual(
      Object.keys(COMPARATOR_LABELS).sort(),
    );
    expect(COMPARATOR_LABELS[">="]).toBe("at least");
  });

  it("gives every selector field a kind and at least one operator", () => {
    for (const field of SELECTOR_FIELDS) {
      expect(SELECTOR_FIELD_KINDS[field]).toBeDefined();
      expect(SELECTOR_FIELD_OPS[field].length).toBeGreaterThan(0);
    }
    expect([...SELECTOR_FIELD_OPS.year]).toEqual(["=", ">=", "<="]);
    expect([...SELECTOR_FIELD_OPS.is_duet]).toEqual(["equals"]);
  });

  it("offers a pattern on every text field and on no other", () => {
    for (const field of [
      "title",
      "artist",
      "genre",
      "language",
      "edition",
    ] as const)
      expect(SELECTOR_FIELD_OPS[field]).toContain("regex");
    for (const field of ["year", "is_duet", "has_video"] as const)
      expect(SELECTOR_FIELD_OPS[field]).not.toContain("regex");
    // Last of the four, being the specialist: a fresh text clause starts on
    // `contains`, which is what a host reaches for.
    expect([...SELECTOR_FIELD_OPS.title]).toEqual([
      "contains",
      "equals",
      "starts_with",
      "regex",
    ]);
    expect(SELECTOR_OP_LABELS.regex).toBe("matches regex");
  });

  it("says all four things nobody can guess about a pattern", () => {
    // Where it matches, whether case counts, who has the last word, and the one
    // shape the backend refuses outright — that last one said here rather than
    // checked, because deciding it needs a regex parser.
    expect(REGEX_NOTE).toContain("anywhere in the field");
    expect(REGEX_NOTE).toContain("ignores case");
    expect(REGEX_NOTE).toContain("(?-i:Love)");
    expect(REGEX_NOTE).toContain("refuses");
    expect(REGEX_NOTE).toContain("wrap one around another");
  });
});

describe("selectorOpFor", () => {
  it("keeps the operator when the new field takes it", () => {
    expect(selectorOpFor("artist", "starts_with")).toBe("starts_with");
  });

  it("falls to the field's own first one when it does not", () => {
    // Genre `contains …` switched to Year: `contains` is not a year question.
    expect(selectorOpFor("year", "contains")).toBe("=");
    expect(selectorOpFor("is_duet", "contains")).toBe("equals");
  });
});

describe("songMode", () => {
  it("is 'all' while a condition names neither songs nor a match", () => {
    expect(songMode(condition())).toBe("all");
  });

  it("reads the mode off the data, never off a flag beside it", () => {
    expect(songMode(condition({ songs: { ids: [] } }))).toBe("ids");
    expect(
      songMode(condition({ match: { combine: "all", clauses: [] } })),
    ).toBe("match");
  });
});

describe("conditionProblem", () => {
  it("finds nothing wrong with an ordinary condition", () => {
    expect(conditionProblem(condition())).toBeNull();
    expect(
      conditionProblem(condition({ score_filter: { min: 9000, max: null } })),
    ).toBeNull();
    // The ends may meet: exactly 9000 is one score, not none.
    expect(
      conditionProblem(condition({ score_filter: { min: 9000, max: 9000 } })),
    ).toBeNull();
  });

  it("refuses a minimum above the maximum, the way the models do", () => {
    expect(
      conditionProblem(condition({ score_filter: { min: 9000, max: 5000 } })),
    ).toMatch(/at most/i);
  });

  it("refuses an empty pattern and one past the cap", () => {
    const withPattern = (value: string) =>
      conditionProblem(
        condition({
          match: {
            combine: "all",
            clauses: [{ field: "title", op: "regex", value }],
          },
        }),
      );
    expect(withPattern("")).toMatch(/cannot be empty/i);
    expect(withPattern("a".repeat(MAX_PATTERN_LENGTH + 1))).toMatch(
      /longer than 200/i,
    );
    expect(withPattern("a".repeat(MAX_PATTERN_LENGTH))).toBeNull();
  });

  it("lets a pattern this browser cannot compile through, Python being the judge", () => {
    // `(?P<name>…)` is Python's named group and throws in `new RegExp`;
    // `(?<name>…)` is the browser's and Python refuses it. Neither may be
    // refused here: Save is gated on this function, and a refusal for the first
    // would block a rule the backend accepts. The backend answers for both.
    for (const value of ["(?P<song>Love)", "(?<song>Love)", "(a+", "*nope"])
      expect(
        conditionProblem(
          condition({
            match: {
              combine: "all",
              clauses: [{ field: "title", op: "regex", value }],
            },
          }),
        ),
      ).toBeNull();
  });

  it("refuses a condition that picks songs both ways", () => {
    expect(
      conditionProblem(
        condition({
          songs: { ids: ["local:a"] },
          match: { combine: "all", clauses: [] },
        }),
      ),
    ).toMatch(/never both/i);
  });
});

describe("conditionSentence", () => {
  it("says which scope it is over", () => {
    expect(conditionSentence(condition())).toBe(
      "Over all time, some score of 9000 or more.",
    );
    expect(conditionSentence(condition({ scope: "session" }))).toBe(
      "In one party, some score of 9000 or more.",
    );
  });

  it("treats a missing scope as the default the models give it", () => {
    // What a hand-edited export that left the field out parses back as.
    const scopeless = condition();
    delete scopeless.scope;
    expect(conditionSentence(scopeless)).toMatch(/^Over all time, /);
  });

  it("spells out `any score` for every comparator", () => {
    const say = (comparator: Condition["comparator"]) =>
      conditionSentence(condition({ comparator }));
    expect(say(">=")).toContain("some score of 9000 or more");
    expect(say(">")).toContain("some score above 9000");
    expect(say("=")).toContain("some score of exactly 9000");
    expect(say("<=")).toContain("some score of 9000 or less");
    expect(say("<")).toContain("some score below 9000");
  });

  it("counts in the singular when there is one of the thing", () => {
    expect(
      conditionSentence(
        condition({ metric: "number_of_sings", comparator: ">=", value: 1 }),
      ),
    ).toBe("Over all time, at least 1 sing.");
    expect(
      conditionSentence(
        condition({ metric: "number_of_sings", comparator: ">=", value: 3 }),
      ),
    ).toBe("Over all time, at least 3 sings.");
  });

  it("says what the other metrics measure", () => {
    expect(
      conditionSentence(
        condition({ metric: "sum_of_scores", value: 50000, scope: "session" }),
      ),
    ).toBe("In one party, scores adding up to at least 50000.");
    expect(
      conditionSentence(
        condition({ metric: "average_score", comparator: ">", value: 8000 }),
      ),
    ).toBe("Over all time, an average score of more than 8000.");
    expect(
      conditionSentence(
        condition({ metric: "different_artists", comparator: "<", value: 4 }),
      ),
    ).toBe("Over all time, less than 4 different artists.");
  });

  it("folds a score filter into the noun a count counts", () => {
    expect(
      conditionSentence(
        condition({
          scope: "session",
          metric: "number_of_scores",
          comparator: ">=",
          value: 3,
          score_filter: { min: 9000, max: null },
        }),
      ),
    ).toBe("In one party, at least 3 scores of 9000 or more.");
  });

  it("hangs it off the end where the metric is not a count of scores", () => {
    expect(
      conditionSentence(
        condition({
          metric: "different_songs",
          value: 5,
          score_filter: { min: null, max: 4000 },
        }),
      ),
    ).toBe(
      "Over all time, at least 5 different songs, counting only scores of 4000 or less.",
    );
    // `any_score` spends its own comparator on the number, so the filter can
    // never fold in — it would read as two thresholds on one score.
    expect(
      conditionSentence(condition({ score_filter: { min: 5000, max: 9500 } })),
    ).toBe(
      "Over all time, some score of 9000 or more, counting only scores of between 5000 and 9500.",
    );
  });

  it("spells a transposed filter out as written", () => {
    // The sentence says what the definition says. `conditionProblem` is what
    // calls it a mistake, and the editor draws both.
    expect(
      conditionSentence(condition({ score_filter: { min: 9000, max: 5000 } })),
    ).toContain("counting only scores of between 9000 and 5000");
  });

  it("counts the chosen songs, and names an empty list for what it is", () => {
    expect(
      conditionSentence(condition({ songs: { ids: ["local:a"] } })),
    ).toContain(", on one chosen song.");
    expect(
      conditionSentence(condition({ songs: { ids: ["local:a", "local:b"] } })),
    ).toContain(", on one of 2 chosen songs.");
    expect(conditionSentence(condition({ songs: { ids: [] } }))).toContain(
      ", on no song (none is chosen yet).",
    );
  });

  it("joins the clauses of a selector the way they are combined", () => {
    expect(
      conditionSentence(
        condition({
          scope: "session",
          metric: "number_of_scores",
          value: 3,
          score_filter: { min: 9000, max: null },
          match: {
            combine: "all",
            clauses: [{ field: "genre", op: "equals", value: "Rock" }],
          },
        }),
      ),
    ).toBe(
      'In one party, at least 3 scores of 9000 or more, on songs where the genre is "Rock".',
    );
    expect(
      conditionSentence(
        condition({
          match: {
            combine: "any",
            clauses: [
              { field: "title", op: "contains", value: "love" },
              { field: "artist", op: "starts_with", value: "A" },
            ],
          },
        }),
      ),
    ).toContain(
      'on songs where the title contains "love" or the artist starts with "A"',
    );
  });

  it("spells a pattern clause out rather than repeating the select's shorthand", () => {
    expect(
      conditionSentence(
        condition({
          match: {
            combine: "all",
            clauses: [{ field: "title", op: "regex", value: "^Love" }],
          },
        }),
      ),
    ).toContain(
      'on songs where the title matches the regular expression "^Love"',
    );
  });

  it("says a boolean clause in words rather than as a value", () => {
    expect(
      conditionSentence(
        condition({
          match: {
            combine: "all",
            clauses: [
              { field: "is_duet", op: "equals", value: true },
              { field: "has_video", op: "equals", value: false },
            ],
          },
        }),
      ),
    ).toContain("on songs where it is a duet and it has no video");
  });

  it("reads a year clause as a year", () => {
    const say = (op: SelectorClause["op"]) =>
      conditionSentence(
        condition({
          match: {
            combine: "all",
            clauses: [{ field: "year", op, value: 1985 }],
          },
        }),
      );
    expect(say("=")).toContain("the year is 1985.");
    expect(say(">=")).toContain("the year is 1985 or later.");
    expect(say("<=")).toContain("the year is 1985 or earlier.");
  });

  it("says nothing about songs when nothing narrows them", () => {
    // No clauses is no restriction, whichever way they would have combined —
    // `evaluate._matches` says the same, so the sentence must not imply one.
    expect(
      conditionSentence(condition({ match: { combine: "any", clauses: [] } })),
    ).toBe("Over all time, some score of 9000 or more.");
  });
});
