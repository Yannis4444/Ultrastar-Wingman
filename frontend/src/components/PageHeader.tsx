import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { backTarget } from "../backLink";
import { Icon } from "./icons";
import "./PageHeader.css";

interface PageHeaderProps {
  title: string;
  /** Where the back arrow leads by default; no arrow without it. */
  back?: string;
  /** Controls at the right edge of the header row. */
  children?: ReactNode;
}

/** Subpage header: back arrow, title, optional trailing controls. */
export default function PageHeader({ title, back, children }: PageHeaderProps) {
  // A page can be reached from more than one surface — the host manage view
  // opens the same settings the user page does — so the link that led here may
  // name the way back. Without it the page's own parent stays the destination,
  // which is also what a reload falls back to.
  const target = backTarget(useLocation().state) ?? back;

  return (
    <header className="page-header">
      {target && (
        <Link className="page-header-back" to={target} aria-label="Back">
          <Icon name="chevron-left" />
        </Link>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}
