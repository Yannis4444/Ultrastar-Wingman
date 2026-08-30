import { useId } from "react";
import { ANY_VALUE, type TagCriterion } from "../tags";
import { Icon, type IconName } from "./icons";
import Modal from "./Modal";
import "./FilterPanel.css";

/** What every row of the panel has: glyph · name · control (§4). */
interface FilterRowBase {
  /** What the page calls this criterion — `favorite`, `sung`, `tag:<id>` or
   *  `facet:<id>`. */
  key: string;
  name: string;
  icon: IconName;
  /** The `.tag-color-*` class the glyph is painted with. */
  colorClass: string;
}

/** A mark, a tag or a boolean facet: the Any / Yes / No control of §4. */
export interface TriStateFilterRow extends FilterRowBase {
  kind: "tri-state";
  value: TagCriterion;
}

/**
 * A valued facet: the same row with a quiet `<select>` where the tri-state
 * group sits (§4). `options` are the values the reader's own library holds —
 * the page reads them off the songs, because a value nothing visible carries
 * is a value nothing would match.
 */
export interface SelectFilterRow extends FilterRowBase {
  kind: "select";
  value: string;
  options: string[];
}

/** One criterion the panel asks about. */
export type FilterRow = TriStateFilterRow | SelectFilterRow;

/** Any / Yes / No, in the order ui-guidelines §4 fixes them in. */
const OPTIONS: [TagCriterion, string][] = [
  ["any", "Any"],
  ["yes", "Yes"],
  ["no", "No"],
];

/**
 * The Songs page's **Filter** panel: one row per criterion, each ending in the
 * tri-state control of §4 — or, for a valued facet, in the select that offers
 * what the library actually holds.
 *
 * Every change applies to the list behind the panel straight away — the reader
 * narrows a 500-song library by watching the count move, and a panel that only
 * committed on *Done* would hide exactly the feedback they are filtering by.
 * *Done* therefore only closes; *Reset* puts every criterion back to its
 * default, the hidden-by-default tags included.
 */
export default function FilterPanel({
  rows,
  onSet,
  onReset,
  onClose,
}: {
  rows: FilterRow[];
  onSet: (key: string, value: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // Two Filter panels never coexist, but the radio `name`s have to be unique
  // against anything else the document holds.
  const group = useId();

  return (
    <Modal title="Filter" onClose={onClose}>
      <div className="filter-panel">
        {rows.map((row) => (
          <div key={row.key} className="filter-row">
            <Icon
              name={row.icon}
              className={`filter-row-glyph ${row.colorClass}`}
            />
            <span className="filter-row-name">{row.name}</span>
            {row.kind === "tri-state" ? (
              /* The radios share a `name`, so the arrow keys walk the row the
                 way a native radio group does — no key handler of our own. */
              <fieldset className="tri-state">
                <legend className="visually-hidden">{row.name}</legend>
                {OPTIONS.map(([value, label]) => (
                  <label key={value} className="tri-state-option">
                    <input
                      className="visually-hidden"
                      type="radio"
                      name={`${group}-${row.key}`}
                      value={value}
                      checked={row.value === value}
                      onChange={() => onSet(row.key, value)}
                    />
                    <span className="tri-state-text">{label}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <select
                className="text-input text-input-quiet filter-row-select"
                aria-label={row.name}
                value={row.value}
                onChange={(event) => onSet(row.key, event.target.value)}
              >
                <option value={ANY_VALUE}>Any</option>
                {/* A value the reader chose that the library no longer holds —
                    a rescan dropped the last song with it. Without this the
                    select would show an empty box over a list filtered by
                    something nothing on screen names. */}
                {row.value !== ANY_VALUE &&
                  !row.options.includes(row.value) && (
                    <option value={row.value}>{row.value}</option>
                  )}
                {row.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="filter-panel-footer">
        <button type="button" className="button" onClick={onReset}>
          Reset
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
