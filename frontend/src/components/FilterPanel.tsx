import { useId } from "react";
import type { TagCriterion } from "../tags";
import { Icon, type IconName } from "./icons";
import Modal from "./Modal";
import "./FilterPanel.css";

/** One criterion the panel asks about: a built-in mark or a tag. */
export interface FilterRow {
  /** What the page calls this criterion — `favorite`, `sung` or `tag:<id>`. */
  key: string;
  name: string;
  icon: IconName;
  /** The `.tag-color-*` class the glyph is painted with. */
  colorClass: string;
  value: TagCriterion;
}

/** Any / Yes / No, in the order ui-guidelines §4 fixes them in. */
const OPTIONS: [TagCriterion, string][] = [
  ["any", "Any"],
  ["yes", "Yes"],
  ["no", "No"],
];

/**
 * The Songs page's **Filter** panel: one row per criterion, each ending in the
 * tri-state control of §4.
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
  onSet: (key: string, value: TagCriterion) => void;
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
            {/* The radios share a `name`, so the arrow keys walk the row the
                way a native radio group does — no key handler of our own. */}
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
