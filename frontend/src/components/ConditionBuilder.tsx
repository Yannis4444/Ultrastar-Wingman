import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { Condition, SelectorClause, SongRead } from "../api";
import { listSongsOptions } from "../api/@tanstack/react-query.gen";
import {
  COMBINE_LABELS,
  COMPARATOR_LABELS,
  COMPARATORS,
  CONDITION_SCOPES,
  conditionProblem,
  conditionSentence,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  METRICS,
  SCOPE_LABELS,
  SCOPE_NOTE,
  SELECTOR_FIELD_KINDS,
  SELECTOR_FIELD_LABELS,
  SELECTOR_FIELD_OPS,
  SELECTOR_FIELDS,
  SELECTOR_OP_LABELS,
  selectorOpFor,
  SONG_MODE_LABELS,
  SONG_MODES,
  songMode,
  type SongMode,
} from "../achievements";
import { useAuth } from "../auth";
import { Icon } from "./icons";
import Loading from "./Loading";
import PickerRow from "./PickerRow";
import SongCover from "./SongCover";
import "./ConditionBuilder.css";

interface ConditionBuilderProps {
  value: Condition[];
  onChange: (conditions: Condition[]) => void;
}

/** What "Add condition" adds: the plainest condition there is, the one a host
 *  most often wants — "some score of 9000 or better, over all time". */
function blank(): Condition {
  return {
    scope: "global",
    metric: "any_score",
    comparator: ">=",
    value: 9000,
  };
}

/**
 * The needle the songs page and the playlist picker both match on, spelled out
 * here a third time rather than lifted into a helper: it is five lines, and the
 * three surfaces are free to disagree about what "a match" means without one of
 * them having to argue the other two out of it.
 */
function matches(song: SongRead, needle: string): boolean {
  return (
    song.id === needle ||
    song.title.toLowerCase().includes(needle) ||
    song.artist.toLowerCase().includes(needle)
  );
}

/** How many search hits the inline list draws before it asks for a better
 *  needle. The playlist's picker caps at nothing, but it owns a whole modal;
 *  this list sits inside a form somebody is still filling in. */
const MAX_HITS = 20;

/**
 * A number box that may be empty. The condition's own `value` is a required
 * integer and a score filter's ends are optional, so the two cases differ only
 * in what the parent stores for "empty" — which is what `whenEmpty` says.
 *
 * The draft is the in-progress typing the props cannot hold: "" is not a
 * number, and neither is a lone minus sign. `shown` is what the parent was last
 * told to store, so the value echoing back does not wipe the box the reader is
 * still in.
 */
function NumberField({
  label,
  value,
  onChange,
  whenEmpty = null,
  hideLabel = false,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  whenEmpty?: number | null;
  hideLabel?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState<number | null>(value);
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  if (value !== shown) {
    // Somebody else changed it — a condition removed above this one, a mode
    // switched. Adjusting during render is React's own answer to a prop the
    // state is derived from.
    setShown(value);
    setDraft(value === null ? "" : String(value));
  }

  return (
    <label
      className={className ? `condition-field ${className}` : "condition-field"}
    >
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
      <input
        className="text-input text-input-quiet"
        type="number"
        inputMode="numeric"
        min={0}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = Number.parseInt(text, 10);
          const next = Number.isNaN(parsed) ? null : parsed;
          setShown(next ?? whenEmpty);
          onChange(next);
        }}
      />
    </label>
  );
}

/**
 * The "Chosen songs" half: a search box over the library and the songs already
 * picked, each with a way off the list. Its own component so the needle lives
 * with the box it belongs to, and so the library is fetched only while a
 * condition is actually choosing songs.
 */
function SongPicker({
  ids,
  onChange,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const auth = useAuth();
  const [search, setSearch] = useState("");
  const library = useQuery({
    ...listSongsOptions(),
    enabled: auth.loaded && auth.can("songs.view"),
  });

  const songs = library.data?.songs ?? [];
  const byId = new Map(songs.map((song) => [song.id, song]));
  const chosen = new Set(ids);
  const needle = search.trim().toLowerCase();
  const hits = needle
    ? songs.filter((song) => matches(song, needle)).slice(0, MAX_HITS)
    : [];

  return (
    <>
      <label className="condition-field">
        <span>Search songs</span>
        <input
          className="text-input text-input-quiet"
          placeholder="Title or artist"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {library.isLoading && <Loading />}

      {needle !== "" && (
        <ul className="picker-list condition-hits">
          {hits.map((song) => (
            <PickerRow
              key={song.id}
              lead={<SongCover song={song} />}
              title={song.title}
              meta={song.artist}
              pressed={chosen.has(song.id)}
              onClick={() =>
                onChange(
                  chosen.has(song.id)
                    ? ids.filter((id) => id !== song.id)
                    : [...ids, song.id],
                )
              }
            />
          ))}
        </ul>
      )}

      {needle !== "" && hits.length === 0 && !library.isLoading && (
        <p className="condition-help">No song matches that.</p>
      )}

      {ids.length === 0 ? (
        <p className="condition-help">
          No song is chosen yet, so nothing can satisfy this condition. Search
          above and pick the songs it is about.
        </p>
      ) : (
        <ul className="condition-chosen">
          {ids.map((id, index) => {
            const song = byId.get(id);
            return (
              <li key={id} className="condition-chosen-row">
                {song ? (
                  <SongCover song={song} />
                ) : (
                  <span className="picker-row-glyph">
                    <Icon name="music" />
                  </span>
                )}
                <span className="condition-chosen-text">
                  <span className="condition-chosen-title">
                    {/* A song that has left the library keeps its id here: it
                        is still what the condition asks for. */}
                    {song ? song.title : id}
                  </span>
                  <span className="condition-chosen-meta">
                    {song ? song.artist : "Not in the library"}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  aria-label={`Remove ${song ? song.title : id}`}
                  onClick={() =>
                    onChange(ids.filter((_, other) => other !== index))
                  }
                >
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The value a clause takes when its field changes kind: what was there if it
 *  still fits, the emptiest thing of the new kind otherwise. */
function valueFor(
  field: SelectorClause["field"],
  previous: SelectorClause["value"],
): SelectorClause["value"] {
  const kind = SELECTOR_FIELD_KINDS[field];
  if (kind === "boolean")
    return typeof previous === "boolean" ? previous : true;
  if (kind === "number") return typeof previous === "number" ? previous : 0;
  return typeof previous === "string" ? previous : "";
}

/**
 * The conditions of an achievement, as boxes somebody can fill in. Every
 * condition is one flat block (§1.1 — a hairline and 16px, never a card), and
 * under its heading it reads as the sentence it will mean: the summary line is
 * the only thing in here that says what four selects add up to.
 *
 * Controlled all the way down. The only state of its own is what a half-typed
 * number and a half-typed search cannot be held as data — everything else goes
 * out through `onChange` the moment it changes, so the editor around it never
 * has a definition that disagrees with what is on screen.
 *
 * Which songs a condition is about is read off the data, never held beside it:
 * `songs` and `match` are mutually exclusive in the models, so switching mode
 * clears the other one and there is no way to build a definition the backend
 * would refuse.
 */
export default function ConditionBuilder({
  value,
  onChange,
}: ConditionBuilderProps) {
  // The radio groups of one block must not answer to the radios of another, and
  // two builders could in principle share a document.
  const group = useId();

  function update(index: number, next: Condition) {
    onChange(value.map((condition, i) => (i === index ? next : condition)));
  }

  function setFilter(index: number, end: "min" | "max", next: number | null) {
    const condition = value[index];
    const min = end === "min" ? next : (condition.score_filter?.min ?? null);
    const max = end === "max" ? next : (condition.score_filter?.max ?? null);
    update(index, {
      ...condition,
      // Both ends open is no filter at all, not a filter of two nulls: it is
      // what the plainest condition looks like, and what an export should hold.
      score_filter: min === null && max === null ? null : { min, max },
    });
  }

  function setMode(index: number, mode: SongMode) {
    const condition = value[index];
    update(index, {
      ...condition,
      songs: mode === "ids" ? { ids: [] } : null,
      match: mode === "match" ? { combine: "all", clauses: [] } : null,
    });
  }

  function setClauses(index: number, clauses: SelectorClause[]) {
    const condition = value[index];
    update(index, {
      ...condition,
      match: { combine: condition.match?.combine ?? "all", clauses },
    });
  }

  return (
    <div className="condition-builder">
      {value.map((condition, index) => {
        const mode = songMode(condition);
        const problem = conditionProblem(condition);
        const clauses = condition.match?.clauses ?? [];

        return (
          <div className="condition-block" key={index}>
            <div className="condition-head">
              <h3 className="condition-title">Condition {index + 1}</h3>
              <button
                type="button"
                className="icon-button icon-button-danger"
                aria-label={`Remove condition ${index + 1}`}
                title="Remove condition"
                onClick={() =>
                  onChange(value.filter((_, other) => other !== index))
                }
              >
                <Icon name="close" />
              </button>
            </div>

            {/* What the four selects add up to, in one sentence. It is what
                tells a host they built the thing they meant to build. */}
            <p className="condition-sentence">{conditionSentence(condition)}</p>

            {/* ------------------------------------------------------ scope */}
            <fieldset className="condition-pills">
              <legend className="visually-hidden">
                What this condition looks at
              </legend>
              {CONDITION_SCOPES.map((scope) => (
                <label key={scope} className="condition-pill">
                  <input
                    className="visually-hidden"
                    type="radio"
                    name={`${group}-scope-${index}`}
                    value={scope}
                    checked={(condition.scope ?? "global") === scope}
                    onChange={() => update(index, { ...condition, scope })}
                  />
                  <span className="condition-pill-text">
                    {SCOPE_LABELS[scope]}
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="condition-help">{SCOPE_NOTE}</p>

            {/* ------------------------------------------------ measurement */}
            <label className="condition-field">
              <span>What is measured</span>
              <select
                className="text-input text-input-quiet"
                value={condition.metric}
                onChange={(event) =>
                  update(index, {
                    ...condition,
                    metric: event.target.value as Condition["metric"],
                  })
                }
              >
                {METRICS.map((metric) => (
                  <option key={metric} value={metric}>
                    {METRIC_LABELS[metric]}
                  </option>
                ))}
              </select>
            </label>
            <p className="condition-help">
              {METRIC_DESCRIPTIONS[condition.metric]}
            </p>

            {/* Its own line: at 390px the metric select alone fills the width,
                and a comparator squeezed in beside it would leave the number
                box three characters wide. */}
            <div className="condition-pair">
              <label className="condition-field">
                <span>Has to be</span>
                <select
                  className="text-input text-input-quiet"
                  value={condition.comparator}
                  onChange={(event) =>
                    update(index, {
                      ...condition,
                      comparator: event.target.value as Condition["comparator"],
                    })
                  }
                >
                  {COMPARATORS.map((comparator) => (
                    <option key={comparator} value={comparator}>
                      {COMPARATOR_LABELS[comparator]}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Number"
                value={condition.value}
                whenEmpty={0}
                onChange={(next) =>
                  update(index, { ...condition, value: next ?? 0 })
                }
              />
            </div>

            {/* ----------------------------------------------- score filter */}
            <h4 className="condition-subhead">Only count scores</h4>
            <div className="condition-pair">
              <NumberField
                label="At least"
                value={condition.score_filter?.min ?? null}
                onChange={(next) => setFilter(index, "min", next)}
              />
              <NumberField
                label="At most"
                value={condition.score_filter?.max ?? null}
                onChange={(next) => setFilter(index, "max", next)}
              />
            </div>
            <p className="condition-help">
              Leave them empty and every score counts.
            </p>
            {problem && (
              <p className="error-notice condition-error" role="alert">
                {problem}
              </p>
            )}

            {/* ------------------------------------------------ which songs */}
            <h4 className="condition-subhead">Which songs</h4>
            <label className="condition-field">
              {/* A quiet select rather than three pills: "All songs · Chosen
                  songs · Songs matching" is ~330px of pill at 0.85em and there
                  are 328 to put them in at 360px, and a segmented choice that
                  wraps two-and-one reads as an accident. §7's "Pick from" is
                  the same call. */}
              <span>Songs that count</span>
              <select
                className="text-input text-input-quiet"
                value={mode}
                onChange={(event) =>
                  setMode(index, event.target.value as SongMode)
                }
              >
                {SONG_MODES.map((option) => (
                  <option key={option} value={option}>
                    {SONG_MODE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>

            {mode === "ids" && (
              <SongPicker
                ids={condition.songs?.ids ?? []}
                onChange={(ids) =>
                  update(index, { ...condition, songs: { ids } })
                }
              />
            )}

            {mode === "match" && (
              <>
                <label className="condition-field">
                  <span>Songs have to match</span>
                  <select
                    className="text-input text-input-quiet"
                    value={condition.match?.combine ?? "all"}
                    onChange={(event) =>
                      update(index, {
                        ...condition,
                        match: {
                          combine: event.target.value as "all" | "any",
                          clauses,
                        },
                      })
                    }
                  >
                    {(["all", "any"] as const).map((combine) => (
                      <option key={combine} value={combine}>
                        {COMBINE_LABELS[combine]}
                      </option>
                    ))}
                  </select>
                </label>

                <ul className="condition-clauses">
                  {clauses.map((clause, position) => {
                    const kind = SELECTOR_FIELD_KINDS[clause.field];
                    const name = `Song rule ${position + 1}`;
                    const replace = (next: SelectorClause) =>
                      setClauses(
                        index,
                        clauses.map((other, i) =>
                          i === position ? next : other,
                        ),
                      );

                    return (
                      <li key={position} className="condition-clause">
                        <select
                          className="text-input text-input-quiet condition-clause-field"
                          aria-label={`${name} field`}
                          value={clause.field}
                          onChange={(event) => {
                            const field = event.target
                              .value as SelectorClause["field"];
                            replace({
                              field,
                              op: selectorOpFor(field, clause.op),
                              value: valueFor(field, clause.value),
                            });
                          }}
                        >
                          {SELECTOR_FIELDS.map((field) => (
                            <option key={field} value={field}>
                              {SELECTOR_FIELD_LABELS[field]}
                            </option>
                          ))}
                        </select>

                        <select
                          className="text-input text-input-quiet condition-clause-op"
                          aria-label={`${name} test`}
                          value={clause.op}
                          onChange={(event) =>
                            replace({
                              ...clause,
                              op: event.target.value as SelectorClause["op"],
                            })
                          }
                        >
                          {SELECTOR_FIELD_OPS[clause.field].map((op) => (
                            <option key={op} value={op}>
                              {SELECTOR_OP_LABELS[op]}
                            </option>
                          ))}
                        </select>

                        {kind === "boolean" ? (
                          <select
                            className="text-input text-input-quiet condition-clause-value"
                            aria-label={`${name} value`}
                            value={clause.value === true ? "yes" : "no"}
                            onChange={(event) =>
                              replace({
                                ...clause,
                                value: event.target.value === "yes",
                              })
                            }
                          >
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        ) : kind === "number" ? (
                          <NumberField
                            label={`${name} value`}
                            hideLabel
                            className="condition-clause-value"
                            value={
                              typeof clause.value === "number"
                                ? clause.value
                                : 0
                            }
                            whenEmpty={0}
                            onChange={(next) =>
                              replace({ ...clause, value: next ?? 0 })
                            }
                          />
                        ) : (
                          <input
                            className="text-input text-input-quiet condition-clause-value"
                            aria-label={`${name} value`}
                            value={String(clause.value)}
                            onChange={(event) =>
                              replace({ ...clause, value: event.target.value })
                            }
                          />
                        )}

                        <button
                          type="button"
                          className="icon-button icon-button-danger"
                          aria-label={`Remove ${name.toLowerCase()}`}
                          onClick={() =>
                            setClauses(
                              index,
                              clauses.filter((_, i) => i !== position),
                            )
                          }
                        >
                          <Icon name="close" />
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <button
                  type="button"
                  className="condition-add"
                  onClick={() =>
                    setClauses(index, [
                      ...clauses,
                      { field: "title", op: "contains", value: "" },
                    ])
                  }
                >
                  <Icon name="plus" />
                  <span>Add song rule</span>
                </button>
              </>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="condition-add condition-add-outer"
        onClick={() => onChange([...value, blank()])}
      >
        <Icon name="plus" />
        <span>Add condition</span>
      </button>
    </div>
  );
}
