import {
  achievementColorClass,
  achievementDescription,
  achievementGlyph,
  achievementIconUrl,
  achievementName,
  COMPARATOR_LABELS,
  COMPARATORS,
  conditionHasProgress,
  conditionTarget,
  isMasked,
  METRIC_LABELS,
  METRICS,
  progressFraction,
  progressLabel,
  SELECTOR_FIELD_KINDS,
  SELECTOR_FIELD_OPS,
  SELECTOR_FIELDS,
  selectorOpFor,
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

  it("keeps one stable URL when nothing says the picture moved", () => {
    // The API carries no version for an achievement's icon, so an omitted one
    // is the ordinary case and must not bust the cache on every render.
    expect(achievementIconUrl("a-golden", null)).toBe(
      achievementIconUrl("a-golden"),
    );
  });

  it("busts the cache for a caller that knows it did", () => {
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
