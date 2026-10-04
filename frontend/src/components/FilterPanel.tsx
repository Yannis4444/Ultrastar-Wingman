import { ANY_VALUE, type TagCriterion } from "../tags";
import { Icon, type IconName } from "./icons";
import Modal from "./Modal";
import "./FilterPanel.css";

/** What every chip of the panel has: glyph · name (§4). */
interface FilterRowBase {
  /** What the page calls this criterion — `favorite`, `sung`, `tag:<id>` or
   *  `facet:<id>`. The `tag:` ones make up the panel's second cloud. */
  key: string;
  name: string;
  icon: IconName;
  /** The `.tag-color-*` class the glyph is painted with. */
  colorClass: string;
}

/** A mark, a tag or a boolean facet: the chip that cycles Any / Yes / No (§4). */
export interface TriStateFilterRow extends FilterRowBase {
  kind: "tri-state";
  value: TagCriterion;
}

/**
 * A valued facet: the same chip over an invisible `<select>` (§4). `options`
 * are the values the reader's own library holds — the page reads them off the
 * songs, because a value nothing visible carries is a value nothing would
 * match.
 */
export interface SelectFilterRow extends FilterRowBase {
  kind: "select";
  value: string;
  options: string[];
}

/** One criterion the panel asks about. */
export type FilterRow = TriStateFilterRow | SelectFilterRow;

/** Where a tap takes a cycling chip: Any → Yes → No → Any, from wherever it
 *  stands (§4), so a hidden-by-default tag that opens on *No* comes back on
 *  its first tap. */
const NEXT: Record<TagCriterion, TagCriterion> = {
  any: "yes",
  yes: "no",
  no: "any",
};

/** The word a screen reader hears after the criterion's name. */
const STATE_WORD: Record<TagCriterion, string> = {
  any: "Any",
  yes: "Yes",
  no: "No",
};

/**
 * A mark, a tag or a boolean facet. A plain `<button>`, so Enter and Space
 * cycle it the way a tap does with no key handler of our own. The state is a
 * word in its name rather than `aria-pressed`, whose true and false cannot say
 * *No*.
 */
function CycleChip({
  row,
  onSet,
}: {
  row: TriStateFilterRow;
  onSet: (key: string, value: string) => void;
}) {
  const no = row.value === "no";
  const className =
    row.value === "yes" ? "chip chip-on" : no ? "chip filter-chip-no" : "chip";
  return (
    <button
      type="button"
      className={className}
      onClick={() => onSet(row.key, NEXT[row.value])}
    >
      {/* *No* swaps the criterion's own glyph for `eye-off`, the same 1em
          square, so the chip keeps its width through the cycle. */}
      <Icon
        name={no ? "eye-off" : row.icon}
        className={
          no ? "filter-chip-glyph" : `filter-chip-glyph ${row.colorClass}`
        }
      />
      <span className="chip-name">{row.name}</span>
      <span className="visually-hidden"> {STATE_WORD[row.value]}</span>
    </button>
  );
}

/**
 * A valued facet: glyph · the facet's name or the chosen value · a chevron,
 * under a bare `<select>` laid over the whole chip, so a tap anywhere opens
 * the native list and the chip is as wide as its text rather than its longest
 * option. The select is the control and carries the name; what is drawn is
 * hidden from a screen reader, which would otherwise hear it twice.
 */
function SelectChip({
  row,
  onSet,
}: {
  row: SelectFilterRow;
  onSet: (key: string, value: string) => void;
}) {
  const chosen = row.value !== ANY_VALUE;
  return (
    <div className={chosen ? "chip chip-on" : "chip"}>
      <Icon name={row.icon} className={`filter-chip-glyph ${row.colorClass}`} />
      <span className="chip-name" aria-hidden="true">
        {chosen ? row.value : row.name}
      </span>
      <Icon name="chevron-down" className="filter-chip-chevron" />
      <select
        className="filter-chip-select"
        aria-label={row.name}
        value={row.value}
        onChange={(event) => onSet(row.key, event.target.value)}
      >
        {/* The facet's own name is the "not filtering" entry. */}
        <option value={ANY_VALUE}>{row.name}</option>
        {/* A value the reader chose that the library no longer holds — a
            rescan dropped the last song with it. Without this the select would
            fall back to the first entry while the list stays filtered by
            something nothing on screen names. */}
        {chosen && !row.options.includes(row.value) && (
          <option value={row.value}>{row.value}</option>
        )}
        {row.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One wrapping cloud of chips, named for a screen reader alone: the glyphs
 *  already say which cloud is which. */
function Cloud({
  label,
  rows,
  onSet,
}: {
  label: string;
  rows: FilterRow[];
  onSet: (key: string, value: string) => void;
}) {
  return (
    <div className="filter-cloud" role="group" aria-label={label}>
      {rows.map((row) =>
        row.kind === "tri-state" ? (
          <CycleChip key={row.key} row={row} onSet={onSet} />
        ) : (
          <SelectChip key={row.key} row={row} onSet={onSet} />
        ),
      )}
    </div>
  );
}

/**
 * The Songs page's **Filter** panel: one hint line over two clouds of the
 * filter chips of §4 — *Built-in* (the marks and the facets) and, under a
 * hairline, *Tags* — in the order the page hands the criteria over.
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
  const builtIn = rows.filter((row) => !row.key.startsWith("tag:"));
  const tags = rows.filter((row) => row.key.startsWith("tag:"));

  return (
    <Modal title="Filter" onClose={onClose}>
      <div className="filter-panel">
        <p className="section-note">
          Tap once for only these songs, twice to leave them out.
        </p>
        {/* A cloud with nothing in it is not drawn — nor, with it, the
            hairline that would separate it from nothing. */}
        {builtIn.length > 0 && (
          <Cloud label="Built-in" rows={builtIn} onSet={onSet} />
        )}
        {tags.length > 0 && <Cloud label="Tags" rows={tags} onSet={onSet} />}
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
