import { Link } from "react-router-dom";
import type { ManageEntry } from "../manage";
import { Icon } from "./icons";
import "./ManageMenu.css";

interface ManageMenuProps {
  /** Already filtered by rights — see `manageEntries`. */
  entries: ManageEntry[];
  /**
   * Router state handed to every row: the host view names itself as the way
   * back so the pages behind the rows return to the stage.
   */
  linkState?: unknown;
}

/**
 * The management rows, one navigation row per surface. Both the phone's user
 * page and the host screen's manage view render this, so a new entry or a
 * changed row shape reaches both at once; only the metrics differ, through the
 * host page's own overrides.
 */
export default function ManageMenu({ entries, linkState }: ManageMenuProps) {
  return (
    <nav className="manage-menu" aria-label="Manage">
      {entries.map((entry) => (
        <Link
          key={entry.to}
          className="manage-menu-row"
          to={entry.to}
          state={linkState}
        >
          <Icon name={entry.icon} className="manage-menu-icon" />
          <span className="manage-menu-label">{entry.label}</span>
          <Icon name="chevron-right" className="manage-menu-icon" />
        </Link>
      ))}
    </nav>
  );
}
