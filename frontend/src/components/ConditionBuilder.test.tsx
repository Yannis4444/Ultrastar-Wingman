import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Condition, SelectorClause, SongRead } from "../api";
import { meResponse } from "../test/auth";
import { condition } from "../test/achievements";
import ConditionBuilder from "./ConditionBuilder";

const { getMe, listSongs } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSongs: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSongs,
}));

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "local:abc",
    source: "local",
    title: "Africa",
    artist: "Toto",
    duration_seconds: 295,
    has_video: false,
    is_duet: false,
    language: "English",
    genre: "Pop",
    year: 1982,
    edition: null,
    creator: null,
    ...overrides,
  };
}

const HEY = song({ id: "local:def", title: "Hey Jude", artist: "The Beatles" });

/** Renders the builder and hands back the `onChange` every assertion reads: the
 *  component is controlled, so what it emitted *is* what it did. */
function renderBuilder(value: Condition[]) {
  const onChange = vi.fn<(conditions: Condition[]) => void>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ConditionBuilder value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

/** The same, for a test that wants to hand the builder a new value — a real
 *  editor re-renders it with what it emitted, and the operator list has to
 *  follow the field it arrives with. */
function renderBuilderWith(value: Condition) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ConditionBuilder value={[value]} onChange={() => {}} />
    </QueryClientProvider>,
  );
  return {
    container: view.container,
    rerender: (next: Condition) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <ConditionBuilder value={[next]} onChange={() => {}} />
        </QueryClientProvider>,
      ),
  };
}

/** The whole list the last `onChange` emitted. */
function emittedAll(onChange: ReturnType<typeof vi.fn>): Condition[] {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as Condition[];
}

/** The one condition of it a test is about. */
function emitted(onChange: ReturnType<typeof vi.fn>, index = 0): Condition {
  return emittedAll(onChange)[index];
}

/** And the one clause of that condition's selector. */
function emittedClause(
  onChange: ReturnType<typeof vi.fn>,
  position = 0,
): SelectorClause {
  const clauses = emitted(onChange).match?.clauses ?? [];
  return clauses[position];
}

beforeEach(() => {
  getMe.mockResolvedValue(meResponse(["songs.view", "achievements.manage"]));
  listSongs.mockResolvedValue({ data: { songs: [song(), HEY] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

it("draws one block per condition, each with the way out of it", () => {
  renderBuilder([condition(), condition({ scope: "session" })]);

  expect(screen.getByRole("heading", { name: "Condition 1" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Condition 2" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Remove condition 2" }),
  ).toBeVisible();
});

it("says what each condition means in a sentence", () => {
  renderBuilder([
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
  ]);

  expect(
    screen.getByText(
      'In one party, at least 3 scores of 9000 or more, on songs where the genre is "Rock".',
    ),
  ).toBeVisible();
});

it("emits the metric that was chosen", () => {
  const onChange = renderBuilder([condition()]);

  fireEvent.change(screen.getByLabelText("What is measured"), {
    target: { value: "different_artists" },
  });

  expect(emitted(onChange).metric).toBe("different_artists");
});

it("explains the metric that is chosen, `any score` above all", () => {
  renderBuilder([condition({ metric: "any_score" })]);

  expect(screen.getByText(/their worst/)).toBeVisible();
});

it("emits the comparator and the number beside it", () => {
  const onChange = renderBuilder([condition()]);

  fireEvent.change(screen.getByLabelText("Has to be"), {
    target: { value: "<=" },
  });
  expect(emitted(onChange).comparator).toBe("<=");

  fireEvent.change(screen.getByLabelText("Number"), {
    target: { value: "7500" },
  });
  expect(emitted(onChange).value).toBe(7500);
});

it("switches the scope between all time and one party", () => {
  const onChange = renderBuilder([condition()]);

  expect(screen.getByRole("radio", { name: "All time" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "One party" }));

  expect(emitted(onChange).scope).toBe("session");
});

describe("the score filter", () => {
  it("emits both ends, and drops the filter when both are cleared", () => {
    const onChange = renderBuilder([condition()]);

    fireEvent.change(screen.getByLabelText("At least"), {
      target: { value: "9000" },
    });
    expect(emitted(onChange).score_filter).toEqual({ min: 9000, max: null });
  });

  it("clears back to empty, which is every score counting", () => {
    const onChange = renderBuilder([
      condition({ score_filter: { min: 9000, max: null } }),
    ]);

    fireEvent.change(screen.getByLabelText("At least"), {
      target: { value: "" },
    });

    expect(emitted(onChange).score_filter).toBeNull();
  });

  it("refuses a minimum above the maximum where it was typed", () => {
    renderBuilder([condition({ score_filter: { min: 9000, max: 5000 } })]);

    expect(screen.getByRole("alert")).toHaveTextContent(/at most/i);
  });

  it("says nothing while the range holds something", () => {
    renderBuilder([condition({ score_filter: { min: 5000, max: 9000 } })]);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("which songs count", () => {
  it("clears the chosen list when it goes back to every song", () => {
    const onChange = renderBuilder([
      condition({ songs: { ids: ["local:abc"] } }),
    ]);

    fireEvent.change(screen.getByLabelText("Songs that count"), {
      target: { value: "all" },
    });

    expect(emitted(onChange).songs).toBeNull();
    expect(emitted(onChange).match).toBeNull();
  });

  it("never has a list and a match at once", () => {
    const onChange = renderBuilder([
      condition({ songs: { ids: ["local:abc"] } }),
    ]);

    fireEvent.change(screen.getByLabelText("Songs that count"), {
      target: { value: "match" },
    });

    expect(emitted(onChange).songs).toBeNull();
    expect(emitted(onChange).match).toEqual({ combine: "all", clauses: [] });
  });

  it("drops a selector when the chosen list takes over", () => {
    const onChange = renderBuilder([
      condition({
        match: {
          combine: "all",
          clauses: [{ field: "genre", op: "equals", value: "Rock" }],
        },
      }),
    ]);

    fireEvent.change(screen.getByLabelText("Songs that count"), {
      target: { value: "ids" },
    });

    expect(emitted(onChange).match).toBeNull();
    expect(emitted(onChange).songs).toEqual({ ids: [] });
  });
});

describe("choosing songs", () => {
  it("finds a song by what is typed and adds it to the list", async () => {
    const onChange = renderBuilder([condition({ songs: { ids: [] } })]);

    fireEvent.change(screen.getByLabelText("Search songs"), {
      target: { value: "hey" },
    });

    const hit = await screen.findByRole("button", { name: /Hey Jude/ });
    fireEvent.click(hit);

    expect(emitted(onChange).songs).toEqual({ ids: ["local:def"] });
  });

  it("takes a chosen song off the list again", async () => {
    const onChange = renderBuilder([
      condition({ songs: { ids: ["local:abc"] } }),
    ]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Africa" }),
    );

    expect(emitted(onChange).songs).toEqual({ ids: [] });
  });

  it("keeps a song that has left the library on the list, by its id", async () => {
    renderBuilder([condition({ songs: { ids: ["usdb:gone"] } })]);

    await waitFor(() => expect(listSongs).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Remove usdb:gone" }),
    ).toBeVisible();
  });
});

describe("the song rules", () => {
  const MATCHING = condition({
    match: {
      combine: "all",
      clauses: [{ field: "title", op: "contains", value: "love" }],
    },
  });

  it("adds a rule and takes one away", () => {
    const onChange = renderBuilder([MATCHING]);

    fireEvent.click(screen.getByRole("button", { name: "Add song rule" }));
    expect(emitted(onChange).match?.clauses).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove song rule 1" }));
    expect(emitted(onChange).match?.clauses).toEqual([]);
  });

  it("switches how the rules are combined", () => {
    const onChange = renderBuilder([MATCHING]);

    fireEvent.change(screen.getByLabelText("Songs have to match"), {
      target: { value: "any" },
    });

    expect(emitted(onChange).match?.combine).toBe("any");
  });

  it("gives every rule its own index and its own way off", () => {
    const { container } = renderBuilderWith(
      condition({
        match: {
          combine: "all",
          clauses: [
            { field: "title", op: "contains", value: "love" },
            { field: "artist", op: "equals", value: "Toto" },
            { field: "year", op: ">=", value: 1990 },
          ],
        },
      }),
    );

    // Three rules, each numbered, so which field, test and value belong
    // together is on the screen and not a matter of counting selects.
    expect(
      [...container.querySelectorAll(".condition-clause-index")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Rule 1", "Rule 2", "Rule 3"]);

    // And each rule's controls sit inside that rule, under its own head.
    const rules = [
      ...container.querySelectorAll<HTMLElement>(".condition-clause"),
    ];
    expect(rules).toHaveLength(3);
    for (const [position, rule] of rules.entries()) {
      const name = `Song rule ${position + 1}`;
      expect(within(rule).getByLabelText(`${name} field`)).toBeVisible();
      expect(within(rule).getByLabelText(`${name} test`)).toBeVisible();
      expect(within(rule).getByLabelText(`${name} value`)).toBeVisible();
      expect(
        within(rule).getByRole("button", {
          name: `Remove ${name.toLowerCase()}`,
        }),
      ).toBeVisible();
    }
  });

  it("keeps the all/any switch outside the rules it governs", () => {
    const { container } = renderBuilderWith(MATCHING);

    // It is the list's header, not the first rule's field: no rule contains it.
    const combine = screen.getByLabelText("Songs have to match");
    for (const rule of container.querySelectorAll<HTMLElement>(
      ".condition-clause",
    ))
      expect(rule).not.toContainElement(combine);
    // And the list it heads is only drawn once there is a rule in it.
    expect(container.querySelector(".condition-clauses")).not.toBeNull();
  });

  it("draws no rule list at all while there is no rule", () => {
    const { container } = renderBuilderWith(
      condition({ match: { combine: "all", clauses: [] } }),
    );

    expect(container.querySelector(".condition-clauses")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add song rule" }),
    ).toBeInTheDocument();
  });

  it("offers only the operators the field takes", () => {
    const options = () =>
      within(screen.getByLabelText("Song rule 1 test"))
        .getAllByRole("option")
        .map((option) => option.textContent);

    const { rerender } = renderBuilderWith(MATCHING);
    expect(options()).toEqual([
      "contains",
      "is",
      "starts with",
      "matches regex",
    ]);

    rerender(
      condition({
        match: {
          combine: "all",
          clauses: [{ field: "year", op: "=", value: 1985 }],
        },
      }),
    );
    expect(options()).toEqual(["is", "at least", "at most"]);
  });

  it("keeps an operator the new field cannot take out of the data", () => {
    const onChange = renderBuilder([MATCHING]);

    fireEvent.change(screen.getByLabelText("Song rule 1 field"), {
      target: { value: "year" },
    });

    // `contains` is not a year question, and the value has to become one too.
    expect(emittedClause(onChange)).toEqual({
      field: "year",
      op: "=",
      value: 0,
    });
  });

  it("gives a boolean field a yes-or-no of its own", () => {
    const onChange = renderBuilder([
      condition({
        match: {
          combine: "all",
          clauses: [{ field: "is_duet", op: "equals", value: true }],
        },
      }),
    ]);

    const value = screen.getByLabelText("Song rule 1 value");
    expect(
      within(value)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Yes", "No"]);

    fireEvent.change(value, { target: { value: "no" } });
    expect(emittedClause(onChange).value).toBe(false);
  });

  it("emits what is typed into a text rule", () => {
    const onChange = renderBuilder([MATCHING]);

    fireEvent.change(screen.getByLabelText("Song rule 1 value"), {
      target: { value: "moon" },
    });

    expect(emittedClause(onChange).value).toBe("moon");
  });

  it("switches a text rule to a pattern and keeps the box it was typed in", () => {
    const onChange = renderBuilder([MATCHING]);

    fireEvent.change(screen.getByLabelText("Song rule 1 test"), {
      target: { value: "regex" },
    });

    // The operator alone changes: a pattern is the same text field asked a
    // different question, not a control of its own.
    expect(emittedClause(onChange)).toEqual({
      field: "title",
      op: "regex",
      value: "love",
    });
  });

  const PATTERN = (value: string) =>
    condition({
      match: {
        combine: "all",
        clauses: [{ field: "title", op: "regex", value }],
      },
    });

  it("emits a pattern exactly as it is typed", () => {
    const onChange = renderBuilder([PATTERN("^Love")]);

    fireEvent.change(screen.getByLabelText("Song rule 1 value"), {
      target: { value: String.raw`^(?-i:Live) at .*\d{4}$` },
    });

    expect(emittedClause(onChange).value).toBe(
      String.raw`^(?-i:Live) at .*\d{4}$`,
    );
  });

  it("says how a pattern behaves, and only while one is being written", () => {
    const { rerender } = renderBuilderWith(MATCHING);
    expect(screen.queryByText(/ignores case/)).not.toBeInTheDocument();

    rerender(PATTERN("^Love"));
    expect(screen.getByText(/ignores case/)).toBeVisible();
  });

  it("names an empty pattern before Save can, and nothing a browser alone dislikes", () => {
    const { rerender } = renderBuilderWith(PATTERN(""));
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be empty/i);

    // Python's own named group, which `new RegExp` refuses. Save is gated on
    // this notice, so claiming it is broken would block a rule that works.
    rerender(PATTERN("(?P<song>Love)"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

it("adds a condition, and lets the last one go", () => {
  const onChange = renderBuilder([condition()]);

  fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
  expect(emittedAll(onChange)).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Remove condition 1" }));
  // An empty list is a state this component may produce: the editor around it
  // is what warns that an achievement with no conditions is unsatisfiable.
  expect(emittedAll(onChange)).toEqual([]);
});

it("asks the library for nothing while no condition chooses songs", () => {
  renderBuilder([condition()]);

  expect(listSongs).not.toHaveBeenCalled();
});

describe("locked", () => {
  /** What a built-in's conditions are drawn as: the sentences, and nothing to
   *  press. */
  function renderLocked(value: Condition[]) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ConditionBuilder value={value} onChange={() => {}} readOnly />
      </QueryClientProvider>,
    );
  }

  it("keeps every block's heading and its sentence", () => {
    renderLocked([
      condition(),
      condition({ scope: "session", metric: "number_of_sings", value: 5 }),
    ]);

    expect(screen.getByRole("heading", { name: "Condition 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Condition 2" })).toBeVisible();
    expect(
      screen.getByText("Over all time, some score of 9000 or more."),
    ).toBeVisible();
    expect(screen.getByText("In one party, at least 5 sings.")).toBeVisible();
  });

  it("draws no control at all, so nothing can fail on Save", () => {
    renderLocked([condition({ songs: { ids: ["local:abc"] } })]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    // And the library is left alone: there is no picker to fill.
    expect(listSongs).not.toHaveBeenCalled();
  });
});
