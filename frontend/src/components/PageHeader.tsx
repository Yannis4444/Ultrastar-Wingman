import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./icons";
import "./PageHeader.css";

interface PageHeaderProps {
  title: string;
  /** Where the back arrow leads; no arrow without it. */
  back?: string;
  /** Controls at the right edge of the header row. */
  children?: ReactNode;
}

/** Subpage header: back arrow, title, optional trailing controls. */
export default function PageHeader({ title, back, children }: PageHeaderProps) {
  return (
    <header className="page-header">
      {back && (
        <Link className="page-header-back" to={back} aria-label="Back">
          <Icon name="chevron-left" />
        </Link>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}
